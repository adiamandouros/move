// A day of OASA's buses, small enough to search: the routes of its live network
// (live-routes.js) and the times of the open-data feed in data/raw/bus. That
// feed stopped in August 2026 and spreads each trip's time evenly along its
// route, so its times are stand-ins (README.md).
//
//   node scripts/planner-lab/build-buses.js <out.json> [--box south,west,north,east] [--rides bus-rides.json]
//
// With --box only the stops inside it are kept. The test data is made with
// --box 37.94,23.63,38.02,23.75

import { createReadStream, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { onLiveRoutes } from './live-routes.js';
import { withRides } from './rides.js';

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
 * @param {{ day?: number }} [options]
 * @returns {Promise<import('./network.js').Buses>}
 */
export async function compactBuses(files, stopTimes, { day = WEDNESDAY } = {}) {
    const routeOf = new Map(csv(files.routes).map(([id, line, , type]) => [id, { line, mode: type === TROLLEY ? 'trolley' : 'bus' }]));
    const onTheDay = new Map(csv(files.trips).filter(([, service]) => service === `day_${day}`).map(([route, , trip]) => [trip, route]));
    const places = new Map(csv(files.stops).map(row => [row[0], { lat: Number(row.at(-3)), lng: Number(row.at(-2)), name: row.slice(2, -3).join(',') }]));

    const trips = new Map();
    for await (const line of stopTimes) {
        const [trip, arrival, , stop] = line.trim().split(',');
        if (!onTheDay.has(trip) || !places.has(stop)) continue;
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

/**
 * What's left of a day's buses inside a box: south, west, north, east
 * @param {import('./network.js').Buses} buses @param {number[]} box
 * @returns {import('./network.js').Buses}
 */
export function cutToBox(buses, [south, west, north, east]) {
    const inside = code => {
        const [lat, lng] = buses.stops[code];
        return lat >= south && lng >= west && lat <= north && lng <= east;
    };
    const routes = buses.routes.flatMap(route => {
        const kept = route.stops.flatMap((code, i) => inside(code) ? [i] : []);
        if (kept.length < 2) return [];
        return [{
            ...route,
            stops: kept.map(i => route.stops[i]),
            profiles: route.profiles.map(offsets => kept.map(i => offsets[i] - offsets[kept[0]])),
            trips: route.trips.map(([start, profile]) => /** @type {[number, number]} */ ([start + route.profiles[profile][kept[0]], profile])),
        }];
    });
    const used = new Set(routes.flatMap(route => route.stops));
    return { ...buses, routes, stops: Object.fromEntries(Object.entries(buses.stops).filter(([code]) => used.has(code))) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { box: { type: 'string' }, rides: { type: 'string' } } });
    const raw = join(fileURLToPath(new URL('../../', import.meta.url)), 'data/raw');
    const read = name => readFileSync(join(raw, 'bus', name), 'utf8');
    const lines = createInterface({ input: createReadStream(join(raw, 'bus/stop_times.txt')) });
    const feed = await compactBuses({ routes: read('routes.txt'), trips: read('trips.txt'), stops: read('stops.txt') }, lines);
    const { buses, gone, untimed } = onLiveRoutes(feed, JSON.parse(readFileSync(join(raw, 'oasa/network.json'), 'utf8')));
    // Measured ride times where there are enough (rides.js)
    const measured = values.rides ? withRides(buses, JSON.parse(readFileSync(values.rides, 'utf8'))) : { buses, retimed: 0 };
    if (values.rides) console.log(`${measured.retimed} trips with measured ride times`);
    const out = values.box ? cutToBox(measured.buses, values.box.split(',').map(Number)) : measured.buses;
    writeFileSync(positionals[0], `${JSON.stringify(out)}\n`);
    console.log(`${positionals[0]}: ${Object.keys(out.stops).length} stops, ${out.routes.length} routes`);
    console.log(`Lines of the feed that are gone: ${gone.join(', ') || 'none'}`);
    console.log(`${untimed.length} live routes the feed has no times for, so left out of the search:`);
    for (const { line, name } of untimed) console.log(`  ${line}  ${name}`);
}
