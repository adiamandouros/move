// Helpers for building HTML with template strings, shared by the browser and
// the server (which imports this file from public/js/core/)
//
// Build HTML with html`…`, which escapes every value put into it:
//   html`<p class="stop">${stop.name}</p>`         the name is escaped
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`   pieces built with
//                                                  html`` (and lists of them) go in as they are
//   html`${cond && html`<b>…</b>`}`                 null, undefined and false give nothing
// raw(text) marks HTML that's safe as it is; it's rarely needed. HTML goes
// into the page with setHtml(element, view), and on the server as String(view)
// or into a Handlebars view as {{value}} (server/pages/templates.js).

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
    // Handlebars doesn't escape what has toHTML(), so pieces built with html``
    // go into a view as {{piece}}, and plain text is still escaped
    toHTML() { return this.text; }
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

// Tell screen readers something that changed out of sight, through the
// page's live region (#sr-announcer, in layout.hbs)
/** @param {string} message */
export function announce(message) {
    const el = document.getElementById('sr-announcer');
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
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

// The same as HTML, for values that are pieces built with html`` (a line's
// pill in a sentence): the text is escaped, and values go in as html`` puts
// them, pieces as they are and anything else escaped.
// formatHtml(t('subway.change-to'), { line: linePill('M3', 'M3') })
/** @param {string} text @param {Record<string, unknown>} values @returns {Html} */
export function formatHtml(text, values) {
    return new Html(text.split(/(\{\w+\})/).map((part, i) => {
        const key = part.slice(1, -1);
        return i % 2 && values[key] !== undefined && values[key] !== null ? piece(values[key]) : escapeHtml(part);
    }).join(''));
}

// A name in the page's language, or in English if it has none:
// localName(station.name, 'el')
/** @param {{ el?: string, en?: string } | null | undefined} names @param {string} lang */
export const localName = (names, lang) => names?.[lang] || names?.en || '';

// A date ('2026-10-31', as the data writes them) as people write it: "31/10/2026"
/** @param {string} date */
export function formatDate(date) {
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}`;
}

// A link that opens in a new tab, and says so to screen readers after its
// content (newTab: "(opens in a new tab)" in the page's language). attrs: its
// attributes, written href first and the rest by name; true writes one
// without a value, null, undefined and false leave it out. The one way pages write such a link: in
// views as {{#external href="…"}}…{{/external}} (server/pages/templates.js).
/**
 * @param {Record<string, unknown>} attrs @param {unknown} content @param {string} newTab
 * @returns {Html}
 */
export function externalLink(attrs, content, newTab) {
    const written = Object.entries(attrs)
        .sort(([a], [b]) => a === 'href' ? -1 : b === 'href' ? 1 : a.localeCompare(b))
        .filter(([, value]) => value !== null && value !== undefined && value !== false)
        .map(([name, value]) => value === true ? html` ${name}` : html` ${name}="${value}"`);
    return html`<a${written} target="_blank" rel="noopener">${content}<span class="sr-only"> ${newTab}</span></a>`;
}

// Google Maps walking directions to a place
/** @param {number} lat @param {number} lng */
export const walkingUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

// An icon from the sprite, by what it means (MEANINGS in
// server/pages/icons.js lists them), sized and coloured like the text around
// it: icon('walk', 'me-1'). Icons are decoration; the text next to them or
// the control's label says what they mean. filled: a tab's filled form, for
// the current tab. In the browser the sprite's URL comes from the page (it
// carries the asset version); the server versions /icons.svg when it renders
// the page.
const sprite = globalThis.document?.documentElement.dataset.icons ?? '/icons.svg';
/** @param {string} name @param {string} [cls] more classes @param {{ filled?: boolean }} [options] @returns {Html} */
export function icon(name, cls = '', { filled = false } = {}) {
    return html`<svg class="icon${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="${sprite}#${name}${filled ? '-filled' : ''}"></use></svg>`;
}

// The one notice: a boxed message with an icon, in one of four tones (DESIGN.md).
// warn: something to watch for (yellow); info: how to read what's shown;
// ok: all clear; danger: it isn't working. attrs: more classes, or role="status".
/** @param {'warn' | 'info' | 'ok' | 'danger'} tone @param {string} iconName @param {unknown} content @param {string} [cls] @returns {Html} */
export function notice(tone, iconName, content, cls = '') {
    return html`<div class="notice notice-${tone}${cls ? ` ${cls}` : ''}">${icon(iconName)}<div class="notice-body">${content}</div></div>`;
}
