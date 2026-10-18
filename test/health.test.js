import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { RELAY_VERSION } from '../proxy/worker.js';
import { createHealth } from '../server/health.js';
import { securityHeaders } from '../server/security.js';
import { report, runChecks } from '../scripts/health-check.js';

// The health page (server/health.js), the security headers, and the
// scheduled check that reads them (scripts/health-check.js)

const NOW = Date.parse('2026-10-18T12:00:00Z');
const MINUTE = 60_000;

function buildDir({ generated = '2026-10-18T01:30:00Z', ok = true, validTo = '2026-10-31' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'health-'));
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ generated, outputs: { 'rail.json': { ok: true }, 'bus-stops.json': { ok } } }));
    writeFileSync(join(dir, 'rail.json'), JSON.stringify({ feed: { validTo } }));
    return dir;
}

const relayFetch = versions => async url => {
    const name = new URL(url).hostname;
    if (versions[name] === 'down') throw new Error('connect ECONNREFUSED');
    if (versions[name] === undefined) return new Response('Bad request', { status: 400 });
    return Response.json({ version: versions[name] });
};

function health({ lastOk = NOW - 2 * MINUTE, sources = { oasaEl: true, stasy: true }, dir = buildDir(), versions = { 'pi.example': RELAY_VERSION } } = {}) {
    return createHealth({
        busStatus: () => ({ routes: [{ name: 'direct', lastOk: null }, { name: 'home relay', lastOk }] }),
        announcementStatus: () => Object.fromEntries(Object.entries(sources).map(([k, ok]) => [k, { ok, error: 'secret detail' }])),
        buildDir: dir,
        relays: Object.keys(versions).map(host => ({ name: host === 'pi.example' ? 'home relay' : 'relay', url: `https://${host}/`, key: 'k3y' })),
        fetch: relayFetch(versions),
        now: () => NOW,
    });
}

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
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    try {
        const res = await fetch(`http://localhost:${server.address().port}/api/health`);
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
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    try {
        for (let i = 0; i < 3; i++) await fetch(`http://localhost:${server.address().port}/h`);
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

test('security headers go on every response; HSTS only over https', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.use(securityHeaders());
    app.get('/', (_req, res) => res.send('ok'));
    const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    try {
        const base = `http://localhost:${server.address().port}/`;
        const plain = await fetch(base);
        assert.equal(plain.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(plain.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.equal(plain.headers.get('permissions-policy'), 'geolocation=(self), camera=(), microphone=()');
        assert.equal(plain.headers.get('x-frame-options'), 'SAMEORIGIN');
        assert.equal(plain.headers.get('strict-transport-security'), null);
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
