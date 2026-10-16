import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWS_DIR  = join(ROOT, 'server', 'views');
const TOOLS_DIR  = join(ROOT, 'tools');
const PUBLIC_DIR = join(ROOT, 'public');

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

// Links to one of the pages (with any ?query or #hash) point at that page in
// the given language. Mirrors localHref in /js/core/i18n.js.
function localHref(href, lang, pagePaths) {
    const [, path, rest] = href.match(/^(\/[^?#]*)(.*)$/) ?? [];
    if (!path || !pagePaths.includes(basePath(path))) return href;
    return localPath(basePath(path), lang) + rest;
}

// The page in one language, as the inline script in layout.html would show it:
// each data-i18n element's text, data-i18n-<attribute> attributes, and links
function translate(html, lang, get, pagePaths) {
    if (lang === 'en') return html;
    return html
        .replace(/(<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g,
            (match, open, _tag, key, close) => get(key) ? open + escapeText(get(key)) + close : match)
        .replace(/<[a-z][^>]*>/g, tag => {
            for (const [, name, key] of tag.matchAll(/\sdata-i18n-([a-z-]+)="([^"]+)"/g)) {
                if (get(key)) tag = tag.replace(new RegExp(`(\\s${name}=")[^"]*"`), `$1${escapeAttr(get(key))}"`);
            }
            return tag;
        })
        .replace(/(<a\b[^>]*\shref=")(\/[^"]*)"/g, (_, open, href) => `${open}${localHref(href, lang, pagePaths)}"`);
}

// The public origin (e.g. https://move.gr), for canonical URLs, the sitemap
// and link previews. Without SITE_URL the pages leave out what needs it.
export const siteUrl = () => (process.env.SITE_URL ?? '').replace(/\/+$/, '');

const LOCALES = { en: 'en_US', el: 'el_GR' };

// Search and link-preview tags. Pages without a path (the 404, /offline, the
// admin pages) are kept out of search results. path is the English one.
function metaTags({ path, lang, title, description }) {
    if (!path) return '    <meta name="robots" content="noindex">';
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

// Strings for one page: the shell's, every tool's name (for the nav) and the page's own.
function pageStrings(shellStrings, tools, own = {}) {
    const out = {};
    for (const lang of ['en', 'el']) {
        out[lang] = { ...shellStrings[lang], ...own[lang] };
        for (const tool of tools) {
            out[lang][`tool.${tool.id}.title`] = tool.title[lang];
            out[lang][`tool.${tool.id}.short`] = (tool.shortTitle ?? tool.title)[lang];
            if (tool.description) out[lang][`tool.${tool.id}.description`] = tool.description[lang];
        }
    }
    return out;
}

// Every page as HTML, by path (exported for test/accessibility.test.js)
export function renderPages(tools = loadTools()) {
    const layout = readFileSync(join(VIEWS_DIR, 'layout.html'), 'utf8')
        .replace(/(href|src)="(\/[^"]+)"/g, (_, name, url) => `${name}="${versioned(url)}"`);
    const imports = importMap(tools);
    const view = name => readFileSync(join(VIEWS_DIR, `${name}.html`), 'utf8');
    const shellStrings = JSON.parse(readFileSync(join(VIEWS_DIR, 'strings.json'), 'utf8'));
    // Paths of the pages that exist in both languages (English ones)
    const pagePaths = ['/', '/offline', ...tools.map(t => t.path)];
    const pageList = `    <script type="application/json" id="pages">${JSON.stringify(pagePaths)}</script>`;

    // path and description are for public pages that belong in search results
    const render = ({ lang = 'en', active = null, title, titleKey = '', path = null, description = '', content, own, scripts = [], head = '' }) => {
        const strings = pageStrings(shellStrings, tools, own);
        const get = key => strings[lang][key] ?? strings.en[key];
        const fullTitle = `${(lang !== 'en' && get(titleKey)) || title} — Wayhop`;
        return translate(fill(layout, {
            lang,
            title: fullTitle,
            titleKey,
            meta: metaTags({ path, lang, title: fullTitle, description }),
            head,
            importMap: imports,
            pages: pageList,
            sideNav: navLinks(tools, active, 'side'),
            bottomNav: navLinks(tools, active, 'bottom'),
            content,
            // Escape "<" so the JSON can't close the surrounding <script> element
            strings: JSON.stringify(strings).replace(/</g, '\\u003c'),
            scripts: scripts.map(src => `    <script type="module" src="${versioned(src)}"></script>`).join('\n'),
        }), lang, get, pagePaths);
    };

    const pages = {};
    for (const lang of LANGS) {
        const description = shellStrings[lang]['home.description'];
        pages[localPath('/', lang)] = render({
            lang,
            title: 'Athens transit',
            titleKey: 'home.title',
            path: '/',
            description,
            head: appData(description, lang),
            content: view('home'),
            scripts: ['/js/core/announcements.js'],
        });
        pages[localPath('/offline', lang)] = render({ lang, title: "You're offline", titleKey: 'offline.title', content: fill(view('offline'), { tiles: tiles(tools.filter(t => t.offline)) }) });
        for (const tool of tools) {
            pages[localPath(tool.path, lang)] = render({
                lang,
                active: tool.id,
                title: tool.title.en,
                titleKey: `tool.${tool.id}.title`,
                path: tool.path,
                description: tool.description?.[lang] ?? '',
                content: tool.page,
                own: tool.strings,
                scripts: tool.scripts.map(s => `/tools/${tool.id}/${s}`),
            });
        }
    }
    const notFound = Object.fromEntries(LANGS.map(lang => [lang, render({ lang, title: 'Page not found', titleKey: 'notfound.title', content: view('notfound') })]));
    // The pages search engines should find (English paths), for the sitemap
    const indexed = ['/', ...tools.map(t => t.path)];
    return { pages, indexed, notFound, render };
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
export function createPages(tools = loadTools()) {
    const { pages, indexed, notFound, render } = renderPages(tools);
    const serviceWorker = renderServiceWorker(tools, pages);
    const router = express.Router();
    // SITE_URL if set, so search engines only ever see the public address
    const origin = req => siteUrl() || `${req.protocol}://${req.get('host')}`;

    router.get('/sw.js', (_req, res) => {
        res.set('Cache-Control', 'no-cache').type('js').send(serviceWorker);
    });

    router.get('/robots.txt', (req, res) => {
        res.set('Cache-Control', 'no-cache').type('text').send(robotsTxt(origin(req)));
    });

    router.get('/sitemap.xml', (req, res) => {
        res.set('Cache-Control', 'no-cache').type('xml').send(sitemapXml(origin(req), indexed));
    });

    for (const [path, html] of Object.entries(pages)) {
        router.get(path, (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(html));
    }

    for (const tool of tools) router.use(`/tools/${tool.id}`, express.static(tool.clientDir));

    return {
        router,
        // Render any other page (e.g. the admin pages) with the shared layout
        render,
        notFound: (req, res) => res.status(404).type('html').send(notFound[langOf(req.path)]),
    };
}
