// The published index, as the build writes it and the site reads it. Node's
// own modules only: the build runs on GitHub without npm install.

import { gunzipSync } from 'zlib';

export const PUBLISHED = 'https://github.com/adiamandouros/move/releases/download/places-index/places-index.json.gz';
// Editing removes a little; this much in a week means a broken fetch
const MOST_LOST = 0.1;

/**
 * The index (scripts/places/build.js): each town's names, its own first;
 * each street's names, its town (its place in towns, -1 for none), its
 * lines and its house numbers; each place's names, town, kind (park,
 * metro…), where it is and a station's lines. Where things are is in
 * whole numbers of 1e-5 degrees, each point a step from the one before:
 * a line is lat, lng, lat, lng…, the numbers are n, lat, lng, n… (a
 * negative n: one end of a range of numbers); a place's lat and lng are
 * where it is
 * @typedef {[names: string[], town: number, lines: number[][], numbers: number[]]} IndexStreet
 * @typedef {[names: string[], town: number, kind: string, lat: number, lng: number, lines?: string[]]} IndexPlace
 * @typedef {{ built: string, licence: string, towns: string[][], streets: IndexStreet[], places: IndexPlace[] }} PlacesIndex
 */

/** @param {Buffer} file @returns {PlacesIndex} */
export const unpack = file => JSON.parse(gunzipSync(file).toString());

/** @param {PlacesIndex} index */
export function countsOf(index) {
    return {
        towns: index.towns.length,
        streets: index.streets.length,
        numbers: index.streets.reduce((sum, street) => sum + street[3].length / 3, 0),
        places: index.places.length,
    };
}

// What has shrunk too far since last time, in words
/** @param {Record<string, number>} counts @param {Record<string, number> | null} [previous] */
export function lostSince(counts, previous) {
    if (!previous) return [];
    return Object.keys(counts)
        .filter(what => previous[what] && counts[what] < previous[what] * (1 - MOST_LOST))
        .map(what => `${what}: ${counts[what]}, down from ${previous[what]}`);
}
