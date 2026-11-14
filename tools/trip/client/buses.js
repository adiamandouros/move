import { answering, quickerWay, rowKey, TIE_SECONDS } from '/tools/subway/answer.js';
import { AFTER_WALK_SECONDS, busDay, CHANGE_SECONDS, createPlanner, joinNetwork, METERS_PER_MINUTE, streetEnd } from '/tools/subway/city.js';
import { findWays, fold, secondsTo } from '/tools/subway/ways.js';
import { cost } from '/tools/subway/weights.js';
import { NEAR_MINUTES } from './plan.js';
import { trainOf, trainRide } from './trains.js';

// The Trip page's ways with a bus (decision 31): the whole city's search
// (city.js, decision 28) over OASA's timetable (buses.json, decision 30) and
// the suburban railway's (trains.json, decision 41), for
// leaving now, the next half hour's answer as the page shows it
// (decision 33), and its way timed again with OASA's live times, with the
// quicker way on a decision when OASA has its bus coming in time (decision
// 36), and with how late its suburban trains run (trains.js, decision 42).
// No DOM, so it's tested in Node.

// How far from either end a stop is tried, as a station is
const NEAR_SECONDS = NEAR_MINUTES * 60;
const ON_THE_ROAD = new Set(['bus', 'trolley']);
// What only the city's search rides: the metro and the tram alone, the page
// plans itself (plan.js)
const CITY_ONLY = new Set([...ON_THE_ROAD, 'suburban']);

/** @typedef {ReturnType<typeof createPlanner>} Planner */
/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {{ access: number[], egress: number[], from: Point & { station?: string }, to: Point & { station?: string } }} Ends a trip's start and end, and the stops walked to from the one and from to the other (ends) */
/** @typedef {{ minutes: number, meters: number, out?: number, in?: number }} Walk out, in: the exit of the metro station it leaves or walks into, by its place in the station's exits, where one is gone through (decision 51) */
/** @typedef {import('/tools/subway/city.js').Names} Names */
/**
 * What OASA says of a bus ride of the way shown in full (liveWay): the bus
 * the rider can catch, due `at` (seconds from midnight), and the next of its
 * line after it, null if none is on the road; or that OASA has none the rider
 * can catch there yet
 * @typedef {{ at: number, next: number | null, off?: number } | { none: true }} RideLive
 */
/**
 * One ride of a way, as the page draws it: its stops (city.js), when it
 * leaves and gets there, how many stops it rides, where its line goes, and
 * the walk to it from the ride before (null when it's the same stop), with
 * the note that walk has (a suburban station's change, decision 41), or null.
 * `dir`: a metro or tram ride's direction, as rail.json names it, for its
 * platforms' step-free access. `lines`: every bus line that rides it, the
 * first to come first. `next`: a bus ride's, when the timetable's next bus
 * of its line leaves there, null if there's none. `live`:
 * OASA's word on a bus of the way shown in full, once its stop is answered.
 * A suburban ride's `train`: its number, null when trains.json doesn't say,
 * and `timetable`, when it leaves by the timetable, by which the page shows
 * when it actually leaves (decision 47); it boards then, or a train caught
 * as it runs late when it's expected (trainRide in trains.js). `along`: where
 * each stop of the ride is, from where it boards to where it gets off, and
 * `past`, the stops after that, up to PAST_STOPS, by which the page follows
 * the rider along the ride and sees them ride past their stop (follow.js, Plan 7);
 * `on`, those stops themselves, for the list of a bus's stops on the way
 * @typedef {{ line: string, dir?: string, lines: string[], mode: string, board: import('/tools/subway/city.js').Stop, alight: import('/tools/subway/city.js').Stop,
 *   boards: number, arrives: number, stops: number, along: [number, number][], past: [number, number][], on: import('/tools/subway/city.js').Stop[], toward: { el: string, en: string }, walkBefore: Walk | null,
 *   walkNote: { el: string, en: string } | null, next?: number | null, live?: RideLive, train?: string | null, timetable?: number }} Ride
 */
/**
 * A way with a bus, as one of the Trip page's options: `rides`, its walks
 * from the door and to it (null when there's none), when it gets there
 * (seconds from now's midnight), its minutes, changes, and what it costs a
 * rider by the weights (weights.js), which puts it in order. It's never the
 * morning's first trip, as a metro option can be: it's for leaving now. In
 * the half hour's answer, a way by rail alone has the same shape
 * @typedef {{ city: true, morning: false, rides: Ride[], firstWalk: Walk | null, lastWalk: Walk | null,
 *   arrives: number, minutes: number, changes: number, cost: number }} BusOption
 */
/**
 * A way of the half hour's answer (answer.js): its range in minutes, the
 * quickest and slowest tenth left out; its last bus's lines and the stops
 * they leave from, nearest first, when any of several will do (`bundle`);
 * and the way itself for each departure tried, null where it isn't found
 * @typedef {{ range: [number, number], bundle: boolean, lines: string[],
 *   stops: { stop: import('/tools/subway/city.js').Stop, walk: Walk | null, lines: string[] }[], options: (BusOption | null)[] }} HalfRow
 */
/**
 * The half hour's answer as the page shows it: what kind it is, the
 * departures tried (seconds from midnight), and its ways, the one it stands
 * for first. On a decision, `quicker` is the way that leaves the first ride
 * sooner for a bus, offered when OASA has it coming in time (liveWay); one
 * of `rows` when it's shown among them
 * @typedef {{ kind: 'clear' | 'decision' | 'depends' | 'none', departures: number[], rows: HalfRow[], quicker: HalfRow | null }} HalfView
 */
