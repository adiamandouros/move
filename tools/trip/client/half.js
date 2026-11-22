// The next half hour's answer (decision 33) as the Trip page shows it, with
// no page in it: which of its ways, each for which departure, as the clock
// goes on, and the quicker way the rider took on a decision (decision 36).
// The controller (controller.js) decides what's shown with them and
// render.js draws it. No DOM, so it's tested in Node.

// A departure tried up to a minute ago still counts: the page redraws each minute
const LATE_SECONDS = 60;

// Each way the half hour's answer shows, as it is for the next departure
// tried at `now` (seconds from midnight) or the first after it that has it,
// and which departure that is
/**
 * @param {import('./buses.js').HalfView} view @param {number} now
 * @returns {{ row: import('./buses.js').HalfRow, o: import('./buses.js').BusOption, departure: number }[]}
 */
export function halfWays(view, now) {
    const next = view.departures.findIndex(at => at >= now - LATE_SECONDS);
    if (next < 0) return [];
    return view.rows.flatMap(row => {
        const departure = row.options.findIndex((o, d) => d >= next && o);
        const o = row.options[departure];
        return o ? [{ row, o, departure }] : [];
    });
}

// The quicker way the rider took, for the departure shown: as OASA's live
// times have it, or until they do, the half hour's own for that departure or
// the first after it. A row is made from a way found, so it has one for a
// departure at least (halfView in buses.js)
/** @param {import('./buses.js').HalfRow} row @param {number} departure @returns {import('./buses.js').BusOption} */
export const takenOption = (row, departure) => /** @type {import('./buses.js').BusOption} */ (row.options.find((o, d) => d >= departure && o) ?? row.options.find(Boolean));
