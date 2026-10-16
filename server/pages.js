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

// The public origin (e.g. https://move.gr), for canonical URLs, the sitemap
// and link previews. Without SITE_URL the pages leave out what needs it.
export const siteUrl = () => (process.env.SITE_URL ?? '').replace(/\/+$/, '');

// Search and link-preview tags. Pages without a path (the 404, /offline, the
// admin pages) are kept out of search results.
function metaTags({ path, title, description }) {
    if (!path) return '    <meta name="robots" content="noindex">';
    const origin = siteUrl();
    const url = origin && origin + path;
    return [
        `<meta name="description" content="${escapeAttr(description)}">`,
        url && `<link rel="canonical" href="${url}">`,
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Move">',
        `<meta property="og:title" content="${escapeAttr(title)}">`,
        `<meta property="og:description" content="${escapeAttr(description)}">`,
        url && `<meta property="og:url" content="${url}">`,
        origin && `<meta property="og:image" content="${origin}/icon/web-app-manifest-512x512.png">`,
        '<meta name="twitter:card" content="summary">',
    ].filter(Boolean).map(tag => `    ${tag}`).join('\n');
}

// Structured data for the home page, so search results can show Move as a free web app
function appData(description) {
    const data = {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Move',
        description,
        ...(siteUrl() && { url: `${siteUrl()}/` }),
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
    // Escape "<" so the JSON can't close the surrounding <script> element
    return JSON.stringify(out).replace(/</g, '\\u003c');
}

// Every page as HTML, by path (exported for test/accessibility.test.js)
export function renderPages(tools = loadTools()) {
    const layout = readFileSync(join(VIEWS_DIR, 'layout.html'), 'utf8')
        .replace(/(href|src)="(\/[^"]+)"/g, (_, name, url) => `${name}="${versioned(url)}"`);
    const imports = importMap(tools);
    const view = name => readFileSync(join(VIEWS_DIR, `${name}.html`), 'utf8');
    const shellStrings = JSON.parse(readFileSync(join(VIEWS_DIR, 'strings.json'), 'utf8'));

    // path and description are for public pages that belong in search results
    const render = ({ active = null, title, titleKey = '', path = null, description = '', content, own, scripts = [], head = '' }) => fill(layout, {
        title: `${title} — Move`,
        titleKey,
        meta: metaTags({ path, title: `${title} — Move`, description }),
        head,
        importMap: imports,
        sideNav: navLinks(tools, active, 'side'),
        bottomNav: navLinks(tools, active, 'bottom'),
        content,
        strings: pageStrings(shellStrings, tools, own),
        scripts: scripts.map(src => `    <script type="module" src="${versioned(src)}"></script>`).join('\n'),
    });

    const homeDescription = shellStrings.en['home.description'];
    const pages = {
        '/': render({
            title: 'Athens transit',
            titleKey: 'home.title',
            path: '/',
            description: homeDescription,
            head: appData(homeDescription),
            content: view('home'),
            scripts: ['/js/core/announcements.js'],
        }),
        '/offline': render({ title: "You're offline", titleKey: 'offline.title', content: fill(view('offline'), { tiles: tiles(tools.filter(t => t.offline)) }) }),
    };
    for (const tool of tools) {
        pages[tool.path] = render({
            active: tool.id,
            title: tool.title.en,
            titleKey: `tool.${tool.id}.title`,
            path: tool.path,
            description: tool.description?.en ?? '',
            content: tool.page,
            own: tool.strings,
            scripts: tool.scripts.map(s => `/tools/${tool.id}/${s}`),
        });
    }
    const notFound = render({ title: 'Page not found', titleKey: 'notfound.title', content: view('notfound') });
    // The pages search engines should find, for the sitemap
    const indexed = ['/', ...tools.map(t => t.path)];
    return { pages, indexed, notFound, render };
}

// ── robots.txt and sitemap ──────────────────────────────────────────────────

export function robotsTxt(origin) {
    return `User-agent: *\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemapXml(origin, paths) {
    const urls = paths.map(path => `    <url><loc>${origin}${path}</loc></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
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
    const precache = [
        '/', '/offline',
        ...shellUrls(),
        ...offlineTools.flatMap(t => [
            t.path,
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
        offlinePages: JSON.stringify(offlineTools.map(t => t.path)),
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
        notFound: (_req, res) => res.status(404).type('html').send(notFound),
    };
}
