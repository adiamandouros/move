// Helpers for building HTML with template strings, shared by the browser and
// the server (which imports this file from public/js/core/)
//
// Build HTML with html`…`, which escapes every value put into it:
//   html`<p class="stop">${stop.name}</p>`         the name is escaped
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`   pieces built with
//                                                  html`` (and lists of them) go in as they are
//   html`${cond && html`<b>…</b>`}`                 null, undefined and false give nothing
// raw(text) marks HTML that's safe as it is; it's rarely needed. HTML goes
// into the page with setHtml(element, view), and on the server as String(view).

// Marks HTML as built safely; a global symbol, so pieces built by another
// copy of this module (each language loads its own in the tests) count too
const SAFE = Symbol.for('wayhop.html');

// HTML that's safe to put in a page as it is: what html`` and raw() give
export class Html {
    /** @param {string} text */
    constructor(text) {
        this.text = text;
        this[SAFE] = true;
    }
    toString() { return this.text; }
}

/** @param {unknown} value @returns {value is Html} */
const isHtml = value => Boolean(value?.[SAFE]);

/** @param {unknown} value @returns {string} */
const piece = value => value === null || value === undefined || value === false ? ''
    : isHtml(value) ? value.text
    : Array.isArray(value) ? value.map(piece).join('')
    : escapeHtml(value);

/** @param {TemplateStringsArray} strings @param {...unknown} values @returns {Html} */
export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += piece(values[i]) + strings[i + 1];
    return new Html(out);
}

// HTML from somewhere that's known to be safe, as it is
/** @param {string} text */
export const raw = text => new Html(String(text));

// Put HTML built with html`` into an element (the one way HTML enters a page
// in the browser)
/** @param {Element} element @param {Html | ''} view */
export function setHtml(element, view) {
    element.innerHTML = String(view);
}

// Escape text for safe use inside HTML, as text or in an attribute
/** @param {unknown} text */
export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// A link from data (an announcement's, say) if it's a web address, else null:
// escaping keeps it inside its attribute, but a javascript: link would still run
/** @param {unknown} url @returns {string | null} */
export function safeUrl(url) {
    try {
        return ['http:', 'https:'].includes(new URL(String(url)).protocol) ? String(url) : null;
    } catch {
        return null;
    }
}

// Fill {name} placeholders: format(t('subway.ride'), { min: 12 }). Gives text;
// put it into html`` to escape it.
/** @param {string} text @param {Record<string, unknown>} values @returns {string} */
export function format(text, values) {
    return text.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

// A name in the page's language, or in English if it has none:
// localName(station.name, 'el')
/** @param {{ el?: string, en?: string } | null | undefined} names @param {string} lang */
export const localName = (names, lang) => names?.[lang] || names?.en || '';

// Google Maps walking directions to a place
/** @param {number} lat @param {number} lng */
export const walkingUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

// An icon from the sprite (server/pages/icons.js lists them), sized and
// coloured like the text around it: icon('geo-alt', 'me-1'). Icons are
// decoration; the text next to them or the control's label says what they mean.
// In the browser the sprite's URL comes from the page (it carries the asset
// version); the server versions /icons.svg when it renders the page.
const sprite = globalThis.document?.documentElement.dataset.icons ?? '/icons.svg';
/** @param {string} name @param {string} [cls] more classes @returns {Html} */
export function icon(name, cls = '') {
    return html`<svg class="bi${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="${sprite}#${name}"></use></svg>`;
}

// Text colour for a label on `background` (#rrggbb): whichever of white and
// near-black has the higher contrast, so line badges stay readable (WCAG AA)
/** @param {string} background */
export function textOn(background) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(background.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.0607 ? '#fff' : '#0f131c';
}
