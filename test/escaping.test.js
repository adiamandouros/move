import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { listFiles } from '../server/pages/assets.js';
import { renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { renderStationPage } from '../server/pages/stations.js';
import { parseTemplate } from '../server/pages/templates.js';
import { athensNow, planTrip } from '../tools/subway/client/network.js';
import { rail as smallRail } from './fixtures/rail.js';
import { browserModule } from './support/browser-modules.js';

// Data from outside (OASA's and STASY's websites, the open data, the station
// editor) is shown as text wherever it's drawn, never run as HTML. The bus
// page's own case is in bus-render.test.js.

const EVIL = '<img src=x onerror="alert(1)">';
const ESCAPED = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';
// (Handlebars writes = as &#x3D;; browsers read both the same)
const safe = (view, where) => {
    const text = String(view);
    assert.doesNotMatch(text, /<img src=x|onerror="/, where);
    assert.ok(text.replaceAll('&#x3D;', '=').includes(ESCAPED), `${where}: the text is still shown`);
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

// HTML is written in two ways only, both escaping what goes in: Handlebars
// views (.hbs) and html`` (/js/core/html.js). Not in plain strings, and not
// put into a view with {{{three braces}}}, except the page inside the layout.
// (Strings may still start an XML or SVG document: the sitemap, the icon sprite.)
const XML = new Set(['xml', 'urlset', 'url', 'loc', 'xhtml:link', 'svg', 'symbol']);
const sources = dirs => dirs.flatMap(dir => listFiles(dir)).map(file => ({ file, text: readFileSync(file, 'utf8') }));

test('no HTML in plain strings: views or html`` only', () => {
    const found = [];
    for (const { file, text } of sources(['server', 'public/js', 'tools', 'admin']).filter(f => f.file.endsWith('.js'))) {
        // A string that starts with a tag, where a string can start (not inside html``)
        for (const m of text.matchAll(/(?:^|[=(,:?[{]|return|&&|\|\|)\s*(?<!html)[`'"]\s*<\/?\??([a-zA-Z][\w:]*)/gm)) {
            if (!XML.has(m[1])) found.push(`${file}:${text.slice(0, m.index).split('\n').length}`);
        }
    }
    assert.deepEqual(found, []);
});

test('views put nothing in unescaped but the page inside the layout', () => {
    const unescaped = [];
    const walk = (node, file) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'MustacheStatement' && node.escaped === false) unescaped.push(`${file}: {{{${node.path.original}}}}`);
        for (const value of Object.values(node)) if (value && typeof value === 'object' && value !== node.loc) walk(value, file);
    };
    for (const { file, text } of sources(['server/views', 'admin', 'tools']).filter(f => f.file.endsWith('.hbs'))) walk(parseTemplate(text), file);
    assert.deepEqual(unescaped, ['server/views/layout.hbs: {{{content}}}']);
});

test('what goes into <head> is escaped: title, description, structured data', () => {
    const { render } = renderPages(loadTools());
    const html = render({ title: EVIL, path: '/subway', description: EVIL, content: '', structuredData: { name: '</script><script>alert(1)</script>' }, styles: ['/admin/assets/admin.css'] });
    const head = html.slice(0, html.indexOf('</head>'));
    assert.doesNotMatch(head, /<img src=x|<\/script><script>alert/);
    assert.match(head, /<meta property="og:title" content="&lt;img src&#x3D;x onerror&#x3D;&quot;alert\(1\)&quot;&gt; — Wayhop">/);
    assert.match(head, /<script type="application\/ld\+json">\{"name":"\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>"\}<\/script>/);
    // A page's own stylesheets (the admin pages')
    assert.match(head, /<link rel="stylesheet" href="\/admin\/assets\/admin\.css">\n/);
});
