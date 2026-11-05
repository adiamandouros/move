// A day of OASA's buses, small enough to search: the week the app's trip
// search reads (data/oasa/bus-timetable.json, the open-data feed of August
// 2026) on the routes of OASA's live network, in data/raw/oasa, with measured
// ride times if given: server/data/bus-timetable.js. The feed spreads each
// trip's time evenly along its route, so its times are stand-ins (README.md).
//
//   node scripts/planner-lab/build-buses.js <out.json> [--day 3] [--box south,west,north,east] [--rides bus-rides.json [--bad-day]]
//
// --day: the weekday, 0 = Sunday; Wednesday if not given.
// With --bad-day the measured stretches take their slowest tenth, not their
// median: the timetable ways are ranked by (weights.js).
// With --box only the stops inside it are kept. The test data is made with
// --box 37.94,23.63,38.02,23.75

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { onLiveRoutes, withRides } from '../../server/data/bus-timetable.js';

const WEDNESDAY = 3;
const round = n => Math.round(n * 1e5) / 1e5;

/**
 * One weekday (0 = Sunday) of the week's routes, as the lab searches it, with
 * the live network's stops
 * @param {import('../../server/data/bus-timetable.js').WeekRoute[]} routes @param {any} network @param {number} day
 * @returns {import('../../tools/subway/client/city.js').Buses}
 */
export function dayOf(routes, network, day) {
    const place = new Map();
    for (const { stops } of Object.values(network.stops ?? {})) for (const stop of stops) place.set(stop.code, stop);
    const used = [...new Set(routes.flatMap(route => route.stops))].sort();
    return {
        day,
        stops: Object.fromEntries(used.map(code => [code, [round(place.get(code).lat), round(place.get(code).lng), place.get(code).el]])),
        routes: routes.map(({ line, mode, code, stops, profiles, patterns, days }) => ({ line, mode, code, stops, profiles, trips: patterns[days[day]] }))
            .filter(route => route.trips.length),
    };
}

/**
 * What's left of a day's buses inside a box: south, west, north, east
 * @param {import('../../tools/subway/client/city.js').Buses} buses @param {number[]} box
 * @returns {import('../../tools/subway/client/city.js').Buses}
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
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { day: { type: 'string' }, box: { type: 'string' }, rides: { type: 'string' }, 'bad-day': { type: 'boolean' } } });
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const week = read(join(repo, 'data/oasa/bus-timetable.json'));
    const network = read(join(repo, 'data/raw/oasa/network.json'));
    const { routes, gone, untimed } = onLiveRoutes(week.routes, network);
    // Measured ride times where there are enough
    const measured = values.rides ? withRides(routes, read(values.rides), { badDay: values['bad-day'] }) : { routes, retimed: 0 };
    if (values.rides) console.log(`${measured.retimed} trips of the week with measured ride times`);
    const day = dayOf(measured.routes, network, values.day === undefined ? WEDNESDAY : Number(values.day));
    const out = values.box ? cutToBox(day, values.box.split(',').map(Number)) : day;
    writeFileSync(positionals[0], `${JSON.stringify(out)}\n`);
    console.log(`${positionals[0]}: ${Object.keys(out.stops).length} stops, ${out.routes.length} routes`);
    console.log(`Lines of the feed that are gone: ${gone.join(', ') || 'none'}`);
    console.log(`${untimed.length} live routes the feed has no times for, so left out of the search:`);
    for (const { line, name } of untimed) console.log(`  ${line}  ${name}`);
}
