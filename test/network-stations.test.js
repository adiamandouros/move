import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { loadConfig } from '../server/config.js';
import { createPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { stringGetter } from '../server/pages/i18n.js';
import {
    firstAndLastByDate, suburbanIndexView, suburbanStationPage, suburbanStationView, tramIndexView, tramStopPage, tramStopView,
} from '../server/pages/network-stations.js';
import { stationView } from '../server/pages/stations.js';
import { browserModule, strings } from './support/browser-modules.js';
import { listen } from './support/listen.js';

// The tram's and the suburban railway's station pages (decision 55): one page
// per network, joined by the walks between them, from the browser tests' data
// (the tram in rail.json, the railway's trains of 20–25 Oct in trains.json)

const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
const trains = JSON.parse(readFileSync(new URL('./browser/data/trains.json', import.meta.url), 'utf8'));
const TODAY = '2026-10-21'; // a Wednesday
const tools = loadTools();
const s = lang => stringGetter(strings(lang), lang);
const en = s('en');
// What a reader sees of a piece of HTML
const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
const cards = view => view.lines.flatMap(line => line.directions);

test('first and last trains by date: only trains that go on from the stop, none on a date with no trains', () => {
    // Stops 0 → 1 → 2; one train turns back at 1
    const timetable = {
        profiles: [{ stops: [0, 1, 2], offsets: [0, 120, 300] }, { stops: [0, 1], offsets: [0, 120] }],
        patterns: [[], [[5 * 3600, 0], [22 * 3600, 0], [23 * 3600, 1]], [[6 * 3600, 0]]],
        days: [0, 0, 0, 0, 0, 0, 0],
        dates: { '2026-10-21': 1, '2026-10-22': 2 },
    };
    assert.deepEqual(firstAndLastByDate(timetable, 1, ['2026-10-21', '2026-10-22', '2026-10-23']), [
        { date: '2026-10-21', first: 5 * 3600 + 120, last: 22 * 3600 + 120 },
        { date: '2026-10-22', first: 6 * 3600 + 120, last: 6 * 3600 + 120 },
        { date: '2026-10-23', first: null, last: null },
    ]);
    assert.deepEqual(firstAndLastByDate(timetable, 2, ['2026-10-21']), [{ date: '2026-10-21', first: null, last: null }], 'the last stop: no departures');
});

test('a tram stop\'s page: its own sign, the walk to the metro station of the same name, a card per direction leaving, nothing said of steps', () => {
    const view = tramStopView(rail, 'syntagma', 'en', en, trains);
    assert.equal(view.plannerId, 'syntagma-tram', 'the planner\'s id, as Syntagma the metro station has its own');
    assert.equal(text(view.here), 'Tram stop on');
    assert.match(String(view.favourite), /data-favourite="station" data-key="syntagma-tram"/);
    assert.equal(view.changes.length, 1);
    assert.match(String(view.changes[0].text), /<a href="\/subway\/stations\/syntagma">Syntagma<\/a>/);
    assert.match(text(view.changes[0].text), /M2 , M3 Syntagma · ~4' about 4 minutes on foot/);
    // Syntagma is T6's end: one direction leaves from here
    assert.deepEqual(cards(view).map(card => text(card.endSign)), ['Pikrodafni']);
    const [card] = cards(view);
    assert.equal(card.previous, null);
    assert.deepEqual(card.next, { href: '/tram/stops/zappeio', name: 'Zappio' });
    assert.equal(card.stepFree.text, 'Step-free access: not known yet');
    assert.deepEqual(card.times.map(row => row.days), ['Mon–Thu', 'Fri', 'Sat', 'Sun']);
    assert.equal(card.arriving, null, 'no exits recorded for the tram');
    assert.ok(!view.lifts && !view.liftCaution, 'no lifts, no step-free claim');
    assert.deepEqual(view.timetable.gtfs, { old: true, date: '31/10/2026' }, 'the metro\'s feed, which ended on 31 Oct');
});

test('a tram stop named as a metro station elsewhere isn\'t joined to it: Kallithea on T7 is not M1\'s Kallithea', () => {
    const view = tramStopView(rail, 'kallithea', 'en', en, trains);
    assert.equal(view.plannerId, 'kallithea-tram');
    assert.deepEqual(view.changes, []);
    assert.equal(cards(view).length, 2, 'both directions of T7 leave from here');
    assert.ok(cards(view).every(card => card.previous && card.next));
});

test('a metro station\'s page lists the walks to the tram and the suburban railway', () => {
    const syntagma = stationView(rail, 'syntagma', 'en', en, trains);
    assert.equal(syntagma.changes.length, 1);
    assert.match(String(syntagma.changes[0].text), /<a href="\/tram\/stops\/syntagma">Syntagma<\/a>/);
    assert.match(String(syntagma.changes[0].text), /line-t6/);
    const piraeus = stationView(rail, 'piraeus', 'el', s('el'), trains);
    const toTrain = piraeus.changes.find(change => String(change.text).includes('/suburban/stations/piraeus'));
    assert.ok(toTrain, 'Piraeus links to the railway\'s Piraeus');
    assert.match(toTrain.note, /Ο σταθμός του Προαστιακού/, 'with the walk\'s note, in Greek');
    assert.deepEqual(stationView(rail, 'kallithea', 'en', en, trains).changes, []);
    assert.deepEqual(stationView(rail, 'syntagma', 'en', en).changes.length, 1, 'without trains.json, the tram\'s walks still');
});

test('a suburban station\'s page: by its own id, its trains by date from today, toward where each ends', () => {
    const view = suburbanStationView(rail, trains, 'piraeus', 'en', en, TODAY);
    assert.equal(view.plannerId, 'piraeus-suburban');
    assert.equal(text(view.here), 'Suburban railway station on');
    assert.match(String(view.changes[0].text), /<a href="\/subway\/stations\/piraeus">Piraeus<\/a>/);
    assert.match(view.changes[0].note, /isn’t in the metro’s building/);
    assert.equal(view.ticket, null, 'inside OASA\'s ticket');
    // Piraeus is where A1 and A4 begin
    assert.deepEqual(cards(view).map(card => text(card.lineBadge) + ' ' + text(card.endSign)), ['A1 Airport', 'A4 Kiato']);
    const [a1] = cards(view);
    assert.deepEqual(a1.times.map(row => row.days), ['Today, Wed 21/10', 'Thu 22/10', 'Fri 23/10', 'Sat 24/10', 'Sun 25/10'], 'yesterday left out');
    assert.ok(a1.times.every(row => /^\d\d:\d\d$/.test(row.first) && /^\d\d:\d\d$/.test(row.last) && row.none === null));
    assert.deepEqual(view.timetable, { suburban: true });
    assert.ok(!view.lifts);
});

test('a suburban station outside OASA\'s ticket says so; a date with no trains says "No trains"', () => {
    const quiet = structuredClone(trains);
    quiet.dates['2026-10-22'] = [];
    const view = suburbanStationView(rail, quiet, 'airport', 'en', en, TODAY);
    assert.equal(view.ticket, 'Needs a Hellenic Train ticket, as OASA\'s ticket doesn\'t cover Airport.');
    assert.equal(view.plannerId, 'airport-suburban');
    const rows = cards(view)[0].times;
    assert.deepEqual(rows[1], { days: 'Thu 22/10', first: '', last: '', none: 'No trains' });
    const greek = suburbanStationView(rail, trains, 'airport', 'el', s('el'), TODAY);
    assert.equal(cards(greek)[0].times[0].days, 'Σήμερα, Τετ 21/10');
});

test('the two stations at SKA link to each other, with the footbridge\'s note', () => {
    const view = suburbanStationView(rail, trains, 'ska-a3', 'en', en, TODAY);
    assert.equal(view.plannerId, 'ska-a3');
    assert.match(String(view.changes[0].text), /<a href="\/suburban\/stations\/ska">/);
    assert.match(view.changes[0].note, /footbridge/);
});

test('the indexes: each line\'s stops in order, the metro to change to, and the other networks\' indexes', () => {
    const tram = tramIndexView(rail, 'en', en);
    assert.deepEqual(tram.lines.map(line => line.key), ['t6', 't7']);
    const syntagma = tram.lines[0].stops[0];
    assert.equal(syntagma.href, '/tram/stops/syntagma');
    assert.match(String(syntagma.changes), /line-m2[^]*line-m3/);
    assert.deepEqual(tram.seeAlso.map(link => link.href), ['/subway/stations', '/suburban/stations']);

    const suburban = suburbanIndexView(rail, trains, 'en', en);
    assert.deepEqual(suburban.lines.map(line => line.key), ['a1', 'a2', 'a3', 'a4']);
    const piraeus = suburban.lines[0].stops.find(stop => stop.href === '/suburban/stations/piraeus');
    assert.match(String(piraeus.changes), /line-m1/);
    assert.doesNotMatch(String(piraeus.changes), /line-a4/, 'lines sharing the track aren\'t a change');
    assert.deepEqual(suburban.seeAlso.map(link => link.href), ['/subway/stations', '/tram/stops']);
});

test('the pages\' titles and structured data: a light rail station and a train station', () => {
    const tram = tramStopPage(rail, 'neo-faliro', { tools, origin: 'https://wayhop.example', trains });
    assert.equal(tram.path, '/tram/stops/neo-faliro');
    assert.deepEqual(tram.values('el'), { name: 'Νέο Φάληρο', lines: 'T7' });
    const data = tram.structuredData('en', en);
    assert.equal(data['@graph'][0]['@type'], 'LightRailStation');
    assert.equal(data['@graph'][0].url, 'https://wayhop.example/tram/stops/neo-faliro');
    assert.deepEqual(data['@graph'][1].itemListElement.map(item => item.item), ['https://wayhop.example/subway', 'https://wayhop.example/tram/stops', 'https://wayhop.example/tram/stops/neo-faliro']);

    const train = suburbanStationPage(rail, trains, 'kifisias', { tools, origin: 'https://wayhop.example' });
    assert.equal(train.structuredData('en', en)['@graph'][0]['@type'], 'TrainStation');
    assert.deepEqual(train.values('en'), { name: 'Kifisias', lines: 'A1, A2' });
});

test('stationPath: a planner station\'s page, a tram stop and a suburban station by their own ids', async () => {
    const { stationPath } = await browserModule('public/js/core/metro.js');
    const { withSuburban, withTram } = await import('../tools/subway/client/network.js');
    const joined = withSuburban(withTram(rail), trains, TODAY);
    assert.equal(stationPath(joined, 'syntagma'), '/subway/stations/syntagma');
    assert.equal(stationPath(joined, 'syntagma-tram'), '/tram/stops/syntagma');
    assert.equal(stationPath(joined, 'zappeio'), '/tram/stops/zappeio');
    assert.equal(stationPath(joined, 'piraeus-suburban'), '/suburban/stations/piraeus');
    assert.equal(stationPath(joined, 'megara'), '/suburban/stations/megara');
});

// ── Over HTTP ──────────────────────────────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), 'network-stations-'));
const railFile = join(dir, 'rail.json');
const trainsFile = join(dir, 'trains.json');
writeFileSync(railFile, JSON.stringify(rail));

let server;
let get;
before(async () => {
    const app = express();
    const pages = createPages(tools, { railFile, trainsFile, config: loadConfig({ SITE_URL: 'https://wayhop.example' }) });
    app.use(pages.router);
    app.use(pages.notFound);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).send(''));
    server = await listen(app);
    get = async path => {
        const res = await fetch(server.url + path);
        return { status: res.status, html: await res.text() };
    };
});
after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
});

