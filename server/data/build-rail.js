import { existsSync } from 'fs';
import { join } from 'path';
import { readCsv, readCsvAll } from './csv.js';
import { DAY_NAMES, addDays, crowdedDates, isoDate, pickWeek, serviceDates, toSeconds, weekday } from './calendar.js';
import { applyHours } from './stasy.js';
import { POSITIONS } from './validate.js';

// Build rail.json — everything the subway page needs, offline:
//
// {
//   schema,
//   feed:      { validFrom, validTo, week: { sun: 'YYYY-MM-DD', … } }   ← dates the weekly timetable was taken from
//   hours?:    { fetched: 'YYYY-MM-DD' }                                ← the copy of STASY's first and last trains
//   positions: ['back', …, 'front'],
//   stations:  { id: { name: { el, en }, coords: [lat, lng], lines: ['M1', …] } },
//   lines: { M1: { name, color, directions: { kifisia: {
//       toward: { el, en },
//       stops:  [{ station, exits, elevators?, escalators?, stairs?, centralPlatform?, transfers?, note?, hours? }, …],   ← in travel order
//       timetable: {
//         profiles: [{ stops: [stopIndex, …], offsets: [seconds from first stop, …] }, …],
//         patterns: [[[startSeconds, profileIndex], …], …],                              ← one list of trips per distinct day
//         days:     [patternIndex × 7],                                                   ← index 0 = Sunday
//         dates:    { 'YYYY-MM-DD': patternIndex }                                        ← dates whose trains aren't their weekday's
//       } } } } }
// }
//
// A trip departs its first stop at `startSeconds` (may exceed 86400 after
// midnight) and reaches stops[profile.stops[i]] at startSeconds + offsets[i].
// `days` is one typical week, for any date; `dates` has the feed's own trains
// for the days from yesterday to its end that differ from that week (a
// holiday, a new timetable), so the planner shows a date's real trains while
// the feed has them.
// Branches (e.g. M3 trains that end at Doukissis instead of the airport) are
// simply trips whose profile covers fewer stops. Trains the feed lists twice
// are kept once (see dropCopies). A stop's `hours` are STASY's first and last
// trains from there, [{ to, first, last }] (stasy.js, readLine).

const RAIL_SCHEMA = 1;
const DAY = 86_400;

/**
 * stasy: the copy of STASY's timetables (stasy.js, stasyTables), or null
 * @param {{ dir: string, curated: any, today: string, stasy?: any }} options
 * @returns {Promise<{ data: import('../../types/data.js').Rail, warnings: string[], notes: string[] }>}
 */
