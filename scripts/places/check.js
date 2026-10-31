// Whether an index is good enough to publish. It's built from what volunteers
// mapped that week and sent to the live site, so a bad week must stop here.

import { countsOf, lostSince } from '../../server/places/published.js';
import { load, search, meters } from '../../server/places/search.js';

const FLOORS = { towns: 60, streets: 30_000, numbers: 100_000, places: 2_500 };
// Answers that have to keep working, near where they are now. Only the place
// is held: a number that's estimated today may be mapped tomorrow.
const ANSWERS = [
    { query: 'Μενελάου 25, Καλλιθέα', town: 'Καλλιθέας', at: [37.95463, 23.71049] },
    { query: 'Menelaou 25, kallithea', town: 'Καλλιθέας', at: [37.95463, 23.71049] },
    { query: 'Πατησίων 100', town: 'Αθηναίων', at: [37.99596, 23.73255] },
    { query: 'Πειραιώς 100, Μοσχάτο', town: 'Μοσχάτου-Ταύρου', at: [37.96295, 23.69171] },
    { query: 'Μακεδονίας 49, Κερα', town: 'Κερατσινίου - Δραπετσώνας', at: [37.97805, 23.62674] },
    { query: 'Μηθύμνης 13, Κορυδαλλός', town: 'Κορυδαλλού', at: [37.97642, 23.64744] },
    { query: 'Σύνταγμα', town: 'Αθηναίων', at: [37.9751, 23.73574] },
    { query: 'Αεροδρόμιο', town: 'Σπάτων - Αρτέμιδος', at: [37.93689, 23.94482] },
];
const CLOSE_ENOUGH = 1000;
// Never a street in the town next door when the town typed doesn't have it
const NOT_THERE = ['Μενελάου 25, Νέα Σμύρνη'];

// What's wrong with an index, in words; none means it can go out.
// previous: the published index's counts, if there is one.
export function problemsWith(index, { previous = null, floors = FLOORS, answers = ANSWERS, notThere = NOT_THERE } = {}) {
    const counts = countsOf(index);
    const problems = lostSince(counts, previous);
    for (const [what, floor] of Object.entries(floors)) {
        if (counts[what] < floor) problems.push(`${what}: ${counts[what]}, the least expected is ${floor}`);
    }
    const db = load(index);
    for (const { query, town, at: [lat, lng] } of answers) {
        const { results, notInTown } = search(db, query);
        const first = results[0];
        if (!first || notInTown) problems.push(`"${query}": no answer`);
        else if (first.town !== town) problems.push(`"${query}": in ${first.town}, not ${town}`);
        else if (meters(first, { lat, lng }) > CLOSE_ENOUGH) problems.push(`"${query}": ${Math.round(meters(first, { lat, lng }))} m away from where it was`);
    }
    for (const query of notThere) {
        if (!search(db, query).notInTown) problems.push(`"${query}": should say it isn't in that town`);
    }
    return problems;
}
