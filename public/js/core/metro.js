import { html, icon } from './html.js';

/** @typedef {import('../../../types/data.js').Position} Position */

// Metro markup shared by the subway page (drawn in the browser) and the
// station pages (written on the server, server/pages/stations.js). Strings
// come from s(key): t() in the browser, the page's strings on the server.
// Line pills are in lines.js.

// The station a direction of a line ends at, as its signs name it, even
// when the next train turns back sooner (M3 toward Doukissis / Airport:
// "airport")
/** @param {import('../../../types/data.js').Rail} rail @param {string} line @param {string} dir */
export const lineEnd = (rail, line, dir) => rail.lines[line].directions[dir].stops.at(-1).station;

// "05:32" for a time in seconds after midnight; trains after midnight belong
// to the day before (24:15 → "00:15")
/** @param {number} seconds */
export function clockTime(seconds) {
    const minutes = Math.floor(seconds / 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Where to ride, as a stop gives it: the cars nearest the way out (or the
 * change), and the ones nearest a lift, an escalator up and stairs
 * @typedef {{ exits: Position[], elevators?: Position[], escalators?: Position[], stairs?: Position[] }} Where
 */

// How a car to ride in leads off the platform: an escalator up, stairs, or,
// while neither is recorded, just the way out (an arrow)
/** @param {Where} where @param {Position} p @returns {'escalator' | 'stairs' | 'exit'} */
export const exitKind = (where, p) => where.escalators?.includes(p) ? 'escalator' : where.stairs?.includes(p) ? 'stairs' : 'exit';

// The symbols a diagram shows, for the legend under it
/** @param {Where} where @returns {('exit' | 'escalator' | 'stairs' | 'lift')[]} */
export const diagramSymbols = where => [...new Set([
    ...where.exits.map(p => exitKind(where, p)),
    ...(where.elevators?.length ? /** @type {const} */ (['lift']) : []),
])];

// A symbol in a car, filled (it stands alone): the way out, by its kind
/** @param {'escalator' | 'stairs' | 'exit'} kind */
const exitSymbol = kind => kind === 'escalator' ? icon('escalator') : kind === 'stairs' ? icon('stairs') : icon('exit');

// The train from back to front (positions: rail.json's), with the parts to
// ride in highlighted, each showing how it leads off the platform, and the
// ones next to a lift marked. One image for screen readers, described by its
// label. Under the cars, each part's name; when they don't fit (large text),
// the same in a line of words instead (style.css switches).
/** @param {Position[]} positions @param {Where} where @param {(key: string) => string} s */
export function trainDiagram(positions, where, s) {
    const { exits } = where;
    const elevators = where.elevators ?? [];
    const label = p => s(`subway.pos.${p}`);
    // "Near Back (escalator)": the kind, when it's recorded
    const ride = p => exitKind(where, p) === 'exit' ? label(p) : `${label(p)} (${s(`subway.${exitKind(where, p)}`)})`;
    const described = [...exits.map(ride), ...elevators.map(p => `${label(p)} (${s('subway.elevator')})`)].join(', ');
    const cls = p => `${exits.includes(p) ? ' highlighted' : ''}${elevators.includes(p) ? ' has-elevator' : ''}`;
    return html`
            <div class="train-diagram" role="img" aria-label="${s('subway.diagram-label')} ${described}">
                <div class="train-cars-wrap" aria-hidden="true">
                    <div class="train-cars">${positions.map(p => html`
                        <div class="train-car${cls(p)}">${exits.includes(p) && exitSymbol(exitKind(where, p))}${elevators.includes(p) && icon('lift', 'car-elevator')}</div>`)}
                    </div>
                    <div class="position-labels">${positions.map(p => html`<div class="position-label${cls(p)}">${label(p)}</div>`)}</div>
                    <p class="position-words">
                        <span class="highlighted">${s('subway.ride-in')} ${exits.map(ride).join(', ')}</span>
                        ${elevators.length > 0 && html`<span class="has-elevator">${s('subway.elevator-in')} ${elevators.map(label).join(', ')}</span>`}
                    </p>
                </div>
            </div>`;
}

// Where to ride for the exit: the train diagram, or a note that it isn't
// known yet for this stop
/** @param {Position[]} positions @param {Where} where @param {(key: string) => string} s */
export function exitDiagram(positions, where, s) {
    return where.exits.length
        ? trainDiagram(positions, where, s)
        : html`<p class="text-body-secondary fst-italic small">${s('subway.no-position-data')}</p>`;
}

// What the diagrams on a page show, in words, under them: open unless the
// person closed it (rememberLegends below). symbols: diagramSymbols() of every
// diagram there; each line has a small car drawn as in the diagram
// (decoration: the words say it).
/** @param {string[]} symbols @param {(key: string) => string} s @param {boolean} [open] */
export function diagramLegend(symbols, s, open = true) {
    const car = (cls, symbol) => html`<span class="legend-car train-car${cls}" aria-hidden="true">${symbol}</span>`;
    const items = [
        html`<li>${car(' highlighted', null)}<span>${s('subway.legend-ride')}</span></li>`,
        symbols.includes('exit') && html`<li>${car(' highlighted', icon('exit'))}<span>${s('subway.legend-exit')}</span></li>`,
        symbols.includes('escalator') && html`<li>${car(' highlighted', icon('escalator'))}<span>${s('subway.legend-escalator')}</span></li>`,
        symbols.includes('stairs') && html`<li>${car(' highlighted', icon('stairs'))}<span>${s('subway.legend-stairs')}</span></li>`,
        symbols.includes('lift') && html`<li>${car(' has-elevator', icon('lift', 'car-elevator'))}<span>${s('subway.legend-lift')}</span></li>`,
    ];
    return html`<details class="diagram-legend"${open ? html` open` : ''}>
            <summary>${s('subway.legend')}</summary>
            <ul class="diagram-legend-list">${items}</ul>
        </details>`;
}

// A legend closed stays closed, on every page, until it's opened again: kept
// on the device. The server draws it open; the browser closes it when the
// person closed it before (localStorage can be missing or blocked: then it
// stays open).
const LEGEND_CLOSED = 'legend-closed';

export function legendOpen() {
    try { return localStorage.getItem(LEGEND_CLOSED) !== '1'; } catch { return true; }
}

// Run once per page (shell.js): close the page's legends if they were
// closed, and remember each one opened or closed
export function rememberLegends() {
    if (!legendOpen()) /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll('details.diagram-legend')).forEach(legend => { legend.open = false; });
    // toggle doesn't bubble: caught on its way down
    document.addEventListener('toggle', e => {
        const legend = /** @type {HTMLDetailsElement} */ (e.target);
        if (!legend.matches?.('details.diagram-legend')) return;
        try {
            if (legend.open) localStorage.removeItem(LEGEND_CLOSED);
            else localStorage.setItem(LEGEND_CLOSED, '1');
        } catch { /* not kept: open next time */ }
    }, true);
}

// The badge for a central platform (the doors open on the left). cls: where it sits.
/** @param {(key: string) => string} s @param {string} [cls] */
export function centralPlatformBadge(s, cls = '') {
    return html`<span class="tag${cls ? ` ${cls}` : ''}">${icon('doors-left', 'me-1')}${s('subway.doors-left')}</span>`;
}

// A stop's note ("Unreliable data", "No data yet!"), or nothing
/** @param {string | null | undefined} note */
export function stopNote(note) {
    return note ? html`<div class="stop-note mt-3">${icon('info', 'me-1')}${note}</div>` : null;
}
