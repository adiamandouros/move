import { html } from './html.js';

// How Wayhop names a line: every time a page names one, it shows its pill or
// plate (DESIGN.md, "Lines and stations"), built here, in the browser and on
// the server alike. Three sizes, each in em so it grows with the text:
//   's'  in lists: station suggestions, the stations by line, a stop's lines
//   'm'  in sentences, arrival rows and tables
//   'l'  in the headers of leg cards, station sections and bus stops
// test/lines.test.js checks no page shows a line's name without them.

/** @typedef {'s' | 'm' | 'l'} PillSize */

// A metro or tram line: a round pill in its colour. id is the line's key in
// rail.json or tram.json ('M1'), name what it says. The colours are classes
// in style.css (.line-m1), so no page needs inline styles;
// test/accessibility.test.js keeps them the same as data/curated/'s, and
// readable.
/** @param {string} id @param {string} name @param {PillSize} [size] */
export function linePill(id, name, size = 'm') {
    return html`<span class="line-pill pill-${size} line-${id.toLowerCase()}">${name}</span>`;
}

// A bus line's number: a neutral plate with square corners, as buses have no
// colours of their own. label: words before the number for screen readers
// only ("Line"), where the number alone wouldn't say what it is.
/** @param {string} number @param {PillSize} [size] @param {string} [label] */
export function busPlate(number, size = 'm', label = '') {
    return html`<span class="bus-plate pill-${size}">${label && html`<span class="sr-only">${label} </span>`}${number}</span>`;
}

// Several, with a space between them: "change to [M2] [M3]" (and a comma
// for screen readers, "M2, M3")
/** @param {import('./html.js').Html[]} pills */
export const pillList = pills => html`${pills.map((pill, i) => html`${i ? html`<span class="sr-only">,</span> ` : ''}${pill}`)}`;

// A station's sign, as in the stations: an off-white panel with a line's
// colour on its top edge and, at a station on two lines, the other's on its
// bottom edge. Only metro lines have edges, and the lower number goes on
// top (Syntagma: M2 above, M3 below) until the real signs at the other
// interchanges are checked. name: in the page's language only. A label,
// never a link: 'm' for the direction of travel beside a large pill, 'l' as
// a station page's title.
/** @param {string} name @param {string[]} lines @param {'m' | 'l'} [size] */
export function stationSign(name, lines, size = 'm') {
    const [top, bottom] = lines.filter(id => /^M\d+$/.test(id)).sort().map(id => id.toLowerCase());
    return html`<span class="station-sign sign-${size}${top ? ` sign-top-${top}` : ''}${bottom ? ` sign-bottom-${bottom}` : ''}">${name}</span>`;
}