/**
 * A stop's live times, as the page passes them on (live.js): each bus OASA
 * has coming, by its route, due `at`, as said at `asked` (both seconds from
 * midnight); stale: an older answer, as OASA couldn't be reached;
 * unavailable: none to be had
 * @typedef {{ buses: { route: string, vehicle?: string | null, line: string | null, to?: Names | null, at: number }[], asked?: number, stale?: boolean, unavailable?: boolean }} StopLive
 */
/**
 * The quicker way offered on a decision (decision 36): leave the first ride,
 * `ride`, at `change` for the bus `line`, due at `stop` at `at` (seconds from
 * midnight), `walk` from where it's left (null: the same stop), and get
 * there about `sooner` seconds sooner than staying on. The switch on the way
 * (T14, decision 50) is the same, off the ride the rider is on, for the next
 * ride's `line` of any `mode` (a bus without one)
 * @typedef {{ line: string, at: number, sooner: number, ride: { line: string, mode: string }, change: import('/tools/subway/city.js').Stop,
 *   stop: import('/tools/subway/city.js').Stop, walk: Walk | null, mode?: string }} Offer
 */
/**
 * The way shown in full, timed with OASA's live times (liveWay): as one of the
 * page's options; for a last bus that can be any of several, each stop it
 * leaves from with the first bus of each line the rider can catch there
 * (`buses`, the first to come first; null when the stop isn't answered)
 * and every bus of those lines the rider can catch there, soonest first,
 * with where it goes (`arrivals`, for its row opened, decision 48);
 * the stops to ask OASA for, each with when the first bus the rider can
 * catch there comes (null: none yet), for how often it's asked again; on a
 * decision, the quicker way when OASA has its bus coming in time; on the
 * way, the switch to the search ahead's way, by its key (decision 50); and
 * when its first train leaves (seconds from midnight; null: it has none), for how
 * often the trains are asked for again (decision 42)
 * @typedef {{ option: BusOption, stops: { stop: import('/tools/subway/city.js').Stop, walk: Walk | null, lines: string[], buses: { line: string, at: number }[] | null,
 *   arrivals: { line: string, to: Names | null, at: number, vehicle: string | null }[] }[],
 *   asks: { stop: string, at: number | null, ride?: true }[], offer: Offer | null, switchTo: (Offer & { key: string }) | null, train: number | null }} LiveWay
 */
/**
 * The rider's own bus (decision 50): OASA's code for the vehicle they
 * boarded on ride `leg` (ownBus in live.js)
 * @typedef {{ leg: number, vehicle: string }} OwnBus
 */

// A walk's length, as the search times it (city.js), and the exits it goes
// through: `out` of the metro station it leaves, `in` the one it walks into
/** @param {number} seconds @param {{ out?: number | null, in?: number | null }} [exits] @returns {Walk | null} */
const walkOf = (seconds, exits = {}) => seconds > 0 ? {
    minutes: Math.max(1, Math.round(seconds / 60)), meters: Math.round(seconds / 60 * METERS_PER_MINUTE),
    ...exits.out != null && { out: exits.out }, ...exits.in != null && { in: exits.in },
} : null;
// The exit a walk from the door goes into a station by, or one to the door
// comes out of it by; none for a station picked as the start or the end
/** @param {import('/tools/subway/city.js').Stop} stop @param {Point & { station?: string }} place @param {import('/tools/subway/city.js').Way} way */
const doorExit = (stop, place, way) => place.station ? null : streetEnd(stop, place, way).exit;

/**
 * The search over the city on `weekday` (0 = Sunday), with the suburban
 * railway's `trains` of the day when there are any (trainDay in city.js).
 * `rail`: rail.json as the page plans on it, with its tram or without it
 * (decision 29), never already joined to it (city.js joins it)
 * @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Buses} buses @param {number} weekday
 * @param {import('/tools/subway/city.js').Trains | null} [trains]
 */
export const cityPlanner = (rail, buses, weekday, trains = null) => createPlanner(joinNetwork(rail, busDay(buses, weekday), weekday, trains));

// Walking into the stops near where the trip starts, out of those near where
// it ends, through a metro station's exits (decision 51); a station picked
// as the start or the end is its platforms, with no walk to them
/** @param {Planner} planner @param {Point & { station?: string }} place @param {import('/tools/subway/city.js').Way} way */
const endOf = (planner, place, way) => planner.near(place, NEAR_SECONDS, -1, place.station ? null : way);
/** @param {Planner} planner @param {Point & { station?: string }} from @param {Point & { station?: string }} to */
const ends = (planner, from, to) => [endOf(planner, from, 'in'), endOf(planner, to, 'out')];

// How many stops past where a ride gets off it carries, for seeing a rider ride past their stop
export const PAST_STOPS = 2;
// A stop's position, to about a metre, as a ride carries its stops
/** @param {import('/tools/subway/city.js').Stop} stop @returns {[number, number]} */
const position = stop => [Math.round(stop.lat * 1e5) / 1e5, Math.round(stop.lng * 1e5) / 1e5];
// A leg's stops, boarding to getting off, where they are, and where the stops after are
/** @param {Planner} planner @param {{ route: number, boardIndex: number, alightIndex: number }} leg */
function alongLeg(planner, leg) {
    const { stops } = planner.routes[leg.route];
    const at = i => position(planner.stops[stops[i]]);
    const on = stops.slice(leg.boardIndex, leg.alightIndex + 1).map(stop => planner.stops[stop]);
    return {
        on,
        along: on.map(position),
        past: stops.slice(leg.alightIndex + 1, leg.alightIndex + 1 + PAST_STOPS).map((_, i) => at(leg.alightIndex + 1 + i)),
    };
}

