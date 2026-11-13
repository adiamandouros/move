// The whole city for the trip search (decision 28): the metro and the tram
// from rail.json, a day of buses and trolleys from buses.json (decision 30),
// a day of the suburban railway from trains.json (decision 41), and walks
// between stops worked out from the straight line, as there's no street map. No DOM, and only relative imports, so the browser and the
// planner lab (scripts/planner-lab/) share it.

import { createPlanner as search, CHANGE_SECONDS, MAX_RIDES } from './raptor.js';
import { withTram } from './network.js';

export { CHANGE_SECONDS, MAX_RIDES };
const DAY = 86_400;
// After a walk to another stop, on top of the walk
export const AFTER_WALK_SECONDS = 60;
// How far a change may walk. Five minutes hid the 420 from Aigaleo
const CHANGE_WALK_SECONDS = 600;
// Walks are the straight line with the streets added: 200 walks checked
// against a street router came out at 1.38 times it, at an ordinary pace.
// The Trip page's walks to the metro and the tram are these too (decision 37)
const WINDING = 1.4;
export const METERS_PER_MINUTE = 80;
const CELL_LAT = 0.005;
const CELL_LNG = 0.006;
const CELL_METERS = 450;
// Meters on the flat, as the address search measures them (server/places/search.js)
const M_LAT = 111_320;
const M_LNG = 111_320 * Math.cos(37.97 * Math.PI / 180);

/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {{ el: string, en: string }} Names */
/**
 * A stop: name, Greek, for the lab; names, as the page shows them (`en` ''
 * for a bus stop whose English is its Greek in Latin letters, as in
 * bus-stops.json); station, a rail stop's id in rail.json; oasaTicket: false
 * at a suburban station OASA's ticket doesn't cover
 * @typedef {Point & { id: string, name: string, names?: Names, station?: string, oasaTicket?: false }} Stop
 */
/** @typedef {import('./raptor.js').Route & { toward?: Names, dir?: string, code?: string, numbers?: (string | null)[] }} Route where it goes: a rail line's direction, a bus's last stop; dir: a metro or tram line's direction, as rail.json names it; code: a bus's OASA route, which its live times name; numbers: each suburban trip's train, which its live times name (decision 42) */
/** @typedef {import('./raptor.js').Leg} Leg */
/** @typedef {import('./raptor.js').Journey} Journey */
/**
 * A day of buses. A route's trips are [start, profile], and a profile the
 * seconds from the start at each of its stops. `code`: the OASA route it's
 * on, for measured ride times. A stop's English name, where there is one, after its Greek.
 * @typedef {{ day: number, stops: Record<string, [number, number, string] | [number, number, string, string]>,
 *   routes: { line: string, mode: string, code?: string, stops: string[], profiles: number[][], trips: [number, number][] }[] }} Buses
 */

/**
 * A day of trains: each station's [lat, lng, Greek, English], the walks
 * known better than the straight line's and the stations outside OASA's
 * ticket, as trains.json has them, and routes as a day of buses has them, a
 * trip's start in seconds from the day's midnight, then its train's number
 * (decision 42)
 * @typedef {{ stations: Record<string, [number, number, string, string]>, walks: import('../../../types/data.js').Trains['walks'], outside: string[],
 *   routes: { line: string, stops: string[], profiles: number[][], trips: [number, number, string?][] }[] }} Trains
 */

/** @param {Point} a @param {Point} b */
export const meters = (a, b) => Math.hypot((a.lat - b.lat) * M_LAT, (a.lng - b.lng) * M_LNG);
/** @param {Point} a @param {Point} b */
export const walkMeters = (a, b) => meters(a, b) * WINDING;
/** @param {Point} a @param {Point} b */
export const walkSeconds = (a, b) => walkMeters(a, b) / METERS_PER_MINUTE * 60;

/**
 * One weekday (0 = Sunday) of buses.json, with the trips of the day before
 * that are still on the road after midnight, at times before it
 * @param {import('../../../types/data.js').Buses} buses @param {number} weekday @returns {Buses}
 */
export function busDay({ stops, routes }, weekday) {
    const used = new Set();
    const day = routes.flatMap(({ line, mode, code, stops: along, runs, patterns, days }) => {
        const profiles = runs.map(run => run.reduce((offsets, seconds) => [...offsets, offsets.at(-1) + seconds], [0]));
        const tripsOf = (pattern, shift) => {
            let start = 0;
            return patterns[pattern].map(([after, profile]) => /** @type {[number, number]} */ ([(start += after) + shift, profile]));
        };
        const trips = [
            ...tripsOf(days[(weekday + 6) % 7], -DAY).filter(([start, profile]) => start + profiles[profile].at(-1) >= 0),
            ...tripsOf(days[weekday], 0),
        ];
        if (!trips.length) return [];
        along.forEach(stop => used.add(stop));
        return [{ line, mode, code, stops: along.map(stop => stops[stop][0]), profiles, trips }];
    });
    return {
        day: weekday,
        stops: Object.fromEntries([...used].map(i => [stops[i][0], [stops[i][1], stops[i][2], stops[i][3], stops[i][4]]])),
        routes: day,
    };
}

/**
 * The trains of `date` ('YYYY-MM-DD') in trains.json, with those of the day
 * before still running after midnight, at times before it. Null when there
 * are none for the date: railway.gov.gr's board for it was never fetched
 * @param {import('../../../types/data.js').Trains} trains @param {string} date @returns {Trains | null}
 */