test('before trains.json is built, the railway\'s pages can\'t be drawn yet (503); the tram\'s can', async () => {
    assert.equal((await get('/suburban/stations/piraeus')).status, 503);
    assert.equal((await get('/tram/stops/syntagma')).status, 200);
});

test('the pages in both languages, a 404 for a stop that isn\'t one, and the sitemap', async () => {
    writeFileSync(trainsFile, JSON.stringify(trains));
    for (const [path, title] of [
        ['/tram/stops', 'Tram stops'], ['/el/tram/stops/syntagma', 'Στάση τραμ Σύνταγμα'],
        ['/suburban/stations', 'Suburban railway stations'], ['/suburban/stations/piraeus', 'Piraeus suburban railway station'],
        ['/el/suburban/stations/megara', 'Σταθμός Προαστιακού Μέγαρα'],
    ]) {
        const { status, html } = await get(path);
        assert.equal(status, 200, path);
        assert.match(html, new RegExp(`<title>${title}`), path);
    }
    const { html } = await get('/tram/stops/syntagma');
    assert.match(html, /href="\/subway\?from=syntagma-tram"/, 'planned from the planner\'s id');
    assert.ok(!html.includes('id="lift-status"'), 'no lift status: STASY lists the metro\'s lifts');
    for (const path of ['/tram/stops/kifisia', '/suburban/stations/syntagma', '/tram/stops/constructor', '/el/suburban/stations/__proto__']) {
        assert.equal((await get(path)).status, 404, path);
    }
    const sitemap = (await get('/sitemap.xml')).html;
    for (const path of ['/tram/stops', '/tram/stops/syntagma', '/el/tram/stops/syntagma', '/suburban/stations', '/suburban/stations/chalkida', '/el/suburban/stations/chalkida']) {
        assert.ok(sitemap.includes(`https://wayhop.example${path}<`), path);
    }
});
