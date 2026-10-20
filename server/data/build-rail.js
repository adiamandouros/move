import { existsSync } from 'fs';
import { join } from 'path';
import { readCsv, readCsvAll } from './csv.js';
import { DAY_NAMES, isoDate, pickWeek, serviceDates, toSeconds } from './calendar.js';
import { applyHours } from './stasy.js';
import { POSITIONS } from './validate.js';

// Build rail.json — everything the subway page needs, offline:
//
// {
//   schema, generated,
//   feed:      { validFrom, validTo, week: { sun: 'YYYY-MM-DD', … } }   ← dates the weekly timetable was taken from
//   hours?:    { fetched: 'YYYY-MM-DD' }                                ← the copy of STASY's first and last trains
//   positions: ['back', …, 'front'],
//   stations:  { id: { name: { el, en }, coords: [lat, lng], lines: ['M1', …] } },
//   lines: { M1: { name, color, directions: { kifisia: {
//       toward: { el, en },
//       stops:  [{ station, exits, elevators?, centralPlatform?, transfers?, note?, hours? }, …],   ← in travel order
//       timetable: {
//         profiles: [{ stops: [stopIndex, …], offsets: [seconds from first stop, …] }, …],
//         patterns: [[[startSeconds, profileIndex], …], …],                              ← one list of trips per distinct day
//         days:     [patternIndex × 7]                                                    ← index 0 = Sunday
//       } } } } }
// }
//
// A trip departs its first stop at `startSeconds` (may exceed 86400 after
// midnight) and reaches stops[profile.stops[i]] at startSeconds + offsets[i].
// Branches (e.g. M3 trains that end at Doukissis instead of the airport) are
// simply trips whose profile covers fewer stops. Trains the feed lists twice
// are kept once (see dropCopies). A stop's `hours` are STASY's first and last
// trains from there, [{ to, first, last }] (stasy.js, readLine).

export const RAIL_SCHEMA = 1;
const DAY = 86_400;

/**
 * stasy: the copy of STASY's timetables (stasy.js, stasyTables), or null
 * @param {{ dir: string, curated: any, today: string, stasy?: any }} options
 * @returns {Promise<{ data: import('../../types/data.js').Rail, warnings: string[] }>}
 */
