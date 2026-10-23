import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config.js';
import { SHELL_STRINGS, stringGetter, toolNames } from './i18n.js';
import { lastTrains } from './last-trains.js';
import { appData } from './seo.js';
import { STATION_STRINGS, STATIONS_PATH } from './stations.js';
import { view } from './templates.js';

// Every page of the site. Each one is at its path in English and under /el
// in Greek, and is rendered in both languages at startup (index.js), in the
// layout (layout.js). Page fields:
//   path          the English address
//   title         strings key of its title
//   description   strings key of its description in search results
//   values        lang → the values for {name} placeholders in both
//   index         false keeps it out of search results and the sitemap
//   content       (lang, strings) → the HTML inside <main>, from its view;
//                 strings: the page's, for {{t}}
//   strings       its own strings ({ en, el }), for its view and its scripts
//   scripts       browser modules to load
//   structuredData  (lang, s) → its schema.org data, for <head> (seo.js)
//   active        the tool whose navigation entry is highlighted
//   ad            where it has an ad slot (server/ads.js)
//   rail          true when it's drawn from rail.json, so it's drawn again
//                 when that changes (index.js)
//
// Pages that aren't in this list, of the same shape:
//   - the station pages (STATION_PATHS), built on request from rail.json (stations.js, stationPage)
//   - the 404 page (NOT_FOUND), rendered for the address that wasn't found
//   - the error page (SERVER_ERROR), for an address whose answer failed
//   - the admin pages (server/admin/), private and in English only

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS_DIR = join(ROOT, 'tools');


/** @typedef {import('../../types/pages.js').Page} Page */
/** @typedef {import('../../types/pages.js').Tool} Tool */

// config: the settings (server/config.js), for the ads and the contact
// address; without them (e.g. to list the paths), none. rail: rail.json as
// it is now, for the tools that use it (tool.json "rail")
/**
 * @param {Tool[]} tools @param {import('../../types/config.js').Config} [config]
 * @param {() => import('../../types/data.js').Rail | null} [rail]
 * @returns {Page[]}
 */
export function sitePages(tools, config = loadConfig({}), rail = () => null) {
    const ads = Boolean(config.adsense.client);
    return [
        {
            path: '/',
            title: 'home.page-title',
            description: 'home.description',
            content: (lang, strings) => view('server/views/home.hbs')({ tiles: [...tools.map(toolTile), STATIONS_TILE] }, { lang, strings }),
            structuredData: (lang, s) => appData(s('home.description'), lang, config.siteUrl),
            scripts: ['/js/core/announcements.js', '/js/core/install.js'],
            active: 'home',
            ad: 'home',
        },
        {
            path: '/offline',
            title: 'offline.title',
            index: false,
            content: (lang, strings) => view('server/views/offline.hbs')({ tiles: tools.filter(t => t.offline).map(toolTile) }, { lang, strings }),
        },
        // The tools: tools/<id>/ (see tools/README.md)
        ...tools.map(tool => {
            const page = view(tool.view);
            return {
                path: tool.path,
                title: `tool.${tool.id}.title`,
                description: `tool.${tool.id}.description`,
                // Its data.json gives the view its values; with "rail", also its
                // data.json "lastTrains" rows' times, as `metro` (last-trains.js)
                content: (lang, strings) => page(tool.rail
                    ? { ...tool.data, metro: lastTrains(rail(), tool.data.lastTrains, lang, stringGetter(strings, lang)) }
                    : tool.data, { lang, strings }),
                strings: tool.strings,
                scripts: tool.scripts.map(s => `/tools/${tool.id}/${s}`),
                active: tool.id,
                ad: tool.ad,
                rail: tool.rail,
            };
        }),
        ...TEXT_PAGES.map(name => ({
            path: `/${name}`,
            title: `${name}.title`,
            // The privacy page has its own description once it describes ads
            description: `${name}.description${name === 'privacy' && ads ? '-ads' : ''}`,
            // The privacy page has parts for with and without ads, and the
            // contact page shows CONTACT_EMAIL (the address OASA also sees) when it's set
            content: (lang, strings) => view(`server/views/pages/${name}.${lang}.hbs`)({
                updated: PRIVACY_UPDATED[lang], email: config.contactEmail, ads, adClient: config.adsense.client ?? '',
            }, { lang, strings }),
        })),
    ];
}

/** @type {Page} */
export const NOT_FOUND = { title: 'notfound.title', index: false, content: (lang, strings) => view('server/views/notfound.hbs')({}, { lang, strings }) };

// When answering failed (server/errors.js)
/** @type {Page} */
export const SERVER_ERROR = { title: 'error.title', index: false, content: (lang, strings) => view('server/views/error.hbs')({}, { lang, strings }) };

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
                view: join(toolDir, 'page.hbs'),
                strings: existsSync(join(toolDir, 'strings.json')) ? JSON.parse(readFileSync(join(toolDir, 'strings.json'), 'utf8')) : {},
                data: existsSync(join(toolDir, 'data.json')) ? JSON.parse(readFileSync(join(toolDir, 'data.json'), 'utf8')) : {},
                clientDir: join(toolDir, 'client'),
            };
        })
        .sort((a, b) => a.order - b.order);
}

// A link to a page as a tile (the home page's shortcuts, the offline page's
// tools that work offline): server/views/partials/tile.hbs
const toolTile = tool => ({ href: tool.path, tool: tool.id, iconName: tool.icon, titleKey: `tool.${tool.id}.title`, descriptionKey: `tool.${tool.id}.description` });

// The metro stations' pages, from the home page
const STATIONS_TILE = { href: STATIONS_PATH, tool: null, iconName: 'list-ul', titleKey: 'home.stations', descriptionKey: 'home.stations-text' };

// ── Pages of text ───────────────────────────────────────────────────────────

// Written once per language: server/views/pages/<name>.<lang>.hbs
const TEXT_PAGES = ['about', 'privacy', 'contact'];
// When privacy.<lang>.hbs last changed in substance (shown on the page)
const PRIVACY_UPDATED = { en: '18 October 2026', el: '18 Οκτωβρίου 2026' };

// ── Strings ─────────────────────────────────────────────────────────────────

// Every table of strings ({ en, el }) as it's written, for checks: the
// shell's, the tools' names, each tool's own and the station pages'
/** @param {Tool[]} tools */
export const stringTables = tools => [SHELL_STRINGS, toolNames(tools), ...tools.map(t => t.strings), STATION_STRINGS];

// ── Facts checked by hand ───────────────────────────────────────────────────

// When the facts written on the pages by hand were last checked: each
// section of a tool's data.json "checked" ({{> checked}} shows it on the
// page), named by its heading, for /admin/diagnostics (factsChecks)
/** @param {Tool[]} tools @returns {{ what: string, date: string }[]} */
export function checkedFacts(tools) {
    return tools.flatMap(tool => Object.entries(tool.data?.checked ?? {}).map(([section, { date }]) => ({
        what: `${tool.title.en}: ${tool.strings.en?.[`${tool.id}.${section}`] ?? section}`,
        date,
    })));
}
