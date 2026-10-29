import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { createBusApi } from '../server/oasa/index.js';
import { clientKey, createClientLimiter, NEW_STOPS_PER_MINUTE } from '../server/oasa/limits.js';
import { listen } from './support/listen.js';

// Fair use of the request budget to OASA: known stops only, and a per-visitor
// allowance of stops that aren't cached

let t = 1_000_000;
const now = () => t;

test('IPv4 addresses count on their own, IPv6 ones by /64', () => {
    assert.equal(clientKey('203.0.113.7'), '203.0.113.7');
    assert.equal(clientKey('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(clientKey('2a02:587:1234:5600:1:2:3:4'), '2a02:587:1234:5600::/64');
    assert.equal(clientKey('2a02:0587:1234:5600::99'), '2a02:587:1234:5600::/64');
    assert.equal(clientKey('2a02:587::1'), '2a02:587:0:0::/64');
    assert.equal(clientKey('::1'), '0:0:0:0::/64');
});

test('each client gets its allowance per minute; free requests always pass', () => {
    const limiter = createClientLimiter({ perMinute: 10, now });
    assert.equal(limiter.take('a', 6), 0);
    assert.equal(limiter.take('a', 4), 0);
    t += 15_000;
    assert.equal(limiter.take('a', 1), 45_000, 'refused until the minute is over');
    assert.equal(limiter.take('a', 0), 0);
    assert.equal(limiter.take('b', 10), 0, 'another client is unaffected');
    t += 45_000;
    assert.equal(limiter.take('a', 10), 0, 'a new minute');
});

// ── /api/arrivals ───────────────────────────────────────────────────────────

const KNOWN = Array.from({ length: 40 }, (_, i) => String(10_000 + i));
let server;
let base;
let calls = 0;
let api;
before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'limits-'));
    const stopsFile = join(dir, 'bus-stops.json');
    writeFileSync(stopsFile, JSON.stringify({ fields: ['code', 'lat', 'lng'], stops: KNOWN.map(c => [c, 37.9, 23.7]) }));
    const client = { request: async () => { calls++; return []; }, status: () => ({ at: now(), routes: [] }) };
    api = createBusApi({ client, stopsFile, now });
    const app = express();
    app.set('trust proxy', true);
    app.use('/api', api);
    server = await listen(app);
    base = server.url;
});
after(() => server.close());

const ask = (stops, ip = '198.51.100.1') => fetch(`${base}/api/arrivals?stops=${stops.join(',')}`, { headers: { 'X-Forwarded-For': ip } });

test('only stops from bus-stops.json are accepted, without asking OASA', async () => {
    const before = calls;
    const res = await ask([KNOWN[0], '99999999']);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /99999999/);
    assert.equal(calls, before);
});

test(`a visitor may ask for ${NEW_STOPS_PER_MINUTE} new stops a minute; cached ones are free`, async () => {
    const ip = '198.51.100.2';
    for (let i = 0; i < NEW_STOPS_PER_MINUTE; i += 10) assert.equal((await ask(KNOWN.slice(i, i + 10), ip)).status, 200);
    const over = await ask(KNOWN.slice(NEW_STOPS_PER_MINUTE, NEW_STOPS_PER_MINUTE + 1), ip);
    assert.equal(over.status, 429);
    assert.equal(over.headers.get('retry-after'), '60');
    assert.equal((await ask(KNOWN.slice(0, 6), ip)).status, 200, 'stops cached a moment ago cost nothing');
    assert.equal((await ask(KNOWN.slice(NEW_STOPS_PER_MINUTE, NEW_STOPS_PER_MINUTE + 1), '198.51.100.3')).status, 200, 'other visitors are unaffected');
    // Counted in the usage of OASA, for the diagnostics
    assert.equal(api.status().usage.hour.limited, 1);
});

test('the trip finder\'s requests are counted apart: a search when it starts, each stop by where its answer came from', async () => {
    const trips = () => api.status().usage.hour.trips;
    const before = trips();
    const get = (query, ip = '198.51.100.9') => fetch(`${base}/api/arrivals?${query}`, { headers: { 'X-Forwarded-For': ip } });
    assert.equal((await get(`stops=${KNOWN[34]},${KNOWN[35]}&for=trip-start`)).status, 200);
    assert.equal((await get(`stops=${KNOWN[34]}&for=trip`)).status, 200);
    // The bus page's own requests, and anything else said, aren't the finder's
    assert.equal((await get(`stops=${KNOWN[36]}`)).status, 200);
    assert.equal((await get(`stops=${KNOWN[37]}&for=other`)).status, 200);
    const after = trips();
    assert.equal(after.searches - before.searches, 1);
    assert.equal(after.answers.oasa - before.answers.oasa, 2);
    assert.equal(after.answers.cache - before.answers.cache, 1);
});

