import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { adSlot, adsenseClient, adsenseMeta, adsTxt } from './ads.js';
import { createStationPages, STATIONS_PATH } from './stations.js';

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWS_DIR  = join(ROOT, 'server', 'views');
const TOOLS_DIR  = join(ROOT, 'tools');
const PUBLIC_DIR = join(ROOT, 'public');

// Pages of text (server/views/pages/<name>.<lang>.html), one file per language
const TEXT_PAGES = ['about', 'privacy', 'contact'];
// When privacy.<lang>.html last changed in substance (shown on the page)
const PRIVACY_UPDATED = { en: '16 October 2026', el: '16 Οκτωβρίου 2026' };

// Keep the page's <!-- with ads --> or <!-- without ads --> parts (privacy.<lang>.html)
const adsVariant = (html, ads) => html.replace(/<!-- (with|without) ads -->\n([\s\S]*?)<!-- \/\1 ads -->\n/g,
    (_, which, part) => (which === 'with') === ads ? part : '');

const require = createRequire(import.meta.url);
const packageDir = name => dirname(require.resolve(`${name}/package.json`));

// Third-party files served from node_modules, so nothing loads from a CDN
export const VENDOR = {
    '/vendor/bootstrap':       join(packageDir('bootstrap'), 'dist'),
    '/vendor/bootstrap-icons': join(packageDir('bootstrap-icons'), 'font'),
};

// Files every page needs, cached by the service worker on install
const SHELL_FILES = [
    '/vendor/bootstrap/css/bootstrap.min.css',
    '/vendor/bootstrap/js/bootstrap.bundle.min.js',
    '/vendor/bootstrap-icons/bootstrap-icons.min.css',
    '/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
];
const SHELL_DIRS = ['css', 'icon', join('js', 'core')];

// ── Asset versions ──────────────────────────────────────────────────────────

// Stylesheets and scripts are linked as <url>?v=<hash of every asset file>, so
// each deploy gives them new URLs. The live server's LiteSpeed serves public/
// with a 7-day cache, so without this browsers kept old stylesheets and
// scripts after a deploy (and so did the service worker, which fills its cache
// through the browser's), mixing them with new pages.
let version = null;
export function assetVersion() {
    if (version) return version;
    const hash = createHash('sha256');
    const toolFiles = listFiles(TOOLS_DIR).filter(f => f.includes(`${sep}client${sep}`));
    for (const file of [...shellFiles(), ...toolFiles]) hash.update(readFileSync(file));
    for (const dir of Object.values(VENDOR)) hash.update(readFileSync(join(dir, '..', 'package.json')));
    version = hash.digest('hex').slice(0, 10);
    return version;
}

const VERSIONED = /^\/(css|js|tools|vendor)\/.+\.(css|js)$/;
export const versioned = url => VERSIONED.test(url) ? `${url}?v=${assetVersion()}` : url;

// Every page script, mapped to its versioned URL, so that their imports
// (import … from '/js/core/i18n.js', './map.js') load the same version
function importMap(tools) {
    const modules = [
        ...listFiles(join(PUBLIC_DIR, 'js', 'core')).map(f => urlPath('', PUBLIC_DIR, f)),
        ...tools.flatMap(t => listFiles(t.clientDir).map(f => urlPath(`/tools/${t.id}`, t.clientDir, f))),
    ].filter(url => url.endsWith('.js'));
    const map = { imports: Object.fromEntries(modules.map(url => [url, versioned(url)])) };
    return `    <script type="importmap">${JSON.stringify(map)}</script>`;
}

// ── Tools ───────────────────────────────────────────────────────────────────

