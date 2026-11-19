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
// page's, and the first of a trip, the first new stop after the trip was
// planned again from where the rider moved to (decision 45), a stop first
// asked for the ride they're on (decision 50), one first asked for
// another way shown (decision 62), or one asked again as the rider takes
// another way (decision 64), say that too, so /admin/usage counts them
// apart (server/oasa/usage.js)
/** @param {string} code @param {'start' | 'moved' | 'ride' | 'other' | 'take' | null} [opening] */
export const arrivalsUrl = (code, opening = null) => `/api/arrivals?stops=${code}&for=${opening ? `plan-${opening}` : 'plan'}`;

/**
 * The rider's own bus, as they board at `boardedAt` (seconds from midnight)
 * at a stop whose last answer is `answer`: OASA's code for the vehicle of
 * their `lines` due nearest then, by which it's known again at the stop they
 * get off (decision 50). Null when OASA had none, or no code for it
 * @param {StopLive | undefined} answer @param {string[]} lines @param {number} boardedAt
 * @returns {string | null}
 */
export function ownBus(answer, lines, boardedAt) {
    const theirs = (answer?.buses ?? []).filter(bus => bus.line && lines.includes(bus.line));
    const nearest = theirs.reduce((best, bus) => !best || Math.abs(bus.at - boardedAt) < Math.abs(best.at - boardedAt) ? bus : best, null);
    return nearest?.vehicle ?? null;
}

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
 * @param {{ stop: string, at: number | null, ride?: true }[]} asks
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

// Another way taken is checked on the tap (decision 64): its first bus's
// stop asked again when that answer is this old, as the server keeps a
// stop's answer that long anyway; with no answer this long after the tap,
// it's taken on the answer there is
export const FRESH_MS = 30_000;
export const CHECK_WAIT_MS = 5_000;

/**
 * The stop to ask again as the rider takes another way (decision 64): its
 * first bus's (the one stop asked for it, `asks`), when OASA had that bus
 * coming (`said`, what the way shows of it) and the stop's answer came
 * FRESH_MS or longer before `nowMs` (`askedAt`). Null: taken at once, as
 * its answer is fresh, or it has no bus OASA had coming to check
 * @param {import('./buses.js').RideLive | undefined} said
 * @param {{ stop: string }[]} asks @param {number | undefined} askedAt @param {number} nowMs
 */
export function checkStop(said, asks, askedAt, nowMs) {
    const stop = asks[0]?.stop;
    if (!stop || !said || !('at' in said)) return null;
    return askedAt !== undefined && nowMs - askedAt < FRESH_MS ? null : stop;
}

/**
 * Whether the bus a way showed as the rider tapped it (`before`) can still
 * be caught, by what the way says of its first bus once timed again with
 * the stop's new answer (`after`): the same vehicle, where OASA gives one,
 * or any bus where it doesn't. With no bus shown, or no answer to go by,
 * it's taken on what there is
 * @param {import('./buses.js').RideLive | undefined} before @param {import('./buses.js').RideLive | undefined} after
 */
export function stillCaught(before, after) {
    if (!before || !('at' in before) || !after) return true;
    if (!('at' in after)) return false;
    return !before.vehicle || !after.vehicle || before.vehicle === after.vehicle;
}
