// @ts-check
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml } from '../../public/js/core/html.js';
import { adsenseClient } from '../ads.js';
import { fill } from './layout.js';
import { appData } from './seo.js';
import { STATIONS_PATH } from './stations.js';

// Every page of the site. Each one is at its path in English and under /el
// in Greek, and is rendered in both languages at startup (index.js), in the
// layout (layout.js). Page fields:
//   path          the English address
//   title         strings key of its title
//   description   strings key of its description in search results
//   index         false keeps it out of search results and the sitemap
//   content       (lang, s) → the HTML inside <main>; s(key) gives a string
//   strings       its own strings ({ en, el }), for data-i18n and its scripts
//   scripts       browser modules to load
//   head          (lang, s) → more for <head>
//   active        the tool whose navigation entry is highlighted
//   ad            where it has an ad slot (server/ads.js)
//
// Pages that aren't in this list:
//   - the station pages (STATION_PATHS), built on request from rail.json by stations.js
//   - the 404 page (NOT_FOUND), rendered for the address that wasn't found
//   - the admin pages (server/admin/), private and in English only

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEWS_DIR = join(ROOT, 'server', 'views');
const TOOLS_DIR = join(ROOT, 'tools');

const view = name => readFileSync(join(VIEWS_DIR, `${name}.html`), 'utf8');

/** @typedef {import('../../types/pages.js').Page} Page */
/** @typedef {import('../../types/pages.js').Tool} Tool */

/** @param {Tool[]} tools @returns {Page[]} */
export function sitePages(tools) {
    return [
        {
            path: '/',
            title: 'home.page-title',
            description: 'home.description',
            content: () => view('home'),
            head: (lang, s) => appData(s('home.description'), lang),
            scripts: ['/js/core/announcements.js'],
            active: 'home',
            ad: 'home',
        },
        {
            path: '/offline',
            title: 'offline.title',
            index: false,
            content: () => fill(view('offline'), { tiles: tiles(tools.filter(t => t.offline)) }),
        },
        // The tools: tools/<id>/ (see tools/README.md)
        ...tools.map(tool => ({
            path: tool.path,
            title: `tool.${tool.id}.title`,
            description: `tool.${tool.id}.description`,
            content: () => tool.page,
            strings: tool.strings,
            scripts: tool.scripts.map(s => `/tools/${tool.id}/${s}`),
            active: tool.id,
            ad: tool.ad,
        })),
        ...TEXT_PAGES.map(name => ({
            path: `/${name}`,
            title: `${name}.title`,
            // The privacy page has its own description once it describes ads
            description: `${name}.description${name === 'privacy' && adsenseClient() ? '-ads' : ''}`,
            content: (lang, s) => fill(adsVariant(view(`pages/${name}.${lang}`), Boolean(adsenseClient())), {
                updated: PRIVACY_UPDATED[lang], email: contactEmail(s), adClient: adsenseClient() ?? '',
            }),
        })),
    ];
}

/** @type {Page} */
export const NOT_FOUND = { title: 'notfound.title', index: false, content: () => view('notfound') };

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
                page: readFileSync(join(toolDir, 'page.html'), 'utf8'),
                strings: existsSync(join(toolDir, 'strings.json')) ? JSON.parse(readFileSync(join(toolDir, 'strings.json'), 'utf8')) : {},
                clientDir: join(toolDir, 'client'),
            };
        })
        .sort((a, b) => a.order - b.order);
}

// The offline page's links to the tools that work offline
function tiles(tools) {
    return tools.map(tool => `        <a href="${tool.path}" class="tool-tile">
            <i class="bi bi-${tool.icon}" aria-hidden="true"></i>
            <span class="tool-tile-title" data-i18n="tool.${tool.id}.title">${tool.title.en}</span>
            <span class="tool-tile-desc" data-i18n="tool.${tool.id}.description">${tool.description?.en ?? ''}</span>
        </a>`).join('\n');
}

// ── Pages of text ───────────────────────────────────────────────────────────

// Written once per language: server/views/pages/<name>.<lang>.html
const TEXT_PAGES = ['about', 'privacy', 'contact'];
// When privacy.<lang>.html last changed in substance (shown on the page)
const PRIVACY_UPDATED = { en: '18 October 2026', el: '18 Οκτωβρίου 2026' };

// Keep the page's <!-- with ads --> or <!-- without ads --> parts (privacy.<lang>.html)
const adsVariant = (html, ads) => html.replace(/<!-- (with|without) ads -->\n([\s\S]*?)<!-- \/\1 ads -->\n/g,
    (_, which, part) => (which === 'with') === ads ? part : '');

// The contact page's email line: CONTACT_EMAIL (the address OASA also sees),
// or nothing when it isn't set
function contactEmail(s) {
    const email = process.env.CONTACT_EMAIL;
    if (!email) return '';
    return `    <p class="contact-email"><i class="bi bi-envelope me-2" aria-hidden="true"></i>${s('contact.email')} <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>`;
}
