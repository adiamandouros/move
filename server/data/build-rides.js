import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { athensNow } from '../../tools/subway/client/network.js';
import { STOP_CODE } from './check-output.js';

// Build bus-rides.json: how long buses really take between two stops, by
// route, hour and kind of day, from the buses the server saw pass
// (server/oasa/passes.js, data/local/bus-passes/; roadmap Plan 3, decision
// 26). The same bus passing two stops of its route, one after the other,
// is one ride. For the planner, whose timetable is the August feed's.
// {
//   schema, from: '2026-11-03', to: '2026-11-20', days: 14,
//   rides: [{ route: '5567', line: 'Α2', from: '60002', to: '60806',
//             times: { 'wd 8': [rides, median s, slowest tenth s], 'sa 13': […] } }, …]
// }
// A time's key is the kind of day it left (wd Monday to Friday, sa, su) and
// the hour, Athens time. Buses only: no bus numbers, nothing about who looked.

export const RIDES_SCHEMA = 1;
// Days of passes used: roads and timetables change, so not for ever
export const RIDE_DAYS = 91;
// A longer gap between two passes of the same bus isn't one ride
const MAX_RIDE_S = 90 * 60;
const DAY = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const KINDS = ['su', 'wd', 'wd', 'wd', 'wd', 'wd', 'sa'];

/**
 * The passes of the RIDE_DAYS days up to `today` ('YYYY-MM-DD'), from `dir`.
 * A line that isn't a pass (a file cut short) is left out.
 * @param {string} dir @param {string} today
 * @returns {{ passes: { at: number, stop: string, route: string, line: string, vehicle: string }[], days: string[] }}
 */
export function readPasses(dir, today, keep = RIDE_DAYS) {
    if (!existsSync(dir)) return { passes: [], days: [] };
    const oldest = new Date(Date.parse(today) - (keep - 1) * 86_400_000).toISOString().slice(0, 10);
    const days = readdirSync(dir).flatMap(name => DAY.exec(name)?.[1] ?? []).filter(day => day >= oldest && day <= today).sort();
    const passes = days.flatMap(day => readFileSync(join(dir, `${day}.jsonl`), 'utf8').split('\n').flatMap(line => {
        try {
            const p = JSON.parse(line);
            return Number.isFinite(p.at) && STOP_CODE.test(p.stop) && p.route && p.vehicle ? [p] : [];
        } catch {
            return [];
        }
    }));
    return { passes, days };
}

// The stops of each OASA route, from the live network (oasa-network.js)
const stopsOf = network => new Map(Object.entries(network?.stops ?? {}).map(([route, { stops }]) => [route, stops.map(s => s.code)]));

/**
 * Each ride: a bus's pass at one stop of its route, then its next pass, at a
 * stop further along the same route.
 * @param {ReturnType<typeof readPasses>['passes']} passes @param {any} network
 */
export function ridesFrom(passes, network) {
    const routes = stopsOf(network);
    const byBus = new Map();
    for (const p of passes) {
        const key = `${p.vehicle} ${p.route}`;
        (byBus.get(key) ?? byBus.set(key, []).get(key)).push(p);
    }
    const rides = [];
    for (const list of byBus.values()) {
        list.sort((a, b) => a.at - b.at);
        for (let k = 1; k < list.length; k++) {
            const [a, b] = [list[k - 1], list[k]];
            const stops = routes.get(a.route);
            const seconds = b.at - a.at;
            if (!stops || seconds <= 0 || seconds > MAX_RIDE_S) continue;
            // Round a loop a stop can come twice: the nearest pair in order.
            // Never from the first stop: there a bus is seen arriving, not
            // leaving, so the ride would include its wait (the B2 at Fix)
            let best = null;
            stops.forEach((s, i) => {
                if (s !== a.stop || i === 0) return;
                const j = stops.indexOf(b.stop, i + 1);
                if (j > i && (!best || j - i < best)) best = j - i;
            });
            if (best) rides.push({ route: a.route, line: a.line, from: a.stop, to: b.stop, left: a.at, seconds });
        }
    }
    return rides;
}

// "wd 8": the kind of day and the hour a ride left, Athens time
export function hourOf(seconds) {
    const { weekday, seconds: s } = athensNow(new Date(seconds * 1000));
    return `${KINDS[weekday]} ${Math.floor(s / 3600)}`;
}

const at = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/**
 * @param {ReturnType<typeof readPasses>} read @param {any} network
 * @returns {{ data: any, warnings: string[] }}
 */
export function buildBusRides({ passes, days }, network) {
    const groups = new Map();
    for (const ride of ridesFrom(passes, network)) {
        const key = `${ride.route} ${ride.from} ${ride.to}`;
        const group = groups.get(key) ?? groups.set(key, { route: ride.route, line: ride.line, from: ride.from, to: ride.to, hours: new Map() }).get(key);
        const hour = hourOf(ride.left);
        (group.hours.get(hour) ?? group.hours.set(hour, []).get(hour)).push(ride.seconds);
    }
    const rides = [...groups.values()]
        .sort((a, b) => a.route.localeCompare(b.route) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
        .map(({ hours, ...ride }) => ({
            ...ride,
            times: Object.fromEntries([...hours].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([hour, list]) => {
                const sorted = list.sort((x, y) => x - y);
                return [hour, [sorted.length, at(sorted, 0.5), at(sorted, 0.9)]];
            })),
        }));
    const data = { schema: RIDES_SCHEMA, from: days[0] ?? null, to: days.at(-1) ?? null, days: days.length, rides };
    return { data, warnings: days.length ? [] : ['No buses seen passing yet: no ride times'] };
}
