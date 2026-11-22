import { distanceMeters } from '/js/core/geo.js';
import { latinName } from '/js/core/text.js';

// Nearby-stop search over bus-stops.json (see server/data/build-bus.js for the
// format). No DOM access, so it can be unit-tested in Node.

/**
 * @typedef {{ code: string, lat: number, lng: number, name: import('../../../types/data.js').Names, lines: string[] }} BusStop
 * @typedef {BusStop & { meters?: number }} ShownStop a stop as a page lists it: `meters`, how far it is, when the location is known
 */

// Turn the compact rows into objects
/** @param {import('../../../types/data.js').BusStops} data @returns {BusStop[]} */
export function decodeStops({ fields, stops }) {
    const at = Object.fromEntries(fields.map((f, i) => [f, i]));
    // `fields` says which column is which, so a row is read by name rather
    // than by its place, each field cast to the type it has there
    return stops.map(row => {
        const el = /** @type {string} */ (row[at.el]);
        return {
            code: /** @type {string} */ (row[at.code]),
            lat: /** @type {number} */ (row[at.lat]),
            lng: /** @type {number} */ (row[at.lng]),
            // '' where it's the Greek in Latin letters (build-bus.js)
            name: { el, en: /** @type {string} */ (row[at.en]) || latinName(el) },
            lines: /** @type {string[]} */ (row[at.lines]),
        };
    });
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
