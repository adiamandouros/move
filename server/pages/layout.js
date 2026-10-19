import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml, icon } from '../../public/js/core/html.js';
import { adSlot, adsenseMeta } from '../ads.js';
import { importMap, versioned } from './assets.js';
import { LANGS, localPath, otherLang, pageStrings, translate } from './i18n.js';
import { metaTags } from './seo.js';

// The layout every page shares (server/views/layout.html): the head, the
// navigation, the language link and the menu around the page's content.

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');

// Fill a template's {{name}} slots (layout.html, the views, sw.js)
export function fill(template, values) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}

// → render(page): a page as HTML, in the layout and in its language.
// pagePaths: the pages that exist in both languages, for links in the page's
// language (see translate in i18n.js). Page fields:
//   lang         'en' or 'el'
//   path         the page's English path, for the link to it in the other
//                language; pages without one (the admin pages) are English only
//   index        false keeps it out of search results; description is for
//                the pages that are in them
//   title        in the page's language, without " — Wayhop"
//   active       the tool whose navigation entry is highlighted
//   content      the HTML inside <main>
//   strings      the page's own strings ({ en, el }), for data-i18n and its scripts
//   scripts      browser modules to load
//   head         more for <head> (e.g. structured data)
//   ad           where it has an ad slot (server/ads.js)
/**
 * @param {import('../../types/pages.js').Tool[]} tools @param {string[]} pagePaths
 * @returns {(page: import('../../types/pages.js').RenderOptions) => string}
 */
export function createRenderer(tools, pagePaths) {
    const layout = readFileSync(join(VIEWS_DIR, 'layout.html'), 'utf8');
    const imports = importMap(tools);
    const stringsFor = pageStrings(tools);

    return ({ lang = 'en', active = null, title, path = null, index = true, description = '', content, strings: own, scripts = [], head = '', ad = null }) => {
        const strings = stringsFor(lang, own);
        // /js/core/ads.js loads AdSense for the ad slot, and for the privacy
        // page's ad choices button
        const slot = adSlot(ad);
        if (slot || content.includes('id="ad-choices"')) scripts = [...scripts, '/js/core/ads.js'];
        const fullTitle = `${title} — Wayhop`;
        const html = translate(fill(layout, {
            lang,
            // For icon() in the browser (public/js/core/html.js)
            icons: versioned('/icons.svg'),
            otherLanguage: otherLanguage(lang, path),
            languageRedirect: path ? LANGUAGE_REDIRECT : '',
            title: escapeHtml(fullTitle),
            // The installed app opens in the language it was installed in
            manifest: localPath('/manifest.webmanifest', lang),
            meta: [metaTags({ path, index, lang, title: fullTitle, description }), adsenseMeta()].filter(Boolean).join('\n'),
            head,
            importMap: imports,
            sideNav: navLinks(tools, active, 'side'),
            sideLanguage: languageLink(lang, path, 'side'),
            sideLinks: siteLinks('side'),
            languageSuggestion: languageSuggestion(lang, path, stringsFor(otherLang(lang))),
            bottomNav: [homeLink(active), navLinks(tools, active, 'bottom'), MENU_BUTTON].join('\n'),
            siteMenu: siteMenu(lang, path),
            content,
            ad: slot,
            // The page's strings, for its scripts (/js/core/i18n.js). Escape
            // "<" so the JSON can't close the surrounding <script> element.
            strings: JSON.stringify(strings).replace(/</g, '\\u003c'),
            scripts: scripts.map(src => `    <script type="module" src="${versioned(src)}"></script>`).join('\n'),
        }), lang, key => strings[key], pagePaths);
        // Links to stylesheets, scripts and icons, in the layout and the page,
        // at this deploy's version (assets.js)
        return html.replace(/(href|src)="(\/[^"]+)"/g, (_, name, url) => `${name}="${versioned(url)}"`);
    };
}

// The bottom navigation (phones) starts with the home page, shown with the
// Wayhop logo; on wider screens the logo in the sidebar links home
function homeLink(active) {
    const current = active === 'home';
    return `        <a href="/" class="nav-btn btn d-flex flex-column align-items-center py-2${current ? ' active" aria-current="page' : ''}"><img src="/icon/logo.svg" alt="" width="33" height="24" class="nav-logo fs-4"><span class="nav-label" data-i18n="nav.home">Home</span></a>`;
}

function navLinks(tools, active, variant) {
    return tools.map(tool => {
        const current = tool.id === active;
        const attrs = `href="${tool.path}" class="nav-btn btn ${variant === 'side'
            ? 'd-flex align-items-center gap-3 px-3 py-3 mb-1'
            : 'd-flex flex-column align-items-center py-2'}${current ? ' active' : ''}"${current ? ' aria-current="page"' : ''}`;
        return variant === 'side'
            ? `                <a ${attrs}>${icon(tool.icon, 'fs-5')}<span data-i18n="tool.${tool.id}.title">${tool.title.en}</span></a>`
            : `        <a ${attrs}>${icon(tool.icon, 'fs-4')}<span class="nav-label" data-i18n="tool.${tool.id}.short">${(tool.shortTitle ?? tool.title).en}</span></a>`;
    }).join('\n');
}

