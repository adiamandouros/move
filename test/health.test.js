import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import express from 'express';
import { RELAY_VERSION } from '../proxy/worker.js';
import { createHealth } from '../server/health.js';
import { securityHeaders } from '../server/security.js';
import { report, runChecks } from '../scripts/health-check.js';
import { listen } from './support/listen.js';

// The health page (server/health.js), the security headers, and the
// scheduled check that reads them (scripts/health-check.js)

const NOW = Date.parse('2026-10-18T12:00:00Z');
const MINUTE = 60_000;

// A data folder's build/ (its raw/ beside it, as data/ has them). hours: the
// date of STASY's copy rail.json uses; stasyFetch: STASY's last fetch; airportCheck: the last airport timetable check
// checks: rail.json's nightly checks (rail-checks.js)
function buildDir({ generated = '2026-10-18T01:30:00Z', ok = true, validTo = '2026-10-31', hours = '2026-10-10', stasyFetch = null, airportCheck = null, checks = undefined } = {}) {
    const dir = join(mkdtempSync(join(tmpdir(), 'health-')), 'build');
    mkdirSync(dir);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ generated, outputs: { 'rail.json': { ok: true, checks }, 'bus-stops.json': { ok } } }));
    writeFileSync(join(dir, 'rail.json'), JSON.stringify({ feed: { validTo }, ...(hours && { hours: { fetched: hours } }) }));
    if (stasyFetch) {
        mkdirSync(join(dirname(dir), 'raw', 'stasy'), { recursive: true });
        writeFileSync(join(dirname(dir), 'raw', 'stasy', 'last-fetch.json'), JSON.stringify(stasyFetch));
    }
    if (airportCheck) {
        mkdirSync(join(dirname(dir), 'raw', 'stasy'), { recursive: true });
        writeFileSync(join(dirname(dir), 'raw', 'stasy', 'airport-check.json'), JSON.stringify(airportCheck));
    }
    return dir;
}

const relayFetch = versions => async url => {
    const name = new URL(url).hostname;
    if (versions[name] === 'down') throw new Error('connect ECONNREFUSED');
    if (versions[name] === undefined) return new Response('Bad request', { status: 400 });
    return Response.json({ version: versions[name] });
};

function health({ lastOk = NOW - 2 * MINUTE, sources = { oasaEl: true, stasy: true }, dir = buildDir(), versions = { 'pi.example': RELAY_VERSION }, places = undefined } = {}) {
    return createHealth({
        placesStatus: places && (() => places),
        busStatus: () => ({ routes: [{ name: 'direct', lastOk: null }, { name: 'home relay', lastOk }] }),
        announcementStatus: () => Object.fromEntries(Object.entries(sources).map(([k, ok]) => [k, { ok, error: 'secret detail' }])),
        buildDir: dir,
        relays: Object.keys(versions).map(host => ({ name: host === 'pi.example' ? 'home relay' : 'relay', url: `https://${host}/`, key: 'k3y' })),
        fetch: relayFetch(versions),
        now: () => NOW,
    });
}