// The same rides whatever the bus: between the same stops, any line
const bundleKey = way => way.legs.map(leg => `${ON_THE_ROAD.has(leg.mode) ? 'bus' : leg.line} ${leg.board} ${leg.alight}`).join('|');

/**
 * The ways with a bus or a train for leaving at `now`: those the search finds, the same
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
        if (!way.legs.some(leg => CITY_ONLY.has(leg.mode))) continue;
        const key = bundleKey(way);
        if (!bundles.has(key)) bundles.set(key, { way, lines: way.legs.map(() => new Set()) });
        way.legs.forEach((leg, i) => bundles.get(key).lines[i].add(leg.line));
    }
    return [...bundles.values()].map(({ way, lines }) => cityOption(planner, way, { access, egress, from, to }, now.seconds, lines.map(set => [...set])));
}

/**
 * `way` as one of the page's options, leaving at `now` (seconds from
 * midnight). `lines`: each ride's lines, its own one unless given. A
 * suburban ride timed with how late the trains run (trainRide) says its
 * train and when it leaves by the timetable; the timetable's own are looked up
 * @param {Planner} planner
 * @param {Omit<import('/tools/subway/ways.js').Way, 'legs'> & { legs: (import('/tools/subway/ways.js').Way['legs'][number] & { train?: string | null, timetable?: number })[] }} way
 * @param {Ends} ends @param {number} now
 * @param {string[][]} [lines]
 * @returns {BusOption}
 */
