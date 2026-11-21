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

// Each distance below in metres is at least the fix's own accuracy when that's
// worse (within): GPS wanders about that much while the rider stands still
// (decision 60)
export const MOVED_METRES = 20;
export const REPLAN_MS = 2 * 60_000;
// A fix less exact than this (a cell or Wi-Fi guess, not GPS) places nobody
export const ROUGH_METRES = 200;
// Within this of a stop, a station or the door, the rider is there
export const NEAR_METRES = 20;
// Further than this from every point of the step they're on, for this long,
// the rider is off the way: a walk's straight line can be far from the
// streets, a train's from its track between stations kilometres apart
export const OFF_METRES = 300;
// Waiting at a stop, or on a bus, a trolley or a tram, whose stops are close
// enough for the road to keep near the line between them: this instead
// (decision 60). And on a walk to a ride, within this of the ride past its
// first stop and nearer it than the walk: boarded
export const OFF_CLOSE_METRES = 100;
export const OFF_MS = 60_000;
// After this long without a fix (underground), one fix that doesn't fit the
// way is enough: there's nothing to confirm it against
export const GAP_MS = 2 * 60_000;
// This far from the start, the rider has left
export const LEFT_METRES = 20;
// Not moved this far for this long: standing still (the pause rule, with
// the page untouched as long: timing.js IDLE_MS)
export const STILL_METRES = 50;
export const STILL_MS = 10 * 60_000;

/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {{ lat: number, lng: number, at: number, accuracy?: number | null }} Fix */

/**
 * `metres`, or `fix`'s accuracy when that's more
 * @param {number} metres @param {{ accuracy?: number | null }} fix
 */
export const within = (metres, fix) => Math.max(metres, fix.accuracy ?? 0);
/**
 * A step of the way, as it's followed: a walk from `from` to `to` (the
 * first, or between rides) to ride `ride`, waiting at a stop for ride
 * `ride`, ride `ride` along `points` (boarding to getting off) with the
 * stops `past` it (`close`: by bus, trolley or tram, its stops close
 * together), or the last walk to the door. `arrived` once every step is done.
 * A way's last bus that can be any of several (Road · 15) has its walk, wait
 * and ride carry `any`, every ride it can be (buses.js anyRides): walking to
 * or waiting at any of their stops is on the way, and the rider rides
 * whichever they board
 * @typedef {{ kind: 'walk', ride: number, from: Point, to: Point, any?: AnyRide[] } | { kind: 'wait', ride: number, at: Point, any?: AnyRide[] }
 *   | { kind: 'ride', ride: number, points: Point[], past: Point[], close: boolean, any?: AnyRide[] } | { kind: 'last', from: Point, to: Point } | { kind: 'arrived' }} Step
 */
/** @typedef {{ board: string, line: string, points: Point[], past: Point[] }} AnyRide one of the rides a last bus can be: the line `line` from the stop `board` (its id) */
/**
 * Where the rider is on the way: which step (an index into the steps), at
 * which of a ride's points (`stop`), since when (`at`, ms; null before any
 * fix placed them), since when they've been off the way (`offSince`, ms,
 * null while on it), the last fix that counted, the last place they moved
 * STILL_METRES from, and when (`anchor`), whether the last fix moved them on
 * (`moved`) and whether they're off the way (`off`); on a last bus that can
 * be any of several, which of its rides they boarded (`any`, its place in
 * the step's `any`; null before, or on the way's own)
 * @typedef {{ step: number, stop: number, at: number | null, offSince: number | null, fix: Fix | null, anchor: { lat: number, lng: number, at: number } | null, moved: boolean, off: boolean, any: number | null }} State
 */

/**
 * Whether to plan the trip again from `position`, `planned` being where it
 * was last planned from and when (ms)
 * @param {{ lat: number, lng: number, at: number }} planned
 * @param {{ lat: number, lng: number, accuracy?: number | null }} position
 * @param {number} nowMs
 */
export const replanDue = (planned, position, nowMs) => nowMs - planned.at >= REPLAN_MS
    && distanceMeters(planned.lat, planned.lng, position.lat, position.lng) >= within(MOVED_METRES, position);

