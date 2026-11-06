import { answering } from '/tools/subway/answer.js';
import { busDay, createPlanner, joinNetwork } from '/tools/subway/city.js';
import { findWays, fold, secondsTo } from '/tools/subway/ways.js';
import { cost } from '/tools/subway/weights.js';

// The Trip page's ways with a bus (decision 31): the whole city's search
// (city.js, decision 28) over OASA's timetable (buses.json, decision 30), for
// leaving now. No DOM, so it's tested in Node.

// How far from either end a stop is tried, as a station is (plan.js)
const NEAR_SECONDS = 15 * 60;
// A walk's length, as the search times it: the straight line × 1.4 at 80 m a minute
const METERS_PER_SECOND = 80 / 60;
const ON_THE_ROAD = new Set(['bus', 'trolley']);

/** @typedef {ReturnType<typeof createPlanner>} Planner */
/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {{ minutes: number, meters: number }} Walk */
/**
 * One ride of a way, as the page draws it: its stops (city.js), when it
 * leaves and gets there, how many stops it rides, where its line goes, and
 * the walk to it from the ride before (null when it's the same stop).
 * `lines`: every bus line that rides it, the first to come first
 * @typedef {{ line: string, lines: string[], mode: string, board: import('/tools/subway/city.js').Stop, alight: import('/tools/subway/city.js').Stop,
 *   boards: number, arrives: number, stops: number, toward: { el: string, en: string }, walkBefore: Walk | null }} Ride
 */
/**
 * A way with a bus, as one of the Trip page's options: `rides`, its walks
 * from the door and to it (null when there's none), when it gets there
 * (seconds from now's midnight), its minutes, changes, and what it costs a
 * rider by the weights (weights.js), which puts it in order. It's never the
 * morning's first trip, as a metro option can be: it's for leaving now
 * @typedef {{ city: true, morning: false, rides: Ride[], firstWalk: Walk | null, lastWalk: Walk | null,
 *   arrives: number, minutes: number, changes: number, cost: number }} BusOption
 */

/** @param {number} seconds @returns {Walk | null} */
const walkOf = seconds => seconds > 0 ? { minutes: Math.max(1, Math.round(seconds / 60)), meters: Math.round(seconds * METERS_PER_SECOND) } : null;

/**
 * The search over the city on `weekday` (0 = Sunday). `rail`: rail.json as
 * the page plans on it, with its tram or without it (decision 29), never
 * already joined to it (city.js joins it)
 * @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Buses} buses @param {number} weekday
 */
export const cityPlanner = (rail, buses, weekday) => createPlanner(joinNetwork(rail, busDay(buses, weekday), weekday));

/** @param {Planner} planner @param {Point} from @param {Point} to */
const ends = (planner, from, to) => [planner.near(from, NEAR_SECONDS), planner.near(to, NEAR_SECONDS)];

// The same rides whatever the bus: between the same stops, any line
const bundleKey = way => way.legs.map(leg => `${ON_THE_ROAD.has(leg.mode) ? 'bus' : leg.line} ${leg.board} ${leg.alight}`).join('|');

/**
 * The ways with a bus for leaving at `now`: those the search finds, the same
 * lines arriving together once (fold), and ways that only differ by which
 * bus rides between the same two stops as one, with each of its lines,
 * timed by the first to come (as Plan 5 bundles a last bus), as the Trip
 * page's options
 * @param {Planner} planner @param {Point} from @param {Point} to @param {{ seconds: number }} now
 * @returns {BusOption[]}
 */
export function busOptions(planner, from, to, now) {
    const [access, egress] = ends(planner, from, to);
    if (!access.length || !egress.length) return [];
    const bundles = new Map();
    for (const way of fold(findWays(planner, access, egress, now.seconds))) {
        if (!way.legs.some(leg => ON_THE_ROAD.has(leg.mode))) continue;
        const key = bundleKey(way);
        if (!bundles.has(key)) bundles.set(key, { way, lines: way.legs.map(() => new Set()) });
        way.legs.forEach((leg, i) => bundles.get(key).lines[i].add(leg.line));
    }
    return [...bundles.values()]
        .map(({ way, lines }) => ({
            city: /** @type {true} */ (true),
            morning: /** @type {false} */ (false),
            rides: way.legs.map((leg, i) => ({
                line: leg.line, lines: [...lines[i]], mode: leg.mode, board: planner.stops[leg.board], alight: planner.stops[leg.alight],
                boards: leg.boards, arrives: leg.arrives, stops: leg.alightIndex - leg.boardIndex,
                toward: planner.routes[leg.route].toward, walkBefore: walkOf(leg.walkBefore),
            })),
            firstWalk: walkOf(secondsTo(access, way.legs[0].board)),
            lastWalk: walkOf(secondsTo(egress, way.legs.at(-1).alight)),
            arrives: way.at,
            minutes: Math.round((way.at - now.seconds) / 60),
            changes: way.legs.length - 1,
            cost: cost(planner, way, now.seconds, access, egress),
        }));
}

/**
 * The half hour's answer (answer.js): every departure in the next 30 minutes,
 * one every 2, a departure at a time. What kind of answer the trip has: one
 * clear way, a decision on the way, or it depends (roadmap Plan 7)
 * @param {Planner} planner @param {Point} from @param {Point} to @param {{ seconds: number }} now
 */
export function halfHour(planner, from, to, now) {
    const [access, egress] = ends(planner, from, to);
    return answering(planner, access, egress, now.seconds);
}
