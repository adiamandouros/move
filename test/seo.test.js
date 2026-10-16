import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPages, loadTools, renderPages } from '../server/pages.js';

// What search engines and link previews see: meta tags, robots.txt and the sitemap

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
    app.use(createPages(tools).router);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('the home page and every tool are indexed', () => {
    assert.deepEqual(indexed, ['/', ...tools.map(t => t.path)]);
});

for (const path of indexed) {
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
    for (const html of [pages['/offline'], notFound, render({ title: 'Admin', content: '' })]) {
        assert.equal(meta(html, 'name', 'robots'), 'noindex');
        assert.equal(canonical(html), undefined);
        assert.equal(meta(html, 'name', 'description'), undefined);
    }
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
    const locs = [...(await res.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
    assert.deepEqual(locs, indexed.map(p => `https://move.example${p}`));
});