/** @param {Point} a @param {Point} b */
const metres = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);
/** @param {[number, number]} pair */
const point = ([lat, lng]) => ({ lat, lng });
// The city's search's rides by rail, whose stations are far apart
const RAIL = new Set(['metro', 'suburban']);

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
 * `rail` has) as the steps it's followed by, from `from` to `to`. A walk
 * into a metro station ends at the exit it goes in by, and one out of it
 * starts at the exit it comes out by (decision 51)
 * @param {any} o @param {Point} from @param {Point} to @param {import('/tools/subway/network.js').Rail} rail
 * @returns {Step[]}
 */
export function waySteps(o, from, to, rail) {
    /** @type {Step[]} */
    const steps = [];
    let here = from;
    /** @param {number} ride @param {Point} to @param {AnyRide[] | undefined} [any] */
    const walk = (ride, to, any) => { steps.push({ kind: 'walk', ride, from: here, to, ...any && { any } }); here = to; };
    // A station's exit, by its place in its exits, or `or` without one
    /** @param {{ exits?: { at: [number, number] }[] } | undefined} station @param {number | undefined} i @param {Point} or */
    const exitOr = (station, i, or) => {
        const exit = i === undefined ? null : station?.exits?.[i];
        return exit ? { lat: exit.at[0], lng: exit.at[1] } : or;
    };
    /** @param {number} ride @param {Point[]} points @param {Point[]} past @param {boolean} close @param {AnyRide[] | undefined} [any] */
    const board = (ride, points, past, close, any) => {
        steps.push({ kind: 'wait', ride, at: points[0], ...any && { any } }, { kind: 'ride', ride, points, past, close, ...any && { any } });
        here = points[points.length - 1];
    };
    if (o.city) {
        o.rides.forEach((ride, i) => {
            const before = i === 0 ? o.firstWalk : ride.walkBefore;
            /** @type {AnyRide[] | undefined} */
            const any = ride.any?.length ? ride.any.map((/** @type {any} */ r) => ({ board: r.board, line: r.line, points: r.along.map(point), past: r.past.map(point) })) : undefined;
            if (before) {
                if (i > 0) here = exitOr(o.rides[i - 1].alight, before.out, here);
                walk(i, exitOr(ride.board, before.in, point(ride.along[0])), any);
            }
            board(i, ride.along.map(point), ride.past.map(point), !RAIL.has(ride.mode), any);
        });
        if (o.lastWalk) steps.push({ kind: 'last', from: exitOr(o.rides.at(-1).alight, o.lastWalk.out, here), to });
    } else {
        const station = id => { const [lat, lng] = rail.stations[id].coords; return { lat, lng }; };
        // A walk between two stations of tram.json, through the exit it says:
        // out of one after a ride, into the other for a ride from there
        const between = (ride, a, b, { leaving = true, boarding = true } = {}) => {
            const exit = rail.walkExits?.[a]?.[b];
            if (leaving) here = exitOr(rail.stations[a], exit, here);
            walk(ride, boarding ? exitOr(rail.stations[b], exit, station(b)) : station(b));
        };
        if (o.start.walk) walk(0, o.plan.walkFirst ? station(o.start.station) : exitOr(rail.stations[o.start.station], o.start.walk.in, station(o.start.station)));
        if (o.plan.walkFirst) between(0, o.start.station, o.plan.legs[0].from, { leaving: false });
        o.plan.legs.forEach((leg, i) => {
            const before = o.plan.legs[i - 1];
            if (before && before.to !== leg.from) between(i, before.to, leg.from);
            const { stops } = rail.lines[leg.line].directions[leg.dir];
            const at = stops.slice(leg.fromIndex, leg.toIndex + 1).map(stop => station(stop.station));
            board(i, at, stops.slice(leg.toIndex + 1, leg.toIndex + 3).map(stop => station(stop.station)), Boolean(rail.lines[leg.line].tram));
        });
        // A walk to another station at the end counts as the last walk
        if (o.plan.walkLast) between(o.plan.legs.length, o.plan.legs.at(-1).to, o.end.station, { boarding: false });
        if (o.end.walk) steps.push({ kind: 'last', from: o.plan.walkLast ? here : exitOr(rail.stations[o.end.station], o.end.walk.out, here), to });
    }
    return steps;
}

