import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { loadConfig } from '../server/config.js';
import { createPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { renderPages } from '../server/pages/index.js';
import { breadcrumb, firstAndLast, indexView, mainDestination, stationPage, stationView } from '../server/pages/stations.js';
import { rail } from './fixtures/rail.js';

// The station pages (/subway/stations/<id>), built from rail.json

const tools = loadTools();
const railFile = join(mkdtempSync(join(tmpdir(), 'stations-')), 'rail.json');
writeFileSync(railFile, JSON.stringify(rail));

let server;
let base;
before(async () => {
    const app = express();
    const pages = createPages(tools, { railFile, config: loadConfig({ SITE_URL: 'https://wayhop.example' }) });
    app.use(pages.router);
    app.use(pages.notFound);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const get = async path => {
    const res = await fetch(base + path);
    return { status: res.status, html: await res.text() };
};
const main = html => html.match(/<main[^>]*>([\s\S]*)<\/main>/)[1];
// The page's text, as a reader sees it (Handlebars writes ' as &#x27;, html`` as &#39;)
const text = html => main(html).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');

test('first and last trains are grouped by days that look the same', () => {
    const groups = firstAndLast(rail.lines.L1.directions.east.timetable, 1);
    assert.deepEqual(groups.map(g => g.days), [[1, 2, 3, 4, 5], [6, 0]]);
    // 05:30 + 2 min to reach x; 00:30 the next night + 2 min
    assert.equal(groups[0].first, 5.5 * 3600 + 120);
    assert.equal(groups[0].last, 24.5 * 3600 + 120);
});

test('service that runs into the next day is "all night" on both sides', () => {
    const groups = firstAndLast(rail.lines.L2.directions.east.timetable, 0);
    assert.deepEqual(groups.map(g => [g.days, g.first === null, g.last === null]), [
        [[1, 2, 3, 4, 5], false, false],
        [[6], false, true],
        [[0], true, false],
    ]);
});

test('a break of under an hour before the next day\'s first train is still "all night"', () => {
    // Saturday's night trains end at 05:15 on Sunday, Sunday's service starts at 05:30;
    // other nights end at 00:30
    const timetable = {
        profiles: [{ stops: [0, 1], offsets: [0, 120] }],
        patterns: [[[5.5 * 3600, 0], [24.5 * 3600, 0]], [[5.5 * 3600, 0], [29.25 * 3600, 0]]],
        days: [0, 0, 0, 0, 0, 0, 1],
    };
    assert.deepEqual(firstAndLast(timetable, 0).map(g => [g.days, g.first, g.last]), [
        [[1, 2, 3, 4, 5], 5.5 * 3600, 24.5 * 3600],
        [[6], 5.5 * 3600, null],
        [[0], null, 24.5 * 3600],
    ]);
});

test('the last stop of a direction has no departures', () => {
    assert.deepEqual(firstAndLast(rail.lines.L1.directions.east.timetable, 2), []);
});

// The data the station views draw (server/views/stations/*.hbs): plain values,
// and the metro pieces shared with the subway page (metro.js) as html``
test('what a station\'s page shows, as data: lines, neighbours, where to ride, connections, times', () => {
    const view = stationView(rail, 'x', 'en', key => key);
    assert.equal(view.name, 'Cross');
    assert.deepEqual(view.lines.map(l => [l.key, l.number, l.directions.map(d => d.headingId)]), [['l1', '1', ['l1-east-0', 'l1-west-1']], ['l2', '2', ['l2-east-2']]]);
    const [east] = view.lines[0].directions;
    assert.equal(east.toward, 'Beta');
    assert.deepEqual([east.previous, east.next], [{ href: '/subway/stations/a', name: 'Alpha' }, { href: '/subway/stations/b', name: 'Beta' }]);
    assert.equal(east.arriving.exitsKnown, true);
    assert.match(String(east.arriving.diagram), /class="train-diagram"/);
    assert.equal(east.arriving.centralPlatform, null);
    // The line to change to is its pill
    assert.deepEqual(east.arriving.transfers.map(t => ({ ...t, line: String(t.line) })), [{ line: '<span class="line-pill pill-m line-l2">L2</span>', toward: 'Gamma', where: 'subway.pos.center-front' }]);
    // Each line's pill: in the sentence under the name, and large as its section's heading
    assert.deepEqual(view.lines.map(l => [String(l.badge), String(l.heading)]), [
        ['<span class="line-pill pill-m line-l1">L1</span>', '<span class="line-pill pill-l line-l1">L1</span>'],
        ['<span class="line-pill pill-m line-l2">L2</span>', '<span class="line-pill pill-l line-l2">L2</span>'],
    ]);
    assert.match(String(east.arriving.note), /class="stop-note[^"]*">.*Unreliable data<\/div>$/);
    assert.equal(view.lines[0].directions[1].arriving.note, null);
    // Arriving at b on L1: a central platform
    assert.match(String(stationView(rail, 'b', 'en', key => key).lines[0].directions[0].arriving.centralPlatform), /class="central-platform-badge">.*subway\.doors-left/);
    assert.deepEqual(east.times, [
        { days: 'stations.day.1–stations.day.5', first: '05:32', last: '00:32' },
        { days: 'stations.day.6, stations.day.0', first: '06:02', last: '01:02' },
    ]);
    // Leaving the first stop of L2: nothing about arriving; all night on Saturday
    const [l2] = view.lines[1].directions;
    assert.equal(l2.previous, null);
    assert.equal(l2.arriving, null);
    assert.deepEqual(l2.times.map(t => [t.first, t.last]), [['05:00', '00:00'], ['05:00', 'stations.all-night'], ['stations.all-night', '00:00']]);
    assert.deepEqual([l2.fromStasy, l2.timesToward, l2.others], [true, 'Gamma', []]);
    assert.deepEqual([east.fromStasy, east.timesToward], [false, 'Beta']);
    // In Greek, and where the times come from: STASY for L2, the timetable for L1
    assert.equal(stationView(rail, 'x', 'el', key => key).lines[0].directions[0].toward, 'Βήτα');
    assert.deepEqual(view.timetable, { stasy: '01/10/2026', gtfs: { old: false, date: '31/12/2099' } });
    assert.deepEqual(stationView(rail, 'a', 'en', key => key).timetable, { stasy: null, gtfs: { old: false, date: '31/12/2099' } });
    assert.equal(view.walking, 'https://www.google.com/maps/dir/?api=1&destination=38,23.7&travelmode=walking');
});

// A line like M3 from Dimotiko Theatro: p → q → r, and on to s for some
// trains (s like the airport); STASY's times from p to each of them
function branching() {
    const r = structuredClone(rail);
    for (const [id, en] of [['p', 'Pi'], ['q', 'Qu'], ['r', 'Ro'], ['s', 'Sigma']]) r.stations[id] = { name: { en, el: en }, coords: [38, 23.7], lines: ['L3'] };
    const week = (weekdays, friday, saturday, sunday) => [sunday, weekdays, weekdays, weekdays, weekdays, friday, saturday];
    const H = 3600;
    r.lines.L3 = {
        name: 'L3', color: '#0057b8',
        directions: {
            out: {
                toward: { en: 'Ro / Sigma', el: 'Ro / Sigma' },
                stops: [
                    {
                        station: 'p', exits: [], hours: [
                            // Only as far as q: one later train; to r: most trains; on to s: some
                            { to: 'q', first: Array(7).fill(5.5 * H), last: week(24.5 * H, 25.5 * H, null, 24.5 * H) },
                            { to: 'r', first: week(5.5 * H, 5.5 * H, 5.5 * H, null), last: week(23.95 * H, 25.5 * H, null, 23.95 * H) },
                            { to: 's', first: Array(7).fill(5.5 * H), last: week(22.9 * H, 22.9 * H, 23.5 * H, 23.5 * H) },
                        ],
                    },
                    { station: 'q', exits: [], hours: [{ to: 'r', first: Array(7).fill(5.6 * H), last: Array(7).fill(24.6 * H) }] },
                    { station: 'r', exits: [] }, { station: 's', exits: [] },
                ],
                // Ten trains to r for each one on to s
                timetable: {
                    profiles: [{ stops: [0, 1, 2], offsets: [0, 120, 300] }, { stops: [0, 1, 2, 3], offsets: [0, 120, 300, 900] }],
                    patterns: [[...Array.from({ length: 10 }, (_, i) => [6 * H + i * 600, 0]), [7 * H, 1]]],
                    days: [0, 0, 0, 0, 0, 0, 0],
                },
            },
        },
    };
    return r;
}

test('STASY\'s times: the table for where most trains go, a sentence for each other destination', () => {
    const r = branching();
    const [out] = stationView(r, 'p', 'en', key => key).lines.find(l => l.key === 'l3').directions;
    assert.equal(out.timesToward, 'Ro');
    assert.deepEqual(out.times, [
        { days: 'stations.day.1–stations.day.4', first: '05:30', last: '23:57' },
        { days: 'stations.day.5', first: '05:30', last: '01:30' },
        { days: 'stations.day.6', first: '05:30', last: 'stations.all-night' },
        { days: 'stations.day.0', first: 'stations.all-night', last: '23:57' },
    ]);
    // Nearer: only the last train, later than the table's; further on: first and last, by days when they differ
    const [q, , s] = r.lines.L3.directions.out.stops[0].hours;
    const strings = { 'stations.other-further': 'To {name}: {times}.', 'stations.other-shorter': 'Only as far as {name}: {times}.', 'stations.other-first-last': 'first {first}, last {last}',
        'stations.other-last': 'last {last}', 'stations.other-every-day': '{times}, every day', 'stations.other-days': '{days}: {times}', 'stations.all-night': 'All night',
        ...Object.fromEntries(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => [`stations.day.${i}`, d])) };
    const english = stationView(r, 'p', 'en', key => strings[key] ?? key).lines.find(l => l.key === 'l3').directions[0];
    assert.deepEqual(english.others, [
        'Only as far as Qu: Mon–Thu: last 00:30; Fri: last 01:30; Sat: last All night; Sun: last 00:30.',
        'To Sigma: Mon–Fri: first 05:30, last 22:54; Sat, Sun: first 05:30, last 23:30.',
    ]);
    // The same every day: "every day"; a nearer one never later than the table's: nothing
    q.last = Array(7).fill(23 * 3600);
    s.last = Array(7).fill(22.9 * 3600);
    assert.deepEqual(stationView(r, 'p', 'en', key => strings[key] ?? key).lines.find(l => l.key === 'l3').directions[0].others, ['To Sigma: first 05:30, last 22:54, every day.']);
});

test('the table\'s destination is where most of the stop\'s trains go', () => {
    const r = branching();
    const direction = r.lines.L3.directions.out;
    assert.equal(mainDestination(direction.stops[0].hours, direction, 0).to, 'r');
    // Most trains on to s instead
    direction.timetable.patterns = [[[6 * 3600, 0], [6.5 * 3600, 1], [7 * 3600, 1]]];
    assert.equal(mainDestination(direction.stops[0].hours, direction, 0).to, 's');
});

test('a station with STASY\'s times shows its note, and the other destinations under the table, in both languages', () => {
    const { renderPage } = renderPages(tools);
    const english = text(renderPage(stationPage(branching(), 'p', { tools }), 'en'));
    for (const expected of [
        'Mon–Thu 05:30 23:57', 'Sat 05:30 All night', 'Sun All night 23:57',
        'Only as far as Qu: Mon–Thu: last 00:30; Fri: last 01:30; Sat: last All night; Sun: last 00:30.',
        'To Sigma: Mon–Fri: first 05:30, last 22:54; Sat, Sun: first 05:30, last 23:30.',
        'First and last trains from Pi toward Ro',
        'First and last trains from STASY\'s timetable, as of 01/10/2026.',
    ]) assert.ok(english.includes(expected), `"${expected}" in: ${english}`);
    assert.ok(!english.includes('OASA\'s timetable'));
    const greek = text(renderPage(stationPage(branching(), 'p', { tools }), 'el'));
    for (const expected of [
        'Προς Sigma: Δευ–Παρ: πρώτο 05:30, τελευταίο 22:54; Σάβ, Κυρ: πρώτο 05:30, τελευταίο 23:30.',
        'Πρώτα και τελευταία δρομολόγια από το πρόγραμμα της ΣΤΑΣΥ, όπως ήταν στις 01/10/2026.',
    ]) assert.ok(greek.includes(expected), `"${expected}" in: ${greek}`);
});

test('the index, as data: every station by line, with the other lines there', () => {
    assert.deepEqual(indexView(rail, 'el', key => key).lines.map(l => [l.key, String(l.heading), l.stops.map(s => [s.name, s.changes && String(s.changes)])]), [
        ['l1', '<span class="line-pill pill-l line-l1">L1</span>', [['Άλφα', null], ['Κόμβος', '<span class="line-pill pill-s line-l2">L2</span>'], ['Βήτα', null]]],
        ['l2', '<span class="line-pill pill-l line-l2">L2</span>', [['Κόμβος', '<span class="line-pill pill-s line-l1">L1</span>'], ['Γάμμα', null]]],
    ]);
    assert.equal(indexView(rail, 'en', key => key).lines[0].stops[1].href, '/subway/stations/x');
});

test('a station page shows lines, neighbours, where to ride, connections and times', async () => {
    const { status, html } = await get('/subway/stations/x');
    assert.equal(status, 200);
    assert.match(html, /<title>Cross metro station — Wayhop<\/title>/);
    assert.match(html, /<meta name="description" content="Cross metro station \(L1, L2\): which carriage/);
    assert.match(html, /<link rel="canonical" href="https:\/\/wayhop\.example\/subway\/stations\/x">/);
    assert.match(html, /<html lang="en"/);
    assert.match(html, /<a href="\/el\/subway\/stations\/x" hreflang="el"/);
    const t = text(html);
    for (const expected of [
        'Toward Beta', 'Previous stop: Alpha', 'Next stop: Beta',
        'Changing to L2 toward Gamma: ride in the Near Front of the train.',
        'Unreliable data',
        'Mon–Fri 05:32 00:32', 'Sat, Sun 06:02 01:02',
        'Toward Gamma', 'Sat 05:00 All night', 'Sun All night 00:00',
        // L2's times are STASY's, L1's the timetable's
        'First and last trains from STASY\'s timetable, as of 01/10/2026.',
        'From OASA\'s timetable, valid until 31/12/2099. Times are approximate.',
    ]) assert.ok(t.includes(expected), `"${expected}" in: ${t}`);
    assert.match(html, /aria-label="Train diagram showing where to stand: Back, Center \(elevator\)"/);
    // Under the sections, what the trains show
    assert.match(html, /<details class="diagram-legend" open>\s*<summary>What the train shows<\/summary>/);
    // Each line's section: its large pill alone, its name for screen readers
    assert.match(html, /<h2 class="station-line-title" id="line-l1"><span class="line-pill pill-l line-l1">L1<\/span><span class="sr-only"> Line 1<\/span><\/h2>/);
    assert.match(html, /Changing to <span class="line-pill pill-m line-l2">L2<\/span> toward Gamma/);
    assert.match(html, /href="\/subway\/stations\/a">Alpha</);
    assert.match(html, /href="\/subway\?from=x"/);
    assert.match(html, /href="\/subway\?to=x"/);
    assert.match(html, /<a href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=38,23\.7&amp;travelmode=walking" class="[^"]+" target="_blank" rel="noopener">/);
});

test('arriving at a terminus shows the exit; leaving the first stop shows only times', async () => {
    const t = text((await get('/subway/stations/b')).html);
    assert.ok(t.includes('End of the line'));
    assert.ok(t.includes('Doors open on the left'));
    // Alpha starts the eastbound direction and ends the westbound one: one exit, one timetable
    const first = (await get('/subway/stations/a')).html;
    assert.equal(first.split('>Getting off here</h4>').length - 1, 1);
    assert.equal(first.split('>First and last trains</h4>').length - 1, 1);
});

test('the Greek page is in Greek, with Greek links', async () => {
    const { status, html } = await get('/el/subway/stations/x');
    assert.equal(status, 200);
    assert.match(html, /<title>Σταθμός μετρό Κόμβος — Wayhop<\/title>/);
    assert.match(html, /<html lang="el"/);
    const t = text(html);
    assert.ok(t.includes('Προς Βήτα') && t.includes('Δευ–Παρ') && t.includes('Όλη τη νύχτα'), t);
    assert.match(html, /href="\/el\/subway\/stations\/a">Άλφα</);
    assert.match(html, /href="\/el\/subway\?from=x"/);
    assert.match(html, /href="\/el\/subway\/stations"/);
    assert.match(html, /<link rel="alternate" hreflang="el" href="https:\/\/wayhop\.example\/el\/subway\/stations\/x">/);
});

test('structured data describes the station and its breadcrumb', async () => {
    const { html } = await get('/subway/stations/x');
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    const [station, crumbs] = data['@graph'];
    assert.equal(station['@type'], 'SubwayStation');
    assert.deepEqual(station.geo, { '@type': 'GeoCoordinates', latitude: 38, longitude: 23.7 });
    assert.deepEqual(crumbs.itemListElement.map(i => i.item), [
        'https://wayhop.example/subway', 'https://wayhop.example/subway/stations', 'https://wayhop.example/subway/stations/x',
    ]);
});

test('the index lists every station by line, marking changes', async () => {
    const { status, html } = await get('/subway/stations');
    assert.equal(status, 200);
    const t = text(html);
    assert.ok(t.includes('Metro stations') && t.includes('Line 1') && t.includes('Line 2'));
    assert.ok(t.includes('Cross · Change to L2'), t);
    assert.equal((html.match(/href="\/subway\/stations\/[a-z]+"/g) ?? []).length, 5);
});

test('an unknown station is a 404', async () => {
    assert.equal((await get('/subway/stations/nope')).status, 404);
    assert.equal((await get('/el/subway/stations/nope')).status, 404);
});

test('the sitemap lists the station pages in both languages', async () => {
    const xml = (await get('/sitemap.xml')).html;
    for (const path of ['/subway/stations', '/subway/stations/x', '/el/subway/stations/c']) {
        assert.ok(xml.includes(`<loc>https://wayhop.example${path}</loc>`), path);
    }
});

test('the pages follow a rebuilt rail.json without a restart', async () => {
    const renamed = structuredClone(rail);
    renamed.stations.x.name.en = 'Crossing';
    writeFileSync(railFile, JSON.stringify(renamed));
    utimesSync(railFile, new Date(), new Date(Date.now() + 5000));
    assert.match((await get('/subway/stations/x')).html, /<h1[^>]*>Crossing<\/h1>/);
    writeFileSync(railFile, JSON.stringify(rail));
    utimesSync(railFile, new Date(), new Date(Date.now() + 10_000));
});

test('the subway page links to the station index', async () => {
    assert.match((await get('/subway')).html, /href="\/subway\/stations">All metro stations</);
});

test('a station page is a page like the others: title and description with its values, structured data, strings', () => {
    const page = stationPage(rail, 'x', { tools, origin: 'https://wayhop.example' });
    assert.deepEqual([page.path, page.title, page.description, page.active, page.ad], ['/subway/stations/x', 'stations.station-title', 'stations.description', 'subway', 'station']);
    assert.deepEqual(page.values('el'), { name: 'Κόμβος', lines: 'L1, L2' });
    assert.equal(page.structuredData('en', key => key)['@graph'][0].name, 'Cross');
    // Its strings: its own and the subway page's
    assert.ok(page.strings.en['stations.toward'] && page.strings.el['subway.doors-left']);
    const index = stationPage(rail, null, { tools });
    assert.deepEqual([index.path, index.title, index.values], ['/subway/stations', 'stations.title', undefined]);
});

test('a string a station page needs but doesn\'t have fails, as in every other view', () => {
    const { renderPage } = renderPages(tools);
    // Without the subway page's strings (its train positions, among others)
    const withoutSubway = tools.map(t => t.id === 'subway' ? { ...t, strings: {} } : t);
    assert.throws(() => renderPage(stationPage(rail, 'x', { tools: withoutSubway }), 'el'), /There's no string "subway\.[\w.-]+" \(el\)/);
});

test('a page\'s own strings go to the browser only when it has scripts of its own', () => {
    const { pages, renderPage } = renderPages(tools);
    const sent = html => JSON.parse(html.match(/<script type="application\/json" id="strings">(.*?)<\/script>/)[1]);
    const station = sent(renderPage(stationPage(rail, 'x', { tools }), 'en'));
    assert.equal(station['stations.toward'], undefined);
    assert.equal(station['shell.new-tab'], '(opens in a new tab)');
    assert.equal(sent(pages['/subway'])['subway.doors-left'], tools.find(t => t.id === 'subway').strings.en['subway.doors-left']);
});

test('the breadcrumb: from the subway page to the page itself, in the views and the structured data alike', () => {
    const s = key => ({ 'stations.subway': 'Subway', 'stations.title': 'Metro stations' })[key];
    assert.deepEqual(breadcrumb(rail, 'x', 'el', s), [
        { name: 'Subway', path: '/subway' }, { name: 'Metro stations', path: '/subway/stations' }, { name: 'Κόμβος', path: '/subway/stations/x' },
    ]);
    assert.deepEqual(breadcrumb(rail, null, 'en', s).map(c => c.path), ['/subway', '/subway/stations']);
    assert.deepEqual(stationView(rail, 'x', 'en', s).crumbs, breadcrumb(rail, 'x', 'en', s));
    assert.deepEqual(indexView(rail, 'en', s).crumbs, breadcrumb(rail, null, 'en', s));
});
