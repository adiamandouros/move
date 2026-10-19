import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

// The icon sprite (/icons.svg): the Bootstrap Icons the site uses, as one
// small SVG file of <symbol>s instead of the whole icon font (2,000+ icons).
// Pages show one with icon(name) from public/js/core/html.js, or in a static
// view with <svg class="bi" aria-hidden="true"><use href="/icons.svg#<name>"></use></svg>.
// A new icon goes in this list (test/icons.test.js checks the code's icons are).

export const ICONS = [
    'airplane', 'arrow-down-circle-fill', 'arrow-down-up', 'arrow-left-right', 'arrow-repeat', 'arrow-up-square',
    'arrows-angle-contract', 'bus-front', 'check-circle-fill', 'clock', 'cloud-check', 'crosshair', 'dash-lg',
    'door-open', 'download', 'envelope', 'exclamation-triangle', 'exclamation-triangle-fill', 'eye', 'eye-slash',
    'geo-alt', 'globe', 'heart-pulse', 'info-circle', 'list-ul', 'lock', 'map', 'megaphone', 'moon-stars', 'person-walking',
    'person-wheelchair', 'plus-lg', 'signpost-2-fill', 'signpost-split', 'symmetry-horizontal', 'telephone',
    'ticket-perforated', 'train-front', 'wifi-off', 'x-lg', 'x-octagon-fill',
];

const require = createRequire(import.meta.url);
export const ICONS_DIR = join(dirname(require.resolve('bootstrap-icons/package.json')), 'icons');

let sprite = null;
/** @returns {string} */
export function iconSprite() {
    if (sprite) return sprite;
    const symbols = ICONS.map(name => {
        const svg = readFileSync(join(ICONS_DIR, `${name}.svg`), 'utf8');
        const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
        const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '');
        return `<symbol id="${name}" viewBox="${viewBox}">${inner}</symbol>`;
    });
    sprite = `<svg xmlns="http://www.w3.org/2000/svg"><!-- Bootstrap Icons, MIT License, https://github.com/twbs/icons/blob/main/LICENSE -->${symbols.join('')}</svg>`;
    return sprite;
}