/** Before any fix: on the first step, at its start */
/** @returns {State} */
export const starting = () => ({ step: 0, stop: 0, at: null, offSince: null, fix: null, anchor: null, moved: false, off: false, any: null });

/**
 * Another way to follow, from where `state` had the rider: at its start,
 * where the last fix had them (a phone standing still may send no other)
 * @param {State} state @returns {State}
 */
export const startOver = state => ({ ...starting(), fix: state.fix, anchor: state.anchor, at: state.fix?.at ?? null });

/**
 * Where the rider is on `steps`, a way switched to on the way (T14), or back
 * from it, from where `state` had them on the way's `before`: the same step,
 * as both ways are the same up to the ride they're on, at the same stop of it
 * when the new way rides that far; at the start (startOver) when the step
 * isn't the same
 * @param {Step[]} before @param {State} state @param {Step[]} steps
 * @returns {State}
 */
export function carry(before, state, steps) {
    const was = before[state.step];
    const now = steps[state.step];
    const ride = step => 'ride' in step ? step.ride : -1;
    if (!was || !now || was.kind !== now.kind || ride(was) !== ride(now)) return startOver(state);
    // The ride boarded of a last bus's several, where the new way has it too
    const boarded = state.any !== null && 'any' in was ? was.any?.[state.any] : null;
    const any = boarded && 'any' in now ? now.any?.findIndex(r => r.board === boarded.board && r.line === boarded.line) ?? -1 : -1;
    const points = now.kind === 'ride' ? any >= 0 && now.any ? now.any[any].points : now.points : null;
    return { ...state, stop: points ? Math.min(state.stop, points.length - 1) : state.stop, offSince: null, moved: false, off: false, any: any >= 0 ? any : null };
}

/**
 * `step` as the rider follows it: on a last bus that can be any of several,
 * once they've boarded one (`any`), that one's stops
 * @template {Step} S @param {S} step @param {number | null} any @returns {S}
 */
const shaped = (step, any) => step.kind === 'ride' && any !== null && step.any?.[any] ? { ...step, points: step.any[any].points, past: step.any[any].past } : step;

/**
 * The ride of a last bus's several (those `only` takes) that `fix` is on
 * past its first stop, within `limit` of it, nearer it than `than`: its
 * place in `any`, and the stop it's at; null when none is. The nearest of
 * them when several are
 * @param {AnyRide[] | undefined} any @param {Fix} fix @param {number} limit @param {number} [than] @param {(r: AnyRide) => boolean} [only]
 * @returns {{ any: number, stop: number } | null}
 */
function boardedAny(any, fix, limit, than = Infinity, only = () => true) {
    let found = /** @type {{ any: number, stop: number } | null} */ (null);
    let least = Infinity;
    (any ?? []).forEach((r, k) => {
        const stop = nearest(fix, r.points);
        const by = offBy({ kind: 'ride', ride: 0, points: r.points, past: r.past, close: true }, 0, fix);
        if (only(r) && stop > 0 && !near(fix, r.points[0]) && by <= limit && by < than && by < least) [least, found] = [by, { any: k, stop }];
    });
    return found;
}

/** The step the rider is on, or that they've arrived */
/** @param {Step[]} steps @param {State} state @returns {Step} */
export const stepOf = (steps, state) => steps[state.step] ?? { kind: 'arrived' };

// Which of `points` is nearest `fix`
/** @param {Point} fix @param {Point[]} points */
const nearest = (fix, points) => points.reduce((best, p, i) => metres(fix, p) < metres(fix, points[best]) ? i : best, 0);
/** @param {Fix} fix @param {Point} p */
const near = (fix, p) => metres(fix, p) <= within(NEAR_METRES, fix);