// Read every tools/<id>/ folder. See tools/README.md for the format.
export function loadTools(dir = TOOLS_DIR) {
    return readdirSync(dir)
        .filter(id => existsSync(join(dir, id, 'tool.json')))
        .map(id => {
            const toolDir = join(dir, id);
            const config = JSON.parse(readFileSync(join(toolDir, 'tool.json'), 'utf8'));
            for (const field of ['path', 'icon', 'title']) {
                if (!config[field]) throw new Error(`tools/${id}/tool.json is missing "${field}"`);
            }
            return {
                id,
                order: 0,
                offline: false,
                scripts: [],
                precache: [],
                ...config,
                page: readFileSync(join(toolDir, 'page.html'), 'utf8'),
                strings: existsSync(join(toolDir, 'strings.json')) ? JSON.parse(readFileSync(join(toolDir, 'strings.json'), 'utf8')) : {},
                clientDir: join(toolDir, 'client'),
            };
        })
        .sort((a, b) => a.order - b.order);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function fill(template, values) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}

const escapeAttr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Languages ───────────────────────────────────────────────────────────────

// English pages are at their plain paths, Greek ones under /el
export const LANGS = ['en', 'el'];
export const langOf = path => /^\/el(\/|$)/.test(path) ? 'el' : 'en';
export const basePath = path => path.replace(/^\/el(?=\/|$)/, '') || '/';
export const localPath = (path, lang) => lang === 'el' ? (path === '/' ? '/el' : `/el${path}`) : path;

const otherLang = lang => lang === 'el' ? 'en' : 'el';

