import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPages, loadTools, localPath, renderPages } from '../server/pages.js';

// What search engines and link previews see: meta tags, the Greek pages under
// /el, robots.txt and the sitemap

process.env.SITE_URL = 'https://move.example/';
const tools = loadTools();
const { pages, indexed, notFound, render } = renderPages(tools);

const head = html => html.match(/<head>([\s\S]*?)<\/head>/)[1];
const meta = (html, attr, name) => head(html).match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];
const canonical = html => head(html).match(/<link rel="canonical" href="([^"]*)">/)?.[1];

let server;
let base;
before(async () => {
    const app = express();
    const served = createPages(tools);
    app.use(served.router);
    app.use(served.notFound);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('the home page and every tool are indexed', () => {
    assert.deepEqual(indexed, ['/', ...tools.map(t => t.path)]);
});

const alternates = html => Object.fromEntries([...head(html).matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => m.slice(1)));

for (const path of indexed.flatMap(p => [p, localPath(p, 'el')])) {
    test(`${path}: has a description, canonical URL and link preview`, () => {
        const html = pages[path];
        assert.ok(meta(html, 'name', 'description')?.length > 20, 'description');
        assert.equal(canonical(html), `https://move.example${path}`);
        assert.equal(meta(html, 'property', 'og:url'), `https://move.example${path}`);
        assert.equal(meta(html, 'property', 'og:title'), html.match(/<title>(.*?)<\/title>/)[1]);
        assert.match(meta(html, 'property', 'og:image'), /^https:\/\/move\.example\/icon\/.+\.png$/);
        assert.equal(meta(html, 'name', 'robots'), undefined);
    });
}

test('pages that aren\'t for search results are noindex', () => {
    for (const html of [pages['/offline'], pages['/el/offline'], notFound.en, notFound.el, render({ title: 'Admin', content: '' })]) {
        assert.equal(meta(html, 'name', 'robots'), 'noindex');
        assert.equal(canonical(html), undefined);
        assert.equal(meta(html, 'name', 'description'), undefined);
    }
});

for (const path of indexed) {
    test(`${path}: the English and Greek pages point at each other`, () => {
        const expected = { en: `https://move.example${path}`, el: `https://move.example${localPath(path, 'el')}`, 'x-default': `https://move.example${path}` };
        assert.deepEqual(alternates(pages[path]), expected);
        assert.deepEqual(alternates(pages[localPath(path, 'el')]), expected);
    });
}

test('Greek pages are in Greek before any script runs', () => {
    const html = pages['/el/subway'];
    assert.match(html, /<html lang="el" data-page-lang="el"/);
    assert.equal(html.match(/<title>(.*?)<\/title>/)[1], 'Μετρό — Move');
    assert.equal(meta(html, 'name', 'description'), tools.find(t => t.id === 'subway').description.el);
    assert.equal(meta(html, 'property', 'og:locale'), 'el_GR');
    assert.match(html, /data-i18n="shell\.skip">Μετάβαση στο περιεχόμενο</);
    // Links to pages stay in Greek; other links don't change
    assert.match(html, /href="\/el"[^>]*>Move</);
    assert.match(html, /href="\/el\/buses"/);
    assert.doesNotMatch(html, /<a [^>]*href="\/(subway|buses|info)"/);
    assert.match(html, /href="\/icon\/site\.webmanifest"/);
});

test('English pages stay as written', () => {
    assert.match(pages['/subway'], /<html lang="en" data-page-lang="en"/);
    assert.match(pages['/subway'], /data-i18n="shell\.skip">Skip to content</);
    assert.doesNotMatch(pages['/subway'], /href="\/el/);
});

test('a missing page under /el gets the Greek 404', async () => {
    const res = await fetch(`${base}/el/nope`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /<html lang="el"/);
    assert.match(await (await fetch(`${base}/nope`)).text(), /<html lang="en"/);
});

test('the Greek pages are served and work offline', async () => {
    for (const path of ['/el', '/el/subway', '/el/info', '/el/offline']) {
        assert.equal((await fetch(base + path)).status, 200, path);
    }
    const sw = await (await fetch(`${base}/sw.js`)).text();
    for (const path of ['/el', '/el/offline', '/el/subway', '/el/info']) assert.ok(sw.includes(`"${path}"`), `${path} is precached`);
    assert.match(sw, /'\/el\/offline'/);
});

test('the home page describes Move as a web app', () => {
    const data = JSON.parse(pages['/'].match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    assert.equal(data['@type'], 'WebApplication');
    assert.equal(data.url, 'https://move.example/');
    assert.equal(data.offers.price, '0');
});

test('without SITE_URL the pages leave out absolute URLs', () => {
    const saved = process.env.SITE_URL;
    delete process.env.SITE_URL;
    try {
        const html = renderPages(tools).pages['/'];
        assert.equal(canonical(html), undefined);
        assert.equal(meta(html, 'property', 'og:image'), undefined);
        assert.ok(meta(html, 'name', 'description'));
    } finally {
        process.env.SITE_URL = saved;
    }
});

test('robots.txt keeps crawlers off the API and points at the sitemap', async () => {
    const res = await fetch(`${base}/robots.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    const text = await res.text();
    assert.match(text, /^Disallow: \/api\/$/m);
    assert.match(text, /^Sitemap: https:\/\/move\.example\/sitemap\.xml$/m);
});

test('the sitemap lists every indexed page at the public address', async () => {
    const res = await fetch(`${base}/sitemap.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /xml/);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
    assert.deepEqual(locs, indexed.flatMap(p => [`https://move.example${p}`, `https://move.example${localPath(p, 'el')}`]));
    assert.match(xml, /<xhtml:link rel="alternate" hreflang="el" href="https:\/\/move\.example\/el\/subway"\/>/);
});