// ── Site menu ───────────────────────────────────────────────────────────────

// The pages about the site: on phones in the menu, on wider screens at the
// bottom of the sidebar
const SITE_PAGES = [['about', 'About', 'info-circle'], ['privacy', 'Privacy', 'lock'], ['contact', 'Contact', 'envelope']];

function siteLinks(variant) {
    if (variant === 'side') {
        return `                    <div class="side-links">
${SITE_PAGES.map(([name, title]) => `                        <a href="/${name}" data-i18n="menu.${name}">${title}</a>`).join('\n')}
                    </div>`;
    }
    return SITE_PAGES.map(([name, title, iconName]) =>
        `            <a href="/${name}" class="site-menu-link">${icon(iconName)}<span data-i18n="menu.${name}">${title}</span></a>`).join('\n');
}

// On phones, the last button in the bottom bar (by the right thumb) opens the
// menu: a popover, so the browser opens and closes it (Esc, a tap outside)
// and moves the keyboard into it and back without a script. Closed until then.
// Only the icon shows, filling the button; screen readers hear its name.
const MENU_BUTTON = `        <button type="button" class="nav-btn menu-btn btn d-flex flex-column align-items-center py-2" popovertarget="site-menu" aria-label="Menu" data-i18n-aria-label="nav.menu">${icon('list', 'fs-4')}</button>`;

function siteMenu(lang, path) {
    return `    <nav id="site-menu" class="site-menu d-md-none" popover aria-label="Menu" data-i18n-aria-label="nav.menu">
${languageLink(lang, path, 'menu')}
${siteLinks('menu')}
    </nav>`;
}

// ── Language link ───────────────────────────────────────────────────────────

// The language link: this page in the other language. Each name is written in
// its own language, as is usual for language links. In the sidebar on wider
// screens, first in the menu on phones.
const LANGUAGE_NAMES = { en: 'English', el: 'Ελληνικά' };
const LANGUAGE_LABELS = { en: 'EN', el: 'ΕΛ' };

function languageLink(lang, path, variant) {
    if (!path) return '';
    const other = otherLang(lang);
    if (variant === 'menu') {
        return `            <a href="${escapeHtml(localPath(path, other))}" hreflang="${other}" lang="${other}" class="site-menu-link menu-language">${icon('globe')}<span>${LANGUAGE_NAMES[other]}</span></a>`;
    }
    const [indent, cls, size] = ['                    ', 'lang-toggle-btn btn d-flex align-items-center gap-3 px-3 py-2 w-100', 5];
    const options = LANGS.map(l => `<span class="lang-opt${l === lang ? ' active' : ''}">${LANGUAGE_LABELS[l]}</span>`).join('<span class="lang-sep">/</span>');
    return `${indent}<a href="${escapeHtml(localPath(path, other))}" hreflang="${other}" class="${cls}">
${indent}    ${icon('globe', `fs-${size}`)}
${indent}    <span class="sr-only" lang="${other}">${LANGUAGE_NAMES[other]}</span>
${indent}    <span class="lang-options" aria-hidden="true">${options}</span>
${indent}</a>`;
}

// Offered once (by /js/core/shell.js) to someone whose browser prefers the
// other language and hasn't chosen one: written in that language
function languageSuggestion(lang, path, otherStrings) {
    if (!path) return '';
    const other = otherLang(lang);
    return `            <div class="lang-suggest" lang="${other}" hidden>
                <a href="${escapeHtml(localPath(path, other))}" hreflang="${other}">${escapeHtml(otherStrings['language.suggest'])}</a>
                <button type="button" class="lang-suggest-close" aria-label="${escapeHtml(otherStrings['language.close'])}">${icon('x-lg')}</button>
            </div>`;
}

// Someone who chose the other language with the language link (remembered in
// localStorage by /js/core/shell.js) gets this page in it, before it shows.
// The script is the same on every page, so the Content-Security-Policy can
// allow it by one hash (server/csp.js); <html> says which page is the other
// language's (otherLanguage).
export const LANGUAGE_REDIRECT = `    <script>
        try { var root = document.documentElement; if (localStorage.getItem('language') === root.dataset.otherLang) location.replace(root.dataset.otherPath + location.search + location.hash); } catch (e) {}
    </script>`;
const otherLanguage = (lang, path) => path
    ? ` data-other-lang="${otherLang(lang)}" data-other-path="${escapeHtml(localPath(path, otherLang(lang)))}"`
    : '';
