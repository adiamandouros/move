import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, statSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import express from 'express';
import { buildIndex } from '../scripts/places/build.js';
import { createPlaces, STALE_AFTER_DAYS } from '../server/places/index.js';
import { PUBLISHED, lostSince } from '../server/places/published.js';
import { raw, rail } from './fixtures/places.js';
import { listen } from './support/listen.js';
import { site } from './support/test-site.js';

// The site's side of address search: keeping the index, and answering

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-02T10:15:00Z');
const built = date => gzipSync(JSON.stringify(buildIndex(raw, rail, date).index));
const servers = [];
after(() => Promise.all(servers.map(server => server.close())));

// A site with this file published (or a failure to fetch it)
function places({ published = built('2026-11-01'), now = () => NOW, dir = mkdtempSync(join(tmpdir(), 'places-')), limiter } = {}) {
    const asked = [], logged = [];
    const fetch = async url => {
        asked.push(url);
        if (published instanceof Error) throw published;
        return typeof published === 'number' ? new Response('', { status: published }) : new Response(published);
    };
    return { places: createPlaces({ dir, fetch, now, limiter, log: message => logged.push(message) }), dir, asked, logged };
}

async function serve(router) {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use('/api/places', router);
    const server = await listen(app);
    servers.push(server);
    return (body, headers = { 'Content-Type': 'application/json' }) => fetch(`${server.url}/api/places`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('downloads the published index and keeps it', async () => {
    const { places: site, dir, asked } = places();
    assert.deepEqual(site.status(), { ok: true, built: null });
    await site.refresh();
    assert.deepEqual(asked, [PUBLISHED]);
    assert.deepEqual(site.status(), { ok: true, built: '2026-11-01' });
    assert.ok(existsSync(join(dir, 'places-index.json.gz')));
});

test('a restart finds what was downloaded, and searches it', async () => {
    const { places: first, dir } = places();
    await first.refresh();
    const { places: again, asked } = places({ dir, published: 500 });
    await again.refreshIfDue();
    assert.deepEqual(asked, [], 'not a week old yet');
    const answer = await (await (await serve(again))({ q: 'Μενελάου 45, Καλλιθέα' })).json();
    assert.equal(answer.results[0].kind, 'exact');
});

test('downloads only when there\'s none, or it\'s a week old', async () => {
    const { places: site, asked } = places({ published: built('2026-10-30') });
    await site.refreshIfDue();
    assert.equal(asked.length, 1, 'none yet');
    await site.refreshIfDue();
    assert.equal(asked.length, 1, 'three days old');
});

test('a week on, it asks again; an index it already has isn\'t written again', async () => {
    let now = NOW;
    const { places: site, dir, asked } = places({ now: () => now, published: built('2026-11-01') });
    await site.refresh();
    const file = join(dir, 'places-index.json.gz');
    utimesSync(file, 1, 1);
    now += 8 * DAY;
    await site.refreshIfDue();
    assert.equal(asked.length, 2);
    assert.equal(statSync(file).mtimeMs, 1000);
});

test('a new index replaces the one in use at the next search', async () => {
    const first = gzipSync(JSON.stringify(buildIndex({ ...raw, streets: [], addresses: [] }, rail, '2026-10-25').index));
    let published = first;
    const dir = mkdtempSync(join(tmpdir(), 'places-'));
    const site = createPlaces({ dir, fetch: async () => new Response(published), now: () => NOW });
    await site.refresh();
    const search = await serve(site);
    assert.deepEqual((await (await search({ q: 'Μενελάου' })).json()).results, []);
    published = built('2026-11-01');
    await site.refresh();
    assert.equal((await (await search({ q: 'Μενελάου' })).json()).results[0].name, 'Μενελάου');
});

for (const [what, published, said] of [
    ['a failed download', 503, /status 503/],
    ['no connection', new Error('ECONNREFUSED'), /ECONNREFUSED/],
    ['a broken file', Buffer.from('not an index'), /wasn't updated/],
]) {
    test(`${what} leaves the index in use, and says why`, async () => {
        const { places: good, dir } = places();
        await good.refresh();
        const { places: site, logged } = places({ dir, published });
        await site.refresh();
        assert.deepEqual(site.status(), { ok: true, built: '2026-11-01' });
        assert.match(logged[0], said);
    });
}

test('an index that has shrunk too far isn\'t taken', async () => {
    const { places: good, dir } = places();
    await good.refresh();
    const small = gzipSync(JSON.stringify(buildIndex({ ...raw, streets: raw.streets.slice(0, 3), addresses: [] }, rail, '2026-11-08').index));
    const { places: site, logged } = places({ dir, published: small });
    await site.refresh();
    assert.equal(site.status().built, '2026-11-01');
    assert.match(logged[0], /streets: \d+, down from 10/);
});

test('only what fell too far counts as lost', () => {
    assert.deepEqual(lostSince({ streets: 91 }, { streets: 100 }), []);
    assert.deepEqual(lostSince({ streets: 89 }, { streets: 100 }), ['streets: 89, down from 100']);
    assert.deepEqual(lostSince({ streets: 1 }, undefined), []);
});

test('the health says when the index has gone stale, or never came', async () => {
    let now = NOW;
    const { places: site } = places({ now: () => now });
    await site.refresh();
    now += (STALE_AFTER_DAYS - 2) * DAY;
    assert.equal(site.status().ok, true);
    now += 2 * DAY;
    assert.equal(site.status().ok, false);
    const { places: none } = places({ published: 404 });
    await none.refresh();
    assert.deepEqual(none.status(), { ok: false, built: null });
});

test('a failure is forgotten when the next download works', async () => {
    let published = 503;
    const site = createPlaces({ dir: mkdtempSync(join(tmpdir(), 'places-')), fetch: async () => (published === 503 ? new Response('', { status: 503 }) : new Response(published)), now: () => NOW, log: () => {} });
    await site.refresh();
    assert.equal(site.status().ok, false);
    published = built('2026-11-01');
    await site.refresh();
    assert.equal(site.status().ok, true);
});

test('answers a search, says how exact, and is never cached', async () => {
    const { places: site } = places();
    await site.refresh();
    const res = await (await serve(site))({ q: 'Μενελάου 55, Καλλιθέα' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { results, notInTown, noSuchTown, corrected } = await res.json();
    assert.deepEqual([results[0].name, results[0].town, results[0].kind, results[0].lo, results[0].hi], ['Μενελάου', 'Καλλιθέας', 'between', 45, 65]);
    assert.deepEqual([notInTown, noSuchTown, corrected], [null, false, false]);
});

test('says when the street isn\'t in that town, or there\'s no such town', async () => {
    const { places: site } = places();
    await site.refresh();
    const search = await serve(site);
    assert.equal((await (await search({ q: 'Μενελάου 45, Νέα Σμύρνη' })).json()).notInTown, 'nea smirni');
    assert.equal((await (await search({ q: 'Μενελάου 45, Ασδφγ' })).json()).noSuchTown, true);
});

test('refuses what isn\'t a search, without saying what was typed', async () => {
    const { places: site } = places();
    await site.refresh();
    const search = await serve(site);
    for (const body of [{}, { q: '' }, { q: '   ' }, { q: 5 }, { q: 'α'.repeat(121) }]) {
        const res = await search(body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match((await res.json()).error, /^Pass q/);
    }
    assert.equal((await search({ q: 'Μενελάου' }, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await search({ q: 'α'.repeat(2000) })).status, 413);
});

test('before there\'s an index it says it\'s unavailable', async () => {
    const res = await (await serve(places({ published: 503 }).places))({ q: 'Μενελάου' });
    assert.equal(res.status, 503);
});

test('a visitor over the limit waits, and others don\'t', async () => {
    const seen = [];
    const { places: site } = places({ limiter: { take: key => { seen.push(key); return seen.length > 1 ? 30_500 : 0; } } });
    await site.refresh();
    const search = await serve(site);
    assert.equal((await search({ q: 'Μενελάου' })).status, 200);
    const refused = await search({ q: 'Μενελάου' });
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('retry-after'), '31');
});

test('the address is on the site, by POST only', async () => {
    const server = await listen(site());
    servers.push(server);
    const res = await fetch(`${server.url}/api/places`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"q":"Μενελάου"}' });
    assert.equal(res.status, 503);
    assert.equal((await fetch(`${server.url}/api/places?q=Μενελάου`)).status, 404);
});
