import { answering, quickerWay } from '/tools/subway/answer.js';
import { AFTER_WALK_SECONDS, busDay, CHANGE_SECONDS, createPlanner, joinNetwork, METERS_PER_MINUTE } from '/tools/subway/city.js';
import { findWays, fold, secondsTo } from '/tools/subway/ways.js';
import { cost } from '/tools/subway/weights.js';
import { NEAR_MINUTES } from './plan.js';

// The Trip page's ways with a bus (decision 31): the whole city's search
// (city.js, decision 28) over OASA's timetable (buses.json, decision 30) and
// the suburban railway's (trains.json, decision 40), for
// leaving now, the next half hour's answer as the page shows it
// (decision 33), and its way timed again with OASA's live times, with the
// quicker way on a decision when OASA has its bus coming in time (decision
// 36). No DOM, so it's tested in Node.

// How far from either end a stop is tried, as a station is
const NEAR_SECONDS = NEAR_MINUTES * 60;
const ON_THE_ROAD = new Set(['bus', 'trolley']);
// What only the city's search rides: the metro and the tram alone, the page
// plans itself (plan.js)
const CITY_ONLY = new Set([...ON_THE_ROAD, 'suburban']);

/** @typedef {ReturnType<typeof createPlanner>} Planner */
/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {{ minutes: number, meters: number }} Walk */
/**
 * What OASA says of a bus ride of the way shown in full (liveWay): the bus
 * the rider can catch, due `at` (seconds from midnight), and the next of its
 * line after it, null if none is on the road; or that OASA has none the rider
 * can catch there yet
 * @typedef {{ at: number, next: number | null } | { none: true }} RideLive
 */
/**
 * One ride of a way, as the page draws it: its stops (city.js), when it
 * leaves and gets there, how many stops it rides, where its line goes, and
 * the walk to it from the ride before (null when it's the same stop), with
 * the note that walk has (a suburban station's change, decision 40), or null.
 * `lines`: every bus line that rides it, the first to come first. `live`:
 * OASA's word on a bus of the way shown in full, once its stop is answered
 * @typedef {{ line: string, lines: string[], mode: string, board: import('/tools/subway/city.js').Stop, alight: import('/tools/subway/city.js').Stop,
 *   boards: number, arrives: number, stops: number, toward: { el: string, en: string }, walkBefore: Walk | null,
 *   walkNote: { el: string, en: string } | null, live?: RideLive }} Ride
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
 * @typedef {{ buses: { route: string, line: string | null, at: number }[], asked?: number, stale?: boolean, unavailable?: boolean }} StopLive
 */
/**
 * The quicker way offered on a decision (decision 36): leave the first ride,
 * `ride`, at `change` for the bus `line`, due at `stop` at `at` (seconds from
 * midnight), `walk` from where it's left (null: the same stop), and get
 * there about `sooner` seconds sooner than staying on
 * @typedef {{ line: string, at: number, sooner: number, ride: { line: string, mode: string }, change: import('/tools/subway/city.js').Stop,
 *   stop: import('/tools/subway/city.js').Stop, walk: Walk | null }} Offer
 */
/**
 * The way shown in full, timed with OASA's live times (liveWay): as one of the
 * page's options; for a last bus that can be any of several, each stop it
 * leaves from with the first bus of each line the rider can catch there
 * (`buses`, the first to come first; null when the stop isn't answered);
 * the stops to ask OASA for, each with when the first bus the rider can
 * catch there comes (null: none yet), for how often it's asked again; and
 * on a decision, the quicker way when OASA has its bus coming in time
 * @typedef {{ option: BusOption, stops: { stop: import('/tools/subway/city.js').Stop, walk: Walk | null, lines: string[], buses: { line: string, at: number }[] | null }[],
 *   asks: { stop: string, at: number | null }[], offer: Offer | null }} LiveWay
 */

