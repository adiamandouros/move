import { html } from '../../public/js/core/html.js';
import { adUnit } from '../ads.js';
import { importMap, versioned } from './assets.js';
import { LANGS, localiseLinks, localPath, otherLang, pageStrings } from './i18n.js';
import { pageMeta } from './seo.js';
import { view } from './templates.js';

// The layout every page shares (server/views/layout.hbs): the head, the
// navigation, the language link and the menu around the page's content.

// The pages about the site: on phones in the menu, on wider screens near the
// bottom of the sidebar, above the language button
const SITE_PAGES = [{ name: 'about', iconName: 'info-circle' }, { name: 'privacy', iconName: 'lock' }, { name: 'contact', iconName: 'envelope' }];

// Each language's name in its own language, as is usual for language links
const LANGUAGE_NAMES = { en: 'English', el: 'Ελληνικά' };
const LANGUAGE_LABELS = { en: 'EN', el: 'ΕΛ' };

// → render(page): a page as HTML, in the layout and in its language.
// pagePaths: the pages that exist in both languages, for links in the page's
// language (see localiseLinks in i18n.js). Page fields:
//   lang         'en' or 'el'
//   path         the page's English path, for the link to it in the other
//                language; pages without one (the admin pages) are English only
//   index        false keeps it out of search results; description is for
//                the pages that are in them
//   title        in the page's language, without " — Wayhop"
//   active       the tool whose navigation entry is highlighted
//   content      the HTML inside <main> (a string, or built with html``)
//   strings      the page's own strings ({ en, el }), for its view and its scripts
//   scripts      browser modules to load
//   structuredData  schema.org data for <head> (seo.js), or null
//   styles       more stylesheets (the admin pages')
//   ad           where it has an ad slot (server/ads.js)
/**
 * @param {import('../../types/pages.js').Tool[]} tools @param {string[]} pagePaths
 * @param {import('../../types/config.js').Config} config the public address and AdSense
 * @returns {(page: import('../../types/pages.js').RenderOptions) => string}
 */
export function createRenderer(tools, pagePaths, config) {
    const layout = view('server/views/layout.hbs');
    const imports = importMap(tools);
    const stringsFor = pageStrings(tools);

    return ({ lang = 'en', active = null, title, path = null, index = true, description = '', content: view, strings: own, scripts = [], structuredData = null, styles = [], ad = null }) => {
        // Built with html`` (the station pages) or by a view
        const content = String(view);
        const strings = stringsFor(lang, own);
        const unit = adUnit(config.adsense, ad);
        // /js/core/ads.js loads AdSense for the ad slot, and for the privacy
        // page's ad choices button
        if (unit || content.includes('id="ad-choices"')) scripts = [...scripts, '/js/core/ads.js'];
        const other = path ? otherLang(lang) : null;
        const page = layout({
            lang,
            // For icon() in the browser (public/js/core/html.js); built with
            // html``, so Handlebars keeps the = of its ?v= as it is
            icons: html`${versioned('/icons.svg')}`,
            // This page in the other language
            other: other && { lang: other, path: localPath(path, other), name: LANGUAGE_NAMES[other] },
            languages: LANGS.map(l => ({ label: LANGUAGE_LABELS[l], active: l === lang })),
            suggestion: other && { text: stringsFor(other)['language.suggest'], close: stringsFor(other)['language.close'] },
            title,
            // The installed app opens in the language it was installed in
            manifest: localPath('/manifest.webmanifest', lang),
            seo: pageMeta({ path, index, lang, title: `${title} — Wayhop`, description, origin: config.siteUrl }),
            adsenseClient: config.adsense.client ?? null,
            structuredData,
            styles,
            importMap: imports,
            home: active === 'home',
            tools: tools.map(tool => ({
                path: tool.path, iconName: tool.icon, active: tool.id === active,
                titleKey: `tool.${tool.id}.title`, shortKey: `tool.${tool.id}.short`,
            })),
            siteLinks: SITE_PAGES.map(({ name, iconName }) => ({ href: `/${name}`, iconName, textKey: `menu.${name}` })),
            content,
            ad: unit,
            // The page's strings, for its scripts (/js/core/i18n.js)
            strings,
            // (versioned with the other links below)
            scripts,
        }, { lang, strings });
        // Links to stylesheets, scripts and icons, in the layout and the page,
        // at this deploy's version (assets.js); links to the pages in the page's language
        return localiseLinks(page, lang, pagePaths).replace(/(href|src)="(\/[^"]+)"/g, (_, name, url) => `${name}="${versioned(url)}"`);
    };
}
