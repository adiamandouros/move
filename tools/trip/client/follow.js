import { distanceMeters } from '/js/core/geo.js';

// My location follows the rider (DESIGN.md, "Start from here"). Until Plan 7
// is in: the trip is planned again from where they are once they're
// MOVED_METRES from where it was last planned, and no sooner than REPLAN_MS
// after it (11 Nov 2026, decision 45). With Plan 7 (agreed 12 Nov 2026): once
// they've left, the way shown in full is their way, and each fix only places
// them on it: walking to a stop, waiting at it, on a ride at one of its
// stops, or on the last walk. A re-plan then comes only once they're off
// the way, still no sooner than REPLAN_MS after the last. No DOM, so it's
// tested in Node; main.js follows.

export const MOVED_METRES = 200;
export const REPLAN_MS = 2 * 60_000;
// A fix less exact than this (a cell or Wi-Fi guess, not GPS) places nobody
export const ROUGH_METRES = 200;
// Within this of a stop, a station or the door, the rider is there
export const NEAR_METRES = 100;
// Further than this from every point of the step they're on, for this long,
// the rider is off the way
export const OFF_METRES = 300;
export const OFF_MS = 60_000;
// After this long without a fix (underground), one fix that doesn't fit the
// way is enough: there's nothing to confirm it against
export const GAP_MS = 2 * 60_000;
// This far from the start, the rider has left
export const LEFT_METRES = 100;
// Not moved this far for this long: standing still (the pause rule, with
// the page untouched as long: timing.js IDLE_MS)
export const STILL_METRES = 50;
export const STILL_MS = 10 * 60_000;

/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {{ lat: number, lng: number, at: number, accuracy?: number | null }} Fix */
/**
 * A step of the way, as it's followed: a walk from `from` to `to` (the
 * first, or between rides), waiting at a stop for ride `ride`, ride `ride`
 * along `points` (boarding to getting off) with the stops `past` it, or the
 * last walk to the door. `arrived` once every step is done
 * @typedef {{ kind: 'walk', from: Point, to: Point } | { kind: 'wait', ride: number, at: Point }
 *   | { kind: 'ride', ride: number, points: Point[], past: Point[] } | { kind: 'last', from: Point, to: Point } | { kind: 'arrived' }} Step
 */
/**
 * Where the rider is on the way: which step (an index into the steps), at
 * which of a ride's points (`stop`), since when (`at`, ms; null before any
 * fix placed them), since when they've been off the way (`offSince`, ms,
 * null while on it), the last fix that counted, and the last place they
 * moved STILL_METRES from, and when (`anchor`)
 * @typedef {{ step: number, stop: number, at: number | null, offSince: number | null, fix: Fix | null, anchor: { lat: number, lng: number, at: number } | null }} State
 */

/**
 * Whether to plan the trip again from `position`, `planned` being where it
 * was last planned from and when (ms)
 * @param {{ lat: number, lng: number, at: number }} planned
 * @param {{ lat: number, lng: number }} position
 * @param {number} nowMs
 */
export const replanDue = (planned, position, nowMs) => nowMs - planned.at >= REPLAN_MS
    && distanceMeters(planned.lat, planned.lng, position.lat, position.lng) >= MOVED_METRES;

/** @param {Point} a @param {Point} b */
const metres = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);
/** @param {[number, number]} pair */
const point = ([lat, lng]) => ({ lat, lng });

// Metres on the flat around `p`, as the address search measures them
const M_LAT = 111_195;
/**
 * How far `p` is from the straight line between `a` and `b`, in metres
 * @param {Point} p @param {Point} a @param {Point} b
 */
export function segmentMeters(p, a, b) {
    const mLng = M_LAT * Math.cos(p.lat * Math.PI / 180);
    const [ax, ay, bx, by] = [(a.lng - p.lng) * mLng, (a.lat - p.lat) * M_LAT, (b.lng - p.lng) * mLng, (b.lat - p.lat) * M_LAT];
    const [dx, dy] = [bx - ax, by - ay];
    const length = dx * dx + dy * dy;
    const t = length ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length)) : 0;
    return Math.round(Math.hypot(ax + t * dx, ay + t * dy));
}

/**
 * The way `o` (one of the Trip page's options: a way of the city's search,
 * with each ride's stops, or a metro option of plan.js, whose stations
 * `rail` has) as the steps it's followed by, from `from` to `to`
 * @param {any} o @param {Point} from @param {Point} to @param {import('/tools/subway/network.js').Rail} rail
 * @returns {Step[]}
 */
export function waySteps(o, from, to, rail) {
    /** @type {Step[]} */
    const steps = [];
    let here = from;
    /** @param {Point} to */
    const walk = to => { steps.push({ kind: 'walk', from: here, to }); here = to; };
    /** @param {number} ride @param {Point[]} points @param {Point[]} past */
    const board = (ride, points, past) => {
        steps.push({ kind: 'wait', ride, at: points[0] }, { kind: 'ride', ride, points, past });
        here = points.at(-1);
    };
    if (o.city) {
        o.rides.forEach((ride, i) => {
            if (i === 0 ? o.firstWalk : ride.walkBefore) walk(point(ride.along[0]));
            board(i, ride.along.map(point), ride.past.map(point));
        });
        if (o.lastWalk) steps.push({ kind: 'last', from: here, to });
    } else {
        const station = id => { const [lat, lng] = rail.stations[id].coords; return { lat, lng }; };
        if (o.start.walk) walk(station(o.start.station));
        if (o.plan.walkFirst) walk(station(o.plan.legs[0].from));
        o.plan.legs.forEach((leg, i) => {
            const before = o.plan.legs[i - 1];
            if (before && before.to !== leg.from) walk(station(leg.from));
            const { stops } = rail.lines[leg.line].directions[leg.dir];
            const at = stops.slice(leg.fromIndex, leg.toIndex + 1).map(stop => station(stop.station));
            board(i, at, stops.slice(leg.toIndex + 1, leg.toIndex + 3).map(stop => station(stop.station)));
        });
        if (o.plan.walkLast) walk(station(o.end.station));
        if (o.end.walk) steps.push({ kind: 'last', from: here, to });
    }
    return steps;
}