// A walk's length, as the search times it (city.js)
/** @param {number} seconds @returns {Walk | null} */
const walkOf = seconds => seconds > 0 ? { minutes: Math.max(1, Math.round(seconds / 60)), meters: Math.round(seconds / 60 * METERS_PER_MINUTE) } : null;

/**
 * The search over the city on `weekday` (0 = Sunday), with the suburban
 * railway's `trains` of the day when there are any (trainDay in city.js).
 * `rail`: rail.json as the page plans on it, with its tram or without it
 * (decision 29), never already joined to it (city.js joins it)
 * @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Buses} buses @param {number} weekday
 * @param {import('/tools/subway/city.js').Trains | null} [trains]
 */
export const cityPlanner = (rail, buses, weekday, trains = null) => createPlanner(joinNetwork(rail, busDay(buses, weekday), weekday, trains));

/** @param {Planner} planner @param {Point} from @param {Point} to */
const ends = (planner, from, to) => [planner.near(from, NEAR_SECONDS), planner.near(to, NEAR_SECONDS)];

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
    return [...bundles.values()].map(({ way, lines }) => cityOption(planner, way, access, egress, now.seconds, lines.map(set => [...set])));
}

/**
 * `way` as one of the page's options, leaving at `now` (seconds from
 * midnight). `lines`: each ride's lines, its own one unless given
 * @param {Planner} planner @param {import('/tools/subway/ways.js').Way} way @param {number[]} access @param {number[]} egress @param {number} now
 * @param {string[][]} [lines]
 * @returns {BusOption}
 */
