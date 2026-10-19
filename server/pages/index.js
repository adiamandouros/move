import { readFileSync } from 'fs';
import express from 'express';
import { inlineScripts } from '../csp.js';
import { adsTxt } from '../ads.js';
import { basePath, langOf, LANGS, localPath, pageStrings } from './i18n.js';
import { iconSprite } from './icons.js';
import { createRenderer } from './layout.js';
import { loadTools, NOT_FOUND, SERVER_ERROR, sitePages, STATION_PATHS } from './registry.js';
import { renderServiceWorker } from './service-worker.js';
import { robotsTxt, siteUrl, sitemapXml } from './seo.js';
import { createStationPages } from './stations.js';

// The public pages, and what goes with them: the service worker, robots.txt,
// the sitemap and the tools' browser files. How it fits together:
//   registry.js         the list of pages
//   layout.js           render(): a page in the shared layout
//   i18n.js             languages, strings and putting a page into its language
//   seo.js              meta tags, structured data, robots.txt, sitemap
//   assets.js           stylesheets, scripts and their versions
//   icons.js            the icon sprite
//   service-worker.js   what the service worker caches for offline use
//   stations.js         the station pages, built from rail.json

// Every page in sitePages (registry.js), rendered in each language, by path;
// render, for the pages that aren't in the list; notFound(path), the 404 page;
// errorPage(path), the page for when answering failed
/** @param {import('../../types/pages.js').Tool[]} [tools] */
export function renderPages(tools = loadTools()) {
    const list = sitePages(tools);
    const pagePaths = [...list.map(page => page.path), ...STATION_PATHS];
    const render = createRenderer(tools, pagePaths);
    const stringsFor = pageStrings(tools);

    // A page from the registry in one language, at `path`
    const renderPage = (page, lang, path) => {
        const strings = stringsFor(lang, page.strings);
        const s = key => strings[key];
        return render({
            lang,
            path,
            index: page.index ?? true,
            title: s(page.title),
            description: page.description ? s(page.description) : '',
            content: page.content(lang, s),
            strings: page.strings,
            scripts: page.scripts,
            head: page.head?.(lang, s) ?? '',
            active: page.active,
            ad: page.ad,
        });
    };

    const pages = {};
    for (const lang of LANGS) {
        for (const page of list) pages[localPath(page.path, lang)] = renderPage(page, lang, page.path);
    }
    // The 404 page for a path, in its language, with the language link to the same path
    const notFound = path => renderPage(NOT_FOUND, langOf(path), basePath(path));
    // The same for the error page (server/errors.js)
    const errorPage = path => renderPage(SERVER_ERROR, langOf(path), basePath(path));
    // The pages search engines should find (English paths), for the sitemap
    const indexed = list.filter(page => page.index !== false).map(page => page.path);
    return { pages, indexed, notFound, errorPage, render };
}

// The app manifest in one language (public/icon/site.webmanifest is the
// English one): an app installed from a Greek page opens at /el, with its
// description in Greek. Both have the same id, so it's one app either way.
const BASE_MANIFEST = JSON.parse(readFileSync(new URL('../../public/icon/site.webmanifest', import.meta.url), 'utf8'));
/** @param {string} lang @param {string} description */
export function appManifest(lang, description) {
    const icons = BASE_MANIFEST.icons.map(icon => ({ ...icon }));
    return { ...BASE_MANIFEST, lang, start_url: localPath('/', lang), description, icons };
}

// Pages, tool client files and the service worker. Everything is rendered once
// at startup; `node --watch` restarts the server when these files change.
/** @param {import('../../types/pages.js').Tool[]} [tools] @param {{ railFile?: string }} [options] */
export function createPages(tools = loadTools(), { railFile } = {}) {
    const { pages, indexed, notFound, errorPage, render } = renderPages(tools);
    const serviceWorker = renderServiceWorker(tools, pages);
    const router = express.Router();
    // The station pages, built from rail.json (when there is one)
    const stations = railFile ? createStationPages({ railFile, render, tools }) : null;
    // SITE_URL if set, so search engines only ever see the public address
    const origin = req => siteUrl() || `${req.protocol}://${req.get('host')}`;

    router.get('/sw.js', (_req, res) => {
        res.set('Cache-Control', 'no-cache').type('js').send(serviceWorker);
    });

    // The icons (icons.js). Pages link it with the asset version, so that
    // address never changes and is kept for good.
    router.get('/icons.svg', (req, res) => {
        res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache').type('svg').send(iconSprite());
    });

    const stringsFor = pageStrings(tools);
    for (const lang of LANGS) {
        const manifest = JSON.stringify(appManifest(lang, stringsFor(lang)['app.description']), null, 2);
        router.get(localPath('/manifest.webmanifest', lang), (_req, res) => {
            res.set('Cache-Control', 'no-cache').type('application/manifest+json').send(manifest);
        });
    }

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
        // The inline scripts of every page, for the Content-Security-Policy
        // (server/csp.js). Station and admin pages share the layout, so the
        // same scripts; csp.test.js checks every page against the policy.
        inlineScripts: new Set([...Object.values(pages), notFound('/'), notFound('/el/'), errorPage('/')].flatMap(inlineScripts)),
        notFound: (req, res) => res.status(404).type('html').send(notFound(req.path)),
        // The error page for an address, in its language (server/errors.js)
        errorPage,
    };
}
