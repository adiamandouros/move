import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import { loadConfig } from '../server/config.js';
import { localPath } from '../server/pages/i18n.js';
import { createPages, renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';

// What search engines and link previews see: meta tags, the Greek pages under
// /el, robots.txt and the sitemap

const config = loadConfig({ SITE_URL: 'https://move.example/' });
const tools = loadTools();
const { pages, indexed, notFound, render } = renderPages(tools, config);

const head = html => html.match(/<head>([\s\S]*?)<\/head>/)[1];
const meta = (html, attr, name) => head(html).match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];
const canonical = html => head(html).match(/<link rel="canonical" href="([^"]*)">/)?.[1];

let server;
let base;
before(async () => {
    const app = express();
    const served = createPages(tools, { config });
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
    assert.match(pages['/privacy'], /<h1>Privacy<\/h1>[\s\S]*Last updated: 26 October 2026/);
    assert.match(pages['/privacy'], /The last three metro stations you picked/);
    assert.match(pages['/privacy'], /The metro stations you starred as favourites/);
    assert.match(pages['/el/privacy'], /Οι σταθμοί μετρό που σημειώσατε ως αγαπημένους/);
    assert.match(pages['/el/privacy'], /<h1>Απόρρητο<\/h1>[\s\S]*Τελευταία ενημέρωση: 26 Οκτωβρίου 2026/);
    assert.match(pages['/el/privacy'], /Οι τρεις τελευταίοι σταθμοί μετρό που επιλέξατε/);
    // No hosting details: who hosts the site and where is nothing a visitor needs
    for (const name of ['about', 'privacy', 'contact']) {
        assert.doesNotMatch(pages[`/${name}`] + pages[`/el/${name}`], /Mediahost|cPanel/i);
    }
    // Every page links to them: in the sidebar, and in the menu on phones
    for (const path of ['/', '/el', '/subway', '/el/info', '/about']) {
        const prefix = path.startsWith('/el') ? '/el' : '';
        const side = pages[path].match(/<div class="side-links">[\s\S]*?<\/div>/)[0];
        const menu = pages[path].match(/<nav id="site-menu"[\s\S]*?<\/nav>/)[0];
        for (const name of ['about', 'privacy', 'contact']) {
            assert.ok(side.includes(`href="${prefix}/${name}"`), `${path}: sidebar links to ${name}`);
            assert.ok(menu.includes(`href="${prefix}/${name}"`), `${path}: menu links to ${name}`);
        }
    }
    assert.match(pages['/el'], /href="\/el\/privacy" class="site-menu-link"><svg[^>]*>[\s\S]*?<\/svg><span>Απόρρητο</);
    // No footer: the menu replaced it
    assert.doesNotMatch(pages['/'] + pages['/subway'], /<footer/);
    // The about page doesn't repeat them
    assert.doesNotMatch(pages['/about'] + pages['/el/about'], /prose-links/);
});

test('the about pages credit the author with a link to their GitHub profile', () => {
    const { pages } = renderPages(tools, loadConfig({}));
    assert.match(pages['/about'], /Created by <a [^>]*href="https:\/\/github\.com\/adiamandouros"[^>]*>adiamandouros/);
    assert.match(pages['/el/about'], /Δημιουργός: <a [^>]*href="https:\/\/github\.com\/adiamandouros"[^>]*>adiamandouros/);
});

test('the contact page shows CONTACT_EMAIL, and leaves it out when unset', () => {
    assert.match(renderPages(tools, loadConfig({ CONTACT_EMAIL: 'hello@wayhop.example' })).pages['/contact'], /Email: <a href="mailto:hello@wayhop\.example">hello@wayhop\.example<\/a>/);
    const html = renderPages(tools, loadConfig({})).pages['/el/contact'];
    assert.doesNotMatch(html, /mailto:/);
    assert.match(html, /github\.com\/adiamandouros\/move\/issues/);
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
    assert.match(html, /class="skip-link">Μετάβαση στο περιεχόμενο</);
    assert.match(html, /<nav id="side-nav"[^>]*aria-label="Κύρια πλοήγηση"/);
    // Links to pages stay in Greek; other links don't change
    assert.match(html, /href="\/el"[^>]*>.*?wayhop</);
    assert.match(html, /href="\/el\/buses"/);
    assert.doesNotMatch(pageLinks(html), /href="\/(subway|buses|info)"/);
    assert.match(html, /<link rel="manifest" href="\/el\/manifest\.webmanifest">/);
    assert.match(html, /href="\/icon\/favicon\.svg"/);
    // The strings its scripts use are Greek only
    const strings = JSON.parse(html.match(/<script type="application\/json" id="strings">(.*?)<\/script>/)[1]);
    assert.equal(strings['shell.skip'], 'Μετάβαση στο περιεχόμενο');
    assert.equal(strings['subway.legend'], 'Τι δείχνει το τρένο');
});

