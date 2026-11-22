// Which of OpenStreetMap's exits at a metro station are still offered: the
// ones the station editor's field trips haven't dealt with (decision 57).
// The data build walks through them with the station's own exits, and the
// station editor shows them as needing data. No DOM access.
import { distanceMeters } from './geo.js';
import { normalise } from './text.js';

// An exit of ours this near one of OpenStreetMap's is the same exit: a
// building's doors side by side are one exit, as the station editor
// records them
export const SAME_EXIT_M = 30;

// What a sign adds to the street's name, left off before names are compared
const SAID = /^(?:εξοδοσ|exit|οδοσ|οδ\.|λεωφοροσ|λεωφ\.|odos|str\.?)\s*|\s*(?:str\.?|street)$/g;

/**
 * An exit's name as a set of the streets or squares it names, to compare
 * names written differently: "Οδός Αθηνάς / Θέμιδος" → ['αθηνασ', 'θεμιδοσ']
 * @param {string | undefined} name @returns {string[]}
 */
export function nameParts(name) {
    return normalise(name ?? '').split('/')
        .map(part => part.trim().replace(SAID, '').replace(/[.,\s]/g, ''))
        .filter(Boolean);
}

// Whether two names name the same place: one's streets all in the other's
/** @param {string | undefined} a @param {string | undefined} b */
const sameName = (a, b) => {
    const [x, y] = [nameParts(a), nameParts(b)];
    /** @param {string[]} p @param {string[]} q */
    const within = (p, q) => p.length > 0 && p.every(part => q.includes(part));
    return within(x, y) || within(y, x);
};

/**
 * @typedef {{ ids: string[], name?: { el?: string, en?: string }, coords: [number, number], only?: 'in' | 'out' }} OsmExit
 * @typedef {{ exits?: { name?: { el?: string, en?: string }, coords?: [number, number] }[], osm?: string[] }} StreetEntry
 */

/**
 * OpenStreetMap's exits at a station (data/curated/osm.json) that its entry
 * in street.json doesn't stand for: not one a field trip dealt with
 * (`osm`, confirmed or found not to be there), and not one of its exits by
 * place (within SAME_EXIT_M) or by name. What's recorded always wins.
 * @param {OsmExit[] | undefined} osm @param {StreetEntry | undefined} entry @returns {OsmExit[]}
 */
export function offeredExits(osm, entry) {
    const dealt = new Set(entry?.osm ?? []);
    const ours = entry?.exits ?? [];
    return (osm ?? []).filter(exit => !exit.ids.some(id => dealt.has(id)) && !ours.some(own =>
        (own.coords && distanceMeters(...own.coords, ...exit.coords) <= SAME_EXIT_M)
        || (own.name?.el && exit.name?.el && sameName(own.name.el, exit.name.el))
        || (own.name?.en && exit.name?.en && sameName(own.name.en, exit.name.en))));
}