export async function buildRail({ dir, curated, today, stasy = null }) {
    const { stations, lines, positions } = curated;
    const file = name => join(dir, name);
    const warnings = [];

    // ── Routes and directions ───────────────────────────────────────────────
    const routeLine = new Map();
    for (const r of await readCsvAll(file('routes.txt'), { required: ['route_id', 'route_short_name'] })) {
        if (lines[r.route_short_name]) routeLine.set(r.route_id, r.route_short_name);
    }
    const foundLines = new Set(routeLine.values());
    for (const id of Object.keys(lines)) if (!foundLines.has(id)) throw new Error(`Line ${id} is not in the rail feed's routes.txt`);

    const dirKeyOf = {};
    for (const [id, line] of Object.entries(lines)) {
        dirKeyOf[id] = Object.fromEntries(Object.entries(line.directions).map(([key, d]) => [d.gtfsDirection, key]));
    }

    // ── Calendar and trips ──────────────────────────────────────────────────
    const optional = async name => existsSync(file(name)) ? readCsvAll(file(name)) : [];
    const dateServices = serviceDates(await optional('calendar.txt'), await optional('calendar_dates.txt'));
    if (!dateServices.size) throw new Error('Rail feed has no service dates');

    const trips = new Map();
    const tripsPerService = new Map();
    for (const t of await readCsvAll(file('trips.txt'), { required: ['route_id', 'service_id', 'trip_id', 'direction_id'] })) {
        const line = routeLine.get(t.route_id);
        if (!line) continue;
        const dirKey = dirKeyOf[line][t.direction_id];
        if (!dirKey) throw new Error(`Trip ${t.trip_id}: ${line} has no direction with gtfsDirection ${t.direction_id} in lines.json`);
        trips.set(t.trip_id, { line, dirKey, service: t.service_id });
        if (!tripsPerService.has(t.service_id)) tripsPerService.set(t.service_id, new Map());
        const perLine = tripsPerService.get(t.service_id);
        perLine.set(line, (perLine.get(line) ?? 0) + 1);
    }

    const week = pickWeek(dateServices, tripsPerService, today);
    const weekServices = week.map(date => dateServices.get(date));
    const neededServices = new Set(weekServices.flatMap(s => [...s]));

    // ── Stops → curated stations ────────────────────────────────────────────
    const stationOfCode = new Map();
    for (const [id, s] of Object.entries(stations.stations)) for (const code of s.gtfs) stationOfCode.set(code, id);
    const ignored = new Set(stations.ignoreGtfs ?? []);

    const stopById = new Map();
    const coordSums = new Map();
    for (const s of await readCsvAll(file('stops.txt'), { required: ['stop_id', 'stop_code', 'stop_lat', 'stop_lon'] })) {
        const station = stationOfCode.get(s.stop_code) ?? null;
        stopById.set(s.stop_id, { code: s.stop_code, station });
        if (!station) continue;
        const sum = coordSums.get(station) ?? { lat: 0, lng: 0, n: 0 };
        sum.lat += +s.stop_lat; sum.lng += +s.stop_lon; sum.n++;
        coordSums.set(station, sum);
    }
    const feedCodes = new Set([...stopById.values()].map(s => s.code));
    const missingCodes = [...stationOfCode.keys()].filter(c => !feedCodes.has(c));
    if (missingCodes.length) warnings.push(`stations.json codes not in the rail feed: ${missingCodes.join(', ')}`);

    // ── Stop times for the chosen week ──────────────────────────────────────
    const tripStops = new Map();
    const unmapped = new Set();
    const stopTimeCols = ['trip_id', 'departure_time', 'stop_id', 'stop_sequence'];
    for await (const st of readCsv(file('stop_times.txt'), { required: stopTimeCols })) {
        const trip = trips.get(st.trip_id);
        if (!trip || !neededServices.has(trip.service)) continue;
        const stop = stopById.get(st.stop_id);
        if (!stop) throw new Error(`stop_times.txt references unknown stop_id ${st.stop_id}`);
        if (!stop.station) {
            if (!ignored.has(stop.code)) unmapped.add(stop.code);
            continue;
        }
        if (!tripStops.has(st.trip_id)) tripStops.set(st.trip_id, []);
        tripStops.get(st.trip_id).push([+st.stop_sequence, stop.station, toSeconds(st.departure_time || st.arrival_time)]);
    }
    if (unmapped.size) {
        throw new Error(`Rail stops not mapped to any station — add them to a station's "gtfs" list or to "ignoreGtfs" in stations.json: ${[...unmapped].join(', ')}`);
    }

    // line → dirKey → [{ stations, times, days }]
    const byDirection = {};
    for (const [tripId, stopList] of tripStops) {
        const { line, dirKey, service } = trips.get(tripId);
        stopList.sort((a, b) => a[0] - b[0]);
        const days = weekServices.flatMap((s, wd) => s.has(service) ? [wd] : []);
        ((byDirection[line] ??= {})[dirKey] ??= []).push({
            stations: stopList.map(s => s[1]),
            times: stopList.map(s => s[2]),
            days,
        });
    }

    // ── Assemble lines ──────────────────────────────────────────────────────
    const out = {};
    const stationLines = new Map();
    for (const [lineId, line] of Object.entries(lines)) {
        const directions = {};
        for (const [dirKey, dir] of Object.entries(line.directions)) {
            const dirTrips = byDirection[lineId]?.[dirKey];
            if (!dirTrips?.length) throw new Error(`${lineId}/${dirKey} has no trips in the chosen week`);

            const order = dirTrips.reduce((a, t) => t.stations.length > a.length ? t.stations : a, []);
            const indexOf = new Map(order.map((s, i) => [s, i]));
            for (const s of order) {
                if (!stationLines.has(s)) stationLines.set(s, new Set());
                stationLines.get(s).add(lineId);
            }

            dropCopies(dirTrips, `${lineId}/${dirKey}`, warnings);
            const timetable = buildTimetable(dirTrips, indexOf, `${lineId}/${dirKey}`);

            directions[dirKey] = {
                toward: dir.toward,
                stops: order.map(station => stopPositions(positions, lineId, dirKey, station, warnings)),
                timetable: dedupeDays(timetable),
            };

            const extra = Object.keys(positions[lineId]?.[dirKey] ?? {}).filter(s => !indexOf.has(s));
            if (extra.length) throw new Error(`positions.json: ${lineId}/${dirKey} lists stations the line doesn't serve: ${extra.join(', ')}`);
        }
        out[lineId] = { name: line.name, color: line.color, directions };
    }

    const stationsOut = {};
    for (const [id, s] of Object.entries(stations.stations)) {
        const sum = coordSums.get(id);
        if (!stationLines.has(id)) { warnings.push(`stations.json: ${id} is not served by any trip`); continue; }
        stationsOut[id] = {
            name: s.name,
            coords: [round(sum.lat / sum.n, 5), round(sum.lng / sum.n, 5)],
            lines: [...stationLines.get(id)].sort(),
        };
    }

    const hoursFetched = applyHours(out, stasy, stations.stations, warnings);

    const allDates = [...dateServices.keys()].sort();
    const validTo = allDates.at(-1);
    if (validTo < today) warnings.push(`Rail feed expired on ${isoDate(validTo)}; using the timetable of its last full week`);

    return {
        data: {
            schema: RAIL_SCHEMA,
            generated: new Date().toISOString(),
            feed: {
                validFrom: isoDate(allDates[0]),
                validTo: isoDate(validTo),
                week: Object.fromEntries(week.map((d, wd) => [DAY_NAMES[wd], isoDate(d)])),
            },
            ...(hoursFetched && { hours: { fetched: hoursFetched } }),
            positions: POSITIONS,
            stations: stationsOut,
            lines: out,
        },
        warnings,
    };
}

