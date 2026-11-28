import { distanceMeters } from '/js/core/geo.js';
import { athensNow } from '/tools/subway/network.js';
import { ROUGH_METRES } from './follow.js';

// Times measured by riders (decision 84), on the phone: while the Trip page
// follows a ride on the metro or the tram from My location, and the rider
// said yes, what happened at and between its stops, from the positions the
// page gets. Once the ride is over, one report: no device, no place but the
// stops, no time finer than the hour. No DOM, so it's tested in Node, the
// traces of 27 November 2026 included; controller.js feeds it.
//
// What a position can tell:
// - GPS (a speed, and this exact or better): where the train stands and
//   when it moves, so when it stopped at each stop, how long it stood there,
//   and how long the rider waited where they boarded.
// - A network fix (underground, about 100 m out): pinned at a station from
//   7 to 50 seconds before the doors open to well into the next tunnel, so
//   follow.js's placement says when the train came to each station, and no
//   more: nothing about standing or waiting.
// A stretch is from the train coming to one stop to coming to the next it
// was placed at (doors to doors), both from the same kind of position, as
// the two come to a station at different moments. The stop boarded at has
// no such moment (the rider was there first), so the first stretch starts
// at the next.

/** A fix this exact or better, with a speed, is GPS */
export const GPS_METRES = 30;
/** GPS within this of a stop's place is at it: platforms are about 100 m long */
export const STOP_METRES = 60;
/** Slower than this (m/s), the train stands */
export const STOPPED_SPEED = 1;
/** Faster than this (m/s), it moves: faster than a walk, or a run to the doors */
export const MOVING_SPEED = 4;
/** After the ride's last stop, GPS waits this long at most for the train to stop there */
export const AFTER_MS = 3 * 60_000;
/** Or until the rider is this far from it */
export const AWAY_METRES = 300;
/** At most this many stretches and stops in a report (the server's limit) */
export const MOST = 40;

/** @typedef {import('./follow.js').Point} Point */
/** @typedef {import('./follow.js').Fix & { speed?: number | null }} Fix */
/** @typedef {'gps' | 'network'} By */
/**
 * A metro or tram ride as it's measured: its line, its direction as
 * rail.json names it (where its trains go), its stops from boarding to
 * getting off (station ids as the planner's network has them, the tram's
 * with `-tram` where a metro station has the same) and where they are
 * @typedef {{ line: string, dir: string, stops: string[], points: Point[] }} Target
 */
/**
 * What a phone sends after a ride (decision 84): the line, direction, day
 * type and hour it boarded; each stretch between two stops it was placed at
 * in a row, in seconds; how long the train stood at each stop on the way
 * (GPS); how long the rider waited where they boarded (GPS)
 * @typedef {{ line: string, dir: string, day: 'weekday' | 'saturday' | 'sunday', hour: number,
 *   stretches: { from: string, to: string, s: number, by: By }[], stops: { stop: string, s: number, by: By }[], wait: { stop: string, s: number, by: By } | null }} Report
 */
/** @typedef {{ stop: number, arrive: number, leave: number, by: By, left: boolean }} Seen when the train came to a stop (`stop`, its place in the ride's), and last stood there, by GPS; `left`: seen moving on after */
/**
 * A ride being measured: which (`target`, `key`), the steps it's on and its
 * ride step's place in them, the stops done before measuring began
 * (`before`: none can be timed), when the rider reached the stop boarded at
 * (GPS; -1: by a network fix, so the wait can't be timed) and when the train
 * left it (GPS), each stop it came to, and when it came to the last
 * (`ended`, ms; null before)
 * @typedef {{ target: Target, key: string, steps: import('./follow.js').Step[], rideStep: number, before: number,
 *   platform: number | null, departed: number | null, seen: Seen[], ended: number | null }} Measuring
 */

/** @param {Point} a @param {Point} b */
const metres = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);
/** @param {Fix} fix @returns {By} */
export const byOf = fix => fix.speed != null && fix.accuracy != null && fix.accuracy <= GPS_METRES ? 'gps' : 'network';
/** @param {Target} t */
const keyOf = t => `${t.line}|${t.dir}|${t.stops[0]}`;

/**
 * Each ride of the way `o` (one of the Trip page's options) as it's
 * measured, by its place among the way's rides: a metro or tram ride's
 * Target, null for any other (buses, trolleys, the suburban railway)
 * @param {import('./plan.js').TripOption} o @param {import('/tools/subway/network.js').Rail} rail
 * @returns {(Target | null)[]}
 */
