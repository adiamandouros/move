// The rule for answers that come too late (decision 65). The Trip page asks
// things in the background, and an answer can come back after its question
// was overtaken: a trip searched, its half hour, the way shown timed, the
// other ways timed (by its worker, searcher.js), a stop asked of OASA. Each
// question carries a ticket for its kind, taken as it's asked, and its
// answer counts only if that ticket is still the newest of its kind for the
// current trip. A later question of the kind overtakes it; so does a new
// trip, and the kind dropped without a new question (the way's timing, as
// the trip is planned again from where the rider moved to). The tickets
// are numbers counting up across the kinds, so they go to the worker and
// come back as they are, and one kind's can't pass for another's. No DOM,
// so it's tested in Node (test/trip-tickets.test.js).

/**
 * @typedef {{
 *   take: (...kinds: string[]) => number,
 *   counts: (kind: string, ticket: number) => boolean,
 *   drop: (...kinds: string[]) => void,
 *   newTrip: () => void,
 * }} Tickets
 */

/** @returns {Tickets} */
export function tickets() {
    let last = 0;
    /** @type {Map<string, number>} */
    const newest = new Map();
    return {
        // A ticket for a question of each of `kinds`, as one question can be
        // answered as more than one (a trip and its half hour): from now on
        // the newest of each
        take(...kinds) {
            last++;
            for (const kind of kinds) newest.set(kind, last);
            return last;
        },
        // Whether the answer to the question with `ticket` counts as `kind`
        counts: (kind, ticket) => newest.has(kind) && newest.get(kind) === ticket,
        // Nothing asked of `kinds` so far counts any more
        drop(...kinds) {
            for (const kind of kinds) newest.delete(kind);
        },
        // A new trip: nothing asked so far counts any more
        newTrip: () => newest.clear(),
    };
}