// How far `fix` is from the step the rider is on: the walk's line, the stop
// they wait at, the ride from the stop they're at to where it gets off
/** @param {Step} step @param {number} stop @param {Point} fix */
function offBy(step, stop, fix) {
    switch (step.kind) {
        // The walk to a last bus that can be any of several is still to the
        // way's own stop: its stops can be a kilometre around, so walking
        // towards any of them would hardly ever be off the way. Waiting, at
        // any of them (Road · 15)
        case 'walk': case 'last': return segmentMeters(fix, step.from, step.to);
        case 'wait': return Math.min(metres(fix, step.at), ...(step.any ?? []).map(r => metres(fix, r.points[0])));
        case 'ride': {
            const rest = step.points.slice(stop);
            return Math.min(...rest.map((p, i) => i ? segmentMeters(fix, rest[i - 1], p) : metres(fix, p)));
        }
        default: return 0;
    }
}

// How far from `step` `fix` may be before the rider is off the way
/** @param {Step} step @param {Fix} fix */
const offLimit = (step, fix) => step.kind === 'wait' || (step.kind === 'ride' && step.close) ? within(OFF_CLOSE_METRES, fix) : OFF_METRES;

/**
 * Where `fix` (at `nowMs`) puts the rider on the way's `steps`, from where
 * `state` had them: on to the next step once they're at the stop a walk ends
 * at, on the ride once they're nearer one of its later stops than the one
 * they waited at (or walked to, when off the walk would make them off the
 * way but they're on the ride: boarded unseen), along the ride by its
 * nearest stop ahead (never back), off
 * it at its last stop, and arrived at the door. `moved`: whether that changed. `off`: they're
 * off the way: OFF_METRES (OFF_CLOSE_METRES waiting, or on a bus, a trolley
 * or a tram) from every point of their step for OFF_MS, or at
 * once after GAP_MS without a fix, or nearer a stop past where the ride gets
 * off than to it. A fix rougher than ROUGH_METRES changes nothing
 * @param {Step[]} steps @param {State} state @param {Fix} fix @param {number} nowMs
 * @returns {State}
 */