export function trainDay({ stations, walks, outside, dates }, date) {
    if (!dates[date]) return null;
    const before = new Date(Date.parse(`${date}T00:00:00Z`) - DAY * 1000).toISOString().slice(0, 10);
    const late = (dates[before] ?? []).flatMap(route => {
        const trips = route.trips.filter(([start, profile]) => start + route.profiles[profile].at(-1) >= DAY)
            .map(([start, profile, train]) => /** @type {[number, number, string?]} */ ([start - DAY, profile, train]));
        return trips.length ? [{ ...route, trips }] : [];
    });
    return { stations, walks, outside, routes: [...late, ...dates[date]] };
}

/**
 * The stops and routes of one weekday (0 = Sunday), last night's trains that
 * run past midnight included, and the suburban railway's day when there is
 * one (trainDay). `index` finds a stop: rail:korydallos, bus:70040, train:athens.
 * Each route says where it goes (`toward`): a rail line's direction, a bus's or train's last stop
 * (decision 41: the train's own end, not its line's); a bus's also which of OASA's routes it is (`code`),
 * as its live times say. `knownWalks`: the trains' walks known better than the
 * straight line's, [stop, stop, seconds, note?], between stops the network has.
 * @param {import('../../../types/data.js').Rail} rail @param {Buses} buses @param {number} weekday @param {Trains | null} [trains]
 */
export function joinNetwork(rail, buses, weekday, trains = null) {
    const net = withTram(rail);
    const stops = [];
    const index = new Map();
    const add = (id, lat, lng, names, more = {}) => {
        index.set(id, stops.length);
        stops.push({ id, lat, lng, name: names.el, names, ...more });
    };
    for (const [id, { coords, name }] of Object.entries(net.stations)) add(`rail:${id}`, coords[0], coords[1], name, { station: id });
    for (const [code, [lat, lng, el, en = '']] of Object.entries(buses.stops)) add(`bus:${code}`, lat, lng, { el, en });
    const outside = new Set(trains?.outside ?? []);
    for (const [id, [lat, lng, el, en]] of Object.entries(trains?.stations ?? {})) add(`train:${id}`, lat, lng, { el, en }, outside.has(id) ? { oasaTicket: false } : {});

    const routes = [];
    for (const [line, { directions, tram }] of Object.entries(net.lines)) {
        for (const [dir, { stops: calls, timetable, toward }] of Object.entries(directions)) {
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
                routes.push({ line, dir, mode: tram ? 'tram' : 'metro', stops: along, trips, toward });
            }
        }
    }
    for (const { line, mode, code, stops: calls, profiles, trips } of buses.routes) {
        const along = calls.map(stop => index.get(`bus:${stop}`));
        routes.push({
            line, mode, code, stops: along,
            trips: trips.map(([start, profile]) => profiles[profile].map(offset => start + offset)),
            toward: stops[along.at(-1)].names,
        });
    }
    for (const { line, stops: calls, profiles, trips } of trains?.routes ?? []) {
        const along = calls.map(station => index.get(`train:${station}`));
        routes.push({
            line, mode: 'suburban', stops: along, trips: trips.map(([start, profile]) => profiles[profile].map(offset => start + offset)),
            numbers: trips.map(([, , train]) => train ?? null), toward: stops[along.at(-1)].names,
        });
    }
    const knownWalks = (trains?.walks ?? []).filter(([from, to]) => index.has(from) && index.has(to))
        .map(([from, to, seconds, note]) => /** @type {KnownWalk} */ ([index.get(from), index.get(to), seconds, ...note ? [note] : []]));
    return { stops, routes, index, knownWalks };
}

/** @typedef {[number, number, number] | [number, number, number, Names]} KnownWalk two stops, the seconds between them, and a note where the way needs one */

/**
 * The search over these stops and routes (a leg's `route` is one of them),
 * with every walk of up to 10 minutes between stops for changes, the
 * straight line's or, either way round, a known walk's (`walks`, by stop:
 * [stop, seconds…]), and `near`:
 * the stops within `limit` seconds on foot of a point, [stop, seconds, stop,
 * seconds…]; `walkNote`, a known walk's note between two stops, or null
 * @param {{ stops: Stop[], routes: Route[], knownWalks?: KnownWalk[] }} network
 */
export function createPlanner({ stops, routes, knownWalks = [] }) {
    const cells = new Map();
    const cellOf = (y, x) => y * 100_000 + x;
    stops.forEach(({ lat, lng }, i) => {
        const cell = cellOf(Math.floor(lat / CELL_LAT), Math.floor(lng / CELL_LNG));
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell).push(i);
    });
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
    const known = new Map();
    const notes = new Map();
    const pair = (from, to) => from * stops.length + to;
    for (const [a, b, seconds, note] of knownWalks) {
        for (const [from, to] of [[a, b], [b, a]]) {
            known.set(pair(from, to), seconds);
            if (note) notes.set(pair(from, to), note);
            const list = walks[from];
            const at = list.findIndex((stop, j) => j % 2 === 0 && stop === to);
            if (at >= 0) list[at + 1] = seconds;
            else list.push(to, seconds);
        }
    }
    const planner = search({ stops, routes, walks }, {
        afterWalk: AFTER_WALK_SECONDS,
        walkSeconds: (from, to) => known.get(pair(from, to)) ?? walkSeconds(stops[from], stops[to]),
    });
    /** @param {number} from @param {number} to @returns {Names | null} */
    const walkNote = (from, to) => notes.get(pair(from, to)) ?? null;
    return { ...planner, stops, routes, walks, near, walkNote };
}
