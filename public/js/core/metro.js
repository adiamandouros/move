import { html, icon, textOn } from './html.js';

/** @typedef {import('../../../types/data.js').Position} Position */

// Metro markup shared by the subway page (drawn in the browser) and the
// station pages (written on the server, server/pages/stations.js). Strings
// come from s(key): t() in the browser, the page's strings on the server.

const COLOR = /^#[0-9a-f]{6}$/i;

// A line's badge, in its colour: line is rail.json's { name, color }. cls:
// the badge's class (the station suggestions have smaller ones). Only a
// #rrggbb colour goes into the style attribute.
/** @param {{ name: string, color: string }} line @param {string} [cls] */
export function lineBadge(line, cls = 'line-badge') {
    const color = COLOR.test(line.color) ? line.color : '#6c757d';
    return html`<span class="${cls}" style="background-color: ${color}; color: ${textOn(color)}">${line.name}</span>`;
}

// "05:32" for a time in seconds after midnight; trains after midnight belong
// to the day before (24:15 → "00:15")
/** @param {number} seconds */
export function clockTime(seconds) {
    const minutes = Math.floor(seconds / 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// A timetable's date ('2026-10-31', rail.json's feed.validTo) as people write it: "31/10/2026"
/** @param {string} date */
export function feedDate(date) {
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}`;
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
