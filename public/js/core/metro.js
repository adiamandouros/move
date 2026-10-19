import { html, icon } from './html.js';

/** @typedef {import('../../../types/data.js').Position} Position */

// Metro markup shared by the subway page (drawn in the browser) and the
// station pages (written on the server, server/pages/stations.js). Strings
// come from s(key): t() in the browser, the page's strings on the server.

// A line's badge, in its colour: id is rail.json's key ('M1'), name what it
// says. The colours are classes in style.css (.line-m1), so no page needs
// inline styles; test/accessibility.test.js keeps them the same as
// data/curated/lines.json's, and readable. cls: the badge's own class (the
// station suggestions have smaller ones).
/** @param {string} id @param {string} name @param {string} [cls] */
export function lineBadge(id, name, cls = 'line-badge') {
    return html`<span class="${cls} line-${id.toLowerCase()}">${name}</span>`;
}

// "05:32" for a time in seconds after midnight; trains after midnight belong
// to the day before (24:15 → "00:15")
/** @param {number} seconds */
export function clockTime(seconds) {
    const minutes = Math.floor(seconds / 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// The train from back to front (positions: rail.json's), with the parts to
// ride in for the exit highlighted and the ones next to an elevator marked.
// One image for screen readers, described by its label.
/**
 * @param {Position[]} positions @param {Position[]} exits @param {Position[]} elevators
 * @param {(key: string) => string} s
 */
export function trainDiagram(positions, exits, elevators, s) {
    const label = p => s(`subway.pos.${p}`);
    const described = [...exits.map(label), ...elevators.map(p => `${label(p)} (${s('subway.elevator')})`)].join(', ');
    const cls = p => `${exits.includes(p) ? ' highlighted' : ''}${elevators.includes(p) ? ' has-elevator' : ''}`;
    return html`
            <div class="train-diagram" role="img" aria-label="${s('subway.diagram-label')} ${described}">
                <div class="train-label" aria-hidden="true">${s('subway.train-back')}</div>
                <div class="train-cars-wrap" aria-hidden="true">
                    <div class="train-cars">${positions.map(p => html`
                        <div class="train-car${cls(p)}">${exits.includes(p) && icon('person-walking')}${elevators.includes(p) && icon('arrow-up-square', 'car-elevator')}</div>`)}
                    </div>
                    <div class="position-labels">${positions.map(p => html`<div class="position-label${cls(p)}">${label(p)}</div>`)}</div>
                </div>
                <div class="train-label" aria-hidden="true">${s('subway.train-front')}</div>
            </div>`;
}

// Where to ride for the exit: the train diagram, or a note that it isn't
// known yet for this stop
/**
 * @param {Position[]} positions @param {Position[]} exits @param {Position[]} elevators
 * @param {(key: string) => string} s
 */
export function exitDiagram(positions, exits, elevators, s) {
    return exits.length
        ? trainDiagram(positions, exits, elevators, s)
        : html`<p class="text-body-secondary fst-italic small">${s('subway.no-position-data')}</p>`;
}

// The badge for a central platform (the doors open on the left). cls: where it sits.
/** @param {(key: string) => string} s @param {string} [cls] */
export function centralPlatformBadge(s, cls = '') {
    return html`<span class="central-platform-badge${cls ? ` ${cls}` : ''}">${icon('symmetry-horizontal', 'me-1')}${s('subway.exit-left')}</span>`;
}

// A stop's note ("Unreliable data", "No data yet!"), or nothing
/** @param {string | null | undefined} note */
export function stopNote(note) {
    return note ? html`<div class="stop-note mt-3">${icon('info-circle', 'me-1')}${note}</div>` : null;
}
