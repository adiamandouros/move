// The page's language and strings. The server renders every page in one
// language (English, or Greek under /el) and puts the strings its scripts
// need into a <script id="strings"> element, in that language, so no extra
// request is needed and translations work offline.

export const language = document.documentElement.lang === 'el' ? 'el' : 'en';

const strings = JSON.parse(document.getElementById('strings')?.textContent ?? '{}');

export function t(key) {
    return strings[key] ?? key;
}

// A link to one of the site's pages in this page's language:
// '/subway?to=x' → '/el/subway?to=x' in Greek
export function localHref(href) {
    return language === 'el' ? `/el${href === '/' ? '' : href}` : href;
}

// Fill {name} placeholders: format(t('subway.ride'), { min: 12 })
export function format(text, values) {
    return text.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}
