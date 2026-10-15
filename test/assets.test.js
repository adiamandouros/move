import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import express from 'express';
import { assetVersion, createPages, listFiles, renderPages, VENDOR } from '../server/pages.js';

// Stylesheets and scripts are linked with ?v=<version> so a deploy can't mix
// new pages with old cached files (see assetVersion in server/pages.js)

const { pages } = renderPages();
const v = assetVersion();
const ROOT = new URL('..', import.meta.url).pathname;

let server;
let base;
before(async () => {
    // Served like server.js does
    const app = express();
    app.use(createPages().router);
    for (const [url, dir] of Object.entries(VENDOR)) app.use(url, express.static(dir));
    app.use(express.static(join(ROOT, 'public'), { index: false }));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('the version is a short hash', () => {
    assert.match(v, /^[0-9a-f]{10}$/);
});

for (const [path, html] of Object.entries(pages)) {
    test(`${path}: every stylesheet and script is linked with the current version`, () => {
        const links = [...html.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)].map(m => m[1]);
        assert.ok(links.length >= 5, 'found the stylesheets and scripts');
        for (const url of links) assert.ok(url.endsWith(`?v=${v}`), `${url} isn't versioned`);
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
        for (const url of scripts) assert.equal(map[url], `${url}?v=${v}`, `${url} isn't in the import map`);
        // The import map must come before any module script
        assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
    });
}

test('the service worker precaches the versioned stylesheets and scripts', async () => {
    const sw = await (await fetch(`${base}/sw.js`)).text();
    const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
    const assets = precache.filter(url => /\.(css|js)(\?|$)/.test(url));
    assert.ok(assets.includes(`/css/style.css?v=${v}`));
    assert.ok(assets.includes(`/js/core/shell.js?v=${v}`));
    for (const url of assets) assert.ok(url.endsWith(`?v=${v}`), `${url} isn't versioned`);
    // Every versioned file it lists is actually served
    for (const url of assets) assert.equal((await fetch(base + url)).status, 200, url);
});
