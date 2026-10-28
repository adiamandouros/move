import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// The icon sprite (/icons.svg): Material Symbols Rounded (Apache 2.0), one
// small SVG file of <symbol>s. Pages show an icon by what it means, never by
// its picture: icon('walk') from public/js/core/html.js, {{icon "walk"}} in a
// view. DESIGN.md has the rules:
//   - one meaning per icon, and one icon per meaning (test/icons.test.js)
//   - outline beside a word; filled where the icon stands alone as the
//     information (filled: true here: status icons, the symbols in the train)
//   - the current tab filled (tab: true: the sprite has `<meaning>-filled`
//     too, which icon(name, cls, { filled: true }) shows)
//   - a toggle's icon outline when off, filled when on (toggle: true: both
//     forms, as for a tab)
// The SVGs are copied into server/icons/ by `npm run icons`, from the
// @material-symbols/svg-400 package (a dev dependency: it's 23,000 files),
// so a new icon goes in this list, then that command.

/** @typedef {{ symbol: string, filled?: boolean, tab?: boolean, toggle?: boolean }} Meaning */

/** @type {Record<string, Meaning>} */
export const MEANINGS = {
    // The tools, in the navigation and on the home page
    metro: { symbol: 'subway', tab: true },
    bus: { symbol: 'directions_bus', tab: true },
    info: { symbol: 'info', tab: true },
    stations: { symbol: 'format_list_bulleted' },
    menu: { symbol: 'menu' },
    // Trips and stations
    'trip-from': { symbol: 'trip_origin' },
    'trip-to': { symbol: 'location_on' },
    // The boarding station following the location (a toggle)
    nearest: { symbol: 'my_location', toggle: true },
    swap: { symbol: 'swap_vert' },
    walk: { symbol: 'directions_walk' },
    'change-trains': { symbol: 'transfer_within_a_station' },
    'get-off': { symbol: 'door_open' },
    'doors-left': { symbol: 'door_sliding' },
    night: { symbol: 'bedtime' },
    // Starred stations, stops and lines (a toggle)
    favourite: { symbol: 'star', toggle: true },
    // In the train diagram, alone in a carriage: how it leads off the
    // platform (an escalator up, stairs, or, not recorded yet, an arrow:
    // the way out), and a lift
    exit: { symbol: 'arrow_upward', filled: true },
    escalator: { symbol: 'escalator', filled: true },
    stairs: { symbol: 'stairs', filled: true },
    lift: { symbol: 'elevator', filled: true },
    // Info's sections
    announcements: { symbol: 'campaign' },
    map: { symbol: 'map' },
    times: { symbol: 'schedule' },
    tickets: { symbol: 'confirmation_number' },
    airport: { symbol: 'flight' },
    'step-free': { symbol: 'accessible' },
    phone: { symbol: 'call' },
    'in-greek': { symbol: 'translate' },
    // Status: alone, filled
    ok: { symbol: 'check_circle', filled: true },
    warning: { symbol: 'warning', filled: true },
    error: { symbol: 'error', filled: true },
    // The rest of the site
    'no-connection': { symbol: 'wifi_off' },
    'offline-ready': { symbol: 'cloud_done' },
    'not-found': { symbol: 'wrong_location' },
    loading: { symbol: 'progress_activity' },
    'hide-empty': { symbol: 'visibility_off' },
    'show-empty': { symbol: 'visibility' },
    more: { symbol: 'chevron_right' },
    back: { symbol: 'arrow_back' },
    close: { symbol: 'close' },
    language: { symbol: 'language' },
    email: { symbol: 'mail' },
    private: { symbol: 'lock' },
    terms: { symbol: 'gavel' },
    'zoom-in': { symbol: 'add' },
    'zoom-out': { symbol: 'remove' },
    'zoom-reset': { symbol: 'fit_screen' },
    // The admin pages
    health: { symbol: 'monitor_heart' },
    download: { symbol: 'download' },
};

export const ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// A tab or a toggle has both forms: the meaning plus -filled too
/** @param {Meaning} meaning */
export const bothForms = ({ tab, toggle }) => Boolean(tab || toggle);

// The files a meaning needs: its symbol, outline or filled, and for both forms both
/** @param {Meaning} meaning */
export const iconFiles = meaning => [
    ...(meaning.filled ? [] : [`${meaning.symbol}.svg`]),
    ...(meaning.filled || bothForms(meaning) ? [`${meaning.symbol}-fill.svg`] : []),
];

/** @param {string} id @param {string} file */
function symbolOf(id, file) {
    const svg = readFileSync(join(ICONS_DIR, file), 'utf8');
    const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
    const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>')).trim();
    return `<symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`;
}

let sprite = null;
/** @returns {string} */
export function iconSprite() {
    if (sprite) return sprite;
    const symbols = Object.entries(MEANINGS).flatMap(([name, meaning]) => [
        symbolOf(name, `${meaning.symbol}${meaning.filled ? '-fill' : ''}.svg`),
        ...(bothForms(meaning) ? [symbolOf(`${name}-filled`, `${meaning.symbol}-fill.svg`)] : []),
    ]);
    sprite = `<svg xmlns="http://www.w3.org/2000/svg"><!-- Material Symbols by Google, Apache License 2.0, https://github.com/google/material-design-icons/blob/master/LICENSE -->${symbols.join('')}</svg>`;
    return sprite;
}
