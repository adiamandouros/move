import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { renderStationPage } from '../server/pages/stations.js';
import { athensNow, planTrip } from '../tools/subway/client/network.js';
import { rail as smallRail } from './fixtures/rail.js';
import { browserModule } from './support/browser-modules.js';

// Data from outside (OASA's and STASY's websites, the open data, the station
// editor) is shown as text wherever it's drawn, never run as HTML. The bus
// page's own case is in bus-render.test.js.

const EVIL = '<img src=x onerror="alert(1)">';
const ESCAPED = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';
const safe = (view, where) => {
    const text = String(view);
    assert.doesNotMatch(text, /<img src=x|onerror="/, where);
    assert.ok(text.includes(ESCAPED), `${where}: the text is still shown`);
};

// A copy of a network with markup in every name and note
function hostile(rail) {
    const copy = structuredClone(rail);
    for (const station of Object.values(copy.stations)) station.name = { en: `${EVIL} ${station.name.en}`, el: `${EVIL} ${station.name.el}` };
    for (const line of Object.values(copy.lines)) {
        for (const direction of Object.values(line.directions)) {
            direction.toward = { en: EVIL, el: EVIL };
            for (const stop of direction.stops) stop.note = EVIL;
        }
    }
    return copy;
}

test('station pages', () => {
    const tools = loadTools();
    const { render } = renderPages(tools);
    const rail = hostile(smallRail);
    for (const lang of ['en', 'el']) {
        safe(renderStationPage(rail, 'x', lang, { render, tools }), `station x, ${lang}`);
        safe(renderStationPage(rail, null, lang, { render, tools }), `station index, ${lang}`);
    }
});

const realRail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));

test('the subway planner\'s result', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const rail = hostile(realRail);
    const { plans, now, tomorrow } = planTrip(rail, 'kifisia', 'aigaleo', athensNow(new Date('2026-10-21T09:00:00Z')));
    safe(render.renderResult(rail, plans, now, { expired: false, tomorrow }), 'route result');
});

test('the subway planner\'s station suggestions', async () => {
    const { stationSearch } = await browserModule('tools/subway/client/search.js', 'en');
    // Just enough of the page for the station field
    const handlers = {};
    const on = (target, name) => (event, fn) => { handlers[`${target}.${event}`] = fn; };
    const input = { value: '', addEventListener: on('input'), setAttribute() {}, closest: () => ({ addEventListener: on('wrap') }) };
    const list = { hidden: true, innerHTML: '', addEventListener: on('list') };
    const rail = hostile(realRail);
    stationSearch({ input, list, rail, onChange() {} });
    input.value = '<img';
    handlers['input.input']();
    assert.equal(list.hidden, false);
    safe(list.innerHTML, 'suggestions');
});

test('the Info page\'s list of stations', async () => {
    const { stationList } = await browserModule('tools/info/client/map.js', 'en');
    safe(stationList(hostile(realRail)), 'station list');
});

test('announcements: titles are text, and only web addresses are linked', async () => {
    const { item } = await browserModule('public/js/core/announcements.js', 'en');
    const date = '2026-10-20T10:00:00.000Z';
    const linked = String(item({ title: EVIL, link: 'https://www.oasa.gr/news/1/', date }, false));
    safe(linked, 'announcement');
    assert.match(linked, /<a href="https:\/\/www\.oasa\.gr\/news\/1\/" target="_blank" rel="noopener">/);
    // A javascript: link (from a copy kept from before the server dropped them) isn't linked
    const unlinked = String(item({ title: 'Closed', link: 'javascript:alert(1)', date }, true));
    assert.doesNotMatch(unlinked, /<a\b|javascript:/);
    assert.match(unlinked, /<span lang="el">Closed<\/span>/);
});
