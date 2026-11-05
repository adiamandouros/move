// The lab's planner: the app's trip search (tools/subway/client/raptor.js,
// decision 28) over any stops and lines, with walks worked out from the
// straight line, as the lab has no street map: see README.md.

import { createPlanner as search, CHANGE_SECONDS, MAX_RIDES } from '../../tools/subway/client/raptor.js';
import { meters } from '../../server/places/search.js';

export { CHANGE_SECONDS, MAX_RIDES };
// The same after a walk to another stop, on top of the walk
export const AFTER_WALK_SECONDS = 60;
// How far a change may walk. Five minutes hid the 420 from Aigaleo
const CHANGE_WALK_SECONDS = 600;
// Walks are the straight line with the streets added: 200 walks checked
// against a street router came out at 1.38 times it, at an ordinary pace
const WINDING = 1.4;
const METERS_PER_MINUTE = 80;
const CELL_LAT = 0.005;
const CELL_LNG = 0.006;
const CELL_METERS = 450;

/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {Point & { id: string, name: string }} Stop */
/** @typedef {import('../../tools/subway/client/raptor.js').Route} Route */
/** @typedef {import('../../tools/subway/client/raptor.js').Leg} Leg */
/** @typedef {import('../../tools/subway/client/raptor.js').Journey} Journey */

/** @param {Point} a @param {Point} b */
export const walkSeconds = (a, b) => meters(a, b) * WINDING / METERS_PER_MINUTE * 60;

/** @param {{ stops: Stop[], routes: Route[] }} network */
export function createPlanner({ stops, routes }) {
    const cells = new Map();
    const cellOf = (y, x) => y * 100_000 + x;
    stops.forEach(({ lat, lng }, i) => {
        const cell = cellOf(Math.floor(lat / CELL_LAT), Math.floor(lng / CELL_LNG));
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell).push(i);
    });
    // The stops within `limit` seconds on foot of a point: [stop, seconds, stop, seconds…]
    /** @param {Point} point @param {number} limit @param {number} [except] */
    const near = (point, limit, except = -1) => {
        const found = [];
        const y = Math.floor(point.lat / CELL_LAT);
        const x = Math.floor(point.lng / CELL_LNG);
        const reach = Math.ceil(limit * METERS_PER_MINUTE / 60 / WINDING / CELL_METERS);
        for (let a = y - reach; a <= y + reach; a++) {
            for (let b = x - reach; b <= x + reach; b++) {
                for (const stop of cells.get(cellOf(a, b)) ?? []) {
                    const seconds = walkSeconds(point, stops[stop]);
                    if (stop !== except && seconds <= limit) found.push(stop, Math.floor(seconds));
                }
            }
        }
        return found;
    };
    const walks = stops.map((stop, i) => near(stop, CHANGE_WALK_SECONDS, i));
    const planner = search({ stops, routes, walks }, {
        afterWalk: AFTER_WALK_SECONDS,
        walkSeconds: (from, to) => walkSeconds(stops[from], stops[to]),
    });
    return { ...planner, stops, near };
}