function cityOption(planner, way, access, egress, now, lines = way.legs.map(leg => [leg.line])) {
    return {
        city: true,
        morning: false,
        rides: way.legs.map((leg, i) => ({
            line: leg.line, lines: lines[i], mode: leg.mode, board: planner.stops[leg.board], alight: planner.stops[leg.alight],
            boards: leg.boards, arrives: leg.arrives, stops: leg.alightIndex - leg.boardIndex,
            toward: planner.routes[leg.route].toward, walkBefore: walkOf(leg.walkBefore),
            walkNote: i && leg.walkBefore ? planner.walkNote(way.legs[i - 1].alight, leg.board) : null,
        })),
        firstWalk: walkOf(secondsTo(access, way.legs[0].board)),
        lastWalk: walkOf(secondsTo(egress, way.legs.at(-1).alight)),
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
        options: best.map((way, d) => way && cityOption(planner, way, access, egress, departures[d], linesOf(way, bundle, lines))),
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

// The most stops the way shown asks OASA for (agreed 6 Nov 2026, decision 34; kept in 38)
export const LIVE_STOPS = 10;

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

// The buses at a stop of those routes that the rider, there at `ready`, can still catch, the first first
/** @param {StopLive | undefined} live @param {Map<string, string>} codes @param {number} ready */
const catchable = (live, codes, ready) => (live?.buses ?? [])
    .filter(bus => codes.has(bus.route) && bus.at >= ready)
    .map(bus => ({ line: codes.get(bus.route), at: bus.at }))
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
 * answer.js), from the first ride as it's timed now; `taken`: the rider took
 * it, so it's the way timed instead (decision 36). Asked for: the stops of
 * the rides by bus, then the decision's bus stop, then those of a last bus
 * that can be any of several, nearest first, at most LIVE_STOPS
 * @param {Planner} planner @param {Point} from @param {Point} to
 * @param {import('/tools/subway/answer.js').Row} row @param {number} departure
 * @param {{ seconds: number }} now @param {Record<string, StopLive>} live
 * @param {{ decision?: import('/tools/subway/answer.js').Decision | null, taken?: boolean }} [options]
 * @returns {LiveWay | null}
 */
export function liveWay(planner, from, to, row, departure, now, live, { decision = null, taken = false } = {}) {
    const way = row.best[departure];
    if (!way) return null;
    if (decision && taken) {
        const off = leavingSooner(decision, way, departure);
        return off < 0 ? null : liveWay(planner, from, to, decision.getOff, off, now, live);
    }
    const [access, egress] = ends(planner, from, to);
    const last = way.legs.length - 1;
    const asks = new Map();
    const ask = (code, at) => { if (code && asks.size < LIVE_STOPS && !asks.has(code)) asks.set(code, at); };
    /** @type {(import('/tools/subway/ways.js').Way['legs'][number] & { boards: number, arrives: number })[]} */
    const legs = [];
    /** @type {(RideLive | undefined)[]} */
    const said = [];
    for (const [i, leg] of way.legs.entries()) {
        const before = legs.at(-1);
        const ready = before ? before.arrives + (leg.walkBefore ? leg.walkBefore + AFTER_WALK_SECONDS : CHANGE_SECONDS) : now.seconds + secondsTo(access, leg.board);
        const code = ON_THE_ROAD.has(leg.mode) && !(row.bundle && i === last) ? codeOf(planner.stops[leg.board]) : null;
        const known = code && live[code] && !live[code].unavailable;
        const [bus, next] = code ? catchable(live[code], routeCodes(planner, [leg.line], leg.board, new Set([leg.alight])), ready) : [];
        ask(code, bus?.at ?? null);
        said.push(known ? (bus ? { at: bus.at, next: next?.at ?? null } : { none: true }) : undefined);
        if (bus) {
            // As long as the timetable's ride from then, or the way's own where there's none
            const [timed] = planner.ride([leg], bus.at) ?? [leg];
            legs.push({ ...leg, boards: bus.at, arrives: bus.at + timed.arrives - timed.boards });
            continue;
        }
        const [timed] = planner.ride([leg], ready) ?? [];
        // A last bus that can be any of several isn't shown as a ride: one of its lines gone for the night doesn't matter
        if (!timed && !(row.bundle && i === last)) return null;
        legs.push(timed ?? leg);
    }
    const end = legs.at(-1);
    const option = cityOption(planner, { ...way, legs, at: end.arrives + secondsTo(egress, end.alight) }, access, egress, now.seconds, linesOf(way, row.bundle, row.lines));
    option.rides.forEach((ride, i) => { if (said[i]) ride.live = said[i]; });

    const doors = new Set(egress.filter((_, i) => i % 2 === 0));
    // On a decision, where the quicker way would catch its bus: asked before a last bus's stops
    const quick = decision && quickerBus(planner, decision, way, departure, legs[0], doors);
    if (quick) ask(quick.code, catchable(live[quick.code], quick.codes, quick.ready)[0]?.at ?? null);
    const stops = row.bundle ? row.stops.map(({ stop, walk, lines }) => {
        const ready = last ? legs[last - 1].arrives + (walk ? walk + AFTER_WALK_SECONDS : CHANGE_SECONDS) : now.seconds + walk;
        const code = codeOf(planner.stops[stop]);
        const coming = catchable(live[code], routeCodes(planner, lines, stop, doors), ready);
        ask(code, coming[0]?.at ?? null);
        const first = new Map();
        for (const bus of coming) if (!first.has(bus.line)) first.set(bus.line, bus.at);
        const known = live[code] && !live[code].unavailable;
        return { stop: planner.stops[stop], walk: walkOf(walk), lines, buses: known ? [...first].map(([line, at]) => ({ line, at })) : null };
    }) : [];
    const coming = stops.filter(({ buses }) => buses?.length).sort((a, b) => a.buses[0].at - b.buses[0].at);
    return {
        option,
        stops: [...coming, ...stops.filter(stop => !coming.includes(stop))],
        asks: [...asks].map(([stop, at]) => ({ stop, at })),
        offer: quick ? offerOf(quick, stayingOn(planner, row, legs, egress, stops, option.arrives), live[quick.code]) : null,
    };
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
