// A way as one strip (Design · A step 4, decision 77): each part as long as
// its minutes, a ride in its line's colour (a bus neutral), a walk dotted,
// a wait a thin line. It goes under a way's heading on the Trip and Subway
// pages, a picture of the whole way before its steps are read. The steps
// say everything it shows, so it's hidden from screen readers.

import { html } from '/js/core/html.js';

/**
 * A ride of the way, as the strip needs it: the minutes walked to where it
 * boards (from the door or the ride before), when it leaves and gets there
 * (seconds, all from the same midnight), and the rail line it is, for its
 * colour, or null for a bus
 * @typedef {{ walk: number, departs: number, arrives: number, line: string | null }} StripRide
 */
/** @typedef {{ kind: 'walk' | 'wait' | 'ride', minutes: number, line?: string | null }} StripPart */

// A wait shorter than this isn't drawn: it's the timetable's rounding, not
// time a rider spends
const LEAST_WAIT = 60;

// The way's parts in order. `lastWalk`: the minutes walked from the last
// ride to the door. `start`: when the way starts (seconds), for the wait
// before its first ride, so the strip adds up to the heading's minutes; null
// when it starts with the walk to the first ride (a morning's first train,
// or a way counted from when it leaves)
/** @param {StripRide[]} rides @param {number} lastWalk @param {number | null} [start] @returns {StripPart[]} */
export function stripParts(rides, lastWalk, start = null) {
    /** @type {StripPart[]} */
    const parts = [];
    if (!rides.length) return parts;
    let at = start ?? rides[0].departs - rides[0].walk * 60;
    for (const { walk, departs, arrives, line } of rides) {
        if (walk > 0) parts.push({ kind: 'walk', minutes: walk });
        at += walk * 60;
        if (departs - at >= LEAST_WAIT) parts.push({ kind: 'wait', minutes: (departs - at) / 60 });
        parts.push({ kind: 'ride', minutes: Math.max(1, (arrives - departs) / 60), line });
        at = arrives;
    }
    if (lastWalk > 0) parts.push({ kind: 'walk', minutes: lastWalk });
    return parts;
}

// How finely a part's share of the width is drawn: in twentieths, each a
// class of its own (.way-share-1 to -20), as the pages have no style
// attributes (the CSP's aim)
const SHARES = 20;

// Each part's share of the strip in twentieths, at least one: the rounding
// carried from part to part, so the shares add up to the whole
/** @param {StripPart[]} parts @returns {number[]} */
function stripShares(parts) {
    const total = parts.reduce((sum, part) => sum + part.minutes, 0);
    let carried = 0;
    let given = 0;
    return parts.map(part => {
        carried += part.minutes / total * SHARES;
        const share = Math.max(1, Math.round(carried) - given);
        given += share;
        return share;
    });
}

// The strip itself, each part as wide as its share. A ride takes its line's
// colour from `.strip-<line>` (the stations' strip's), a bus the neutral of
// its plate. `small`: the other ways' thinner one
/** @param {StripPart[]} parts @param {boolean} [small] */
export function wayStrip(parts, small = false) {
    if (!parts.length) return '';
    const shares = stripShares(parts);
    return html`<span class="way-strip${small ? ' way-strip-small' : ''}" aria-hidden="true">${parts.map((part, i) => html`<span class="way-strip-${part.kind} way-share-${Math.min(SHARES, shares[i])}${part.kind === 'ride' && (part.line ? ` strip-${part.line.toLowerCase()}` : ' way-strip-bus')}"></span>`)}</span>`;
}