test('an address index that went stale or never came is a problem, and says which', async () => {
    assert.deepEqual((await health({ places: { ok: true, built: '2026-10-11' } }).check()).problems, []);
    assert.match((await health({ places: { ok: false, built: '2026-09-01' } }).check()).problems[0], /the index is from 2026-09-01, over 21 days old/);
    assert.match((await health({ places: { ok: false, built: null } }).check()).problems[0], /couldn't be downloaded/);
});

test('a working site is healthy', async () => {
    const result = await health().check();
    assert.equal(result.ok, true, result.problems.join('; '));
    assert.deepEqual(result.problems, []);
    assert.equal(result.arrivals.route, 'home relay');
    assert.equal(result.data.timetableDaysLeft, 13);
    assert.deepEqual(result.relays, { 'home relay': { version: RELAY_VERSION, ok: true } });
});

test('each kind of trouble is named', async () => {
    const result = await health({
        lastOk: NOW - 30 * MINUTE,
        sources: { oasaEl: true, stasy: false },
        dir: buildDir({ generated: '2026-10-16T01:30:00Z', validTo: '2026-10-22' }),
        versions: { 'pi.example': undefined, 'worker.example': 'down' },
    }).check();
    assert.equal(result.ok, false);
    const text = result.problems.join('\n');
    for (const expected of [
        /Live arrivals: no route to OASA has answered in the past 10 minutes/,
        /Announcements: stasy didn't load/,
        /Data: the last build \(2026-10-16T01:30:00\.000Z\) is over 36 h old/,
        /Timetable: the metro timetable ends on 2026-10-22 \(in 4 days\)/,
        /Relay: the home relay runs an older version or is unreachable/,
        /Relay: the relay runs an older version or is unreachable/,
    ]) assert.match(text, expected);
});

test('STASY\'s timetables: pages that couldn\'t be read on the last try, or a copy over 45 days old', async () => {
    assert.deepEqual((await health().check()).stasy, { ok: true, fetched: '2026-10-10', daysOld: 8, unreadable: false });
    // Not fetched yet (the relays' versions say why): the pages use the GTFS's times meanwhile
    assert.equal((await health({ dir: buildDir({ hours: null }) }).check()).stasy.ok, true);
    // Unreachable for a while: fine until the copy is over 45 days old
    assert.equal((await health({ dir: buildDir({ hours: '2026-09-03', stasyFetch: { ok: false, error: 'HTTP 502' } }) }).check()).ok, true);
    assert.match((await health({ dir: buildDir({ hours: '2026-09-02' }) }).check()).problems.join(), /STASY timetables: the copy in use is from 2026-09-02, over 45 days old/);

    const changed = await health({ dir: buildDir({ stasyFetch: { ok: false, unreadable: true, error: 'M3: unknown column' } }) }).check();
    assert.equal(changed.ok, false);
    assert.deepEqual(changed.problems, ['STASY timetables: STASY\'s pages changed and couldn\'t be read on the last try; the last copy is used']);
});

test('announcements kept from before a restart count until the source is tried', async () => {
    const page = sources => createHealth({ busStatus: () => ({ routes: [] }), announcementStatus: () => sources, buildDir: buildDir(), now: () => NOW });
    assert.deepEqual((await page({ stasy: { items: 3 } }).check()).announcements, { ok: true, sources: { stasy: true } });
    assert.deepEqual((await page({ stasy: { items: 0 } }).check()).announcements, { ok: false, sources: { stasy: false } });
    assert.deepEqual((await page({ stasy: { ok: false, items: 3 } }).check()).announcements, { ok: false, sources: { stasy: false } });
});

test('a failed part of the build counts, and so does no build at all', async () => {
    assert.match((await health({ dir: buildDir({ ok: false }) }).check()).problems.join(), /has failed parts/);
    assert.match((await health({ dir: mkdtempSync(join(tmpdir(), 'empty-')) }).check()).problems.join(), /no build yet/);
});

test('the page answers 503 when unhealthy, without addresses, keys or error details', async () => {
    const app = express();
    app.use('/api/health', health({ sources: { stasy: false } }));
    const server = await listen(app);
    try {
        const res = await fetch(`${server.url}/api/health`);
        assert.equal(res.status, 503);
        const body = await res.text();
        for (const secret of ['pi.example', 'k3y', 'secret detail']) assert.ok(!body.includes(secret), `leaks ${secret}`);
    } finally {
        server.close();
    }
});

test('answers are kept for a minute, so the page can\'t be used to load the relays', async () => {
    let asked = 0;
    const page = createHealth({
        busStatus: () => ({ routes: [] }), announcementStatus: () => ({}), buildDir: buildDir(),
        relays: [{ name: 'home relay', url: 'https://pi.example/', key: 'k' }],
        fetch: async () => { asked++; return Response.json({ version: RELAY_VERSION }); },
        now: () => NOW,
    });
    const app = express().use('/h', page);
    const server = await listen(app);
    try {
        for (let i = 0; i < 3; i++) await fetch(`${server.url}/h`);
        assert.equal(asked, 1);
    } finally {
        server.close();
    }
});

test('the relay answers its version', async () => {
    const { default: worker } = await import('../proxy/worker.js');
    const res = await worker.fetch(new Request('https://relay.example/?act=version', { headers: { 'X-Relay-Key': 'k' } }), { RELAY_KEY: 'k' });
    assert.deepEqual(await res.json(), { version: RELAY_VERSION });
    const denied = await worker.fetch(new Request('https://relay.example/?act=version'), { RELAY_KEY: 'k' });
    assert.equal(denied.status, 401);
});

// (The other security headers, on every kind of answer: server.test.js)
test('HSTS goes only on answers over https', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.use(securityHeaders());
    app.get('/', (_req, res) => res.send('ok'));
    const server = await listen(app);
    try {
        const base = `${server.url}/`;
        assert.equal((await fetch(base)).headers.get('strict-transport-security'), null);
        const secure = await fetch(base, { headers: { 'X-Forwarded-Proto': 'https' } });
        assert.equal(secure.headers.get('strict-transport-security'), 'max-age=31536000');
    } finally {
        server.close();
    }
});

