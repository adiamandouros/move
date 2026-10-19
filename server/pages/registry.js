import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config.js';
import { appData } from './seo.js';
import { STATIONS_PATH } from './stations.js';
import { compileView, registerPartial } from './templates.js';

// Every page of the site. Each one is at its path in English and under /el
// in Greek, and is rendered in both languages at startup (index.js), in the
// layout (layout.js). Page fields:
//   path          the English address
//   title         strings key of its title
//   description   strings key of its description in search results
//   index         false keeps it out of search results and the sitemap
//   content       (lang, strings) → the HTML inside <main>, from its view;
//                 strings: the page's, for {{t}}
//   strings       its own strings ({ en, el }), for data-i18n and its scripts
//   scripts       browser modules to load
//   head          (lang, s) → more for <head>
//   active        the tool whose navigation entry is highlighted
//   ad            where it has an ad slot (server/ads.js)
//
// Pages that aren't in this list:
//   - the station pages (STATION_PATHS), built on request from rail.json by stations.js
//   - the 404 page (NOT_FOUND), rendered for the address that wasn't found
//   - the error page (SERVER_ERROR), for an address whose answer failed
//   - the admin pages (server/admin/), private and in English only

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEWS_DIR = join(ROOT, 'server', 'views');
const TOOLS_DIR = join(ROOT, 'tools');

// The views (server/views/<name>.hbs, see templates.js), each compiled once,
// and the partials they share (server/views/partials/<name>.hbs, {{> name}})
const views = new Map();
const view = name => {
    if (!views.has(name)) views.set(name, compileView(readFileSync(join(VIEWS_DIR, `${name}.hbs`), 'utf8'), `server/views/${name}.hbs`));
    return views.get(name);
};
const PARTIALS_DIR = join(VIEWS_DIR, 'partials');
for (const file of readdirSync(PARTIALS_DIR).filter(f => f.endsWith('.hbs'))) {
    registerPartial(file.slice(0, -'.hbs'.length), readFileSync(join(PARTIALS_DIR, file), 'utf8'));
}

/** @typedef {import('../../types/pages.js').Page} Page */
/** @typedef {import('../../types/pages.js').Tool} Tool */

// config: the settings (server/config.js), for the ads and the contact
// address; without them (e.g. to list the paths), none
/** @param {Tool[]} tools @param {import('../../types/config.js').Config} [config] @returns {Page[]} */
export function sitePages(tools, config = loadConfig({})) {
    const ads = Boolean(config.adsense.client);
    return [
        {
            path: '/',
            title: 'home.page-title',
            description: 'home.description',
            content: (lang, strings) => view('home')({ tiles: [...tools.map(toolTile), STATIONS_TILE] }, { lang, strings }),
            head: (lang, s) => appData(s('home.description'), lang, config.siteUrl),
            scripts: ['/js/core/announcements.js', '/js/core/install.js'],
            active: 'home',
            ad: 'home',
        },
        {
            path: '/offline',
            title: 'offline.title',
            index: false,
            content: (lang, strings) => view('offline')({ tiles: tools.filter(t => t.offline).map(toolTile) }, { lang, strings }),
        },
        // The tools: tools/<id>/ (see tools/README.md)
        ...tools.map(tool => {
            const page = compileView(tool.page, `tools/${tool.id}/page.hbs`);
            return {
                path: tool.path,
                title: `tool.${tool.id}.title`,
                description: `tool.${tool.id}.description`,
                content: (lang, strings) => page({}, { lang, strings }),
                strings: tool.strings,
                scripts: tool.scripts.map(s => `/tools/${tool.id}/${s}`),
                active: tool.id,
                ad: tool.ad,
            };
        }),
        ...TEXT_PAGES.map(name => ({
            path: `/${name}`,
            title: `${name}.title`,
            // The privacy page has its own description once it describes ads
            description: `${name}.description${name === 'privacy' && ads ? '-ads' : ''}`,
            // The privacy page has parts for with and without ads, and the
            // contact page shows CONTACT_EMAIL (the address OASA also sees) when it's set
            content: (lang, strings) => view(`pages/${name}.${lang}`)({
                updated: PRIVACY_UPDATED[lang], email: config.contactEmail, ads, adClient: config.adsense.client ?? '',
            }, { lang, strings }),
        })),
    ];
}

/** @type {Page} */
export const NOT_FOUND = { title: 'notfound.title', index: false, content: (lang, strings) => view('notfound')({}, { lang, strings }) };

// When answering failed (server/errors.js)
/** @type {Page} */
export const SERVER_ERROR = { title: 'error.title', index: false, content: (lang, strings) => view('error')({}, { lang, strings }) };

export const STATION_PATHS = [STATIONS_PATH, `${STATIONS_PATH}/*`];

// ── Tools ───────────────────────────────────────────────────────────────────

// Read every tools/<id>/ folder. See tools/README.md for the format.
/** @returns {Tool[]} */
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
                page: readFileSync(join(toolDir, 'page.hbs'), 'utf8'),
                strings: existsSync(join(toolDir, 'strings.json')) ? JSON.parse(readFileSync(join(toolDir, 'strings.json'), 'utf8')) : {},
                clientDir: join(toolDir, 'client'),
            };
        })
        .sort((a, b) => a.order - b.order);
}

// A link to a page as a tile (the home page's shortcuts, the offline page's
// tools that work offline): server/views/partials/tile.hbs
const toolTile = tool => ({ href: tool.path, iconName: tool.icon, titleKey: `tool.${tool.id}.title`, descriptionKey: `tool.${tool.id}.description` });

// The metro stations' pages, from the home page
const STATIONS_TILE = { href: STATIONS_PATH, iconName: 'list-ul', titleKey: 'home.stations', descriptionKey: 'home.stations-text' };

// ── Pages of text ───────────────────────────────────────────────────────────

// Written once per language: server/views/pages/<name>.<lang>.hbs
const TEXT_PAGES = ['about', 'privacy', 'contact'];
// When privacy.<lang>.hbs last changed in substance (shown on the page)
const PRIVACY_UPDATED = { en: '18 October 2026', el: '18 Οκτωβρίου 2026' };
