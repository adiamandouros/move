import { html, icon } from './html.js';

/** @typedef {import('../../../types/data.js').Position} Position */

// Metro markup shared by the subway page (drawn in the browser) and the
// station pages (written on the server, server/pages/stations.js). Strings
// come from s(key): t() in the browser, the page's strings on the server.
// Line pills are in lines.js.

// "05:32" for a time in seconds after midnight; trains after midnight belong
// to the day before (24:15 → "00:15")
/** @param {number} seconds */
export function clockTime(seconds) {
    const minutes = Math.floor(seconds / 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// The train from back to front (positions: rail.json's), with the parts to
// ride in for the exit highlighted and the ones next to an elevator marked.
// One image for screen readers, described by its label. Under the cars, each
// part's name; when they don't fit (large text), the same in a line of words
// instead (style.css switches).
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
                <div class="train-cars-wrap" aria-hidden="true">
                    <div class="train-cars">${positions.map(p => html`
                        <div class="train-car${cls(p)}">${exits.includes(p) && icon('exit')}${elevators.includes(p) && icon('lift', 'car-elevator')}</div>`)}
                    </div>
                    <div class="position-labels">${positions.map(p => html`<div class="position-label${cls(p)}">${label(p)}</div>`)}</div>
                    <p class="position-words">
                        <span class="highlighted">${s('subway.ride-in')} ${exits.map(label).join(', ')}</span>
                        ${elevators.length > 0 && html`<span class="has-elevator">${s('subway.elevator-in')} ${elevators.map(label).join(', ')}</span>`}
                    </p>
                </div>
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
    return html`<span class="central-platform-badge${cls ? ` ${cls}` : ''}">${icon('doors-left', 'me-1')}${s('subway.doors-left')}</span>`;
}

// A stop's note ("Unreliable data", "No data yet!"), or nothing
/** @param {string | null | undefined} note */
export function stopNote(note) {
    return note ? html`<div class="stop-note mt-3">${icon('info', 'me-1')}${note}</div>` : null;
}
