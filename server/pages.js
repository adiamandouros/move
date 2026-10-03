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

function renderPages(tools) {
    const layout = readFileSync(join(VIEWS_DIR, 'layout.html'), 'utf8');
    const view = name => readFileSync(join(VIEWS_DIR, `${name}.html`), 'utf8');
    const shellStrings = JSON.parse(readFileSync(join(VIEWS_DIR, 'strings.json'), 'utf8'));

    const render = ({ active = null, title, titleKey, content, own, scripts = [] }) => fill(layout, {
        title: `${title} — Move`,
        titleKey,
        sideNav: navLinks(tools, active, 'side'),
        bottomNav: navLinks(tools, active, 'bottom'),
        content,
        strings: pageStrings(shellStrings, tools, own),
        scripts: scripts.map(src => `    <script type="module" src="${src}"></script>`).join('\n'),
    });

    const pages = {
        '/': render({ title: 'Athens transit', titleKey: 'home.title', content: fill(view('home'), { tiles: tiles(tools) }) }),
        '/offline': render({ title: "You're offline", titleKey: 'offline.title', content: fill(view('offline'), { tiles: tiles(tools.filter(t => t.offline)) }) }),
    };
    for (const tool of tools) {
        pages[tool.path] = render({
            active: tool.id,
            title: tool.title.en,
            titleKey: `tool.${tool.id}.title`,
            content: tool.page,
            own: tool.strings,
            scripts: tool.scripts.map(s => `/tools/${tool.id}/${s}`),
        });
    }
    const notFound = render({ title: 'Page not found', titleKey: 'notfound.title', content: view('notfound') });
    return { pages, notFound };
}

// ── Service worker ──────────────────────────────────────────────────────────

function listFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

const urlPath = (base, dir, file) => `${base}/${relative(dir, file).split(sep).join('/')}`;

function renderServiceWorker(tools, pages) {
    const offlineTools = tools.filter(t => t.offline);
    const precache = [
        '/', '/offline',
        ...SHELL_FILES,
        ...SHELL_DIRS.flatMap(d => listFiles(join(PUBLIC_DIR, d)).map(f => urlPath('', PUBLIC_DIR, f))),
        ...offlineTools.flatMap(t => [
            t.path,
            ...listFiles(t.clientDir).map(f => urlPath(`/tools/${t.id}`, t.clientDir, f)),
            ...t.precache,
        ]),
    ];

    // The version changes whenever any page or cached file changes
    const hash = createHash('sha256');
    for (const html of Object.values(pages)) hash.update(html);
    for (const file of [
        ...SHELL_DIRS.flatMap(d => listFiles(join(PUBLIC_DIR, d))),
        ...tools.flatMap(t => listFiles(t.clientDir)),
        join(VIEWS_DIR, 'sw.js'),
    ]) hash.update(readFileSync(file));
    for (const dir of Object.values(VENDOR)) hash.update(readFileSync(join(dir, '..', 'package.json')));

    return fill(readFileSync(join(VIEWS_DIR, 'sw.js'), 'utf8'), {
        version: hash.digest('hex').slice(0, 12),
        precache: JSON.stringify(precache, null, 4),
        offlinePages: JSON.stringify(offlineTools.map(t => t.path)),
    });
}

// ── Router ──────────────────────────────────────────────────────────────────

// Pages, tool client files and the service worker. Everything is rendered once
// at startup; `node --watch` restarts the server when these files change.
export function createPages(tools = loadTools()) {
    const { pages, notFound } = renderPages(tools);
    const serviceWorker = renderServiceWorker(tools, pages);
    const router = express.Router();

    router.get('/sw.js', (_req, res) => {
        res.set('Cache-Control', 'no-cache').type('js').send(serviceWorker);
    });

    for (const [path, html] of Object.entries(pages)) {
        router.get(path, (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(html));
    }

    for (const tool of tools) router.use(`/tools/${tool.id}`, express.static(tool.clientDir));

    return {
        router,
        notFound: (_req, res) => res.status(404).type('html').send(notFound),
    };
}
