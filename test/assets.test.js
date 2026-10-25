import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import { FONTS, listFiles, VENDOR, staticFiles, versioned, versionOf } from '../server/pages/assets.js';
import { iconSprite } from '../server/pages/icons.js';
import { createPages, renderPages } from '../server/pages/index.js';

// Stylesheets and scripts are linked with ?v=<that file's version>, so a
// deploy can't mix new pages with old cached files, and gives new addresses
// only to the files it changed (see versionOf in server/pages/assets.js)

const { pages } = renderPages();
const ROOT = new URL('..', import.meta.url).pathname;
const hashOf = content => createHash('sha256').update(content).digest('hex').slice(0, 10);

let server;
let base;
before(async () => {
    // Served like server.js does
    const app = express();
    app.use(createPages().router);
    for (const [url, dir] of Object.entries(VENDOR)) app.use(url, staticFiles(dir));
    app.use(staticFiles(join(ROOT, 'public'), { index: false }));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('each file\'s version is a short hash of that file, so a deploy changes only the ones it changed', () => {
    const files = {
        '/css/style.css': 'public/css/style.css',
        '/js/core/shell.js': 'public/js/core/shell.js',
        '/tools/subway/main.js': 'tools/subway/client/main.js',
        '/vendor/bootstrap/css/bootstrap.min.css': 'node_modules/bootstrap/dist/css/bootstrap.min.css',
    };
    for (const [url, file] of Object.entries(files)) {
        assert.equal(versionOf(url), hashOf(readFileSync(join(ROOT, file))), url);
        assert.equal(versioned(url), `${url}?v=${versionOf(url)}`);
    }
    assert.equal(versionOf('/icons.svg'), hashOf(iconSprite()));
    // An icon keeps its name after the version
    assert.equal(versioned('/icons.svg#walk'), `/icons.svg?v=${versionOf('/icons.svg')}#walk`);
    assert.equal(new Set(Object.keys(files).map(versionOf)).size, 4, 'one version per file');
    // Other files aren't versioned
    assert.equal(versioned('/icon/favicon.svg'), '/icon/favicon.svg');
});

for (const [path, html] of Object.entries(pages)) {
    test(`${path}: every stylesheet and script is linked with the current version`, () => {
        const links = [...html.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)].map(m => m[1]);
        assert.ok(links.length >= 4, 'found the stylesheets and scripts');
        for (const url of links) assert.equal(url, versioned(url.split('?')[0]), `${url} isn't at its version`);
    });

    test(`${path}: icons use the current version of the sprite`, () => {
        const v = versionOf('/icons.svg');
        assert.match(html, new RegExp(`<html [^>]*data-icons="/icons\\.svg\\?v=${v}"`));
        const icons = [...html.matchAll(/<use href="([^"]+)"/g)].map(m => m[1]);
        for (const url of icons) assert.match(url, new RegExp(`^/icons\\.svg\\?v=${v}#[a-z0-9-]+$`));
    });

    test(`${path}: the import map covers every script that can be imported`, () => {
        const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)[1]).imports;
        const scripts = [
            ...listFiles(join(ROOT, 'public', 'js', 'core')).map(f => `/js/core/${f.split('/').pop()}`),
            ...listFiles(join(ROOT, 'tools')).filter(f => f.includes('/client/')).map(f => {
                const [, id, rest] = f.match(/tools\/([^/]+)\/client\/(.+)$/);
                return `/tools/${id}/${rest}`;
            }),
        ].filter(url => url.endsWith('.js'));
        for (const url of scripts) assert.equal(map[url], `${url}?v=${versionOf(url)}`, `${url} isn't in the import map at its version`);
        // The import map must come before any module script
        assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
    });
}

