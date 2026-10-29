import { nearestStops } from './stops.js';
import { countDown, elapsedMinutes, refreshEvery, SLACK_MS } from './timing.js';

// The trip finder (roadmap item 13): direct buses from the stops near you to
// the stops near where you're going, worked out from our own data
// (bus-stops.json, bus-lines.json), with live times only (decision 11: a bus
// OASA isn't predicting isn't shown). No DOM access, so it can be
// unit-tested in Node (bus-trips.test.js).

/** @typedef {import('./stops.js').BusStop & { meters: number }} NearStop */
/** @typedef {import('../../../types/data.js').BusLines['lines'][number]} BusLine */
/**
 * @typedef {{
 *   line: string, direction: number, to: import('../../../types/data.js').Names, route: string,
 *   board: NearStop, alight: NearStop, stops: number,
 * }} TripOption
 * @typedef {{ line: string | null, route: string, vehicle: string, minutes: number }} Arrival
 * @typedef {{ vehicle: string, minutes: number, ride: number | null, arrives: number | null }} TripBus
 */

// The numbers agreed for the finder's load on OASA (29 Oct 2026, decision 7):
// at most this many line directions, so at most twice as many stops asked for
export const MAX_OPTIONS = 5;
// A destination stop is only asked for to match the vehicles: once a minute
export const ALIGHT_REFRESH_MS = 60_000;

// The areas: around where you're going, and around a starting stop you picked
const AREA_M = 400;
// Around you, widened when no bus goes from there (as the stops nearby)
const NEAR_M = 500;
const WIDER_M = 1500;
// Walking pace, for the "~N min walk" (about 4.8 km/h)
const WALK_M_PER_MIN = 80;

// The stops within `radius` of a point, nearest first; the nearest one if
// none is that close (a station far from any bus)
/** @param {import('./stops.js').BusStop[]} stops @param {{ lat: number, lng: number }} at @param {number} radius @returns {NearStop[]} */
const stopsAround = (stops, { lat, lng }, radius) => nearestStops(stops, lat, lng, { limit: Infinity, radius, min: 1 });

/**
 * The options from a place to a place (a stop's or a station's position).
 * From where you are: the stops within NEAR_M, or WIDER_M when no bus goes
 * from those; from a stop you picked (`picked`), those within AREA_M.
 * @param {import('./stops.js').BusStop[]} stops @param {BusLine[]} lines
 * @param {{ lat: number, lng: number, picked?: boolean }} from @param {{ lat: number, lng: number }} to
 * @returns {TripOption[]}
 */
export function findTrips(stops, lines, from, to) {
    const there = stopsAround(stops, to, AREA_M);
    for (const radius of from.picked ? [AREA_M] : [NEAR_M, WIDER_M]) {
        const options = tripOptions(lines, stopsAround(stops, from, radius), there);
        if (options.length) return options;
    }
    return [];
}

/** Whole minutes to walk this far, at least 1 @param {number} meters */
export const walkMinutes = meters => Math.max(1, Math.ceil(meters / WALK_M_PER_MIN));

/**
 * Every line direction that calls at a stop in `from` and later at one in
 * `to`: each line once, boarding at the stop nearest you that works and
 * getting off at the stop nearest the destination after it. Fewest metres
 * walked first, then fewest stops ridden; at most MAX_OPTIONS.
 * @param {BusLine[]} lines @param {NearStop[]} from @param {NearStop[]} to
 * @returns {TripOption[]}
 */
export function tripOptions(lines, from, to) {
    const near = new Map(from.map(s => [s.code, s]));
    const far = new Map(to.map(s => [s.code, s]));
    /** @type {TripOption[]} */
    const options = [];
    for (const line of lines) {
        let best = null;
        line.directions.forEach((dir, direction) => {
            // Every place a stop of the area comes on the route (a circular one can pass one twice)
            const boards = dir.stops.flatMap((code, i) => near.has(code) ? [{ stop: near.get(code), i }] : []);
            const alights = dir.stops.flatMap((code, i) => far.has(code) ? [{ stop: far.get(code), i }] : []);
            for (const b of boards) {
                const later = alights.filter(a => a.i > b.i && a.stop.code !== b.stop.code);
                if (!later.length) continue;
                const a = later.reduce((x, y) => (y.stop.meters < x.stop.meters || (y.stop.meters === x.stop.meters && y.i < x.i) ? y : x));
                /** @type {TripOption} */
                const option = { line: line.line, direction, to: dir.to, route: dir.route, board: b.stop, alight: a.stop, stops: a.i - b.i };
                if (!best || better(option, best)) best = option;
            }
        });
        if (best) options.push(best);
    }
    return options.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0)).slice(0, MAX_OPTIONS);
}

