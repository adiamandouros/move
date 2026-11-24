// Which way of the half hour's answer leads, the Trip page's first card, by
// OASA's live times (decision 72). The half hour picks its way on the
// timetable and the weights before OASA says anything; once OASA's times
// are in, another way shown can be the better one: its bus is coming, the
// first card's isn't for a long while. It leads then, when by the weights on
// live times (liveRank in buses.js) it costs a tie (3') or more less than
// the way leading, and both are known: a way none of whose buses OASA shows
// where it's asked can't take the lead, nor lose it. It takes OASA's word
// on one side or the other, never the timetable's alone on both. A way
// whose first ride is a bus from the start OASA hasn't answered for yet
// can't either: the wait at the start is where the timetable is least to be
// trusted (the 5 "whichever comes first" was 28' away). A last bus after a
// train can go by the timetable, as it isn't asked for another way: so the
// M2 then any bus takes the lead when OASA has the first card's bus far off.
// Once it leads it stays
// until another costs a tie less, so the card doesn't swap back and forth
// as the times move by a minute. No DOM, so it's tested in Node
// (test/trip-rank.test.js).

import { TIE_SECONDS } from '/tools/subway/answer.js';

/**
 * The key of the way that leads, or null for the half hour's own. `half`:
 * the half hour's way; `others`: the other ways shown; each with its key
 * and what it costs on live times (null: not known), whether that's OASA's
 * word (`live`) and whether its first ride is a bus from the start not
 * answered yet (`waiting`), as liveRank in buses.js has them. `held`: the key of the
 * way that led, or null for the half hour's
 * @param {{ key: string, cost: number | null, live?: boolean, waiting?: boolean }} half
 * @param {{ key: string, cost: number | null, live?: boolean, waiting?: boolean }[]} others
 * @param {string | null} held
 * @returns {string | null}
 */
export function leadOf(half, others, held) {
    const ways = [half, ...others];
    const leading = ways.find(way => way.key === held) ?? half;
    if (leading.cost === null || leading.waiting) return leading === half ? null : leading.key;
    const lead = leading.cost;
    const better = ways
        .filter(way => way !== leading && way.cost !== null && !way.waiting && (leading.live || way.live) && /** @type {number} */ (way.cost) <= lead - TIE_SECONDS)
        .sort((a, b) => /** @type {number} */ (a.cost) - /** @type {number} */ (b.cost))[0];
    const next = better ?? leading;
    return next === half ? null : next.key;
}
