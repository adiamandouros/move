// @ts-check
// When the bus page asks again for a stop, and how its minutes count down in
// between (main.js does the asking and drawing).
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
