// Which stops the bus page asks for, when it asks again, and how their
// minutes count down in between. No page in here: main.js hands over what it
// shows as data, then does the asking and drawing, so these rules are tested
// in Node (bus-timing.test.js) and the requests they make in a browser
// (bus-trace.spec.js).
//
// How often a stop is refreshed, by when its next bus comes: [up to minutes,
// every ms], and REFRESH_SLOW_MS for later buses or none. An opened stop, and
// one whose times couldn't be fetched, always at the fastest. Approved
// 2026-10-18, so OASA's 2 requests a second go further (see also
// server/oasa/arrivals.js).
export const REFRESH = [[10, 30_000], [20, 60_000]];
export const REFRESH_SLOW_MS = 120_000;
// The server keeps each stop's arrivals for 30 s; the extra 2 s make sure the
// previous answer has expired (at exactly 30 s we could get the same data)
export const SLACK_MS = 2_000;
// Nothing is asked once nobody has touched the page for this long
export const IDLE_MS = 10 * 60_000;

/**
 * @typedef {{ minutes: number }} Arrival
 * @typedef {{ arrivals?: Arrival[], unavailable?: boolean }} StopResult
 */

/** Whole minutes since an answer came in at `fetchedAt` (0 before the first) */
export function elapsedMinutes(fetchedAt, now) {
    return fetchedAt ? Math.floor((now - fetchedAt) / 60_000) : 0;
}

/**
 * An answer counted down by `minutes`: buses that should have come drop off.
 * @template {StopResult | undefined} R
 * @param {R} result @param {number} minutes @returns {R}
 */
export function countDown(result, minutes) {
    if (!minutes || !result?.arrivals?.length) return result;
    return { ...result, arrivals: result.arrivals.map(a => ({ ...a, minutes: a.minutes - minutes })).filter(a => a.minutes >= 0) };
}

/**
 * How long a stop's (counted-down) answer is good for, in ms.
 * @param {StopResult | undefined} result @param {{ opened?: boolean }} [options]
 */
export function refreshEvery(result, { opened = false } = {}) {
    if (!result || result.unavailable || opened) return REFRESH[0][1] + SLACK_MS;
    const next = result.arrivals?.[0]?.minutes;
    const tier = next === undefined ? null : REFRESH.find(([upTo]) => next <= upTo);
    return (tier?.[1] ?? REFRESH_SLOW_MS) + SLACK_MS;
}

/** Whether the page has gone untouched long enough to stop asking */
export const isIdle = (lastInteraction, now) => now - lastInteraction > IDLE_MS;

/**
 * The stops to ask for now, of those listed. Near you (and starred): those
 * watched, that is on screen or hidden by "Hide empty stops" (so they come
 * back when a bus is on its way). A stop or a line: only those opened, so
 * scrolling down a line asks for nothing. Each once its answer is due
 * (refreshEvery), and not while it's already being asked for.
 * @param {{
 *   codes: string[], view: string, opened: Set<string>, watched: Set<string>,
 *   asking: Set<string>, asked: Record<string, number>, fetched: Record<string, number>,
 *   results: Record<string, StopResult | undefined>,
 * }} stops view: 'nearby', 'stop' or 'line' (main.js readView); asked and fetched: when each
 *   was last asked for (answered or not) and last answered
 * @param {number} now
 * @returns {string[]}
 */
export function dueStops({ codes, view, opened, watched, asking, asked, fetched, results }, now) {
    return codes.filter(code => {
        if (!(view === 'nearby' ? watched : opened).has(code) || asking.has(code)) return false;
        const shown = countDown(results[code], elapsedMinutes(fetched[code], now));
        return now - (asked[code] ?? 0) >= refreshEvery(shown, { opened: opened.has(code) });
    });
}
