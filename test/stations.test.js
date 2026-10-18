import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { createPages, loadTools } from '../server/pages.js';
import { firstAndLast } from '../server/stations.js';
import { rail } from './fixtures/rail.js';

// The station pages (/subway/stations/<id>), built from rail.json

process.env.SITE_URL = 'https://wayhop.example';
const tools = loadTools();
const railFile = join(mkdtempSync(join(tmpdir(), 'stations-')), 'rail.json');
writeFileSync(railFile, JSON.stringify(rail));

let server;
let base;
before(async () => {
    const app = express();
    const pages = createPages(tools, { railFile });
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
const text = html => main(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

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

test('the last stop of a direction has no departures', () => {
    assert.deepEqual(firstAndLast(rail.lines.L1.directions.east.timetable, 2), []);
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
    ]) assert.ok(t.includes(expected), `"${expected}" in: ${t}`);
    assert.match(html, /aria-label="Train diagram showing where to stand: Back, Center \(elevator\)"/);
    assert.match(html, /href="\/subway\/stations\/a">Alpha</);
    assert.match(html, /href="\/subway\?from=x"/);
    assert.match(html, /href="\/subway\?to=x"/);
    assert.match(html, /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=38,23\.7&amp;travelmode=walking" target="_blank"/);
});

test('arriving at a terminus shows the exit; leaving the first stop shows only times', async () => {
    const t = text((await get('/subway/stations/b')).html);
    assert.ok(t.includes('End of the line'));
    assert.ok(t.includes('Exit left'));
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
    assert.match((await get('/subway')).html, /href="\/subway\/stations" data-i18n="subway\.all-stations">All metro stations</);
});