test('the icon sprite is served as SVG, kept for good at its version', async () => {
    const res = await fetch(`${base}/icons.svg?v=${versionOf('/icons.svg')}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^image\/svg\+xml/);
    assert.match(res.headers.get('cache-control'), /immutable/);
    // Material Symbols are under the Apache License, so the sprite carries their notice
    assert.match(await res.text(), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"><!-- Material Symbols by Google, Apache License 2\.0, [^>]+ --><symbol id=/);
    assert.equal((await fetch(`${base}/icons.svg`)).headers.get('cache-control'), 'no-cache');
    // A page from before a deploy asks for the old version: today's sprite, not kept under that address
    assert.equal((await fetch(`${base}/icons.svg?v=0000000000`)).headers.get('cache-control'), 'no-cache');
});

test('the tools\' scripts, Bootstrap and public/ are kept for good at their version, and checked every time otherwise', async () => {
    for (const url of ['/tools/subway/main.js', '/vendor/bootstrap/css/bootstrap.min.css', '/vendor/bootstrap/js/bootstrap.min.js', '/css/style.css', '/js/core/html.js']) {
        const now = await fetch(base + versioned(url));
        assert.equal(now.status, 200, url);
        assert.equal(now.headers.get('cache-control'), 'public, max-age=31536000, immutable', url);
        // Today's file under an old version mustn't be kept as that version
        assert.equal((await fetch(`${base}${url}?v=0000000000`)).headers.get('cache-control'), 'no-cache', url);
        assert.equal((await fetch(base + url)).headers.get('cache-control'), 'no-cache', url);
    }
});

test('the service worker precaches the versioned stylesheets and scripts', async () => {
    const sw = await (await fetch(`${base}/sw.js`)).text();
    const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
    const assets = precache.filter(url => /\.(css|js)(\?|$)/.test(url));
    assert.ok(assets.includes(versioned('/css/style.css')));
    assert.ok(assets.includes(versioned('/js/core/shell.js')));
    assert.ok(precache.includes(versioned('/icons.svg')), 'the icons work offline');
    for (const url of assets) assert.equal(url, versioned(url.split('?')[0]), `${url} isn't at its version`);
    // Not the PNG icons and the share image: the browser and the home screen keep their own
    assert.deepEqual(precache.filter(url => url.startsWith('/icon/')), []);
    // Every versioned file it lists is actually served
    for (const url of assets) assert.equal((await fetch(base + url)).status, 200, url);
});

test('Roboto: both files are served as fonts, kept for 30 days, and work offline', async () => {
    const sw = await (await fetch(`${base}/sw.js`)).text();
    const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
    for (const url of Object.values(FONTS)) {
        assert.ok(precache.includes(url), `${url} is precached`);
        const res = await fetch(base + url);
        assert.equal(res.status, 200, url);
        assert.equal(res.headers.get('content-type'), 'font/woff2');
        assert.equal(res.headers.get('cache-control'), 'public, max-age=2592000');
    }
    // Linked without a version, Bootstrap is checked every time
    assert.equal((await fetch(`${base}/vendor/bootstrap/css/bootstrap.min.css`)).headers.get('cache-control'), 'no-cache');
});

test('Roboto: style.css names the same files as the server, one per alphabet, shown at once', () => {
    const css = readFileSync(join(ROOT, 'public', 'css', 'style.css'), 'utf8');
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => body).filter(body => body.includes('"Roboto";'));
    assert.deepEqual(faces.map(body => body.match(/url\("([^"]+)"\)/)[1]), [FONTS.latin, FONTS.greek]);
    for (const body of faces) {
        assert.match(body, /font-display: swap;/);
        assert.match(body, /font-weight: 100 900;/);
        assert.match(body, /unicode-range: U\+/);
    }
    assert.match(css, /--bs-font-sans-serif: "Roboto", "Roboto Fallback", system-ui,/);
});

for (const [path, html] of Object.entries(pages)) {
    test(`${path}: preloads both Roboto files, before the stylesheets`, () => {
        for (const url of Object.values(FONTS)) {
            const at = html.indexOf(`<link rel="preload" href="${url}" as="font" type="font/woff2" crossorigin>`);
            assert.ok(at !== -1, `${url} isn't preloaded`);
            assert.ok(at < html.indexOf('rel="stylesheet"'));
        }
    });
}