const walked = o => o.board.meters + o.alight.meters;
const better = (a, b) => walked(a) < walked(b) || (walked(a) === walked(b) && a.stops < b.stops);

/**
 * The stops to ask OASA for: where each option boards and gets off, once each
 * @param {TripOption[]} options @returns {string[]}
 */
export const tripStops = options => [...new Set(options.flatMap(o => [o.board.code, o.alight.code]))];

/**
 * An option's buses, from the live answers at its two stops: those of its
 * line going its way that you can still walk to in time, soonest first. Its
 * own route goes its way; another of the line's routes (a short working, a
 * night variant) only once the same bus is predicted at the stop you get
 * off at too, which shows it goes there. The ride is the difference
 * between the two predictions; null while the bus isn't predicted there
 * yet (nothing is estimated).
 * @param {TripOption} option
 * @param {{ arrivals?: Arrival[] } | undefined} boardResult
 * @param {{ arrivals?: Arrival[] } | undefined} alightResult
 * @param {number} walk minutes to the stop you board at
 * @returns {TripBus[]}
 */
export function tripBuses(option, boardResult, alightResult, walk) {
    const later = new Map((alightResult?.arrivals ?? []).map(a => [a.vehicle, a.minutes]));
    return (boardResult?.arrivals ?? [])
        .filter(a => a.line === option.line && a.minutes >= walk)
        .map(a => {
            const there = later.get(a.vehicle);
            const ride = there !== undefined && there > a.minutes ? there - a.minutes : null;
            return { a, ride };
        })
        .filter(({ a, ride }) => a.route === option.route || ride !== null)
        .map(({ a, ride }) => ({ vehicle: a.vehicle, minutes: a.minutes, ride, arrives: ride === null ? null : a.minutes + ride }))
        .sort((x, y) => x.minutes - y.minutes);
}

/**
 * The options in the order to show them: those whose next bus has an
 * arrival, by when you'd get to the destination (walking from the stop
 * included); then those with a bus but no arrival yet, by when it leaves;
 * then those with no bus predicted
 * @template {{ option: TripOption, buses: TripBus[] }} T
 * @param {T[]} trips @returns {T[]}
 */
export function rankTrips(trips) {
    const key = ({ option, buses }) => {
        const known = buses.find(b => b.arrives !== null);
        if (known) return [0, known.arrives + walkMinutes(option.alight.meters)];
        if (buses.length) return [1, buses[0].minutes];
        return [2, 0];
    };
    return trips
        .map((trip, i) => ({ trip, k: key(trip), i }))
        .sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1] || x.i - y.i)
        .map(({ trip }) => trip);
}

/**
 * The trip's stops to ask for now: a stop you board at by when the next bus
 * of its lines comes (the bus page's tiers, timing.js), a stop you get off
 * at every ALIGHT_REFRESH_MS; none while already being asked for
 * @param {{
 *   options: TripOption[], asking: Set<string>, asked: Record<string, number>,
 *   fetched: Record<string, number>, results: Record<string, { arrivals?: Arrival[], unavailable?: boolean } | undefined>,
 * }} trip
 * @param {number} now
 * @returns {string[]}
 */
export function tripDue({ options, asking, asked, fetched, results }, now) {
    /** @type {Map<string, number>} */
    const every = new Map();
    const keep = (code, ms) => every.set(code, Math.min(every.get(code) ?? Infinity, ms));
    for (const o of options) {
        const shown = countDown(results[o.board.code], elapsedMinutes(fetched[o.board.code], now));
        const own = shown && { ...shown, arrivals: shown.arrivals?.filter(a => a.line === o.line) };
        keep(o.board.code, refreshEvery(own));
        keep(o.alight.code, ALIGHT_REFRESH_MS + SLACK_MS);
    }
    return [...every].filter(([code, ms]) => !asking.has(code) && now - (asked[code] ?? 0) >= ms).map(([code]) => code);
}
