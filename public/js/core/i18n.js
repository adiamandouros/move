import { getLanguage } from './settings.js';

// The server puts the page's strings (shell, nav and the current tool's
// strings.json) into a <script id="strings"> element, so no extra request is
// needed and translations work offline.
const strings = JSON.parse(document.getElementById('strings')?.textContent ?? '{}');
// Paths of the pages that exist in both languages
const pages = JSON.parse(document.getElementById('pages')?.textContent ?? '[]');

// A link to one of the pages (with any ?query or #hash) in the current
// language: '/subway?to=x' → '/el/subway?to=x' in Greek. Other links are kept.
export function localHref(href) {
    const [, path, rest] = href.match(/^(\/[^?#]*)(.*)$/) ?? [];
    const base = path?.replace(/^\/el(?=\/|$)/, '') || '/';
    if (!path || !pages.includes(base)) return href;
    return (getLanguage() === 'el' ? (base === '/' ? '/el' : `/el${base}`) : base) + rest;
}

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
    document.querySelectorAll('a[href^="/"]').forEach(a => a.setAttribute('href', localHref(a.getAttribute('href'))));
    history.replaceState(history.state, '', localHref(location.pathname) + location.search + location.hash);
}

// Fill {name} placeholders: format(t('subway.ride'), { min: 12 })
export function format(text, values) {
    return text.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}
