import { escapeHtml, icon, textOn } from './html.js';

/** @typedef {import('../../../types/data.js').Position} Position */

// Metro markup shared by the subway page (drawn in the browser) and the
// station pages (written on the server, server/pages/stations.js). Strings
// come from s(key): t() in the browser, the page's strings on the server.

// A line's badge, in its colour: line is rail.json's { name, color }
/** @param {{ name: string, color: string }} line */
export function lineBadge(line) {
    return `<span class="line-badge" style="background-color: ${line.color}; color: ${textOn(line.color)}">${escapeHtml(line.name)}</span>`;
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
    return `
            <div class="train-diagram" role="img" aria-label="${escapeHtml(`${s('subway.diagram-label')} ${described}`)}">
                <div class="train-label" aria-hidden="true">${s('subway.train-back')}</div>
                <div class="train-cars-wrap" aria-hidden="true">
                    <div class="train-cars">${positions.map(p => `
                        <div class="train-car${cls(p)}">${exits.includes(p) ? icon('person-walking') : ''}${elevators.includes(p) ? icon('arrow-up-square', 'car-elevator') : ''}</div>`).join('')}
                    </div>
                    <div class="position-labels">${positions.map(p => `<div class="position-label${cls(p)}">${label(p)}</div>`).join('')}</div>
                </div>
                <div class="train-label" aria-hidden="true">${s('subway.train-front')}</div>
            </div>`;
}