/** Before any fix: on the first step, at its start */
/** @returns {State} */
export const starting = () => ({ step: 0, stop: 0, at: null, offSince: null, fix: null, anchor: null });

/** The step the rider is on, or that they've arrived */
/** @param {Step[]} steps @param {State} state @returns {Step} */
export const stepOf = (steps, state) => steps[state.step] ?? { kind: 'arrived' };

// Which of `points` is nearest `fix`
/** @param {Point} fix @param {Point[]} points */
const nearest = (fix, points) => points.reduce((best, p, i) => metres(fix, p) < metres(fix, points[best]) ? i : best, 0);
/** @param {Point} fix @param {Point} p */
const near = (fix, p) => metres(fix, p) <= NEAR_METRES;

// How far `fix` is from the step the rider is on: the walk's line, the stop
// they wait at, the ride from the stop they're at to where it gets off
/** @param {Step} step @param {number} stop @param {Point} fix */
function offBy(step, stop, fix) {
    switch (step.kind) {
        case 'walk': case 'last': return segmentMeters(fix, step.from, step.to);
        case 'wait': return metres(fix, step.at);
        case 'ride': {
            const rest = step.points.slice(stop);
            return Math.min(...rest.map((p, i) => i ? segmentMeters(fix, rest[i - 1], p) : metres(fix, p)));
        }
        default: return 0;
    }
}

/**
 * Where `fix` (at `nowMs`) puts the rider on the way's `steps`, from where
 * `state` had them: on to the next step once they're at the stop a walk ends
 * at, on the ride once they're nearer one of its later stops than the one
 * they waited at, along the ride by its nearest stop ahead (never back), off
 * it at its last stop, and arrived at the door. `moved`: whether that changed. `off`: they're
 * off the way: OFF_METRES from every point of their step for OFF_MS, or at
 * once after GAP_MS without a fix, or nearer a stop past where the ride gets
 * off than to it. A fix rougher than ROUGH_METRES changes nothing
 * @param {Step[]} steps @param {State} state @param {Fix} fix @param {number} nowMs
 * @returns {State & { moved: boolean, off: boolean }}
 */
export function placeOn(steps, state, fix, nowMs) {
    if (fix.accuracy != null && fix.accuracy > ROUGH_METRES) return { ...state, moved: false, off: false };
    let { step, stop } = state;
    let past = false;
    for (;;) {
        const current = steps[step];
        if (!current) break;
        if (current.kind === 'walk' || current.kind === 'last') {
            if (!near(fix, current.to)) break;
            step++;
            continue;
        }
        if (current.kind === 'wait') {
            const ride = /** @type {Extract<Step, { kind: 'ride' }>} */ (steps[step + 1]);
            const i = nearest(fix, ride.points);
            if (i === 0 || near(fix, current.at)) break;
            step++;
            stop = i;
            continue;
        }
        if (current.kind !== 'ride') break;
        // On the ride: by the nearest stop ahead, and past its last one
        const last = current.points.at(-1);
        stop += nearest(fix, current.points.slice(stop));
        if (stop !== current.points.length - 1) break;
        past = current.past.length > 0 && nearest(fix, [last, ...current.past]) > 0 && !near(fix, last);
        if (past) break;
        step++;
        stop = 0;
    }
    const moved = step !== state.step || stop !== state.stop;
    const current = steps[step];
    const away = current ? offBy(current, stop, fix) : 0;
    const gap = state.fix && fix.at - state.fix.at > GAP_MS;
    const offSince = away > OFF_METRES ? state.offSince ?? nowMs : null;
    const off = past || (offSince !== null && (gap || nowMs - offSince >= OFF_MS));
    const anchor = !state.anchor || metres(fix, state.anchor) >= STILL_METRES ? { lat: fix.lat, lng: fix.lng, at: nowMs } : state.anchor;
    return { step, stop, at: moved || state.at === null ? nowMs : state.at, offSince, fix, anchor, moved, off };
}

/** The rider has left the start: LEFT_METRES or more from it */
/** @param {Point} fix @param {Point} from */
export const leftStart = (fix, from) => metres(fix, from) >= LEFT_METRES;

/**
 * Standing still: not moved STILL_METRES for STILL_MS, and the page untouched
 * as long (`touchedMs`, when it was last touched). The followed trip's pause
 * rule, in place of the page's untouched one (agreed 12 Nov 2026)
 * @param {State} state @param {number} touchedMs @param {number} nowMs
 */
export const stillDue = (state, touchedMs, nowMs) => Boolean(state.anchor) && nowMs - state.anchor.at >= STILL_MS && nowMs - touchedMs >= STILL_MS;