// Links to one of the pages (with any ?query or #hash) point at that page in
// the given language
function localHref(href, lang, pagePaths) {
    const [, path, rest] = href.match(/^(\/[^?#]*)(.*)$/) ?? [];
    if (!path || !isPage(basePath(path), pagePaths)) return href;
    return localPath(basePath(path), lang) + rest;
}

// Whether a path is one of the pages; "/a/*" in the list stands for every path under /a/
export const isPage = (path, pagePaths) =>
    pagePaths.some(p => p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) : p === path);

// The page in its language. Every page is written in English and put into
// its language here, on the server (browsers get it ready to show):
//   - an element with data-i18n="key" gets that string as its text, and
//     data-i18n-<attribute>="key" sets that attribute
//   - text written in both languages, as data-lang="en" and data-lang="el"
//     elements, keeps only the page's language
//   - in Greek, links to the pages point at the Greek ones (except links
//     that name their language with hreflang, like the language link)
function translate(html, lang, get, pagePaths) {
    html = keepLanguage(html, lang)
        .replace(/(<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g, (match, open, _tag, key, text, close) => {
            if (!get(key)) return match;
            // Keep the spaces around the text, e.g. before "(opens in a new tab)"
            const [, before, after] = text.match(/^(\s*)[\s\S]*?(\s*)$/);
            return open + before + escapeText(get(key)) + after + close;
        })
        .replace(/<[a-z][^>]*>/g, tag => {
            for (const [, name, key] of tag.matchAll(/\sdata-i18n-([a-z-]+)="([^"]+)"/g)) {
                if (get(key)) tag = tag.replace(new RegExp(`(\\s${name}=")[^"]*"`), `$1${escapeAttr(get(key))}"`);
            }
            return tag;
        });
    if (lang === 'en') return html;
    return html.replace(/<a\b[^>]*>/g, tag => /\shreflang="/.test(tag) ? tag
        : tag.replace(/(\shref=")(\/[^"]*)"/, (_, open, href) => `${open}${localHref(href, lang, pagePaths)}"`));
}

// Remove each data-lang element of the other language, with everything in it,
// and the data-lang attribute of the ones that stay
function keepLanguage(html, lang) {
    const opening = /<(\w+)\b[^>]*\sdata-lang="(\w+)"[^>]*>/g;
    let out = '';
    let from = 0;
    for (let m; (m = opening.exec(html));) {
        const [tag, name, only] = m;
        out += html.slice(from, m.index);
        if (only === lang) {
            out += tag.replace(/\sdata-lang="\w+"/, '');
            from = m.index + tag.length;
        } else {
            from = elementEnd(html, name, m.index + tag.length);
            opening.lastIndex = from;
            // An element on a line of its own takes the line with it
            if (/\n[ \t]*$/.test(out) && html[from] === '\n') {
                out = out.replace(/[ \t]*$/, '');
                from++;
            }
        }
    }
    return out + html.slice(from);
}

// Where the <name> element whose content starts at `start` ends (after its closing tag)
function elementEnd(html, name, start) {
    const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g');
    tags.lastIndex = start;
    let depth = 1;
    for (let m; (m = tags.exec(html));) {
        depth += m[1] ? -1 : 1;
        if (!depth) return m.index + m[0].length;
    }
    throw new Error(`<${name} data-lang> is never closed`);
}

// The language link: this page in the other language. Each name is written in
// its own language, as is usual for language links.
const LANGUAGE_NAMES = { en: 'English', el: 'Ελληνικά' };
const LANGUAGE_LABELS = { en: 'EN', el: 'ΕΛ' };

function languageLink(lang, path, variant) {
    if (!path) return '';
    const other = otherLang(lang);
    const [indent, cls, size] = variant === 'side'
        ? ['                    ', 'lang-toggle-btn btn d-flex align-items-center gap-3 px-3 py-2 w-100', 5]
        : ['        ', 'nav-btn lang-toggle-btn btn d-flex flex-column align-items-center py-2', 4];
    const options = LANGS.map(l => `<span class="lang-opt${l === lang ? ' active' : ''}">${LANGUAGE_LABELS[l]}</span>`).join('<span class="lang-sep">/</span>');
    return `${indent}<a href="${escapeAttr(localPath(path, other))}" hreflang="${other}" class="${cls}">
${indent}    <i class="bi bi-globe fs-${size}" aria-hidden="true"></i>
${indent}    <span class="sr-only" lang="${other}">${LANGUAGE_NAMES[other]}</span>
${indent}    <span class="lang-options" aria-hidden="true">${options}</span>
${indent}</a>`;
}

// Someone who chose the other language with the language link (remembered in
// localStorage by /js/core/shell.js) gets this page in it, before it shows
function languageRedirect(lang, path) {
    if (!path) return '';
    const other = otherLang(lang);
    const target = JSON.stringify(localPath(path, other)).replace(/</g, '\\u003c');
    return `    <script>
        try { if (localStorage.getItem('language') === '${other}') location.replace(${target} + location.search + location.hash); } catch (e) {}
    </script>`;
}

// The public origin (e.g. https://move.gr), for canonical URLs, the sitemap
// and link previews. Without SITE_URL the pages leave out what needs it.
export const siteUrl = () => (process.env.SITE_URL ?? '').replace(/\/+$/, '');

const LOCALES = { en: 'en_US', el: 'el_GR' };

// Search and link-preview tags. Pages that aren't indexed (the 404, /offline,
// the admin pages) are kept out of search results. path is the English one.
function metaTags({ path, index, lang, title, description }) {
    if (!path || !index) return '    <meta name="robots" content="noindex">';
    const origin = siteUrl();
    const url = origin && origin + localPath(path, lang);
    // The same page in each language; English is the default for everyone else
    const alternates = origin ? [
        ...LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${origin}${localPath(path, l)}">`),
        `<link rel="alternate" hreflang="x-default" href="${origin}${path}">`,
    ] : [];
    return [
        `<meta name="description" content="${escapeAttr(description)}">`,
        url && `<link rel="canonical" href="${url}">`,
        ...alternates,
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Wayhop">',
        `<meta property="og:locale" content="${LOCALES[lang]}">`,
        ...LANGS.filter(l => l !== lang).map(l => `<meta property="og:locale:alternate" content="${LOCALES[l]}">`),
        `<meta property="og:title" content="${escapeAttr(title)}">`,
        `<meta property="og:description" content="${escapeAttr(description)}">`,
        url && `<meta property="og:url" content="${url}">`,
        origin && `<meta property="og:image" content="${origin}/icon/og-image.png">`,
        origin && '<meta property="og:image:width" content="1200">',
        origin && '<meta property="og:image:height" content="630">',
        origin && '<meta property="og:image:alt" content="Wayhop: live buses and metro in Athens">',
        '<meta name="twitter:card" content="summary_large_image">',
    ].filter(Boolean).map(tag => `    ${tag}`).join('\n');
}

// Structured data for the home page, so search results can show Wayhop as a free web app
function appData(description, lang) {
    const data = {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Wayhop',
        description,
        ...(siteUrl() && { url: siteUrl() + localPath('/', lang) }),
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Any',
        inLanguage: ['en', 'el'],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    };
    return `    <script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function navLinks(tools, active, variant) {
    return tools.map(tool => {
        const current = tool.id === active;
        const attrs = `href="${tool.path}" class="nav-btn btn ${variant === 'side'
            ? 'd-flex align-items-center gap-3 px-3 py-3 mb-1'
            : 'd-flex flex-column align-items-center py-2'}${current ? ' active' : ''}"${current ? ' aria-current="page"' : ''}`;
        return variant === 'side'
            ? `                <a ${attrs}><i class="bi bi-${tool.icon} fs-5" aria-hidden="true"></i><span data-i18n="tool.${tool.id}.title">${tool.title.en}</span></a>`
            : `        <a ${attrs}><i class="bi bi-${tool.icon} fs-4" aria-hidden="true"></i><span class="nav-label" data-i18n="tool.${tool.id}.short">${(tool.shortTitle ?? tool.title).en}</span></a>`;
    }).join('\n');
}

