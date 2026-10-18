// @ts-check
// Helpers for building HTML with template strings, shared by the browser and
// the server (which imports this file from public/js/core/)

// Escape text for safe use inside HTML, as text or in an attribute
/** @param {unknown} text */
export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Fill {name} placeholders: format(t('subway.ride'), { min: 12 })
/** @param {string} text @param {Record<string, unknown>} values @returns {string} */
export function format(text, values) {
    return text.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

// An icon from the sprite (server/pages/icons.js lists them), sized and
// coloured like the text around it: icon('geo-alt', 'me-1'). Icons are
// decoration; the text next to them or the control's label says what they mean.
// In the browser the sprite's URL comes from the page (it carries the asset
// version); the server versions /icons.svg when it renders the page.
const sprite = globalThis.document?.documentElement.dataset.icons ?? '/icons.svg';
/** @param {string} name @param {string} [cls] more classes */
export function icon(name, cls = '') {
    return `<svg class="bi${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="${sprite}#${name}"></use></svg>`;
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
