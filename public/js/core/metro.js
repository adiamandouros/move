import { externalLink, formatHtml, html, icon } from './html.js';

/** @typedef {import('../../../types/data.js').Position} Position */

// Metro markup shared by the subway page (drawn in the browser) and the
// station pages (written on the server, server/pages/stations.js). Strings
// come from s(key): t() in the browser, the page's strings on the server.
// Line pills are in lines.js.

// STASY's page of the lifts out of service, in each language
export const STASY_LIFTS_PAGE = {
    el: 'https://www.stasy.gr/elevators/',
    en: 'https://www.stasy.gr/en/%ce%bb%ce%b5%ce%b9%cf%84%ce%bf%cf%85%cf%81%ce%b3%ce%b9%ce%ba%cf%8c%cf%84%ce%b7%cf%84%ce%b1-%ce%b1%ce%bd%ce%b5%ce%bb%ce%ba%cf%85%cf%83%cf%84%ce%ae%cf%81%cf%89%ce%bd-%ce%b5%ce%bd/',
};

// What goes with anything Wayhop says about step-free access (the terms of
// use promise it): lifts can stop working, and STASY's page says which have
/** @param {'en' | 'el'} lang @param {(key: string) => string} s */
export const liftCaution = (lang, s) => formatHtml(s('lifts.caution'), { link: externalLink({ href: STASY_LIFTS_PAGE[lang] }, s('lifts.caution-link'), s('shell.new-tab')) });

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
// on the device. So does the step-free notice (liftNotice in lifts.js). The
// server draws them open; the browser closes them when the person closed them
// before (localStorage can be missing or blocked: then they stay open).
// Each: what it is → the key it's kept under.
const KEPT_CLOSED = { 'details.diagram-legend': 'legend-closed', 'details.lift-notice': 'lifts-closed' };

const keptOpen = selector => {
    try { return localStorage.getItem(KEPT_CLOSED[selector]) !== '1'; } catch { return true; }
};
export const legendOpen = () => keptOpen('details.diagram-legend');
export const liftsOpen = () => keptOpen('details.lift-notice');

// Run once per page (shell.js): close the page's legends and step-free
// notices if they were closed, and remember each one opened or closed
export function rememberClosed() {
    for (const selector of Object.keys(KEPT_CLOSED)) {
        if (!keptOpen(selector)) /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll(selector)).forEach(details => { details.open = false; });
    }
    // toggle doesn't bubble: caught on its way down
    document.addEventListener('toggle', e => {
        const details = /** @type {HTMLDetailsElement} */ (e.target);
        const selector = Object.keys(KEPT_CLOSED).find(sel => details.matches?.(sel));
        if (!selector) return;
        try {
            if (details.open) localStorage.removeItem(KEPT_CLOSED[selector]);
            else localStorage.setItem(KEPT_CLOSED[selector], '1');
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