export function placeOn(steps, state, fix, nowMs) {
    if (fix.accuracy != null && fix.accuracy > ROUGH_METRES) return { ...state, moved: false, off: false };
    let { step, stop, any } = state;
    let past = false;
    const gap = Boolean(state.fix && fix.at - state.fix.at > GAP_MS);
    for (;;) {
        const current = steps[step];
        if (!current) break;
        if (current.kind === 'walk' || current.kind === 'last') {
            if (near(fix, current.to) || (current.kind === 'walk' && current.any?.some(r => near(fix, r.points[0])))) { step++; continue; }
            const ride = current.kind === 'walk' ? steps[step + 2] : null;
            const onRide = current.kind === 'walk' && ride?.kind === 'ride' && ride.ride === current.ride;
            // A last bus that can be any of several (Road · 15): boarded
            // whichever of its rides from the walk's own stop the fix is on
            // past its first stop, close to it and nearer it than the walk
            // (a ride from another of its stops once they've been there: a
            // walk past a stop along a bus's road looks the same); off the
            // walk after a gap or a minute, Road · 7's rule for any of them
            if (onRide && ride.any) {
                const walked = offBy(current, 0, fix);
                const fromHere = (/** @type {AnyRide} */ r) => metres(r.points[0], ride.points[0]) < 1;
                const got = (walked <= OFF_METRES ? boardedAny(ride.any, fix, within(OFF_CLOSE_METRES, fix), walked, fromHere) : null)
                    ?? (walked > OFF_METRES && (gap || (state.offSince !== null && nowMs - state.offSince >= OFF_MS)) ? boardedAny(ride.any, fix, OFF_METRES) : null);
                if (!got) break;
                step += 2;
                ({ stop, any } = got);
                continue;
            }
            // Still by the walk, but nearer a later stop of the ride than its
            // first, close to the ride and nearer it than the walk: boarded
            // with no fix at the stop that counted (a stop's place 20 m from
            // where people wait, decision 60). Further off: Road · 7's below
            if (onRide) {
                const i = nearest(fix, ride.points);
                const by = offBy(ride, 0, fix);
                const walk = offBy(current, 0, fix);
                if (i > 0 && walk <= OFF_METRES && by <= within(OFF_CLOSE_METRES, fix) && by < walk) {
                    step += 2;
                    stop = i;
                    continue;
                }
            }
            // Off the walk, but on the ride it leads to past its first stop,
            // when that would put them off the way (after a gap, or for
            // OFF_MS): boarded with no fix at the stop (GPS lost on a
            // station's stairs, Road · 7), so on the ride instead
            const due = gap || (state.offSince !== null && nowMs - state.offSince >= OFF_MS);
            if (!due || !onRide || offBy(current, 0, fix) <= OFF_METRES
                || nearest(fix, ride.points) === 0 || offBy(ride, 0, fix) > OFF_METRES) break;
            step += 2;
            stop = 0;
            continue;
        }
        if (current.kind === 'wait') {
            // Waiting at any of a last bus's stops (Road · 15): on whichever
            // of its rides they're on past its first stop
            if (current.any) {
                const got = boardedAny(current.any, fix, within(OFF_CLOSE_METRES, fix));
                if (!got) break;
                step++;
                ({ stop, any } = got);
                continue;
            }
            const ride = /** @type {Extract<Step, { kind: 'ride' }>} */ (steps[step + 1]);
            const i = nearest(fix, ride.points);
            if (i === 0 || near(fix, current.at)) break;
            step++;
            stop = i;
            continue;
        }
        if (current.kind !== 'ride') break;
        // Off the one of a last bus's several they were taken to be on, but
        // on another (one sharing its road so far): that one
        if (current.any && offBy(shaped(current, any), stop, fix) > offLimit(current, fix)) {
            const got = boardedAny(current.any, fix, within(OFF_CLOSE_METRES, fix));
            if (got) ({ stop, any } = got);
        }
        const shape = shaped(current, any);
        // On the ride: by the nearest stop ahead, and past its last one
        const last = shape.points[shape.points.length - 1];
        stop += nearest(fix, shape.points.slice(stop));
        if (stop !== shape.points.length - 1) break;
        past = shape.past.length > 0 && nearest(fix, [last, ...shape.past]) > 0 && !near(fix, last);
        if (past) break;
        step++;
        stop = 0;
    }
    const moved = step !== state.step || stop !== state.stop || any !== state.any;
    const current = steps[step] && shaped(steps[step], any);
    const away = current ? offBy(current, stop, fix) : 0;
    const offSince = current && away > offLimit(current, fix) ? state.offSince ?? nowMs : null;
    const off = past || (offSince !== null && (gap || nowMs - offSince >= OFF_MS));
    const anchor = !state.anchor || metres(fix, state.anchor) >= STILL_METRES ? { lat: fix.lat, lng: fix.lng, at: nowMs } : state.anchor;
    return { step, stop, at: moved || state.at === null ? nowMs : state.at, offSince, fix, anchor, moved, off, any };
}

/**
 * Off the way as time passes: a fix said so, or the last one was off it and
 * OFF_MS have gone by since the first that was, with no fix since to say
 * otherwise (a phone standing still may send none)
 * @param {State} state @param {number} nowMs
 */
export const offDue = (state, nowMs) => state.off || (state.offSince !== null && nowMs - state.offSince >= OFF_MS);

/** The rider has left the start: LEFT_METRES or more from it, or the fix's accuracy */
/** @param {Fix} fix @param {Point} from */
export const leftStart = (fix, from) => metres(fix, from) >= within(LEFT_METRES, fix);

/**
 * Standing still: not moved STILL_METRES for STILL_MS, and the page untouched
 * as long (`touchedMs`, when it was last touched). The followed trip's pause
 * rule, in place of the page's untouched one (agreed 12 Nov 2026)
 * @param {State} state @param {number} touchedMs @param {number} nowMs
 */
export const stillDue = (state, touchedMs, nowMs) => !!state.anchor && nowMs - state.anchor.at >= STILL_MS && nowMs - touchedMs >= STILL_MS;