test('English pages are in English, with English links', () => {
    assert.match(pages['/subway'], /<html lang="en"/);
    assert.match(pages['/subway'], /class="skip-link">Skip to content</);
    assert.match(pages['/subway'], /<nav id="bottom-nav"[^>]*aria-label="Main navigation"/);
    assert.doesNotMatch(pageLinks(pages['/subway']), /href="\/el/);
});

test('every page links to itself in the other language: sidebar, menu and a suggestion', () => {
    const languageLinks = html => html.match(/<a href="[^"]*" hreflang="[^"]*"[^>]*>[\s\S]*?<\/a>/g) ?? [];
    for (const [path, other, lang, name, suggest] of [
        ['/subway', '/el/subway', 'el', 'Ελληνικά', 'Διαβάστε το Wayhop στα ελληνικά'],
        ['/el/subway', '/subway', 'en', 'English', 'Read Wayhop in English'],
        ['/', '/el', 'el', 'Ελληνικά', 'Διαβάστε το Wayhop στα ελληνικά'],
        ['/el', '/', 'en', 'English', 'Read Wayhop in English'],
    ]) {
        const [side, menu, suggestion] = ['lang-toggle-btn', 'menu-language', 'lang-suggest'].map(cls =>
            pages[path].match(new RegExp(`<(a|div)\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>[\\s\\S]*?</\\1>`))?.[0]);
        assert.equal(languageLinks(pages[path]).length, 3, `${path}: three language links`);
        for (const link of [side, menu]) assert.ok(link?.startsWith(`<a href="${other}" hreflang="${lang}"`), link);
        // Named in its own language; in the sidebar EN / ΕΛ is for sighted users, in the menu the name shows
        assert.match(side, new RegExp(`<span class="sr-only" lang="${lang}">${name}</span>`));
        assert.match(menu, new RegExp(`lang="${lang}" class="site-menu-link menu-language">.*<span>${name}</span></a>`));
        // The suggestion is hidden until shell.js offers it, in the other language
        assert.match(suggestion, new RegExp(`^<div class="lang-suggest" lang="${lang}" hidden>`));
        assert.ok(suggestion.includes(`hreflang="${lang}">${suggest}</a>`), suggestion);
    }
    // The bottom bar (phones) starts with the home page, highlighted there
    const bottom = html => html.match(/<nav id="bottom-nav"[\s\S]*?<\/nav>/)[0];
    assert.match(bottom(pages['/']), /^<nav[^>]*>\s*<a href="\/" class="nav-btn [^"]*active" aria-current="page"><svg class="logo nav-logo"/);
    assert.match(bottom(pages['/el/subway']), /<a href="\/el" class="nav-btn [^"]*py-2"><svg class="logo nav-logo" width="33" height="24" [^>]*aria-hidden="true"[^>]*>.*?<\/svg><span class="nav-label">Αρχική</s);
    assert.doesNotMatch(bottom(pages['/subway']), /hreflang/);
    // The current tab's icon is filled, the others outline (DESIGN.md)
    assert.match(bottom(pages['/subway']), /aria-current="page"><svg class="icon icon-nav"[^>]*><use href="[^"]*#metro-filled">/);
    assert.match(bottom(pages['/subway']), /data-tool="buses"[^>]*><svg class="icon icon-nav"[^>]*><use href="[^"]*#bus">/);
    // …and ends with the button that opens the menu: only the icon, named for screen readers
    assert.match(bottom(pages['/el/subway']), /<button type="button" class="nav-btn menu-btn [^"]*" popovertarget="site-menu" aria-label="Μενού"><svg class="icon icon-nav"[^>]*><use href="[^"]*#menu"><\/use><\/svg><\/button>\s*<\/nav>/);
    assert.match(pages['/subway'], /<nav id="site-menu" class="site-menu d-md-none" popover aria-label="Menu"/);
    // The 404 links to the same address in the other language; English-only pages have no language link
    assert.match(notFound('/el/nope'), /<a href="\/nope" hreflang="en"/);
    assert.doesNotMatch(render({ title: 'Admin', content: '' }), /hreflang=/);
});

test('the navigation and the home tiles mark their links to the tools, which go back to where each was left', () => {
    // (public/js/core/remember.js points them at it; other links, like the
    // station pages' "Plan from here", say where they go themselves)
    const toolLinks = html => [...html.matchAll(/<a href="([^"]*)" data-tool="([^"]*)"/g)].map(([, href, tool]) => `${tool} ${href}`);
    const nav = lang => tools.map(tool => `${tool.id} ${localPath(tool.path, lang)}`);
    assert.deepEqual(toolLinks(pages['/el/info']), [...nav('el'), ...nav('el')], 'sidebar and bottom bar');
    assert.deepEqual(toolLinks(pages['/']), [...nav('en'), ...nav('en'), ...nav('en')], 'and the home tiles');
    assert.equal(pages['/'].match(/<a href="[^"]*" data-tool=/g).length, pages['/'].match(/data-tool=/g).length);
    assert.doesNotMatch(pages['/'].match(/<a href="\/subway\/stations"[^>]*>/)[0], /data-tool/, 'the stations tile isn’t a tool');
});

test('a saved choice of the other language opens the page in it before it shows', () => {
    const redirect = html => html.match(/<head>\s*<meta charset="UTF-8">\s*<meta name="viewport"[^>]*>\s*<script>([\s\S]*?)<\/script>/)?.[1];
    const html = page => page.match(/<html[^>]*>/)[0];
    // The same script everywhere (so the Content-Security-Policy allows it by one hash)…
    assert.match(redirect(pages['/subway']), /localStorage\.getItem\('language'\) === root\.dataset\.otherLang\) location\.replace\(root\.dataset\.otherPath \+ location\.search \+ location\.hash\)/);
    assert.equal(redirect(pages['/el/info']), redirect(pages['/subway']));
    assert.equal(redirect(notFound('/a/b')), redirect(pages['/subway']));
    // …reading which page is the other language's from <html>
    assert.match(html(pages['/subway']), / data-other-lang="el" data-other-path="\/el\/subway"/);
    assert.match(html(pages['/el/info']), / data-other-lang="en" data-other-path="\/info"/);
    assert.match(html(notFound('/a/b')), / data-other-path="\/el\/a\/b"/);
    // Pages without an address of their own (admin) have neither
    assert.equal(redirect(render({ title: 'Admin', content: '' })), undefined);
    assert.doesNotMatch(html(render({ title: 'Admin', content: '' })), /data-other/);
    // The address can't break out of its attribute
    assert.match(html(notFound('/"><script>x</script>')), /data-other-path="\/el\/&quot;&gt;&lt;script&gt;/);
});

test('text written in both languages keeps only the page\'s language', () => {
    // The tram rows of the closing times
    assert.match(pages['/info'], /<th scope="row">Syntagma<\/th>/);
    assert.match(pages['/el/info'], /<th scope="row">Σύνταγμα<\/th>/);
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
    const html = renderPages(tools, loadConfig({})).pages['/'];
    assert.equal(canonical(html), undefined);
    assert.equal(meta(html, 'property', 'og:image'), undefined);
    assert.ok(meta(html, 'name', 'description'));
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

test('the tab icon turns light, with the light logo ring, when the browser asks for it', () => {
    const svg = readFileSync('public/icon/favicon.svg', 'utf8');
    const light = svg.match(/@media \(prefers-color-scheme: light\)\{([^<]*)\}<\/style>/)?.[1] ?? '';
    assert.match(light, /\.tile\{fill:#fff\}/);
    // The light mode's ring (style.css's second --wh-brand-dot, the one the page's logo takes)
    const lightRing = [...readFileSync('public/css/style.css', 'utf8').matchAll(/--wh-brand-dot: (#[0-9a-f]{6});/g)][1][1];
    assert.equal(lightRing, '#e89b00');
    assert.match(light, new RegExp(`\\.ring\\{stroke:${lightRing}\\}`));
    assert.match(light, new RegExp(`\\.dot\\{fill:${lightRing}\\}`));
    assert.match(svg, /class="ring" stroke="#ffc107"/, 'dark stays the default');
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