function tiles(tools) {
    return tools.map(tool => `        <a href="${tool.path}" class="tool-tile">
            <i class="bi bi-${tool.icon}" aria-hidden="true"></i>
            <span class="tool-tile-title" data-i18n="tool.${tool.id}.title">${tool.title.en}</span>
            <span class="tool-tile-desc" data-i18n="tool.${tool.id}.description">${tool.description?.en ?? ''}</span>
        </a>`).join('\n');
}

// Strings for one page in one language: the shell's, every tool's name (for
// the nav) and the page's own, with English for any that aren't translated
function pageStrings(shellStrings, tools, own = {}, lang) {
    const strings = l => {
        const out = { ...shellStrings[l], ...own[l] };
        for (const tool of tools) {
            out[`tool.${tool.id}.title`] = tool.title[l];
            out[`tool.${tool.id}.short`] = (tool.shortTitle ?? tool.title)[l];
            if (tool.description) out[`tool.${tool.id}.description`] = tool.description[l];
        }
        return out;
    };
    const translated = Object.entries(strings(lang)).filter(([, text]) => text !== undefined);
    return { ...strings('en'), ...Object.fromEntries(translated) };
}

// Every page as HTML, by path (exported for test/accessibility.test.js)
export function renderPages(tools = loadTools()) {
    const layout = readFileSync(join(VIEWS_DIR, 'layout.html'), 'utf8')
        .replace(/(href|src)="(\/[^"]+)"/g, (_, name, url) => `${name}="${versioned(url)}"`);
    const imports = importMap(tools);
    const view = name => readFileSync(join(VIEWS_DIR, `${name}.html`), 'utf8');
    const shellStrings = JSON.parse(readFileSync(join(VIEWS_DIR, 'strings.json'), 'utf8'));
    // Paths of the pages that exist in both languages (English ones)
    const pagePaths = ['/', '/offline', ...tools.map(t => t.path), ...TEXT_PAGES.map(name => `/${name}`), STATIONS_PATH, `${STATIONS_PATH}/*`];

    // Every page is rendered in one language (lang). path: its English path,
    // for the link to it in the other language; pages without one (the
    // admin pages) are English only. index: false keeps it out of search
    // results; description is for those that are in them. title is in the
    // page's language.
    const render = ({ lang = 'en', active = null, title, path = null, index = true, description = '', content, own, scripts = [], head = '', ad = null }) => {
        const strings = pageStrings(shellStrings, tools, own, lang);
        // ad: where this page has an ad slot (server/ads.js); /js/core/ads.js
        // loads AdSense for it, and for the privacy page's ad choices button
        const slot = adSlot(ad);
        if (slot || content.includes('id="ad-choices"')) scripts = [...scripts, '/js/core/ads.js'];
        const get = key => strings[key];
        const fullTitle = `${title} — Wayhop`;
        return translate(fill(layout, {
            lang,
            languageRedirect: languageRedirect(lang, path),
            title: escapeText(fullTitle),
            meta: [metaTags({ path, index, lang, title: fullTitle, description }), adsenseMeta()].filter(Boolean).join('\n'),
            head,
            importMap: imports,
            sideNav: navLinks(tools, active, 'side'),
            sideLanguage: languageLink(lang, path, 'side'),
            bottomLanguage: languageLink(lang, path, 'bottom'),
            bottomNav: navLinks(tools, active, 'bottom'),
            content,
            ad: slot,
            // The page's strings, for its scripts (/js/core/i18n.js). Escape
            // "<" so the JSON can't close the surrounding <script> element.
            strings: JSON.stringify(strings).replace(/</g, '\\u003c'),
            scripts: scripts.map(src => `    <script type="module" src="${versioned(src)}"></script>`).join('\n'),
        }), lang, get, pagePaths);
    };

    const pages = {};
    for (const lang of LANGS) {
        const description = shellStrings[lang]['home.description'];
        pages[localPath('/', lang)] = render({
            lang,
            title: shellStrings[lang]['home.page-title'],
            path: '/',
            description,
            head: appData(description, lang),
            content: view('home'),
            scripts: ['/js/core/announcements.js'],
            ad: 'home',
        });
        pages[localPath('/offline', lang)] = render({
            lang,
            title: shellStrings[lang]['offline.title'],
            path: '/offline',
            index: false,
            content: fill(view('offline'), { tiles: tiles(tools.filter(t => t.offline)) }),
        });
        for (const tool of tools) {
            pages[localPath(tool.path, lang)] = render({
                lang,
                active: tool.id,
                title: tool.title[lang],
                path: tool.path,
                description: tool.description?.[lang] ?? '',
                content: tool.page,
                own: tool.strings,
                ad: tool.ad,
                scripts: tool.scripts.map(s => `/tools/${tool.id}/${s}`),
            });
        }
    }
    for (const lang of LANGS) {
        for (const name of TEXT_PAGES) {
            pages[localPath(`/${name}`, lang)] = render({
                lang,
                title: shellStrings[lang][`${name}.title`],
                path: `/${name}`,
                // The privacy page has its own description once it describes ads
                description: shellStrings[lang][`${name}.description${name === 'privacy' && adsenseClient() ? '-ads' : ''}`],
                content: fill(adsVariant(view(`pages/${name}.${lang}`), Boolean(adsenseClient())), { updated: PRIVACY_UPDATED[lang], email: contactEmail(shellStrings[lang]), adClient: adsenseClient() ?? '' }),
            });
        }
    }
    // The 404 page for a path, in its language, with the language link to the same path
    const notFound = path => {
        const lang = langOf(path);
        return render({ lang, title: shellStrings[lang]['notfound.title'], path: basePath(path), index: false, content: view('notfound') });
    };
    // The pages search engines should find (English paths), for the sitemap
    const indexed = ['/', ...tools.map(t => t.path), ...TEXT_PAGES.map(name => `/${name}`)];
    return { pages, indexed, notFound, render };
}