export function targetsOf(o, rail) {
    if (o.city) {
        return o.rides.map(ride => (ride.mode === 'metro' || ride.mode === 'tram') && ride.dir && !ride.any?.length
            ? { line: ride.line, dir: ride.dir, stops: ride.on.map(stop => stop.station ?? ''), points: ride.along.map(([lat, lng]) => ({ lat, lng })) }
            : null);
    }
    return o.plan.legs.map(leg => {
        const line = rail.lines[leg.line];
        if (!line || line.suburban) return null;
        const stops = line.directions[leg.dir].stops.slice(leg.fromIndex, leg.toIndex + 1).map(stop => stop.station);
        return { line: leg.line, dir: leg.dir, stops, points: stops.map(id => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1] })) };
    });
}

/**
 * Feeds one fix, just placed on `steps` by follow.js (`state`), to the ride
 * being measured (`m`, null when none). `targets`: the way's rides as
 * measured (targetsOf). Gives what's measured now, and the report of a ride
 * once it's over: the rider came to its last stop (GPS: once the train
 * stood there, or they're AWAY_METRES on, or AFTER_MS later), or they're on
 * another ride, or another way that isn't on the same ride
 * @param {Measuring | null} m @param {{ steps: import('./follow.js').Step[], state: import('./follow.js').State, targets: (Target | null)[], fix: Fix }} now
 * @returns {{ measuring: Measuring | null, report: Report | null }}
 */
export function measure(m, { steps, state, targets, fix }) {
    if (fix.accuracy != null && fix.accuracy > ROUGH_METRES) return { measuring: m, report: null };
    const step = steps[state.step];
    const index = step && (step.kind === 'wait' || step.kind === 'ride') ? state.step : -1;
    const target = index >= 0 && 'ride' in step ? targets[step.ride] ?? null : null;
    /** @type {Report | null} */
    let report = null;
    // Another way, on the same ride (a way switched to on the way, T14: the
    // same line from the same stop, perhaps off it sooner or later): still
    // measured, by the new way's steps, its stops as far as it rides
    if (m && m.steps !== steps && target && keyOf(target) === m.key) {
        const rideStep = step.kind === 'wait' ? index + 1 : index;
        const last = target.stops.length - 1;
        m = { ...m, target, steps, rideStep, seen: m.seen.filter(s => s.stop <= last), ended: null };
    }
    // Another ride, or another way: the one measured is over
    if (m && (m.steps !== steps || (target && keyOf(target) !== m.key))) {
        report = reportOf(m);
        m = null;
    }
    if (!m && target && step) {
        const rideStep = step.kind === 'wait' ? index + 1 : index;
        m = { target, key: keyOf(target), steps, rideStep, before: step.kind === 'ride' ? state.stop : 0, platform: null, departed: null, seen: [], ended: null };
    }
    if (!m) return { measuring: null, report };
    const next = fed(m, step?.kind ?? 'arrived', state, fix);
    if (!next.done) return { measuring: next.m, report };
    return { measuring: null, report: report ?? reportOf(next.m) };
}

/**
 * The ride measured, given `fix` while the rider is on step `kind` of its
 * way (`state` from follow.js); `done` once it's over
 * @param {Measuring} m @param {string} kind @param {import('./follow.js').State} state @param {Fix} fix
 * @returns {{ m: Measuring, done: boolean }}
 */
