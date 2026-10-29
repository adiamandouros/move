import { distanceMeters } from '/js/core/geo.js';
import { latinName } from '/js/core/text.js';

// Nearby-stop search over bus-stops.json (see server/data/build-bus.js for the
// format). No DOM access, so it can be unit-tested in Node.

/**
 * @typedef {{ code: string, lat: number, lng: number, name: import('../../../types/data.js').Names, lines: string[] }} BusStop
 */

// Turn the compact rows into objects
/** @param {import('../../../types/data.js').BusStops} data @returns {BusStop[]} */
export function decodeStops({ fields, stops }) {
    const at = Object.fromEntries(fields.map((f, i) => [f, i]));
    // `fields` says which column is which, so a row is read by name rather than by its type
    return stops.map((/** @type {any[]} */ row) => ({
        code: row[at.code],
        lat: row[at.lat],
        lng: row[at.lng],
        // '' where it's the Greek in Latin letters (build-bus.js)
        name: { el: row[at.el], en: row[at.en] || latinName(row[at.el]) },
        lines: row[at.lines],
    }));
}

// The closest stops within `radius` metres, at most `limit` of them. If fewer
// than `min` are that close (e.g. in the suburbs), the `min` nearest are
// returned whatever the distance.
/**
 * @param {BusStop[]} stops @param {number} lat @param {number} lng
 * @returns {(BusStop & { meters: number })[]}
 */
export function nearestStops(stops, lat, lng, { limit = 6, radius = 500, min = 3 } = {}) {
    const sorted = stops
        .map(s => ({ ...s, meters: distanceMeters(lat, lng, s.lat, s.lng) }))
        .sort((a, b) => a.meters - b.meters);
    const close = sorted.filter(s => s.meters <= radius).slice(0, limit);
    return close.length >= min ? close : sorted.slice(0, Math.min(min, limit));
}
