import { getLanguage } from './settings.js';

// The server puts the page's strings (shell, nav and the current tool's
// strings.json) into a <script id="strings"> element, so no extra request is
// needed and translations work offline.
const strings = JSON.parse(document.getElementById('strings')?.textContent ?? '{}');

export function t(key) {
    const lang = getLanguage();
    return strings[lang]?.[key] ?? strings.en?.[key] ?? key;
}

// Re-apply translations to every [data-i18n] element (and data-i18n-placeholder,
// data-i18n-aria-label, data-i18n-title attributes) and the page title.
// The inline script in layout.html does the same before the first paint.
export function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    for (const attr of ['placeholder', 'aria-label', 'title']) {
        document.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => {
            el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
        });
    }
    const titleKey = document.documentElement.dataset.titleKey;
    if (titleKey) document.title = `${t(titleKey)} — Move`;
    document.querySelectorAll('.lang-opt').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === getLanguage());
    });
}

// Fill {name} placeholders: format(t('subway.ride'), { min: 12 })
export function format(text, values) {
    return text.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}