function cityOption(planner, way, { access, egress, from, to }, now, lines = way.legs.map(leg => [leg.line])) {
    return {
        city: true,
        morning: false,
        rides: way.legs.map((leg, i) => ({
            line: leg.line, lines: lines[i], mode: leg.mode, board: planner.stops[leg.board], alight: planner.stops[leg.alight],
            boards: leg.boards, arrives: leg.arrives, stops: leg.alightIndex - leg.boardIndex, ...alongLeg(planner, leg),
            toward: planner.routes[leg.route].toward, ...planner.routes[leg.route].dir && { dir: planner.routes[leg.route].dir }, walkBefore: walkOf(leg.walkBefore, i ? planner.walkExits(way.legs[i - 1].alight, leg.board) : {}),
            walkNote: i && leg.walkBefore ? planner.walkNote(way.legs[i - 1].alight, leg.board) : null,
            ...ON_THE_ROAD.has(leg.mode) && { next: planner.ride([leg], leg.boards)?.[0].next ?? null },
            ...leg.mode === 'suburban' && { train: leg.train ?? trainOf(planner, leg), timetable: leg.timetable ?? leg.boards },
        })),
        firstWalk: walkOf(secondsTo(access, way.legs[0].board), { in: doorExit(planner.stops[way.legs[0].board], from, 'in') }),
        lastWalk: walkOf(secondsTo(egress, way.legs.at(-1).alight), { out: doorExit(planner.stops[way.legs.at(-1).alight], to, 'out') }),
        arrives: way.at,
        minutes: Math.round((way.at - now) / 60),
        changes: way.legs.length - 1,
        cost: cost(planner, way, now, access, egress),
    };
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

// How many ways the half hour's answer shows, as the answer for leaving now does (plan.js)
const SHOWN = 3;

/**
 * The half hour's answer as the page shows it (decision 33): the way it
 * stands for first (the clear way, the directions that stay on, or the first
 * by the weights when it depends), then the others by the weights, up to 3,
 * leaving out any that's never within a tie of the quickest; on a decision,
 * the way that leaves the first ride sooner too
 * @param {Planner} planner @param {Point} from @param {Point} to @param {import('/tools/subway/answer.js').Answer} answer
 * @returns {HalfView}
 */
export function halfView(planner, from, to, answer) {
    const [access, egress] = ends(planner, from, to);
    const { kind, departures, decision } = answer;
    const shown = shownRows(answer);
    /** @param {import('/tools/subway/answer.js').Row} row @returns {HalfRow} */
    const halfRow = ({ range, bundle, lines, stops, best }) => ({
        range,
        bundle,
        lines,
        stops: stops.map(({ stop, walk, lines: at }) => ({ stop: planner.stops[stop], walk: walkOf(walk), lines: at })),
        options: best.map((way, d) => way && cityOption(planner, way, { access, egress, from, to }, departures[d], linesOf(way, bundle, lines))),
    });
    const rows = shown.map(halfRow);
    const quicker = decision ? rows[shown.indexOf(decision.getOff)] ?? halfRow(decision.getOff) : null;
    return { kind, departures, rows, quicker };
}

/**
 * The rows the half hour's answer shows (halfView), in its order: the way it
 * stands for first, then the others by the weights, up to 3, leaving out any
 * that's never within a tie of the quickest
 * @param {import('/tools/subway/answer.js').Answer} answer
 */
export function shownRows({ rows, clear, decision }) {
    const first = clear ?? decision?.stayOn ?? rows[0];
    return [first, ...rows.filter(row => row !== first)].filter(row => row?.close > 0).slice(0, SHOWN);
}

// Each ride's lines: its own, and for a last bus that can be any of several, all of them
/** @param {import('/tools/subway/ways.js').Way} way @param {boolean} bundle @param {string[]} lines */
const linesOf = (way, bundle, lines) => way.legs.map((leg, i) => bundle && i === way.legs.length - 1 ? lines : [leg.line]);

// The most stops the way shown asks OASA for (agreed 6 Nov 2026, decision 34; kept in 45)
export const LIVE_STOPS = 10;

/**
 * Where the rider is on the way, as it's followed (follow.js, decision 50):
 * on which ride (`leg`: its index among the way's), doing what, at which of
 * the ride's stops (`stop`, from where it boards), since `at` (seconds from
 * midnight: now, or when the last fix came when none has for a while, so
 * nothing slides underground), with `walk` seconds still to walk on a walk
 * @typedef {{ leg: number, kind: 'walk' | 'wait' | 'ride' | 'last' | 'arrived', stop: number, at: number, walk: number }} LiveStep
 */

/**
 * When a ride gets off, for a rider at its `offset`th stop from where it
 * boards at `at`: the timetable's ride from there, by the trip the way boards
 * (the one leaving nearest `leg.boards`); the way's own when the route has none
 * @param {Planner} planner @param {{ route: number, boardIndex: number, alightIndex: number, boards: number, arrives: number }} leg
 * @param {number} offset @param {number} at
 */
function arrivalFrom(planner, leg, offset, at) {
    const trip = tripOf(planner, leg);
    return trip ? at + trip[leg.alightIndex] - trip[leg.boardIndex + offset] : leg.arrives;
}

// The times of the trip a ride boards: the one leaving nearest when it does; none when the route has none
/** @param {Planner} planner @param {{ route: number, boardIndex: number, boards: number }} leg @returns {number[] | undefined} */
function tripOf(planner, leg) {
    const { trips } = planner.routes[leg.route];
    return trips.reduce((best, times) => Math.abs(times[leg.boardIndex] - leg.boards) < Math.abs(best[leg.boardIndex] - leg.boards) ? times : best, trips[0]);
}

// A bus stop's code at OASA, from its id in the city (city.js)
/** @param {import('/tools/subway/city.js').Stop} stop */
const codeOf = stop => stop.id.startsWith('bus:') ? stop.id.slice(4) : null;

/**
 * Which of OASA's routes of `lines` call at `board` and later at one of
 * `ends`, as their live times name them: route code → line. Another route of
 * the same line (a short working) may not get there
 * @param {Planner} planner @param {string[]} lines @param {number} board @param {Set<number>} ends
 * @returns {Map<string, string>}
 */
export function routeCodes(planner, lines, board, ends) {
    const codes = new Map();
    for (const { line, code, stops } of planner.routes) {
        if (!code || !lines.includes(line)) continue;
        const at = stops.indexOf(board);
        if (at >= 0 && stops.slice(at + 1).some(stop => ends.has(stop))) codes.set(code, line);
    }
    return codes;
}

// When OASA has the bus `vehicle` due at the stop `code`, after `after`
// (seconds from midnight); null when it doesn't say, or there's no code
/** @param {Record<string, StopLive>} live @param {string | null} code @param {string | null | undefined} vehicle @param {number} after */
const dueThere = (live, code, vehicle, after) => code && vehicle ? live[code]?.buses.find(bus => bus.vehicle === vehicle && bus.at >= after)?.at ?? null : null;

// The buses at a stop of those routes that the rider, there at `ready`, can still catch, the first first
/** @param {StopLive | undefined} live @param {Map<string, string>} codes @param {number} ready */
const catchable = (live, codes, ready) => (live?.buses ?? [])
    .filter(bus => codes.has(bus.route) && bus.at >= ready)
    .map(bus => ({ line: codes.get(bus.route), to: bus.to ?? null, at: bus.at, vehicle: bus.vehicle ?? null }))
    .sort((a, b) => a.at - b.at);

/**
 * The way the half hour's answer shows in full, `row`'s for `departure`,
 * for leaving at `now` with OASA's live times, `live` by stop code (decision
 * 35). Each ride is timed again from when the rider can be at its stop: a bus
 * OASA has coming that the rider can still catch boards then, and takes as
 * long as the timetable's ride from then; any other ride is the timetable's
 * first from then. Null when a ride can't be made, so the way stays as it is
 * for `departure`. A last bus that can be any of several isn't timed, as on
 * the page: its stops come with the buses the rider can catch at each, those
 * with one first, by when it comes, then the others, nearest first (the
 * rider's rule, 6 Nov). On a `decision` whose directions `row` is, the
 * quicker way is offered when OASA has its bus coming in time (quickerWay in
 * answer.js), from the first ride as it's timed now, until the rider is on
 * it; `taken`: the rider took
 * it, so it's the way timed instead (decision 36). Asked for: the stops of
 * the rides by bus, then the decision's bus stop, then those of a last bus
 * that can be any of several, nearest first, at most LIVE_STOPS. A ride by
 * suburban train is timed with how late the trains run, `trains` by number
 * (trainRide in trains.js, decision 42): the rest of the way from its later
 * arrival, as after a bus
 * @param {Planner} planner @param {Point} from @param {Point} to
 * @param {import('/tools/subway/answer.js').Row} row @param {number} departure
 * @param {{ seconds: number }} now @param {Record<string, StopLive>} live
 * With the rider followed along it (`step`, Plan 7, decision 50): the rides
 * done keep the way's own times (the page greys them) and aren't asked for;
 * the ride they're on gets off when the timetable's ride from the stop
 * they're at says, by the trip the way boards (arrivalFrom); the rest is
 * timed from that, as after a bus; a walk is timed from `step.at` by what's
 * left of it; and once past every ride, the way gets there by the last walk.
 * On a bus that's their `own`, the stop they get off is asked for it, on the
 * tiers by when OASA has that vehicle due there (`ride` marks the ask), and
 * the ride gets off then, when OASA says so. With the search ahead's way
 * off the ride they're on (`ahead`, searchAhead), the switch to it when it's
 * 3' or more sooner (switchOf), its bus's stop asked for that ride
 * @param {{ decision?: import('/tools/subway/answer.js').Decision | null, taken?: boolean, trains?: Record<string, import('./trains.js').TrainLate> | null, step?: LiveStep | null, own?: OwnBus | null, ahead?: Ahead | null }} [options]
 * @returns {LiveWay | null}
 */
export function liveWay(planner, from, to, row, departure, now, live, { decision = null, taken = false, trains = null, step = null, own = null, ahead = null } = {}) {
    const way = row.best[departure];
    if (!way) return null;
    if (decision && taken) {
        const off = leavingSooner(decision, way, departure);
        return off < 0 ? null : liveWay(planner, from, to, decision.getOff, off, now, live, { trains, step, own, ahead });
    }
    const [access, egress] = ends(planner, from, to);
    const last = way.legs.length - 1;
    const current = currentLeg(way, step);
    const asks = new Map();
    const ask = (code, at, ride = false) => { if (code && asks.size < LIVE_STOPS && !asks.has(code)) asks.set(code, { at, ...ride && { ride: true } }); };
    const timed = timedLegs(planner, row, way, now, live, access, { step, own, trains }, ask);
    if (!timed) return null;
    const { legs, said, train } = timed;
    const end = legs.at(-1);
    // Past every ride, the door is as far as the last walk; arrived, it's here
    const at = step?.kind === 'arrived' ? step.at : step?.kind === 'last' ? step.at + step.walk : end.arrives + secondsTo(egress, end.alight);
    const option = cityOption(planner, { ...way, legs, at }, { access, egress, from, to }, now.seconds, linesOf(way, row.bundle, row.lines));
    option.rides.forEach((ride, i) => { if (said[i]) ride.live = said[i]; });

    const doors = new Set(egress.filter((_, i) => i % 2 === 0));
    // On a decision, where the quicker way would catch its bus: asked before
    // a last bus's stops; not once the rider is on the first ride, where the
    // search ahead finds what's quicker (decision 50)
    const quick = decision && (current < 0 || (current === 0 && step.kind !== 'ride')) && quickerBus(planner, decision, way, departure, legs[0], doors);
    if (quick) ask(quick.code, catchable(live[quick.code], quick.codes, quick.ready)[0]?.at ?? null);
    // The search ahead's way off the ride the rider is on: where its bus is
    // caught, asked for that ride, as their own bus is
    const leaving = ahead && leavingAhead(planner, ahead, legs, step);
    if (leaving?.code) ask(leaving.code, catchable(live[leaving.code], leaving.codes, leaving.ready)[0]?.at ?? null, true);
    // A last bus that can be any of several: its stops, until the rider is on it
    const riding = current > last || (current === last && step.kind === 'ride');
    const stops = row.bundle && !riding ? row.stops.map(({ stop, walk, lines }) => {
        const ready = current === last ? step.at + (step.kind === 'walk' ? walk : 0)
            : last ? legs[last - 1].arrives + (walk ? walk + AFTER_WALK_SECONDS : CHANGE_SECONDS) : now.seconds + walk;
        const code = codeOf(planner.stops[stop]);
        const coming = catchable(live[code], routeCodes(planner, lines, stop, doors), ready);
        ask(code, coming[0]?.at ?? null);
        const first = new Map();
        for (const bus of coming) if (!first.has(bus.line)) first.set(bus.line, bus.at);
        const known = live[code] && !live[code].unavailable;
        return { stop: planner.stops[stop], walk: walkOf(walk), lines, buses: known ? [...first].map(([line, at]) => ({ line, at })) : null, arrivals: known ? coming : [] };
    }) : [];
    const coming = stops.filter(({ buses }) => buses?.length).sort((a, b) => a.buses[0].at - b.buses[0].at);
    const staying = riding ? option.arrives : stayingOn(planner, row, legs, egress, stops, option.arrives);
    return {
        option,
        stops: [...coming, ...stops.filter(stop => !coming.includes(stop))],
        asks: [...asks].map(([stop, what]) => ({ stop, ...what })),
        offer: quick ? offerOf(quick, staying, live[quick.code]) : null,
        switchTo: leaving ? switchOf(planner, leaving, staying, live, timed.own) : null,
        train,
    };
}

// The ride the rider is on or walking to, by its index among the way's;
// past them all, one more; -1 when they aren't followed
/** @param {import('/tools/subway/ways.js').Way} way @param {LiveStep | null} step */
const currentLeg = (way, step) => !step ? -1 : step.kind === 'last' || step.kind === 'arrived' ? way.legs.length : step.leg;

/**
 * The rides of `way`, `row`'s, timed for leaving at `now` with the live times
 * `live` and how late the `trains` run, from where the rider is (`step`) on
 * their `own` bus (liveWay); each stop to ask OASA for passed to `ask`.
 * With what OASA says of each bus ride (`said`), when its first train leaves
 * (`train`), and when OASA has the rider's own bus due where they get off
 * (`own`; null when it doesn't say). Null when a ride can't be made
 * @param {Planner} planner @param {import('/tools/subway/answer.js').Row} row @param {import('/tools/subway/ways.js').Way} way
 * @param {{ seconds: number }} now @param {Record<string, StopLive>} live @param {number[]} access
 * @param {{ step: LiveStep | null, own: OwnBus | null, trains: Record<string, import('./trains.js').TrainLate> | null }} rider
 * @param {(code: string | null, at: number | null, ride?: boolean) => void} ask
 */
function timedLegs(planner, row, way, now, live, access, { step, own, trains }, ask) {
    const last = way.legs.length - 1;
    const current = currentLeg(way, step);
    /** @type {(import('/tools/subway/ways.js').Way['legs'][number] & { boards: number, arrives: number })[]} */
    const legs = [];
    /** @type {(RideLive | undefined)[]} */
    const said = [];
    let train = null;
    let ownAt = null;
    for (const [i, leg] of way.legs.entries()) {
        const before = legs.at(-1);
        // A ride done: as the way had it, nothing asked
        if (i < current) {
            legs.push(leg);
            said.push(undefined);
            continue;
        }
        // The ride the rider is on: off it when OASA has their own bus due
        // where they get off, asked for it, or else when the timetable says
        // from where they are
        if (i === current && step.kind === 'ride') {
            const ride = leg.mode === 'suburban' ? trainRide(planner, leg, leg.boards, trains) : null;
            if (ride) train ??= ride.boards;
            const code = own && own.leg === i && ON_THE_ROAD.has(leg.mode) ? codeOf(planner.stops[leg.alight]) : null;
            const due = dueThere(live, code, own?.vehicle, step.at);
            ask(code, due, true);
            ownAt = due;
            legs.push(ride ?? { ...leg, arrives: due ?? arrivalFrom(planner, leg, step.stop, step.at) });
            said.push(undefined);
            continue;
        }
        const ready = i === current ? step.at + (step.kind === 'walk' ? step.walk + (i ? AFTER_WALK_SECONDS : 0) : 0)
            : before ? before.arrives + (leg.walkBefore ? leg.walkBefore + AFTER_WALK_SECONDS : CHANGE_SECONDS) : now.seconds + secondsTo(access, leg.board);
        if (leg.mode === 'suburban') {
            const ride = trainRide(planner, leg, ready, trains);
            if (!ride) return null;
            train ??= ride.boards;
            legs.push(ride);
            said.push(undefined);
            continue;
        }
        const code = ON_THE_ROAD.has(leg.mode) && !(row.bundle && i === last) ? codeOf(planner.stops[leg.board]) : null;
        const known = code && live[code] && !live[code].unavailable;
        const [bus, next] = code ? catchable(live[code], routeCodes(planner, [leg.line], leg.board, new Set([leg.alight])), ready) : [];
        ask(code, bus?.at ?? null);
        // Where it gets off, asked on the same tiers: the bus it boards, due
        // there by its vehicle code, is when the ride ends (decision 53)
        const alight = code && codeOf(planner.stops[leg.alight]);
        ask(alight, bus?.at ?? null);
        const off = bus && dueThere(live, alight, bus.vehicle, bus.at);
        said.push(known ? (bus ? { at: bus.at, next: next?.at ?? null, ...off && { off } } : { none: true }) : undefined);
        if (bus) {
            // Or as long as the timetable's ride from then, or the way's own where there's none
            const [timed] = planner.ride([leg], bus.at) ?? [leg];
            legs.push({ ...leg, boards: bus.at, arrives: off ?? bus.at + timed.arrives - timed.boards });
            continue;
        }
        const [timed] = planner.ride([leg], ready) ?? [];
        // A last bus that can be any of several isn't shown as a ride: one of its lines gone for the night doesn't matter
        if (!timed && !(row.bundle && i === last)) return null;
        legs.push(timed ?? leg);
    }
    return { legs, said, train, own: ownAt };
}

/**
 * The way the search ahead found off the ride the rider is on (searchAhead,
 * Plan 7, decision 50): `key`, as the half hour's rows are told apart
 * (rowKey in answer.js); the way itself, the rides before it and the ride
 * they're on up to where it leaves it as they are timed, then its own; and
 * which of the way's rides it leaves (`leg`)
 * @typedef {{ key: string, way: import('/tools/subway/ways.js').Way, leg: number }} Ahead
 */

/**
 * The search ahead (Plan 7, agreed 12 Nov 2026, decision 50): on a ride of
 * the way shown in full, the ways on from each of its stops still to come,
 * as the rider gets there (by the trip the way boards, as late as the ride
 * is timed to get off, liveWay), or from a walk from one: one departure of
 * the city's search, with every stop and walk as where it starts. A change
 * at the same stop takes as long as in the search. The best that isn't the
 * way itself, nor a later bus of the same line, nor one the rider
 * `declined` (by key), with the rides before as they are timed; staying on
 * is the way, as liveWay times it, which says whether it's sooner. Null
 * off a ride, or with nothing else. Options as liveWay's
 * @param {Planner} planner @param {Point} from @param {Point} to
 * @param {import('/tools/subway/answer.js').Row} row @param {number} departure
 * @param {{ seconds: number }} now @param {Record<string, StopLive>} live
 * @param {{ decision?: import('/tools/subway/answer.js').Decision | null, taken?: boolean, trains?: Record<string, import('./trains.js').TrainLate> | null, step?: LiveStep | null, own?: OwnBus | null, declined?: string[] }} [options]
 * @returns {Ahead | null}
 */
export function searchAhead(planner, from, to, row, departure, now, live, { decision = null, taken = false, trains = null, step = null, own = null, declined = [] } = {}) {
    const way = row.best[departure];
    if (!way || step?.kind !== 'ride') return null;
    if (decision && taken) {
        const off = leavingSooner(decision, way, departure);
        return off < 0 ? null : searchAhead(planner, from, to, decision.getOff, off, now, live, { trains, step, own, declined });
    }
    const [access, egress] = ends(planner, from, to);
    const timed = timedLegs(planner, row, way, now, live, access, { step, own, trains }, () => {});
    const riding = timed?.legs[step.leg];
    const trip = riding && tripOf(planner, riding);
    const here = riding ? riding.boardIndex + step.stop : 0;
    if (!trip || here >= riding.alightIndex) return null;
    const { stops } = planner.routes[riding.route];
    // How late the ride is timed to get off, shared out along the stops left
    const late = riding.arrives - (step.at + trip[riding.alightIndex] - trip[here]);
    const seeds = [];
    /** @type {Map<number, { index: number, reaches: number, walk: number, seconds: number }>} */
    const seededBy = new Map();
    const seed = (stop, index, reaches, walk) => {
        const seconds = reaches - step.at + (walk ? walk + AFTER_WALK_SECONDS : CHANGE_SECONDS);
        seeds.push(stop, seconds);
        if (!(seededBy.get(stop)?.seconds <= seconds)) seededBy.set(stop, { index, reaches, walk, seconds });
    };
    for (let i = here + 1; i <= riding.alightIndex; i++) {
        const reaches = step.at + trip[i] - trip[here] + Math.round(late * (i - here) / (riding.alightIndex - here));
        seed(stops[i], i, reaches, 0);
        const near = planner.walks[stops[i]];
        for (let j = 0; j < near.length; j += 2) seed(near[j], i, reaches, near[j + 1]);
    }
    const skip = new Set([rowKey(planner, way), ...declined]);
    const before = timed.legs.slice(0, step.leg);
    /** @type {Ahead | null} */
    let best = null;
    for (const found of fold(findWays(planner, seeds, egress, step.at))) {
        const [onward, ...rest] = found.legs;
        const by = seededBy.get(onward.board);
        if (!by || onward.line === riding.line || (best && best.way.at <= found.at)) continue;
        const legs = [...before, { ...riding, alight: stops[by.index], alightIndex: by.index, arrives: by.reaches }, { ...onward, walkBefore: by.walk }, ...rest];
        const candidate = { ...found, legs, walk: found.walk + by.walk };
        const key = rowKey(planner, candidate);
        if (!skip.has(key)) best = { key, way: candidate, leg: step.leg };
    }
    return best;
}

/**
 * The search ahead's way, while the rider is on the ride it leaves, before
 * where it does: where it leaves it, what it rides next and from when they
 * can be there, and for a bus, where it's caught (`code`) and OASA's routes
 * of its line that get from there to where it's left (`codes`). Null when
 * it isn't for the ride they're on, or they're past where it leaves
 * @param {Planner} planner @param {Ahead} ahead @param {{ line: string, mode: string, board: number, boardIndex: number }[]} legs @param {LiveStep | null} step
 */
function leavingAhead(planner, ahead, legs, step) {
    if (step?.kind !== 'ride' || ahead.leg !== step.leg) return null;
    const ride = legs[step.leg];
    const leave = ahead.way.legs[step.leg];
    const onward = ahead.way.legs[step.leg + 1];
    if (!ride || leave.line !== ride.line || leave.board !== ride.board || leave.alightIndex <= ride.boardIndex + step.stop) return null;
    const bus = ON_THE_ROAD.has(onward.mode);
    return {
        ahead, ride, leave, onward, bus,
        ready: leave.arrives + (onward.walkBefore ? onward.walkBefore + AFTER_WALK_SECONDS : CHANGE_SECONDS),
        // From the next ride leaving to the door takes the same whenever it leaves
        rest: ahead.way.at - onward.boards,
        code: bus ? codeOf(planner.stops[onward.board]) : null,
        codes: bus ? routeCodes(planner, [onward.line], onward.board, new Set([onward.alight])) : new Map(),
    };
}

/**
 * The switch to the search ahead's way (T14, decision 50), against staying
 * on to the door at `staying`: when it gets there TIE_SECONDS or more sooner,
 * by the timetable for a train, and for a bus only when OASA has it coming
 * in time (quickerWay in answer.js), late as buses are, an older answer
 * offering nothing; `own`: when OASA has the rider's own bus due where they
 * get off, so the stops before are as late (quickerWay's `here`). As the
 * quicker way on a decision is offered, with its key
 * @param {Planner} planner @param {NonNullable<ReturnType<typeof leavingAhead>>} leaving
 * @param {number} staying @param {Record<string, StopLive>} live @param {number | null} own
 * @returns {(Offer & { key: string }) | null}
 */
function switchOf(planner, { ahead, ride, leave, onward, bus, ready, rest, code, codes }, staying, live, own) {
    const offer = { key: ahead.key, ride: { line: ride.line, mode: ride.mode }, mode: onward.mode, change: planner.stops[leave.alight], stop: planner.stops[onward.board], walk: walkOf(onward.walkBefore) };
    if (!bus) {
        const sooner = staying - ahead.way.at;
        return sooner >= TIE_SECONDS ? { ...offer, line: onward.line, at: onward.boards, sooner } : null;
    }
    const answer = code ? live[code] : undefined;
    if (!answer || answer.stale) return null;
    const predictions = answer.buses.filter(each => codes.has(each.route)).map(each => ({ line: codes.get(each.route), at: each.at }));
    const found = quickerWay({ lines: [onward.line], ready, latest: staying - rest, reaches: leave.arrives }, predictions, answer.asked ?? 0, own === null ? {} : { here: leave.arrives });
    return found.offer ? { ...offer, line: found.line, at: found.at, sooner: found.sooner } : null;
}

/**
 * When staying on gets to the door: as the way is timed now, `arrives`, or
 * when its last bus can be any of several, with the first of them to get
 * there from the change, by the timetable or by OASA's buses at its stops,
 * `stops`, as liveWay has them. The earliest, so a quicker way is offered too
 * rarely rather than too often
 * @param {Planner} planner @param {import('/tools/subway/answer.js').Row} row @param {{ alight: number, arrives: number }[]} legs
 * @param {number[]} egress @param {LiveWay['stops']} stops @param {number} arrives
 */
function stayingOn(planner, row, legs, egress, stops, arrives) {
    if (!row.bundle || legs.length < 2) return arrives;
    const change = legs.at(-2);
    const rides = new Map(planner.onwardRides(change.alight, change.arrives, egress)
        .filter(({ leg }) => row.lines.includes(leg.line))
        .map(ride => [ride.leg.line, ride]));
    // A bus OASA has coming takes as long to the door as its line's ride
    const live = stops.flatMap(({ buses }) => buses ?? []).filter(bus => rides.has(bus.line))
        .map(bus => bus.at + rides.get(bus.line).at - rides.get(bus.line).leg.boards);
    return Math.min(arrives, ...[...rides.values()].map(ride => ride.at), ...live);
}

// Which departure of the decision's quicker way leaves the same first ride
// as `way` sooner: `departure`'s, or else the first that does. -1 when none
/** @param {import('/tools/subway/answer.js').Decision} decision @param {import('/tools/subway/ways.js').Way} way @param {number} departure */
function leavingSooner({ getOff }, way, departure) {
    const [first] = way.legs;
    const same = off => off && off.legs[0].line === first.line && off.legs[0].board === first.board;
    return same(getOff.best[departure]) ? departure : getOff.best.findIndex(same);
}

/**
 * The bus the quicker way on `decision` would catch, for the directions
 * `way` as their first ride, `first`, is timed now: where (`code`), OASA's
 * routes of its lines that call there and later near the door or where the
 * quicker way gets off (`codes`), and from when the rider can be there,
 * `ready`. Null when the quicker way doesn't leave that ride
 * @param {Planner} planner @param {import('/tools/subway/answer.js').Decision} decision
 * @param {import('/tools/subway/ways.js').Way} way @param {number} departure
 * @param {{ line: string, mode: string, board: number, boards: number }} first @param {Set<number>} doors
 */
function quickerBus(planner, decision, way, departure, first, doors) {
    const off = decision.getOff.best[leavingSooner(decision, way, departure)];
    if (!off) return null;
    const [leave, onward] = off.legs;
    // As long a ride to the change as the timetable's from when the first ride leaves
    const [timed] = planner.ride([leave], first.boards) ?? [];
    if (!timed) return null;
    const reaches = first.boards + timed.arrives - timed.boards;
    const gets = new Set([...doors, ...decision.getOff.best.flatMap(each => each ? [each.legs[1].alight] : [])]);
    return {
        decision, first, leave, onward, reaches,
        ready: reaches + (onward.walkBefore ? onward.walkBefore + AFTER_WALK_SECONDS : CHANGE_SECONDS),
        // From the bus leaving to the door takes the same whenever it leaves
        rest: off.at - onward.boards,
        code: codeOf(planner.stops[onward.board]),
        codes: routeCodes(planner, decision.lines, onward.board, gets),
        change: planner.stops[leave.alight],
        stop: planner.stops[onward.board],
    };
}

/**
 * The quicker way offered (quickerWay in answer.js), from `quick`'s stop's
 * live times, `answer`, against staying on to the door at `staying`; an
 * older answer offers nothing
 * @param {NonNullable<ReturnType<typeof quickerBus>>} quick @param {number} staying @param {StopLive | undefined} answer
 * @returns {Offer | null}
 */
function offerOf({ decision, first, onward, reaches, ready, rest, codes, change, stop }, staying, answer) {
    if (!answer || answer.stale) return null;
    const predictions = answer.buses.filter(bus => codes.has(bus.route)).map(bus => ({ line: codes.get(bus.route), at: bus.at }));
    const found = quickerWay({ lines: decision.lines, ready, latest: staying - rest, reaches }, predictions, answer.asked);
    if (!found.offer) return null;
    return { line: found.line, at: found.at, sooner: found.sooner, ride: { line: first.line, mode: first.mode }, change, stop, walk: walkOf(onward.walkBefore) };
}
