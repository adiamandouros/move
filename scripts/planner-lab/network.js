// The network the lab searches: metro and tram from rail.json, and buses and
// trolleys from a file build-buses.js makes.

import { withTram } from '../../tools/subway/client/network.js';

const DAY = 86_400;

/**
 * A day's buses, as build-buses.js writes them. A route's trips are [start,
 * profile], and a profile the seconds from the start at each of its stops.
 * `code`: the OASA route it's on (server/data/bus-timetable.js), for measured ride times.
 * @typedef {{ day: number, stops: Record<string, [number, number, string]>,
 *   routes: { line: string, mode: string, code?: string, stops: string[], profiles: number[][], trips: [number, number][] }[] }} Buses
 */

/**
 * The stops and routes of one weekday (0 = Sunday), last night's trains that
 * run past midnight included. `index` finds a stop: rail:korydallos, bus:70040.
 * @param {import('../../types/data.js').Rail} rail @param {Buses} buses @param {number} weekday
 */
export function joinNetwork(rail, buses, weekday) {
    const net = withTram(rail);
    const stops = [];
    const index = new Map();
    const add = (id, lat, lng, name) => {
        index.set(id, stops.length);
        stops.push({ id, lat, lng, name });
    };
    for (const [id, { coords, name }] of Object.entries(net.stations)) add(`rail:${id}`, coords[0], coords[1], name.el);
    for (const [code, [lat, lng, name]] of Object.entries(buses.stops)) add(`bus:${code}`, lat, lng, name);

    const routes = [];
    for (const [line, { directions, tram }] of Object.entries(net.lines)) {
        for (const { stops: calls, timetable } of Object.values(directions)) {
            const byProfile = new Map();
            for (const dayOffset of [-1, 0]) {
                const pattern = timetable.patterns[timetable.days[(weekday + dayOffset + 7) % 7]];
                for (const [start, profile] of pattern) {
                    if (!byProfile.has(profile)) byProfile.set(profile, []);
                    byProfile.get(profile).push(timetable.profiles[profile].offsets.map(offset => start + offset + dayOffset * DAY));
                }
            }
            for (const [profile, trips] of byProfile) {
                const along = timetable.profiles[profile].stops.map(i => index.get(`rail:${calls[i].station}`));
                routes.push({ line, mode: tram ? 'tram' : 'metro', stops: along, trips });
            }
        }
    }
    for (const { line, mode, stops: calls, profiles, trips } of buses.routes) {
        routes.push({
            line, mode,
            stops: calls.map(code => index.get(`bus:${code}`)),
            trips: trips.map(([start, profile]) => profiles[profile].map(offset => start + offset)),
        });
    }
    return { stops, routes, index };
}
