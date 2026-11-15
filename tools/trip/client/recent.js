import { recentList } from '/js/core/recent.js';
import { fold } from '/js/core/text.js';

// The last 3 places picked from search on the Trip page, for either end,
// kept on the device with no time limit (decision 56): offered when a field
// is tapped with nothing in it, and first among what's found while one that
// matches is typed. Each is the place as search found it, as the trip kept
// is (kept.js); My location is never one. No DOM, so it's tested in Node.

const isPlace = place => Boolean(place) && typeof place === 'object'
    && typeof place.name === 'string' && typeof place.lat === 'number' && typeof place.lng === 'number';
// The same place: where it is and what it's called
const samePlace = (a, b) => a.lat === b.lat && a.lng === b.lng && a.name === b.name && (a.n ?? null) === (b.n ?? null);

const places = recentList('recent-places', { valid: isPlace, same: samePlace });

/** The places picked lately, most recent first */
export const recentPlaces = places.list;

/** A place picked from search, so it's offered first later */
export const addRecentPlace = places.add;

// Its words as they're compared with what's typed, Greek and Latin spellings
// alike (as address search does): 'menelaou 4' finds Μενελάου 45
const wordsOf = place => fold([place.name, place.n, place.town].filter(Boolean).join(' ')).split(' ');

/**
 * Whether each word typed starts one of the place's
 * @param {object} place
 * @param {string} typed
 */
export function matchesTyped(place, typed) {
    const words = wordsOf(place);
    const asked = fold(typed).split(' ').filter(Boolean);
    return asked.length > 0 && asked.every(word => words.some(own => own.startsWith(word)));
}

/**
 * What a field lists while `typed` is typed: the places picked lately that
 * match it, first, then the rest of what search `found`, each place once
 * @param {object[]} recent
 * @param {object[]} found
 * @param {string} typed
 */
export function recentFirst(recent, found, typed) {
    const first = recent.filter(place => matchesTyped(place, typed));
    return [...first, ...found.filter(place => !first.some(other => samePlace(other, place)))];
}
