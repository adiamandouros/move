import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { stationPage } from '../server/pages/stations.js';
import { rail } from './fixtures/rail.js';

// Which pages fetch the Trip page's buses.json in the background
// (/js/core/ready-buses.js, decision 39): the ones people use to get about,
// not the ones they only read. What the script does in a page:
// test/browser/ready-buses.spec.js.

const tools = loadTools();
const { pages, renderPage } = renderPages(tools);
const SCRIPT = /<script type="module" src="\/js\/core\/ready-buses\.js\?v=[0-9a-f]+"><\/script>/;
const sent = html => JSON.parse(html.match(/<script type="application\/json" id="strings">(.*?)<\/script>/s)[1]);

test('Home, Subway, Buses and the station pages fetch it, in both languages', () => {
    for (const path of ['/', '/subway', '/buses', '/el', '/el/subway', '/el/buses']) assert.match(pages[path], SCRIPT, path);
    for (const id of [null, 'x']) {
        for (const lang of ['en', 'el']) assert.match(renderPage(stationPage(rail, id, { tools }), lang), SCRIPT, `station ${id} ${lang}`);
    }
});

test('the pages people only read don\'t, nor the Trip page, which loads it itself', () => {
    for (const path of ['/trip', '/info', '/about', '/terms', '/contact', '/privacy', '/offline', '/el/trip', '/el/info', '/el/privacy']) {
        assert.doesNotMatch(pages[path], SCRIPT, path);
    }
});

test('it needs no strings: a station page still sends none of its own', () => {
    assert.equal(sent(renderPage(stationPage(rail, 'x', { tools }), 'en'))['stations.next'], undefined);
});
