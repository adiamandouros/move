import { refreshEvery } from '/tools/buses/timing.js';

// OASA's live times for the way the Trip page shows in full (decision 35):
// how a stop is asked for, what its answer says, and when it's due again.
// How often is agreed (6 Nov 2026, decision 34; kept in 45): the Buses page's tiers
// (timing.js), set by the first bus of the way's lines the rider can still
// catch there, so a change far down the trip costs little until it nears.
// No DOM, so it's tested in Node; main.js asks and draws.

/** @typedef {import('./buses.js').StopLive} StopLive */
/** @typedef {{ arrivals?: { route: string, vehicle?: string | null, line: string | null, to?: { el: string, en: string } | null, minutes: number }[], stale?: boolean, unavailable?: boolean }} StopAnswer */

// The address that asks for one stop. Its requests say they're the Trip
// page's, and the first of a trip, or the first new stop after the trip was
// planned again from where the rider moved to (decision 45), say that too,
// so /admin/usage counts them apart (server/oasa/usage.js)
/** @param {string} code @param {'start' | 'moved' | null} [opening] */
export const arrivalsUrl = (code, opening = null) => `/api/arrivals?stops=${code}&for=${opening ? `plan-${opening}` : 'plan'}`;

/**
 * A stop's answer from /api/arrivals, which came at `seconds` (from
 * midnight): each bus due at seconds from midnight, so it counts down by
 * itself, with where it goes and OASA's code for the vehicle (null when it
 * has none), by which the bus the rider boarded is known again at the stop
 * they get off (Plan 7), and when it was said, as how late a bus comes depends on how far
 * ahead it was (answer.js lateness)
 * @param {StopAnswer} answer @param {number} seconds @returns {StopLive}
 */
export function stopLive({ arrivals = [], stale = false, unavailable = false }, seconds) {
    const buses = arrivals.map(({ route, vehicle = null, line, to = null, minutes }) => ({ route, vehicle, line, to, at: seconds + minutes * 60 }));
    return { buses, asked: seconds, ...(stale && { stale }), ...(unavailable && { unavailable }) };
}

/**
 * What's kept when a stop couldn't be asked (offline, or the server in
 * trouble): its last answer, marked as possibly old, or that there's none,
 * as on the Buses page
 * @param {StopLive | undefined} last @returns {StopLive}
 */
export const unanswered = last => last && !last.unavailable ? { ...last, stale: true } : { buses: [], unavailable: true };

/**
 * The stops to ask for now (`asks`, from liveWay): each once its last answer
 * is due by when the first bus the rider can catch there comes, and not
 * while it's being asked for. `asked`: when each was last asked, answered
 * or not (ms)
 * @param {{ stop: string, at: number | null }[]} asks
 * @param {{ asking: Set<string>, asked: Map<string, number>, answers: Map<string, StopLive> }} state
 * @param {number} nowMs @param {number} seconds now, from midnight
 * @returns {string[]}
 */
export function dueStops(asks, { asking, asked, answers }, nowMs, seconds) {
    return asks.filter(({ stop, at }) => {
        if (asking.has(stop)) return false;
        const answer = answers.get(stop);
        const due = refreshEvery(answer && {
            unavailable: answer.unavailable,
            arrivals: at === null ? [] : [{ minutes: Math.floor((at - seconds) / 60) }],
        });
        return nowMs - (asked.get(stop) ?? -Infinity) >= due;
    }).map(({ stop }) => stop);
}

/**
 * What to say of the live times above the answer, as the Buses page does:
 * paused, none to be had at any stop asked, nor for the suburban trains
 * when the way has one (`trains`, decision 42), or some older than they look
 * @param {{ stop: string }[]} asks @param {Map<string, StopLive>} answers @param {boolean} paused
 * @param {import('./trains.js').TrainsLive | null} [trains] the trains' answer, when the way has a train
 * @returns {'paused' | 'unavailable' | 'trains-unavailable' | 'all-unavailable' | 'stale' | null}
 */
export function liveStatus(asks, answers, paused, trains = null) {
    if (paused) return 'paused';
    const shown = asks.map(({ stop }) => answers.get(stop)).filter(Boolean);
    const buses = shown.length > 0 && shown.every(answer => answer.unavailable);
    if (trains?.unavailable) return buses ? 'all-unavailable' : 'trains-unavailable';
    if (buses) return 'unavailable';
    return shown.some(answer => answer.stale) || trains?.stale ? 'stale' : null;
}
