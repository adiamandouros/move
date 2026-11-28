// Times measured by riders (decision 84): whether a report a phone sent can
// count, against the metro and the tram as the planner has them
// (withTram(rail.json)). A report with anything wrong in it counts for
// nothing. Pure, so the checks are tested on their own.

/** At most this many stretches, and this many stops, in a report */
export const MOST = 40;
/** A stretch takes from this much of the timetable's time for it to this many times it */
export const LEAST_SHARE = 0.5;
export const MOST_TIMES = 3;
/** A train stands at a stop under this long (s) */
export const STAND_SECONDS = 5 * 60;
/** A rider waits under this long (s) */
export const WAIT_SECONDS = 30 * 60;
export const DAYS = ['weekday', 'saturday', 'sunday'];
export const BY = ['gps', 'network'];

/** @typedef {import('../../tools/trip/client/measure.js').Report} Report */
/** @typedef {import('../../tools/subway/client/network.js').Rail} Rail */

/** @param {unknown} n @param {number} below */
const seconds = (n, below) => Number.isInteger(n) && /** @type {number} */ (n) > 0 && /** @type {number} */ (n) < below;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The shortest and the longest the timetable gives from the `a`th stop of a
 * direction to its `b`th, in seconds, over its trains' profiles; null when
 * no train calls at both in that order
 * @param {{ profiles: { stops: number[], offsets: number[] }[] }} timetable @param {number} a @param {number} b
 * @returns {[number, number] | null}
 */
export function timetableSeconds(timetable, a, b) {
    let least = Infinity;
    let most = -Infinity;
    for (const { stops, offsets } of timetable.profiles) {
        const i = stops.indexOf(a);
        const j = stops.indexOf(b);
        if (i < 0 || j <= i) continue;
        least = Math.min(least, offsets[j] - offsets[i]);
        most = Math.max(most, offsets[j] - offsets[i]);
    }
    return most > 0 ? [least, most] : null;
}

/**
 * `body` as a report that counts, or why it doesn't: the line and direction
 * the network has (not the suburban railway's), a day type and an hour,
 * stretches between its stops in order, each between half and three times
 * the timetable's time for it, stops in order where the train stood under 5
 * minutes, a wait at one of its stops under 30, each from GPS or a network
 * fix, at most MOST stretches and MOST stops, and something in it
 * @param {unknown} body @param {Rail} net
 * @returns {{ report: Report } | { problem: string }}
 */
export function checkReport(body, net) {
    if (!isObject(body)) return { problem: 'not a report' };
    const { line, dir, day, hour, stretches = [], stops = [], wait = null } = body;
    const direction = typeof line === 'string' && typeof dir === 'string' && Object.hasOwn(net.lines, line) && !net.lines[line].suburban
        ? net.lines[line].directions[dir] : undefined;
    if (!direction) return { problem: 'no such line or direction' };
    if (typeof day !== 'string' || !DAYS.includes(day)) return { problem: 'no such day' };
    if (!Number.isInteger(hour) || /** @type {number} */ (hour) < 0 || /** @type {number} */ (hour) > 23) return { problem: 'no such hour' };
    if (!Array.isArray(stretches) || !Array.isArray(stops) || (wait !== null && !isObject(wait))) return { problem: 'not a report' };
    if (stretches.length > MOST || stops.length > MOST) return { problem: 'too long' };
    if (!stretches.length && !stops.length && !wait) return { problem: 'empty' };
    const index = new Map(direction.stops.map((stop, i) => [stop.station, i]));
    /** @param {unknown} id */
    const at = id => typeof id === 'string' ? index.get(id) ?? -1 : -1;
    /** @param {unknown} by */
    const known = by => typeof by === 'string' && BY.includes(by);

    let reached = -1;
    for (const s of stretches) {
        if (!isObject(s) || !known(s.by)) return { problem: 'not a stretch' };
        const [a, b] = [at(s.from), at(s.to)];
        if (a < 0 || b <= a || a < reached) return { problem: 'stops not on the line in order' };
        reached = b;
        const timetable = timetableSeconds(direction.timetable, a, b);
        if (!timetable || !Number.isInteger(s.s)) return { problem: 'no timetable for a stretch' };
        const n = /** @type {number} */ (s.s);
        if (n < LEAST_SHARE * timetable[0] || n > MOST_TIMES * timetable[1]) return { problem: 'a stretch far from the timetable' };
    }
    let stood = -1;
    for (const s of stops) {
        if (!isObject(s) || !known(s.by)) return { problem: 'not a stop' };
        const i = at(s.stop);
        if (i <= stood) return { problem: 'stops not on the line in order' };
        stood = i;
        if (!seconds(s.s, STAND_SECONDS)) return { problem: 'stood too long' };
    }
    if (wait && (!known(wait.by) || at(wait.stop) < 0 || !seconds(wait.s, WAIT_SECONDS))) return { problem: 'not a wait' };
    /** @type {Report} */
    const report = {
        line: /** @type {string} */ (line), dir: /** @type {string} */ (dir), day: /** @type {Report['day']} */ (day), hour: /** @type {number} */ (hour),
        stretches: stretches.map(s => ({ from: s.from, to: s.to, s: s.s, by: s.by })),
        stops: stops.map(s => ({ stop: s.stop, s: s.s, by: s.by })),
        wait: wait && { stop: /** @type {string} */ (wait.stop), s: /** @type {number} */ (wait.s), by: /** @type {Report['wait'] & {}} */ (wait).by },
    };
    return { report };
}
