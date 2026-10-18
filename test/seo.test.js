import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import { localPath } from '../server/pages/i18n.js';
import { createPages, renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';

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

test('the home page, every tool and the about, privacy and contact pages are indexed', () => {
    assert.deepEqual(indexed, ['/', ...tools.map(t => t.path), '/about', '/privacy', '/contact']);
});

test('the about, privacy and contact pages are written in each language and linked from every page', async () => {
    for (const name of ['about', 'privacy', 'contact']) {
        assert.match(pages[`/${name}`], /<html lang="en"/);
        assert.match(pages[`/el/${name}`], /<html lang="el"/);
    }
    assert.match(pages['/privacy'], /<h1>Privacy<\/h1>[\s\S]*Last updated: 18 October 2026/);
    assert.match(pages['/el/privacy'], /<h1>Απόρρητο<\/h1>[\s\S]*Τελευταία ενημέρωση: 18 Οκτωβρίου 2026/);
    for (const path of ['/', '/subway', '/el/info']) {
        const footer = pages[path].match(/<footer class="site-footer"[\s\S]*?<\/footer>/)[0];
        const prefix = path.startsWith('/el') ? '/el' : '';
        for (const name of ['about', 'privacy', 'contact']) assert.ok(footer.includes(`href="${prefix}/${name}"`), `${path} links to ${name}`);
    }
    assert.match(pages['/el/subway'], /href="\/el\/privacy" data-i18n="footer\.privacy">Απόρρητο</);
});

test('the contact page shows CONTACT_EMAIL, and leaves it out when unset', () => {
    const saved = process.env.CONTACT_EMAIL;
    try {
        process.env.CONTACT_EMAIL = 'hello@wayhop.example';
        assert.match(renderPages(tools).pages['/contact'], /Email: <a href="mailto:hello@wayhop\.example">hello@wayhop\.example<\/a>/);
        delete process.env.CONTACT_EMAIL;
        const html = renderPages(tools).pages['/el/contact'];
        assert.doesNotMatch(html, /mailto:/);
        assert.match(html, /github\.com\/adiamandouros\/move\/issues/);
    } finally {
        if (saved === undefined) delete process.env.CONTACT_EMAIL;
        else process.env.CONTACT_EMAIL = saved;
    }
});

const alternates = html => Object.fromEntries([...head(html).matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => m.slice(1)));

for (const path of indexed.flatMap(p => [p, localPath(p, 'el')])) {
    test(`${path}: has a description, canonical URL and link preview`, () => {
        const html = pages[path];
        assert.ok(meta(html, 'name', 'description')?.length > 20, 'description');
        assert.equal(canonical(html), `https://move.example${path}`);
        assert.equal(meta(html, 'property', 'og:url'), `https://move.example${path}`);
        assert.equal(meta(html, 'property', 'og:title'), html.match(/<title>(.*?)<\/title>/)[1]);
        assert.equal(meta(html, 'property', 'og:image'), 'https://move.example/icon/og-image.png');
        assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image');
        assert.equal(meta(html, 'name', 'robots'), undefined);
    });
}

test('pages that aren\'t for search results are noindex', () => {
    for (const html of [pages['/offline'], pages['/el/offline'], notFound('/nope'), notFound('/el/nope'), render({ title: 'Admin', content: '' })]) {
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

// <a> tags, without the language links
const pageLinks = html => (html.match(/<a\b[^>]*>/g) ?? []).filter(a => !/\shreflang="/.test(a)).join('\n');

test('Greek pages are in Greek before any script runs', () => {
    const html = pages['/el/subway'];
    assert.match(html, /<html lang="el"/);
    assert.equal(html.match(/<title>(.*?)<\/title>/)[1], 'Μετρό — Wayhop');
    assert.equal(meta(html, 'name', 'description'), tools.find(t => t.id === 'subway').description.el);
    assert.equal(meta(html, 'property', 'og:locale'), 'el_GR');
    assert.match(html, /data-i18n="shell\.skip">Μετάβαση στο περιεχόμενο</);
    // Links to pages stay in Greek; other links don't change
    assert.match(html, /href="\/el"[^>]*>.*?wayhop</);
    assert.match(html, /href="\/el\/buses"/);
    assert.doesNotMatch(pageLinks(html), /href="\/(subway|buses|info)"/);
    assert.match(html, /<link rel="manifest" href="\/el\/manifest\.webmanifest">/);
    assert.match(html, /href="\/icon\/favicon\.svg"/);
    // The page's strings, for its scripts, are Greek only
    const strings = JSON.parse(html.match(/<script type="application\/json" id="strings">(.*?)<\/script>/)[1]);
    assert.equal(strings['shell.skip'], 'Μετάβαση στο περιεχόμενο');
    assert.equal(strings['tool.subway.title'], 'Μετρό');
});

test('English pages are in English, with English links', () => {
    assert.match(pages['/subway'], /<html lang="en"/);
    assert.match(pages['/subway'], /data-i18n="shell\.skip">Skip to content</);
    assert.doesNotMatch(pageLinks(pages['/subway']), /href="\/el/);
});

test('every page links to itself in the other language: sidebar, footer and a suggestion', () => {
    const languageLinks = html => html.match(/<a href="[^"]*" hreflang="[^"]*"[^>]*>[\s\S]*?<\/a>/g) ?? [];
    for (const [path, other, lang, name, suggest] of [
        ['/subway', '/el/subway', 'el', 'Ελληνικά', 'Διαβάστε το Wayhop στα ελληνικά'],
        ['/el/subway', '/subway', 'en', 'English', 'Read Wayhop in English'],
        ['/', '/el', 'el', 'Ελληνικά', 'Διαβάστε το Wayhop στα ελληνικά'],
        ['/el', '/', 'en', 'English', 'Read Wayhop in English'],
    ]) {
        const [side, footer, suggestion] = ['lang-toggle-btn', 'footer-language', 'lang-suggest'].map(cls =>
            pages[path].match(new RegExp(`<(a|div)\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>[\\s\\S]*?</\\1>`))?.[0]);
        assert.equal(languageLinks(pages[path]).length, 3, `${path}: three language links`);
        for (const link of [side, footer]) assert.ok(link?.startsWith(`<a href="${other}" hreflang="${lang}"`), link);
        // Named in its own language; in the sidebar EN / ΕΛ is for sighted users, in the footer the name shows
        assert.match(side, new RegExp(`<span class="sr-only" lang="${lang}">${name}</span>`));
        assert.match(footer, new RegExp(`lang="${lang}" class="footer-language d-md-none">${name}</a>`));
        // The suggestion is hidden until shell.js offers it, in the other language
        assert.match(suggestion, new RegExp(`^<div class="lang-suggest" lang="${lang}" hidden>`));
        assert.ok(suggestion.includes(`hreflang="${lang}">${suggest}</a>`), suggestion);
    }
    // The bottom bar (phones) starts with the home page, highlighted there
    const bottom = html => html.match(/<nav id="bottom-nav"[\s\S]*?<\/nav>/)[0];
    assert.match(bottom(pages['/']), /^<nav[^>]*>\s*<a href="\/" class="nav-btn [^"]*active" aria-current="page"><img src="\/icon\/logo\.svg" alt=""/);
    assert.match(bottom(pages['/el/subway']), /<a href="\/el" class="nav-btn [^"]*py-2"><img src="\/icon\/logo\.svg" alt="" width="33" height="24" class="nav-logo"><span class="nav-label" data-i18n="nav.home">Αρχική</);
    assert.doesNotMatch(bottom(pages['/subway']), /hreflang/);
    // The 404 links to the same address in the other language; English-only pages have no language link
    assert.match(notFound('/el/nope'), /<a href="\/nope" hreflang="en"/);
    assert.doesNotMatch(render({ title: 'Admin', content: '' }), /hreflang=/);
});

test('a saved choice of the other language opens the page in it before it shows', () => {
    const redirect = html => html.match(/<head>\s*<meta charset="UTF-8">\s*<meta name="viewport"[^>]*>\s*<script>([\s\S]*?)<\/script>/)?.[1];
    assert.match(redirect(pages['/subway']), /localStorage\.getItem\('language'\) === 'el'\) location\.replace\("\/el\/subway" \+ location\.search \+ location\.hash\)/);
    assert.match(redirect(pages['/el/info']), /=== 'en'\) location\.replace\("\/info" \+/);
    assert.match(redirect(notFound('/a/b')), /location\.replace\("\/el\/a\/b" \+/);
    assert.equal(redirect(render({ title: 'Admin', content: '' })), undefined);
    // The address can't break out of the script
    assert.doesNotMatch(notFound('/</script><b>'), /<\/script><b>/);
});

test('text written in both languages keeps only the page\'s language', () => {
    assert.match(pages['/info'], /<th scope="row"><span>Piraeus<\/span><\/th>/);
    assert.match(pages['/el/info'], /<th scope="row"><span>Πειραιάς<\/span><\/th>/);
    assert.doesNotMatch(pages['/info'], /Πειραιάς|data-lang=/);
    assert.doesNotMatch(pages['/el/info'], /Piraeus|data-lang=/);
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

test('the home page describes Wayhop as a web app', () => {
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

test('each language has its own app manifest, so the installed app opens in it', async () => {
    assert.match(pages['/subway'], /<link rel="manifest" href="\/manifest\.webmanifest">/);
    for (const [path, lang, start] of [['/manifest.webmanifest', 'en', '/'], ['/el/manifest.webmanifest', 'el', '/el']]) {
        const res = await fetch(base + path);
        assert.equal(res.status, 200, path);
        assert.match(res.headers.get('content-type'), /^application\/manifest\+json/);
        const manifest = await res.json();
        assert.equal(manifest.lang, lang);
        assert.equal(manifest.start_url, start);
        assert.equal(manifest.id, '/', 'one app in both languages');
        assert.equal(manifest.display, 'standalone');
        assert.ok(manifest.description.length > 20);
        assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
    }
});

test('the share image and every manifest icon exist', () => {
    assert.ok(existsSync('public/icon/og-image.png'));
    const manifest = JSON.parse(readFileSync('public/icon/site.webmanifest', 'utf8'));
    assert.equal(manifest.name, 'Wayhop');
    for (const icon of manifest.icons) assert.ok(existsSync('public' + icon.src), icon.src);
    assert.deepEqual(new Set(manifest.icons.map(i => i.purpose)), new Set(['any', 'maskable']));
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
