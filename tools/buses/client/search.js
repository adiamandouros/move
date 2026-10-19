import { normalise } from '/js/core/text.js';
import { distanceMeters } from './stops.js';

// Finding a stop by its name or code, and a line by its number, in our own
// data (bus-stops.json, bus-lines.json): nothing is asked of OASA. No DOM
// access, so it can be unit-tested in Node.

/** @typedef {import('./stops.js').BusStop} BusStop */
/** @typedef {import('../../../types/data.js').BusLines['lines'][number]} BusLine */

// The Latin letters people type for the Greek ones in line numbers: X95 for Χ95
const LOOKALIKES = { a: 'α', b: 'β', g: 'γ', e: 'ε', t: 'τ', x: 'χ' };

// A line number as it's compared: 'x95', 'Χ95' and 'χ 95' are all 'χ95'
export function lineKey(text) {
    return normalise(text).replace(/ /g, '').replace(/th/g, 'θ').replace(/[abgetx]/g, c => LOOKALIKES[c]);
}

// Lines whose number is what was typed, then those that start with it, in number order
/** @param {BusLine[]} lines @param {string} query @returns {BusLine[]} */
export function findLines(lines, query) {
    const q = lineKey(query);
    if (!q) return [];
    const exact = lines.filter(l => lineKey(l.line) === q);
    return [...exact, ...lines.filter(l => !exact.includes(l) && lineKey(l.line).startsWith(q))];
}

// A stop's names as they're compared, worked out once per stop
/** @type {WeakMap<BusStop, string[]>} */
const namesOf = new WeakMap();
const names = stop => {
    if (!namesOf.has(stop)) namesOf.set(stop, [...new Set([stop.name.el, stop.name.en].map(normalise))]);
    return namesOf.get(stop);
};
const WORD_START = /[ .\-(/]/;

// How well a stop matches (lower is better), or null: its code, then a name
// that starts with what was typed, a word in a name that does, a name that
// has it anywhere, a name that has every word typed
/** @param {BusStop} stop @param {string} q @param {string[]} words */
function rank(stop, q, words) {
    if (stop.code === q) return 0;
    if (/^\d+$/.test(q)) return stop.code.startsWith(q) ? 1 : null;
    const all = names(stop);
    if (all.some(n => n.startsWith(q))) return 2;
    if (all.some(n => n.split(WORD_START).some(w => w.startsWith(q)))) return 3;
    if (all.some(n => n.includes(q))) return 4;
    if (words.length > 1 && all.some(n => words.every(w => n.includes(w)))) return 5;
    return null;
}

// Every stop that matches, best first; equally good ones nearest first when
// the location is known (with how far they are), or by name
/**
 * @param {BusStop[]} stops @param {string} query @param {{ lat: number, lng: number } | null} [coords] @param {'el' | 'en'} [language]
 * @returns {(BusStop & { meters?: number })[]}
 */
export function findStops(stops, query, coords = null, language = 'el') {
    const q = normalise(query);
    if (!q) return [];
    const words = q.split(' ');
    const found = [];
    for (const stop of stops) {
        const r = rank(stop, q, words);
        if (r === null) continue;
        found.push({ r, stop: coords ? { ...stop, meters: distanceMeters(coords.lat, coords.lng, stop.lat, stop.lng) } : stop });
    }
    return found
        .sort((a, b) => a.r - b.r || (coords ? a.stop.meters - b.stop.meters : a.stop.name[language].localeCompare(b.stop.name[language], 'el')))
        .map(f => f.stop);
}