function stopPositions(positions, lineId, dirKey, station, warnings) {
    const p = positions[lineId]?.[dirKey]?.[station];
    if (!p) warnings.push(`positions.json: no entry for ${lineId}/${dirKey}/${station}`);
    else if (!p.exits?.length) warnings.push(`positions.json: no exits for ${lineId}/${dirKey}/${station}`);
    return { station, exits: [], ...p };
}

// Turn raw trips into shared run-time profiles plus [start, profile] pairs per weekday.
function buildTimetable(dirTrips, indexOf, label) {
    const profiles = [];
    const profileIndex = new Map();
    const days = Array.from({ length: 7 }, () => []);

    for (const trip of dirTrips) {
        if (!trip.days.length) continue;
        const stops = trip.stations.map(s => {
            if (!indexOf.has(s)) throw new Error(`${label}: a trip serves ${s}, which is not on the line's longest pattern (branching lines are not supported)`);
            return indexOf.get(s);
        });
        const start = trip.times[0];
        const offsets = trip.times.map(t => t - start);
        const key = `${stops.join(',')}|${offsets.join(',')}`;
        if (!profileIndex.has(key)) {
            profileIndex.set(key, profiles.length);
            profiles.push({ stops, offsets });
        }
        for (const wd of trip.days) days[wd].push([start, profileIndex.get(key)]);
    }
    for (const list of days) list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { profiles, days };
}

// The feed sometimes lists a train twice: two timetables laid over each other
// (M1 on 1–2 Oct 2026), or Saturday night's trains again at the start of
// Sunday's service (M2 and M3). A train is a copy of another when it calls at
// the same stations, each within COPY_SECONDS of the other (the Saturday night
// copies drift by up to 84 s along the line; two real trains can't follow each
// other that closely all the way); the copy is taken off that day. A copy of
// the night before's train is taken off the later day, whose service it
// isn't. Trains as close but on different stations are real (an airport train
// right behind a Doukissis one), so they stay.
const COPY_SECONDS = 90;

function dropCopies(dirTrips, label, warnings) {
    const isCopy = (trip, of, shift) => trip.stations.length === of.stations.length
        && trip.stations.every((s, i) => s === of.stations[i] && Math.abs(trip.times[i] - (of.times[i] - shift)) <= COPY_SECONDS);
    const dropped = [];
    for (let wd = 0; wd < 7; wd++) {
        const day = dirTrips.filter(t => t.days.includes(wd)).sort((a, b) => a.times[0] - b.times[0]);
        const night = dirTrips.filter(t => t.days.includes((wd + 6) % 7) && t.times[0] >= DAY - COPY_SECONDS);
        let n = 0;
        day.forEach((trip, i) => {
            const earlier = day.slice(0, i).filter(t => t.days.includes(wd));
            if (earlier.some(t => isCopy(trip, t, 0)) || night.some(t => isCopy(trip, t, DAY))) {
                trip.days = trip.days.filter(d => d !== wd);
                n++;
            }
        });
        if (n) dropped.push(`${DAY_NAMES[wd]}: ${n}`);
    }
    if (dropped.length) warnings.push(`${label}: the feed lists some trains twice; kept one of each (${dropped.join(', ')})`);
}

// Store each distinct day once; `days` maps weekday → pattern.
function dedupeDays({ profiles, days }) {
    const patterns = [];
    const seen = new Map();
    const dayIndex = days.map(list => {
        const key = JSON.stringify(list);
        if (!seen.has(key)) { seen.set(key, patterns.length); patterns.push(list); }
        return seen.get(key);
    });
    return { profiles, patterns, days: dayIndex };
}

function round(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
