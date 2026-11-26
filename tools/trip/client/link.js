import { localName } from '/js/core/html.js';
import { stationByKey } from '/tools/subway/network.js';

// A link to the Trip page with where to go: /trip?to=<station>, a station
// by the key its star has (favourites.js, stationByKey), as Home's starred
// stations link (decision 81). To is that station, From the rider's
// location as when the page opens with nothing; the link's `to` is then
// taken out of the address, so the trip is kept as any other (kept.js) and
// opening the page again doesn't set it over what was typed since. No DOM,
// so it's tested in Node; main.js follows.

/** @typedef {import('./picker.js').Found} Found */

// The station key a link names, or null: `search`, the address's ?…
/** @param {string} search */
export const linkedKey = search => new URLSearchParams(search).get('to') || null;

// The address without the link's `to`, the rest kept (?trace)
/** @param {string} href @returns {string} */
export function withoutLink(href) {
    const address = new URL(href);
    address.searchParams.delete('to');
    return `${address.pathname}${address.search}${address.hash}`;
}

// The station as address search would have found it, so it's chosen, shown
// and kept as one picked from the list; null for a key rail.json and
// trains.json don't know (trains: null while it isn't in)
/**
 * @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Trains | null} trains
 * @param {string} key @param {'el' | 'en'} lang @returns {Found | null}
 */
export function linkedPlace(rail, trains, key, lang) {
    const station = stationByKey(rail, trains, key);
    if (!station) return null;
    const [lat, lng] = station.coords;
    return { name: localName(station.name, lang), town: '', type: 'place', placeKind: station.kind, lineNames: [], n: null, numbers: 0, lat, lng, kind: 'place' };
}
