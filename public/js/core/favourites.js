import { html, icon } from './html.js';

// The stations, bus stops and bus lines a person starred, kept on the device
// so each tool can offer them first. One list per kind, newest first, of
// keys: a station's id ('syntagma'), a stop's code ('10341'), a line with the
// direction it was starred in ('040/1'). The star button that adds and
// removes them is wired once for every page, by shell.js (startFavourites).

/** @typedef {'station' | 'stop' | 'line'} Kind */

const KEY = 'favourites';
/** @type {Kind[]} */
const KINDS = ['station', 'stop', 'line'];

// localStorage can be missing or blocked (private windows, some settings)
const storage = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } },
};

// A bus line in one direction, as it's kept: lineFavourite('040', 1) → '040/1'
/** @param {string} line @param {number} dir */
export const lineFavourite = (line, dir) => `${line}/${dir}`;

/** @returns {Record<Kind, string[]>} */
export function favourites() {
    let saved = null;
    try { saved = JSON.parse(storage.get(KEY)); } catch { /* none */ }
    const list = kind => Array.isArray(saved?.[kind]) ? saved[kind].filter(key => typeof key === 'string') : [];
    return { station: list('station'), stop: list('stop'), line: list('line') };
}

/** @param {Kind} kind @param {string} key */
export const isFavourite = (kind, key) => KINDS.includes(kind) && favourites()[kind].includes(key);

// Star it, or unstar it if it was; whether it's starred now
/** @param {Kind} kind @param {string} key @returns {boolean} */
export function toggleFavourite(kind, key) {
    if (!KINDS.includes(kind)) return false;
    const all = favourites();
    const on = !all[kind].includes(key);
    all[kind] = on ? [key, ...all[kind]] : all[kind].filter(other => other !== key);
    storage.set(KEY, JSON.stringify(all));
    return on;
}

// The star: a toggle button, outline when off and filled when on. text: the
// words beside it ("Favourite"), or label: what it stars, for screen readers
// only when the button is the star alone ("Favourite: SYNTAGMA 10341"). Drawn
// hidden on the server, as it only works with the script, which shows it.
/**
 * @param {{ kind: Kind, key: string, on?: boolean, text?: string, label?: string, cls?: string, hidden?: boolean }} options
 */
export function favouriteButton({ kind, key, on = false, text = '', label = '', cls = '', hidden = false }) {
    return html`<button type="button" class="favourite-btn${cls ? ` ${cls}` : ''}" data-favourite="${kind}" data-key="${key}" aria-pressed="${String(on)}"${hidden ? html` hidden` : ''}>${icon('favourite', text ? 'me-1' : '', { filled: on })}${text && html`<span>${text}</span>`}${label && html`<span class="sr-only">${label}</span>`}</button>`;
}

// A star shows whether what it stars is starred now
/** @param {HTMLElement} button */
function show(button) {
    const on = isFavourite(/** @type {Kind} */ (button.dataset.favourite), button.dataset.key);
    button.setAttribute('aria-pressed', String(on));
    const use = button.querySelector('use');
    use?.setAttribute('href', use.getAttribute('href').replace(/#.*$/, `#favourite${on ? '-filled' : ''}`));
    button.hidden = false;
}

const showAll = () => /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-favourite]')).forEach(show);

// Every star on the page, now and drawn later: a tap stars or unstars, every
// star for the same thing follows (a stop can be listed twice), and the page
// hears of it ('favourites-change', for the lists that show favourites)
export function startFavourites() {
    showAll();
    document.addEventListener('click', e => {
        const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.('[data-favourite]'));
        if (!button) return;
        const { favourite: kind, key } = button.dataset;
        const on = toggleFavourite(/** @type {Kind} */ (kind), key);
        showAll();
        document.dispatchEvent(new CustomEvent('favourites-change', { detail: { kind, key, on } }));
    });
    // Starred in another tab
    window.addEventListener('storage', e => { if (e.key === KEY) showAll(); });
}
