import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { loadConfig } from '../server/config.js';
import { createPages, renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { stationPage } from '../server/pages/stations.js';
import { rail } from './fixtures/rail.js';

// AdSense is off until ADSENSE_CLIENT is set; each ADSENSE_SLOT_* adds one ad
// unit. (Which settings count, and the problems with wrong ones: config.test.js.)

const CLIENT = 'ca-pub-1234567890123456';
const tools = loadTools();

function withEnv(env) {
    const rendered = renderPages(tools, loadConfig(env));
    const station = rendered.renderPage(stationPage(rail, 'x', { tools }), 'en');
    return { ...rendered, station };
}

async function adsTxt(env) {
    const app = express();
    app.use(createPages(tools, { config: loadConfig(env) }).router);
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    try {
        const res = await fetch(`http://localhost:${server.address().port}/ads.txt`);
        return { status: res.status, text: await res.text() };
    } finally {
        server.close();
    }
}

const slots = html => (html.match(/<ins class="adsbygoogle/g) ?? []).length;

test('without ADSENSE_CLIENT there is no trace of ads', async () => {
    const { pages, notFound, station } = withEnv({ ADSENSE_SLOT_HOME: '1234567890' });
    for (const html of [...Object.values(pages), notFound('/nope'), station]) {
        // (the import map lists every core module, ads.js too, but nothing loads it)
        assert.doesNotMatch(html, /adsbygoogle|google-adsense-account|src="\/js\/core\/ads\.js|ad-slot/);
        assert.doesNotMatch(html, /<!-- \/?(with|without) ads -->/);
    }
    assert.match(pages['/privacy'], /uses no cookies or analytics/);
    assert.doesNotMatch(pages['/privacy'], /id="advertising"/);
    assert.doesNotMatch(pages['/terms'], /<h2>Ads<\/h2>/);
    assert.equal((await adsTxt({})).status, 404);
});

test('ADSENSE_CLIENT alone: the verification tag and ads.txt for the review, the ads privacy page, no ads', async () => {
    const { pages, notFound, station } = withEnv({ ADSENSE_CLIENT: CLIENT });
    for (const html of [...Object.values(pages), notFound('/el/nope'), station]) {
        assert.match(html, /<meta name="google-adsense-account" content="ca-pub-1234567890123456">/);
        assert.equal(slots(html), 0);
    }
    assert.deepEqual(await adsTxt({ ADSENSE_CLIENT: CLIENT }), { status: 200, text: 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n' });

    const privacy = pages['/privacy'];
    // Neither the page nor its description (the embedded string table holds every string, unused ones too)
    assert.doesNotMatch(privacy.replace(/<script type="application\/json" id="strings">.*?<\/script>/s, ''), /uses no cookies/);
    // (escaped by the view: Handlebars writes ' as &#x27;)
    assert.match(privacy, /<meta name="description" content="Wayhop has no accounts or analytics and doesn&#x27;t track you itself/);
    assert.match(privacy, /<h2 id="advertising">Advertising<\/h2>/);
    assert.match(privacy, /<button type="button" id="ad-choices"[^>]*data-ad-client="ca-pub-1234567890123456" hidden>Change your ad choices<\/button>/);
    assert.match(privacy, /src="\/js\/core\/ads\.js\?v=/);
    assert.match(pages['/el/privacy'], /<h2 id="advertising">Διαφημίσεις<\/h2>/);
    // The terms: Google chooses the ads, not Wayhop
    assert.match(pages['/terms'], /<h2>Ads<\/h2>\s*<p>The ads come from Google\. Wayhop doesn't choose them/);
    assert.match(pages['/el/terms'], /<h2>Διαφημίσεις<\/h2>/);
    assert.doesNotMatch(privacy + pages['/el/privacy'], /<!-- \/?(with|without) ads -->/);
});

test('each slot setting adds one labelled ad unit after the content, and only there', () => {
    const { pages, station } = withEnv({ ADSENSE_CLIENT: CLIENT, ADSENSE_SLOT_HOME: '1111111111', ADSENSE_SLOT_INFO: '2222222222', ADSENSE_SLOT_STATION: '3333333333' });
    for (const [html, slot] of [[pages['/'], '1111111111'], [pages['/el/info'], '2222222222'], [station, '3333333333']]) {
        assert.equal(slots(html), 1);
        assert.match(html, new RegExp(`<ins class="adsbygoogle ad-unit" data-ad-client="${CLIENT}" data-ad-slot="${slot}"></ins>`));
        assert.match(html, /<aside class="ad-slot" aria-labelledby="ad-label">\s*<p class="ad-label" id="ad-label">Advertisement|Διαφήμιση</);
        // After the page's own content, last in it
        assert.match(html, /<\/div>\s*<aside class="ad-slot"[\s\S]*<\/aside>\s*<\/main>/);
        assert.match(html, /src="\/js\/core\/ads\.js\?v=/);
    }
    assert.match(pages['/el/info'], /<p class="ad-label" id="ad-label">Διαφήμιση</);
    // Never on the live tools, the offline page, or the text pages
    for (const path of ['/subway', '/buses', '/offline', '/about', '/contact', '/el/subway']) {
        assert.equal(slots(pages[path]), 0, path);
        assert.doesNotMatch(pages[path], /src="\/js\/core\/ads\.js/, path);
    }
});

test('a slot without its own setting stays off', () => {
    const { pages, station } = withEnv({ ADSENSE_CLIENT: CLIENT, ADSENSE_SLOT_HOME: '1111111111' });
    assert.equal(slots(pages['/']), 1);
    assert.equal(slots(pages['/info']), 0);
    assert.equal(slots(station), 0);
});

test('settings that look wrong leave ads off', () => {
    const { pages } = withEnv({ ADSENSE_CLIENT: 'pub-123', ADSENSE_SLOT_HOME: '1111111111' });
    assert.doesNotMatch(pages['/'], /adsbygoogle|google-adsense-account/);
});