function fed(m, kind, state, fix) {
    const by = byOf(fix);
    const { points } = m.target;
    const last = points.length - 1;
    const waiting = kind === 'wait' && state.step === m.rideStep - 1;
    const riding = kind === 'ride' && state.step === m.rideStep;
    const after = state.step > m.rideStep;
    const seen = [...m.seen];
    const latest = seen.at(-1);
    const reached = latest?.stop ?? m.before;
    let { platform, departed, ended } = m;
    if (waiting) platform ??= by === 'gps' ? fix.at : -1;
    if (by === 'gps') {
        const speed = fix.speed ?? 0;
        // The train leaving the stop boarded at
        if (departed === null && !seen.length && speed >= MOVING_SPEED && metres(fix, points[0]) <= AWAY_METRES && (riding || waiting)) departed = fix.at;
        // Standing at a stop past the last one seen: come to it; at the last one seen: still there
        const ahead = points.slice(Math.max(reached, 1)).reduce((best, p, i) => metres(fix, p) < metres(fix, points[best]) ? Math.max(reached, 1) + i : best, Math.max(reached, 1));
        const at = metres(fix, points[ahead]) <= STOP_METRES;
        if (at && speed <= STOPPED_SPEED && ahead >= 1 && (riding || after || waiting)) {
            if (latest && latest.stop === ahead && latest.by === 'gps' && !latest.left) seen[seen.length - 1] = { ...latest, leave: fix.at };
            else if (ahead > reached) seen.push({ stop: ahead, arrive: fix.at, leave: fix.at, by, left: false });
        } else if (speed >= MOVING_SPEED && latest && latest.by === 'gps' && !latest.left) {
            seen[seen.length - 1] = { ...latest, left: true };
        }
    } else {
        // A network fix: the stop follow.js placed the rider at, or the last
        // once it put them past the ride
        const stop = riding ? state.stop : after && ended === null ? last : -1;
        if (stop >= 1 && stop > reached) seen.push({ stop, arrive: fix.at, leave: fix.at, by, left: false });
    }
    const arrived = seen.at(-1)?.stop === last;
    if (after) ended ??= fix.at;
    const next = { ...m, platform, departed, seen, ended };
    if (!after) return { m: next, done: false };
    // Past the ride: over at once by a network fix, or once GPS saw the
    // train stand at its last stop, or the rider far on, or long after
    const over = by === 'network' || arrived || metres(fix, points[last]) > AWAY_METRES || fix.at - /** @type {number} */ (ended) >= AFTER_MS;
    return { m: next, done: over };
}

/**
 * What's measured of a ride so far, as it's sent (decision 84), or null
 * when there's nothing: the page hidden (the phone may close it) sends what
 * there is
 * @param {Measuring | null} m @returns {Report | null}
 */
export function reportOf(m) {
    if (!m) return null;
    const { stops: ids } = m.target;
    const last = ids.length - 1;
    const stretches = m.seen.slice(1).flatMap((b, i) => {
        const a = m.seen[i];
        return a.by === b.by ? [{ from: ids[a.stop], to: ids[b.stop], s: Math.round((b.arrive - a.arrive) / 1000), by: b.by }] : [];
    }).slice(0, MOST);
    const stops = m.seen.filter(s => s.by === 'gps' && s.left && s.stop < last)
        .map(s => ({ stop: ids[s.stop], s: Math.round((s.leave - s.arrive) / 1000), by: s.by })).slice(0, MOST);
    const wait = m.platform !== null && m.platform >= 0 && m.departed !== null && m.departed > m.platform
        ? { stop: ids[0], s: Math.round((m.departed - m.platform) / 1000), by: /** @type {By} */ ('gps') } : null;
    if (!stretches.length && !stops.length && !wait) return null;
    const first = m.departed ?? m.seen[0]?.arrive ?? /** @type {number} */ (m.platform);
    const when = athensNow(new Date(first));
    return { line: m.target.line, dir: m.target.dir, day: dayType(when.date, when.weekday), hour: Math.floor(when.seconds / 3600), stretches, stops, wait };
}

/**
 * The kind of day `date` (Athens, YYYY-MM-DD) is: a weekday, a Saturday, or
 * a Sunday or Greek public holiday, when trains run as on a Sunday
 * @param {string} date @param {number} weekday 0 = Sunday
 * @returns {Report['day']}
 */
export function dayType(date, weekday) {
    if (weekday === 0 || holidays(+date.slice(0, 4)).has(date.slice(5))) return 'sunday';
    return weekday === 6 ? 'saturday' : 'weekday';
}

/**
 * Greece's public holidays in `year`, as MM-DD: the fixed ones, and those
 * that move with Orthodox Easter (Clean Monday, Good Friday, Easter Monday,
 * Whit Monday)
 * @param {number} year @returns {Set<string>}
 */
export function holidays(year) {
    // Orthodox Easter by the Julian calendar (Meeus), 13 days on to the Gregorian (1900–2099)
    const d = (19 * (year % 19) + 15) % 30;
    const e = (2 * (year % 4) + 4 * (year % 7) - d + 34) % 7;
    const julian = Date.UTC(year, Math.floor((d + e + 114) / 31) - 1, ((d + e + 114) % 31) + 1);
    const easter = julian + 13 * 86_400_000;
    /** @param {number} days */
    const moved = days => new Date(easter + days * 86_400_000).toISOString().slice(5, 10);
    return new Set(['01-01', '01-06', '03-25', '05-01', '08-15', '10-28', '12-25', '12-26', moved(-48), moved(-2), moved(1), moved(50)]);
}