// The contact page's email line: CONTACT_EMAIL (the address OASA also sees),
// or nothing when it isn't set
function contactEmail(strings) {
    const email = process.env.CONTACT_EMAIL;
    if (!email) return '';
    return `    <p class="contact-email"><i class="bi bi-envelope me-2" aria-hidden="true"></i>${strings['contact.email']} <a href="mailto:${escapeAttr(email)}">${escapeText(email)}</a></p>`;
}

// ── robots.txt and sitemap ──────────────────────────────────────────────────

export function robotsTxt(origin) {
    return `User-agent: *\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
}

// Every indexed page in each language, each listing all its languages
export function sitemapXml(origin, paths) {
    const alternates = path => [...LANGS.map(lang => [lang, localPath(path, lang)]), ['x-default', path]]
        .map(([lang, p]) => `        <xhtml:link rel="alternate" hreflang="${lang}" href="${origin}${p}"/>`).join('\n');
    const urls = paths.flatMap(path => LANGS.map(lang =>
        `    <url>\n        <loc>${origin}${localPath(path, lang)}</loc>\n${alternates(path)}\n    </url>`)).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

// ── Service worker ──────────────────────────────────────────────────────────

export function listFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

export const urlPath = (base, dir, file) => `${base}/${relative(dir, file).split(sep).join('/')}`;

// URLs of the files every page needs (stylesheets, core scripts, icons)
export function shellUrls() {
    return [
        ...SHELL_FILES,
        ...SHELL_DIRS.flatMap(d => listFiles(join(PUBLIC_DIR, d)).map(f => urlPath('', PUBLIC_DIR, f))),
    ].map(versioned);
}

// Contents of those files, for computing cache versions
export function shellFiles() {
    return SHELL_DIRS.flatMap(d => listFiles(join(PUBLIC_DIR, d)));
}

function renderServiceWorker(tools, pages) {
    const offlineTools = tools.filter(t => t.offline);
    // Pages in every language, so the Greek ones work offline too
    const inLangs = path => LANGS.map(lang => localPath(path, lang));
    const precache = [
        ...inLangs('/'), ...inLangs('/offline'),
        ...shellUrls(),
        ...offlineTools.flatMap(t => [
            ...inLangs(t.path),
            ...listFiles(t.clientDir).map(f => versioned(urlPath(`/tools/${t.id}`, t.clientDir, f))),
        ]),
    ];
    const precacheData = offlineTools.flatMap(t => t.precache);

    // The version changes whenever any page or cached file changes
    const hash = createHash('sha256');
    for (const html of Object.values(pages)) hash.update(html);
    for (const file of [
        ...shellFiles(),
        ...tools.flatMap(t => listFiles(t.clientDir)),
        join(VIEWS_DIR, 'sw.js'),
    ]) hash.update(readFileSync(file));
    for (const dir of Object.values(VENDOR)) hash.update(readFileSync(join(dir, '..', 'package.json')));

    return fill(readFileSync(join(VIEWS_DIR, 'sw.js'), 'utf8'), {
        version: hash.digest('hex').slice(0, 12),
        precache: JSON.stringify(precache, null, 4),
        precacheData: JSON.stringify(precacheData, null, 4),
        offlinePages: JSON.stringify(offlineTools.flatMap(t => inLangs(t.path))),
    });
}

// ── Router ──────────────────────────────────────────────────────────────────

// Pages, tool client files and the service worker. Everything is rendered once
// at startup; `node --watch` restarts the server when these files change.
export function createPages(tools = loadTools(), { railFile } = {}) {
    const { pages, indexed, notFound, render } = renderPages(tools);
    const serviceWorker = renderServiceWorker(tools, pages);
    const router = express.Router();
    // The station pages, built from rail.json (when there is one)
    const stations = railFile ? createStationPages({ railFile, render, tools }) : null;
    // SITE_URL if set, so search engines only ever see the public address
    const origin = req => siteUrl() || `${req.protocol}://${req.get('host')}`;

    router.get('/sw.js', (_req, res) => {
        res.set('Cache-Control', 'no-cache').type('js').send(serviceWorker);
    });

    router.get('/robots.txt', (req, res) => {
        res.set('Cache-Control', 'no-cache').type('text').send(robotsTxt(origin(req)));
    });

    // Which ad networks may sell this site's ad space (only once AdSense is set up)
    router.get('/ads.txt', (_req, res, next) => adsTxt() ? res.set('Cache-Control', 'no-cache').type('text').send(adsTxt()) : next());

    router.get('/sitemap.xml', (req, res) => {
        res.set('Cache-Control', 'no-cache').type('xml').send(sitemapXml(origin(req), [...indexed, ...(stations?.paths() ?? [])]));
    });

    for (const [path, html] of Object.entries(pages)) {
        router.get(path, (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(html));
    }

    if (stations) router.use(stations.router);

    for (const tool of tools) router.use(`/tools/${tool.id}`, express.static(tool.clientDir));

    return {
        router,
        // Render any other page (e.g. the admin pages) with the shared layout
        render,
        notFound: (req, res) => res.status(404).type('html').send(notFound(req.path)),
    };
}
