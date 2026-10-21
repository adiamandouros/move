import { join } from 'path';
import { readCsv, readCsvAll } from './csv.js';

// The tram network for the Info page's tram map, from the same rail feed as
// the metro: rail.json's `tram`, in the shape of its metro part (so one map
// drawer serves both), without timetables or car positions:
//
// {
//   stations: { id: { name: { el, en }, coords: [lat, lng], lines: ['T6', …], metro?: { station, lines } } },
//   lines: { T6: { name, color, directions: { pikrodafni: { toward: { el, en }, stops: [{ station }, …] } } } }
// }
//
// A direction's stops are its most common stop pattern in the feed; other
// runs (trams that turn back early) are left out. The two directions of a
// line may call at different stops: T7 runs one way round its Piraeus loop.
// `metro` is the metro station a stop changes to (tram.json's `metro`, with
// that station's lines from the metro part of rail.json).
//
// The tram is only drawn, so problems are warnings, never a failed rail.json:
// a stop the curated file doesn't know is left out of the map.
/**
 * @param {{ dir: string, tram: any, metroStations: Record<string, { lines: string[] }> }} options
 * @returns {Promise<{ data: import('../../types/data.js').Tram, warnings: string[] }>}
 */
export async function buildTram({ dir, tram, metroStations }) {
    const file = name => join(dir, name);
    const warnings = [];

    const routeLine = new Map();
    for (const r of await readCsvAll(file('routes.txt'), { required: ['route_id', 'route_short_name'] })) {
        if (tram.lines[r.route_short_name]) routeLine.set(r.route_id, r.route_short_name);
    }
    const dirKeyOf = Object.fromEntries(Object.entries(tram.lines).map(([id, line]) =>
        [id, Object.fromEntries(Object.entries(line.directions).map(([key, d]) => [d.gtfsDirection, key]))]));

    const trips = new Map();
    for (const t of await readCsvAll(file('trips.txt'), { required: ['route_id', 'trip_id', 'direction_id'] })) {
        const line = routeLine.get(t.route_id);
        const dirKey = line && dirKeyOf[line][t.direction_id];
        if (dirKey) trips.set(t.trip_id, { line, dirKey });
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
    for await (const st of readCsv(file('stop_times.txt'), { required: ['trip_id', 'stop_id', 'stop_sequence'] })) {
        if (!trips.has(st.trip_id)) continue;
        const code = stopById.get(st.stop_id);
        const id = stopOfCode.get(code);
        if (!id) { unknown.add(code ?? st.stop_id); continue; }
        if (!tripStops.has(st.trip_id)) tripStops.set(st.trip_id, []);
        tripStops.get(st.trip_id).push([+st.stop_sequence, id]);
    }
    if (unknown.size) warnings.push(`tram.json: tram stops not on the map (add them to a stop's "gtfs" list): ${[...unknown].sort().join(', ')}`);

    // How many trips run each stop pattern, per line and direction
    const counts = new Map();
    for (const [tripId, list] of tripStops) {
        const { line, dirKey } = trips.get(tripId);
        const ids = list.sort((a, b) => a[0] - b[0]).map(s => s[1]).filter((id, i, all) => id !== all[i - 1]);
        const key = `${line}/${dirKey}`;
        if (!counts.has(key)) counts.set(key, new Map());
        const perPattern = counts.get(key);
        const pattern = ids.join(' ');
        perPattern.set(pattern, (perPattern.get(pattern) ?? 0) + 1);
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
            directions[dirKey] = { toward: dir.toward, stops: main.ids.map(station => ({ station })) };
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
        stations[id] = {
            name: s.name,
            coords: [round(sum.lat / sum.n), round(sum.lng / sum.n)],
            lines: [...stopLines.get(id)].sort(),
            ...(metro && { metro: { station: s.metro, lines: metro.lines } }),
        };
    }

    return { data: { stations, lines }, warnings };
}

const round = n => Math.round(n * 1e5) / 1e5;
