import { join } from 'path';
import { buildTimetable, dropCopies, exitLabel } from './build-rail.js';
import { toSeconds } from './calendar.js';
import { readCsv, readCsvAll } from './csv.js';

// The tram network for the Info page's tram map and the subway planner, from
// the same rail feed as the metro: rail.json's `tram`, in the shape of its
// metro part (so one map drawer and one route finder serve both), without car
// positions:
//
// {
//   stations: { id: { name: { el, en }, coords: [lat, lng], lines: ['T6', …], metro?: { station, lines }, walks?: [{ metro | stop, minutes, exit? }, …] } },
//   lines: { T6: { name, color, directions: { pikrodafni: { toward: { el, en }, stops: [{ station }, …], timetable } } } }
// }
//
// A direction's stops are its most common stop pattern in the feed. Other runs
// (trams that turn back early) go in its timetable as far as they follow those
// stops, as the metro's branches do; they aren't drawn. The two directions of a
// line may call at different stops: T7 runs one way round its Piraeus loop.
// `metro` is the metro station a stop changes to (tram.json's `metro`, with
// that station's lines from the metro part of rail.json), and `walks` the
// stops it's a short walk from, with the minutes: to change there, or instead
// of riding. A walk to a metro station that uses one of its exits (tram.json's
// `exit`, by its Greek name in street.json) has that exit's place in the
// station's `exits` (decision 51).
//
// The timetable is the feed's, on the metro's week and dates (`calendar`, from
// buildRail). Unlike the metro's it isn't held to STASY's: its first and last
// trams agree with STASY's tram page, but for the last trams to 2nd Agiou
// Kosma, which only STASY has (checked by hand, record 28).
//
// A problem here is a warning, never a failed rail.json: a stop the curated
// file doesn't know is left out, and without the tram the metro still works.
/**
 * What buildRail worked out about the feed's days: each service's days (a
 * weekday, 0 = Sunday, or a date), every such day with the day before it, and
 * the dates that may have trains of their own
 * @typedef {{ daysOf: (service: string) => (number | string)[], serviceDays: { key: number | string, before: number | string }[], ownDates: string[] }} Calendar
 */
/**
 * @param {{ dir: string, tram: any, metroStations: Record<string, { lines: string[] }>, calendar: Calendar }} options
 * @returns {Promise<{ data: import('../../types/data.js').Tram, warnings: string[] }>}
 */