export async function buildRail({ dir, curated, today, stasy = null }) {
    const { stations, lines, positions, airport = null } = curated;
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
    // The dates the planner may ask for, from yesterday (its trains after
    // midnight) on, and the day before them, for its trains the next day
    // repeats (dropCopies)
    const dates = [...dateServices.keys()].filter(d => d >= addDays(today, -2)).sort();
    // A date the feed lays two timetables over keeps the typical week's trains
    const crowded = crowdedDates(dateServices, tripsPerService);
    const ownDates = dates.filter(d => d >= addDays(today, -1) && !crowded.has(d));
    const notes = dates.filter(d => d >= addDays(today, -1) && crowded.has(d))
        .map(d => `${isoDate(d)}: the GTFS lists far more trains than usual for a line (two timetables laid over each other?); the typical ${DAY_NAMES[weekday(d)]} is used`);
    const neededServices = new Set([...weekServices, ...dates.map(d => dateServices.get(d))].flatMap(s => [...s]));
    // Each day trains run on: the typical week's weekdays (0 = Sunday) and the dates ('YYYYMMDD')
    const serviceDays = [
        ...DAY_NAMES.map((_, wd) => ({ key: wd, before: (wd + 6) % 7 })),
        ...dates.map(d => ({ key: d, before: addDays(d, -1) })),
    ];

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
        const days = [
            ...weekServices.flatMap((s, wd) => s.has(service) ? [wd] : []),
            ...dates.filter(d => dateServices.get(d).has(service)),
        ];
        ((byDirection[line] ??= {})[dirKey] ??= []).push({
            stations: stopList.map(s => s[1]),
            times: stopList.map(s => s[2]),
            days,
        });
    }

    // ── Assemble lines ──────────────────────────────────────────────────────
    const out = {};
    const stationLines = new Map();
    // Each direction's trips, timetabled once STASY's hours are on its stops
    const pending = [];
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

            dropCopies(dirTrips, serviceDays, `${lineId}/${dirKey}`, warnings);
            directions[dirKey] = {
                toward: dir.toward,
                stops: order.map(station => stopPositions(positions, lineId, dirKey, station, warnings)),
            };
            pending.push({ direction: directions[dirKey], dirTrips, order, indexOf, label: `${lineId}/${dirKey}`, timetabled: airport?.lines?.[lineId]?.[dirKey] });

            const extra = Object.keys(positions[lineId]?.[dirKey] ?? {}).filter(s => !indexOf.has(s));
            if (extra.length) throw new Error(`positions.json: ${lineId}/${dirKey} lists stations the line doesn't serve: ${extra.join(', ')}`);
        }
        out[lineId] = { name: line.name, color: line.color, directions };
    }

    const hoursFetched = applyHours(out, stasy, stations.stations, warnings);
    for (const { direction, dirTrips, order, indexOf, label, timetabled } of pending) {
        trimToHours(dirTrips, direction.stops, label, warnings);
        if (timetabled) addTimetabled(dirTrips, timetabled, order, serviceDays.map(d => d.key), label, warnings);
        direction.timetable = buildTimetable(dirTrips, indexOf, ownDates, label);
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

    const allDates = [...dateServices.keys()].sort();
    const validTo = allDates.at(-1);
    if (validTo < today) warnings.push(`Rail feed expired on ${isoDate(validTo)}; using the timetable of its last full week`);

    return {
        data: {
            schema: RAIL_SCHEMA,
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
        // For the nightly checks (rail-checks.js)
        notes,
    };
}

function stopPositions(positions, lineId, dirKey, station, warnings) {
    const p = positions[lineId]?.[dirKey]?.[station];
    if (!p) warnings.push(`positions.json: no entry for ${lineId}/${dirKey}/${station}`);
    else if (!p.exits?.length) warnings.push(`positions.json: no exits for ${lineId}/${dirKey}/${station}`);
    return { station, exits: [], ...p };
}

// Turn raw trips into shared run-time profiles plus [start, profile] pairs per
// day: each weekday of the typical week, and the dates (`ownDates`,
// 'YYYYMMDD') whose trains differ from their weekday's. Each distinct day is
// stored once; `days` maps weekday → pattern, `dates` ISO date → pattern.
function buildTimetable(dirTrips, indexOf, ownDates, label) {
    // Run-time profiles by key, in the order trips first use them
    const shapes = new Map();
    const week = Array.from({ length: 7 }, () => []);
    const onDate = new Map(ownDates.map(d => [d, []]));

    for (const trip of dirTrips) {
        if (!trip.days.length) continue;
        const stops = trip.stations.map(s => {
            if (!indexOf.has(s)) throw new Error(`${label}: a trip serves ${s}, which is not on the line's longest pattern (branching lines are not supported)`);
            return indexOf.get(s);
        });
        const start = trip.times[0];
        const offsets = trip.times.map(t => t - start);
        const key = `${stops.join(',')}|${offsets.join(',')}`;
        if (!shapes.has(key)) shapes.set(key, { stops, offsets, order: shapes.size });
        for (const day of trip.days) (typeof day === 'number' ? week[day] : onDate.get(day))?.push([start, key]);
    }
    const lists = [...week, ...onDate.values()];
    for (const list of lists) list.sort((a, b) => a[0] - b[0] || shapes.get(a[1]).order - shapes.get(b[1]).order);

    const same = (a, b) => a.length === b.length && a.every(([start, key], i) => start === b[i][0] && key === b[i][1]);
    const own = [...onDate].filter(([date, list]) => !same(list, week[weekday(date)]));

    // Only the profiles the days kept use
    const used = new Set([...week, ...own.map(([, list]) => list)].flatMap(list => list.map(([, key]) => key)));
    const profileIndex = new Map([...shapes.keys()].filter(key => used.has(key)).map((key, i) => [key, i]));
    const profiles = [...profileIndex.keys()].map(key => ({ stops: shapes.get(key).stops, offsets: shapes.get(key).offsets }));

    const patterns = [];
    const seen = new Map();
    const patternOf = list => {
        const trips = list.map(([start, key]) => [start, profileIndex.get(key)]);
        const id = JSON.stringify(trips);
        if (!seen.has(id)) { seen.set(id, patterns.length); patterns.push(trips); }
        return seen.get(id);
    };
    const days = week.map(patternOf);
    const dates = Object.fromEntries(own.map(([date, list]) => [isoDate(date), patternOf(list)]));
    return { profiles, patterns, days, dates };
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

// serviceDays: [{ key, before }], each day (a weekday or a date) and the one before it.
// The warning counts the typical week's.
function dropCopies(dirTrips, serviceDays, label, warnings) {
    const isCopy = (trip, of, shift) => trip.stations.length === of.stations.length
        && trip.stations.every((s, i) => s === of.stations[i] && Math.abs(trip.times[i] - (of.times[i] - shift)) <= COPY_SECONDS);
    const dropped = [];
    for (const { key, before } of serviceDays) {
        const day = dirTrips.filter(t => t.days.includes(key)).sort((a, b) => a.times[0] - b.times[0]);
        const night = dirTrips.filter(t => t.days.includes(before) && t.times[0] >= DAY - COPY_SECONDS);
        let n = 0;
        day.forEach((trip, i) => {
            const earlier = day.slice(0, i).filter(t => t.days.includes(key));
            if (earlier.some(t => isCopy(trip, t, 0)) || night.some(t => isCopy(trip, t, DAY))) {
                trip.days = trip.days.filter(d => d !== key);
                n++;
            }
        });
        if (n && typeof key === 'number') dropped.push(`${DAY_NAMES[key]}: ${n}`);
    }
    if (dropped.length) warnings.push(`${label}: the feed lists some trains twice; kept one of each (${dropped.join(', ')})`);
}

// STASY's own timetable for some trains, every day (data/curated/airport.json:
// the airport trains, from its PDFs), which the GTFS misses (the last ones) or
// ends early (at Doukissis). A GTFS train through `serves` (the airport)
// within COPY_SECONDS of a timetable train there is that train, and keeps the
// GTFS's times (they fit the line's other trains; the PDFs are from 2024 and
// put a few up to 3 minutes off along the way: listed in a warning). On a day
// the GTFS has none, the timetable's runs, with STASY's times at every
// station, in place of a GTFS train calling only at its stations, each within
// COPY_SECONDS (ending early; only then: a train as close but going on is
// another one). GTFS trains through `serves` that are none of them are kept,
// and listed in a warning too, to check on the platform.
function addTimetabled(dirTrips, timetabled, order, days, label, warnings) {
    if (timetabled.stations.join() !== order.join()) {
        warnings.push(`airport.json: ${label} lists other stations than the line has; its trains weren't added`);
        return;
    }
    const at = new Map(order.map((s, i) => [s, i]));
    const served = timetabled.serves;
    const inService = dirTrips.filter(t => t.days.length);
    const matched = new Set();
    const added = [];
    const differ = [];
    for (const train of timetabled.trains) {
        const times = train.times.map(toSeconds);
        const off = (trip, i) => Math.abs(trip.times[i] - times[at.get(trip.stations[i])]);
        const same = inService.filter(t => t.stations.includes(served) && off(t, t.stations.indexOf(served)) <= COPY_SECONDS);
        const short = inService.filter(t => !t.stations.includes(served) && t.stations.every((_, i) => off(t, i) <= COPY_SECONDS));
        for (const t of same) matched.add(t);
        const missing = [];
        for (const day of days) {
            if (same.some(t => t.days.includes(day))) continue;
            missing.push(day);
            for (const t of short) t.days = t.days.filter(d => d !== day);
        }
        const worst = Math.max(0, ...same.flatMap(t => t.stations.map((_, i) => off(t, i))));
        if (worst > COPY_SECONDS) differ.push(`${train.times[0]} (up to ${Math.round(worst / 60)} min)`);
        if (!missing.length) continue;
        dirTrips.push({ stations: [...order], times, days: missing });
        if (missing.some(d => typeof d === 'number')) added.push(`${train.times[0]} (${weekDays(missing)})`);
    }
    if (added.length) warnings.push(`${label}: STASY's airport timetable adds trains the GTFS doesn't have, or has only part of: ${added.join(', ')}`);
    if (differ.length) warnings.push(`${label}: the GTFS times airport trains differently from STASY's airport timetable (the GTFS's are kept; check them on the platform): ${differ.join(', ')}`);
    const others = inService.filter(t => t.days.length && !matched.has(t) && t.stations.includes(served));
    if (others.length) {
        const list = others.sort((a, b) => a.times[0] - b.times[0]).map(t => `${t.stations[0]} ${clock(t.times[0])} (${weekDays(t.days)})`);
        warnings.push(`${label}: the GTFS has airport trains STASY's airport timetable doesn't (kept; check them on the platform): ${list.join(', ')}`);
    }
}

// The typical week's days among a train's: "every day", "mon, tue", or "dates only"
function weekDays(days) {
    const week = DAY_NAMES.filter((_, wd) => days.includes(wd));
    return week.length === 7 ? 'every day' : week.length ? week.join(', ') : 'dates only';
}

const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}`;

// Trains STASY doesn't publish (depot runs): a train is in service from its
// first call that isn't before the first train at its stop, up to its first
// call after the last train (STASY's hours there, with HOURS_LEEWAY: the
// timetable times the same trains up to 3 minutes off STASY's, depot runs
// leave 6 minutes or more outside them); a train left without two calls goes. The window at a call is the hours to the furthest destination
// the train reaches, or all of the stop's together when it reaches none of
// them (a train turning back early, like Kifisia → Eirini). Stops without
// STASY's hours set no limits. So the timetable's first and last trains are
// STASY's, and the planner offers no train that doesn't carry passengers:
// Dimotiko Theatro → Elaionas at 00:51 goes, and M1's 00:30 from Piraeus
// "only as far as Omonia" ends at Omonia.
export const HOURS_LEEWAY = 300;

function trimToHours(dirTrips, stops, label, warnings) {
    const at = new Map(stops.map((s, i) => [s.station, i]));
    // Leaving `station` on weekday wd on a train that ends at stop index `end`: { first, last } (null: no limit)
    const window = (station, end, wd) => {
        const hours = stops[at.get(station)].hours;
        if (!hours) return { first: null, last: null };
        const reached = hours.filter(h => at.get(h.to) <= end);
        const use = reached.length ? [reached.at(-1)] : hours;
        const limit = (kind, pick) => {
            const values = use.map(h => h[kind][wd]);
            return values.includes(null) ? null : pick(...values);
        };
        return { first: limit('first', Math.min), last: limit('last', Math.max) };
    };
    let left = 0;
    let shortened = 0;
    const variants = [];
    for (const trip of dirTrips) {
        const kept = new Map();   // "from,to" (call indexes) → days
        for (const day of trip.days) {
            // A date has its own weekday's hours (STASY's tables have no holidays)
            const wd = typeof day === 'number' ? day : weekday(day);
            let a = 0;
            let b = trip.stations.length - 1;
            const end = () => at.get(trip.stations[b]);
            while (a < b) {
                const { first } = window(trip.stations[a], end(), wd);
                if (first === null || trip.times[a] >= first - HOURS_LEEWAY) break;
                a++;
            }
            // It leaves service at its first call after the last train (a depot run
            // catching up near the end of the line still goes from its start)
            for (let k = a; k < b; k++) {
                const { last } = window(trip.stations[k], end(), wd);
                if (last !== null && trip.times[k] > last + HOURS_LEEWAY) b = k;
            }
            const key = a < b ? `${a},${b}` : null;
            // Counted on the typical week
            if (typeof day === 'number') {
                if (!key) left++;
                else if (key !== `0,${trip.stations.length - 1}`) shortened++;
            }
            if (key) kept.set(key, [...(kept.get(key) ?? []), day]);
        }
        const whole = `0,${trip.stations.length - 1}`;
        for (const [key, days] of kept) {
            if (key === whole) continue;
            const [a, b] = key.split(',').map(Number);
            variants.push({ stations: trip.stations.slice(a, b + 1), times: trip.times.slice(a, b + 1), days });
        }
        trip.days = kept.get(whole) ?? [];
    }
    dirTrips.push(...variants);
    if (left || shortened) warnings.push(`${label}: ${left + shortened} trains run outside STASY's first and last trains: ${left} left out, ${shortened} shortened`);
}

function round(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
