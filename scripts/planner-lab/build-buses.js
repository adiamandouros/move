// A day of OASA's bus timetable, small enough to search, from the open-data feed
// in data/raw/bus. That feed stopped in August 2026 and spreads each trip's
// time evenly along its route, so its times are stand-ins (README.md).
//
//   node scripts/planner-lab/build-buses.js <out.json> [--box south,west,north,east]
//
// With --box only the stops inside it are kept: how the test data is made.

import { createReadStream, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

// The feed's service for a Wednesday
const WEDNESDAY = 3;
const TROLLEY = '11';

const csv = text => text.trim().split('\n').slice(1).map(line => line.trim().split(','));
const seconds = time => {
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600 + m * 60 + s;
};

/**
 * @param {{ routes: string, trips: string, stops: string }} files the feed's texts
 * @param {AsyncIterable<string> | Iterable<string>} stopTimes its stop_times.txt, by line
 * @param {{ day?: number, box?: number[] }} [options] box: south, west, north, east
 * @returns {Promise<import('./network.js').Buses>}
 */
export async function compactBuses(files, stopTimes, { day = WEDNESDAY, box } = {}) {
    const routeOf = new Map(csv(files.routes).map(([id, line, , type]) => [id, { line, mode: type === TROLLEY ? 'trolley' : 'bus' }]));
    const onTheDay = new Map(csv(files.trips).filter(([, service]) => service === `day_${day}`).map(([route, , trip]) => [trip, route]));
    const places = new Map(csv(files.stops).map(row => [row[0], { lat: Number(row.at(-3)), lng: Number(row.at(-2)), name: row.slice(2, -3).join(',') }]));
    const inside = ({ lat, lng }) => !box || (lat >= box[0] && lng >= box[1] && lat <= box[2] && lng <= box[3]);

    const trips = new Map();
    for await (const line of stopTimes) {
        const [trip, arrival, , stop] = line.trim().split(',');
        if (!onTheDay.has(trip) || !places.has(stop) || !inside(places.get(stop))) continue;
        if (!trips.has(trip)) trips.set(trip, { stops: [], times: [] });
        trips.get(trip).stops.push(stop);
        trips.get(trip).times.push(seconds(arrival));
    }

    const routes = new Map();
    for (const [trip, { stops, times }] of trips) {
        if (stops.length < 2) continue;
        const key = `${onTheDay.get(trip)}|${stops.join()}`;
        if (!routes.has(key)) routes.set(key, { ...routeOf.get(onTheDay.get(trip)), stops, shapes: new Map(), trips: [] });
        const route = routes.get(key);
        const shape = times.map(time => time - times[0]).join();
        if (!route.shapes.has(shape)) route.shapes.set(shape, route.shapes.size);
        route.trips.push([times[0], route.shapes.get(shape)]);
    }

    const used = new Set([...routes.values()].flatMap(route => route.stops));
    return {
        day,
        stops: Object.fromEntries([...used].sort().map(code => {
            const { lat, lng, name } = places.get(code);
            return [code, [lat, lng, name]];
        })),
        routes: [...routes.values()]
            .sort((a, b) => a.line.localeCompare(b.line) || a.stops.join().localeCompare(b.stops.join()))
            .map(({ line, mode, stops, shapes, trips: all }) => ({
                line, mode, stops,
                profiles: [...shapes.keys()].map(shape => shape.split(',').map(Number)),
                trips: all.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
            })),
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { box: { type: 'string' } } });
    const raw = join(fileURLToPath(new URL('../../', import.meta.url)), 'data/raw/bus');
    const read = name => readFileSync(join(raw, name), 'utf8');
    const lines = createInterface({ input: createReadStream(join(raw, 'stop_times.txt')) });
    const buses = await compactBuses(
        { routes: read('routes.txt'), trips: read('trips.txt'), stops: read('stops.txt') },
        lines,
        { box: values.box?.split(',').map(Number) },
    );
    writeFileSync(positionals[0], `${JSON.stringify(buses)}\n`);
    console.log(`${positionals[0]}: ${Object.keys(buses.stops).length} stops, ${buses.routes.length} routes`);
}