export async function buildTram({ dir, tram, metroStations, calendar }) {
    const file = name => join(dir, name);
    const warnings = [];

    const routeLine = new Map();
    for (const r of await readCsvAll(file('routes.txt'), { required: ['route_id', 'route_short_name'] })) {
        if (tram.lines[r.route_short_name]) routeLine.set(r.route_id, r.route_short_name);
    }
    const dirKeyOf = Object.fromEntries(Object.entries(tram.lines).map(([id, line]) =>
        [id, Object.fromEntries(Object.entries(line.directions).map(([key, d]) => [d.gtfsDirection, key]))]));

    const trips = new Map();
    for (const t of await readCsvAll(file('trips.txt'), { required: ['route_id', 'service_id', 'trip_id', 'direction_id'] })) {
        const line = routeLine.get(t.route_id);
        const dirKey = line && dirKeyOf[line][t.direction_id];
        if (dirKey) trips.set(t.trip_id, { line, dirKey, service: t.service_id });
    }

    const stopOfCode = new Map();
    for (const [id, s] of Object.entries(tram.stops)) for (const code of s.gtfs) stopOfCode.set(code, id);
    const stopById = new Map();
    const coordSums = new Map();
    for (const s of await readCsvAll(file('stops.txt'), { required: ['stop_id', 'stop_code', 'stop_lat', 'stop_lon'] })) {
        stopById.set(s.stop_id, s.stop_code);
        const id = stopOfCode.get(s.stop_code);
        if (!id) continue;
        const sum = coordSums.get(id) ?? { lat: 0, lng: 0, n: 0 };
        sum.lat += +s.stop_lat; sum.lng += +s.stop_lon; sum.n++;
        coordSums.set(id, sum);
    }

    // Each trip's stops in order
    const tripStops = new Map();
    const unknown = new Set();
    for await (const st of readCsv(file('stop_times.txt'), { required: ['trip_id', 'departure_time', 'stop_id', 'stop_sequence'] })) {
        if (!trips.has(st.trip_id)) continue;
        const code = stopById.get(st.stop_id);
        const id = stopOfCode.get(code);
        if (!id) { unknown.add(code ?? st.stop_id); continue; }
        if (!tripStops.has(st.trip_id)) tripStops.set(st.trip_id, []);
        tripStops.get(st.trip_id).push([+st.stop_sequence, id, toSeconds(st.departure_time || st.arrival_time)]);
    }
    if (unknown.size) warnings.push(`tram.json: tram stops not on the map (add them to a stop's "gtfs" list): ${[...unknown].sort().join(', ')}`);

    // How many trips run each stop pattern, per line and direction, and what
    // each direction runs on the days the timetable keeps
    const counts = new Map();
    const runs = new Map();
    for (const [tripId, list] of tripStops) {
        const { line, dirKey, service } = trips.get(tripId);
        // Two platforms of a stop in a row are one call, left at the last one's time
        const calls = list.sort((a, b) => a[0] - b[0]).filter((call, i, all) => call[1] !== all[i + 1]?.[1]);
        const stations = calls.map(c => c[1]);
        const key = `${line}/${dirKey}`;
        if (!counts.has(key)) counts.set(key, new Map());
        const perPattern = counts.get(key);
        const pattern = stations.join(' ');
        perPattern.set(pattern, (perPattern.get(pattern) ?? 0) + 1);
        const days = calendar.daysOf(service);
        if (!days.length) continue;
        if (!runs.has(key)) runs.set(key, []);
        runs.get(key).push({ stations, times: calls.map(c => c[2]), days });
    }

    const lines = {};
    const stopLines = new Map();
    for (const [lineId, line] of Object.entries(tram.lines)) {
        const directions = {};
        const others = [];
        for (const [dirKey, dir] of Object.entries(line.directions)) {
            const patterns = [...counts.get(`${lineId}/${dirKey}`) ?? []].map(([p, n]) => ({ ids: p.split(' '), n }));
            if (!patterns.length) { warnings.push(`${lineId}/${dirKey}: no tram trips in the rail feed`); continue; }
            // The most common pattern; of equally common ones, the longest
            const [main, ...rest] = patterns.sort((a, b) => b.n - a.n || b.ids.length - a.ids.length);
            others.push(...rest.map(p => ({ ...p, dirKey })));
            for (const id of main.ids) {
                if (!stopLines.has(id)) stopLines.set(id, new Set());
                stopLines.get(id).add(lineId);
            }
            directions[dirKey] = {
                toward: dir.toward,
                stops: main.ids.map(station => ({ station })),
                timetable: directionTimetable(runs.get(`${lineId}/${dirKey}`) ?? [], main.ids, calendar, `${lineId}/${dirKey}`, warnings),
            };
        }
        // Other runs may end elsewhere (T7 trams from Voula that end at SEF,
        // on the way out), but a stop no main pattern calls at isn't drawn
        for (const { ids, n, dirKey } of others) {
            const missing = ids.filter(id => !stopLines.get(id)?.has(lineId));
            if (missing.length) warnings.push(`${lineId}/${dirKey}: ${n} trips call at stops the map doesn't show for the line: ${[...new Set(missing)].join(', ')}`);
        }
        if (Object.keys(directions).length) lines[lineId] = { name: line.name, color: line.color, directions };
    }

    const stations = {};
    for (const [id, s] of Object.entries(tram.stops)) {
        const sum = coordSums.get(id);
        if (!stopLines.has(id)) { warnings.push(`tram.json: ${id} is not served by any tram`); continue; }
        const metro = s.metro && metroStations[s.metro];
        if (s.metro && !metro) warnings.push(`tram.json: ${id} changes to ${s.metro}, which isn't a metro station in rail.json`);
        const walks = (s.walks ?? []).filter(walk => walk.metro ? metroStations[walk.metro] : stopLines.has(walk.stop))
            .map(walk => walkExit(id, walk, metroStations, warnings));
        if (walks.length !== (s.walks ?? []).length) warnings.push(`tram.json: ${id} has a walk to a stop that isn't in rail.json`);
        stations[id] = {
            name: s.name,
            coords: [round(sum.lat / sum.n), round(sum.lng / sum.n)],
            lines: [...stopLines.get(id)].sort(),
            ...(metro && { metro: { station: s.metro, lines: metro.lines } }),
            ...(walks.length && { walks }),
        };
    }

    return { data: { stations, lines }, warnings };
}

// A walk to a metro station, with the place of the exit it uses in that
// station's exits, or without one when the exit isn't among them (renamed in
// the station editor, or without a place yet): a warning, as the editor is
// never blocked (record 16)
function walkExit(id, { exit, ...walk }, metroStations, warnings) {
    if (exit === undefined || !walk.metro) return walk;
    const at = (metroStations[walk.metro].exits ?? []).findIndex(e => e.name?.el === exitLabel(exit));
    if (at < 0) {
        warnings.push(`tram.json: ${id}'s walk to ${walk.metro} uses the exit "${exit}", which street.json doesn't have with a place`);
        return walk;
    }
    return { ...walk, exit: at };
}

// A direction's timetable, on its stops only: a tram's calls anywhere else are
// left out, so T7's from Voula that end at SEF, which the way to Piraeus doesn't
// reach, count as ending at Neo Faliro
function directionTimetable(runs, stops, calendar, label, warnings) {
    const indexOf = new Map(stops.map((id, i) => [id, i]));
    const off = new Set();
    const onStops = runs.flatMap(({ stations, times, days }) => {
        const kept = stations.flatMap((id, i) => indexOf.has(id) ? [i] : []);
        stations.filter(id => !indexOf.has(id)).forEach(id => off.add(id));
        return kept.length > 1 ? [{ stations: kept.map(i => stations[i]), times: kept.map(i => times[i]), days }] : [];
    });
    if (off.size) warnings.push(`${label}: trams call at stops off this direction, left out of its timetable: ${[...off].sort().join(', ')}`);
    if (!onStops.length) warnings.push(`${label}: no tram trips in the chosen week`);
    dropCopies(onStops, calendar.serviceDays, label, warnings);
    return buildTimetable(onStops, indexOf, calendar.ownDates, label);
}

const round = n => Math.round(n * 1e5) / 1e5;