// ── The scheduled check ─────────────────────────────────────────────────────

function fakeSite({ arrivals = { arrivals: [] }, health: page = { ok: true, problems: [] }, down = [] } = {}) {
    const asked = [];
    const fetch = async url => {
        const { pathname } = new URL(url);
        asked.push(pathname);
        if (down.includes(pathname)) throw new Error('timeout');
        if (pathname === '/api/arrivals') return Response.json({ stops: { 10361: arrivals } });
        if (pathname === '/api/health') return Response.json(page, { status: page.ok ? 200 : 503 });
        return new Response('<html>', { status: 200 });
    };
    return { fetch, asked };
}

test('the check asks what a visitor would, then reads the health page', async () => {
    const site = fakeSite();
    const { problems } = await runChecks('https://wayhop.example', site.fetch);
    assert.deepEqual(problems, []);
    assert.deepEqual(site.asked, ['/', '/el', '/api/arrivals', '/api/announcements', '/api/health']);
    assert.equal(site.asked.filter(p => p === '/api/arrivals').length, 1, 'one stop: at most one request to OASA');
});

test('the check collects every problem, its own and the health page\'s', async () => {
    const site = fakeSite({ arrivals: { arrivals: [], unavailable: true }, health: { ok: false, problems: ['Relay: the home relay runs version 1, not 2'] }, down: ['/el'] });
    const result = await runChecks('https://wayhop.example', site.fetch);
    assert.deepEqual(result.problems, ['Page /el: HTTP timeout', 'Live arrivals: unavailable (OASA could not be reached)', 'Relay: the home relay runs version 1, not 2']);
    const text = report('https://wayhop.example', result, new Date(NOW));
    assert.match(text, /^## https:\/\/wayhop\.example: 3 problems\n\n- Page \/el: HTTP timeout\n/);
    assert.match(report('https://wayhop.example', { problems: [], health: null }), /: healthy/);
});

test('STASY\'s airport timetable: a change since airport.json, or no check for over 21 days, is a problem', async () => {
    const at = days => new Date(NOW - days * 86_400_000).toISOString();
    // Not checked yet (no airport.json, or before the first build)
    assert.deepEqual((await health().check()).airport, { ok: true, checked: null, daysOld: null, changed: false });
    assert.equal((await health({ dir: buildDir({ airportCheck: { checked: at(3), changes: [] } }) }).check()).ok, true);
    // Unreachable for a while: fine for three weeks
    assert.equal((await health({ dir: buildDir({ airportCheck: { checked: at(21), changes: [], at: at(0), error: 'home relay: HTTP 502' } }) }).check()).ok, true);
    const stale = await health({ dir: buildDir({ airportCheck: { checked: at(22), changes: [], at: at(0), error: 'home relay: HTTP 502' } }) }).check();
    assert.deepEqual(stale.problems, ['Airport timetable: STASY\'s was last checked on 2026-09-26, over 21 days ago']);

    const changed = await health({ dir: buildDir({ airportCheck: { checked: at(1), changes: ['M3/doukissis\'s PDF changed: x.pdf'] } }) }).check();
    assert.equal(changed.ok, false);
    assert.deepEqual(changed.problems, ['Airport timetable: STASY\'s has changed since data/curated/airport.json was written (details on /admin/diagnostics); its trains are still added']);
});

test('the rail data\'s nightly checks: problems fail it, notes don\'t', async () => {
    assert.equal((await health({ dir: buildDir({ checks: { problems: [], notes: ['M1 toward Kifisia: a train every 6\'00" in the GTFS, 7\'30" in STASY\'s table'] } }) }).check()).ok, true);
    const one = await health({ dir: buildDir({ checks: { problems: ['M4: no first and last trains from STASY at any stop'], notes: [] } }) }).check();
    assert.deepEqual(one.problems, ['Rail data: 1 thing the timetable code relies on no longer holds (details on /admin/diagnostics)']);
    const two = await health({ dir: buildDir({ checks: { problems: ['a', 'b'], notes: [] } }) }).check();
    assert.deepEqual(two.problems, ['Rail data: 2 things the timetable code relies on no longer hold (details on /admin/diagnostics)']);
});
