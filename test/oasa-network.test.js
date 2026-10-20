import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { NETWORK_MAX_AGE_MS, PACE_MS, ROUTE_STOPS_MAX_AGE_MS, fetchNetwork, liveNetwork } from '../server/data/oasa-network.js';
import { fakeOasa } from './fixtures/network.js';
import { tempDir } from './fixtures/gtfs.js';

// Today's bus network from OASA's live API (server/data/oasa-network.js), and
// how gently it's asked: the numbers approved on 2026-10-20

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-20T01:30:00Z');
const noWait = async () => {};

test('the agreed numbers', () => {
    assert.equal(PACE_MS, 1000);
    assert.equal(NETWORK_MAX_AGE_MS, 20 * 3_600_000);
    assert.equal(ROUTE_STOPS_MAX_AGE_MS, 7 * DAY);
});

test('the lines, each line\'s routes, each route\'s stops, one at a time and a second apart', async () => {
    const oasa = fakeOasa({ stops: 10 });
    const pauses = [];
    const { network, requests } = await fetchNetwork({ request: oasa.request, now: () => T0, sleep: async ms => { pauses.push(ms); } });
    // 1 for the lines, 5 for their routes, 7 for the routes' stops
    assert.equal(requests, 13);
    assert.deepEqual(oasa.calls.slice(0, 6), [['webGetLines', ''], ['webGetRoutes', '938'], ['webGetRoutes', '1020'], ['webGetRoutes', '1446'], ['webGetRoutes', '1648'], ['webGetRoutes', '999']]);
    assert.deepEqual(pauses, Array(12).fill(1000));
    assert.equal(network.fetched, '2026-10-20T01:30:00.000Z');
    assert.deepEqual(network.lines[0], { code: '938', line: '040', name: { el: 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ', en: 'PEIRAIAS - SYNTAGMA' } });
    // null: no routes today
    assert.deepEqual(network.routes['999'], []);
    assert.deepEqual(network.routes['1648'], [{ code: '6038', type: '1', name: { el: 'ΑΓ. ΒΑΡΒΑΡΑ - ΣΤ. ΚΟΡΥΔΑΛΛΟΣ', en: '' } }]);
    // In route order (OASA answered in reverse), spaces collapsed
    assert.deepEqual(network.stops['3924'].stops.map(s => s.code), ['10000', '10002', '10009']);
    assert.deepEqual(network.stops['3922'].stops[1], { code: '10001', el: 'ΣΤΑΣΗ 1', en: 'STOP 1', lat: 37.9001, lng: 23.7 });
});

test('a route\'s stops are asked for when the route is new, then about once a week, spread over the nights', async () => {
    const oasa = fakeOasa({ stops: 10 });
    const fetchAt = async (time, previous) => {
        oasa.calls.length = 0;
        const { network } = await fetchNetwork({ request: oasa.request, previous, now: () => time, sleep: noWait });
        return { network, stops: oasa.calls.filter(([act]) => act === 'webGetStops').map(([, code]) => code) };
    };
    const first = await fetchAt(T0, null);
    assert.equal(first.stops.length, 7);
    // The next night: lines and routes again, no stops
    const next = await fetchAt(T0 + DAY, first.network);
    assert.deepEqual(next.stops, []);
    assert.equal(next.network.stops['3922'].at, first.network.stops['3922'].at);
    // Over a week later: a seventh of the 7 routes a night, oldest first
    const week = await fetchAt(T0 + 8 * DAY, next.network);
    assert.equal(week.stops.length, 1);
    // A new route is asked for at once, and counts towards the night's seventh
    const withNew = structuredClone(week.network);
    delete withNew.stops['6038'];
    const nightAfter = await fetchAt(T0 + 9 * DAY, withNew);
    assert.deepEqual(nightAfter.stops, ['6038']);
});

test('a failure or an answer that isn\'t a list stops the fetch', async () => {
    const oasa = fakeOasa({ stops: 10 });
    oasa.down();
    await assert.rejects(fetchNetwork({ request: oasa.request, sleep: noWait }), /fake OASA: down/);
    oasa.down(false);
    oasa.broken();
    await assert.rejects(fetchNetwork({ request: oasa.request, sleep: noWait }), /OASA answered \{"error":"Something went wrong"\} for route 3922/);
});

test('fetched at most once a day: a build at startup reuses the kept network; offline, or without a way to ask, too', async () => {
    const rawDir = tempDir();
    const oasa = fakeOasa({ stops: 10 });
    const logs = [];
    const live = (time, more = {}) => liveNetwork({ rawDir, request: oasa.request, now: () => time, sleep: noWait, log: m => logs.push(m), ...more });

    const first = await live(T0);
    assert.equal(first.network.lines.length, 5);
    assert.match(logs[0], /Fetched the bus network from OASA: 5 lines, 13 requests in \d+ s/);
    assert.deepEqual(JSON.parse(readFileSync(join(rawDir, 'oasa', 'network.json'), 'utf8')), first.network);
    const asked = oasa.calls.length;

    assert.deepEqual((await live(T0 + NETWORK_MAX_AGE_MS - 1)).network, first.network);
    assert.deepEqual((await live(T0 + DAY, { offline: true })).network, first.network);
    assert.deepEqual((await live(T0 + DAY, { request: null })).network, first.network);
    assert.equal(oasa.calls.length, asked);

    // The next night: fetched again
    const next = await live(T0 + DAY);
    assert.equal(next.network.fetched, new Date(T0 + DAY).toISOString());
});

test('when OASA can\'t be asked, the kept network is used, or none before the first one', async () => {
    const rawDir = tempDir();
    const oasa = fakeOasa({ stops: 10 });
    oasa.down();
    const logs = [];
    const none = await liveNetwork({ rawDir, request: oasa.request, sleep: noWait, log: m => logs.push(m) });
    assert.deepEqual(none, { network: null, error: 'fake OASA: down' });
    assert.deepEqual(await liveNetwork({ rawDir, request: null }), { network: null, error: 'not fetched yet' });

    const kept = { fetched: new Date(T0).toISOString(), lines: [], routes: {}, stops: {} };
    mkdirSync(join(rawDir, 'oasa'), { recursive: true });
    writeFileSync(join(rawDir, 'oasa', 'network.json'), JSON.stringify(kept));
    const fallback = await liveNetwork({ rawDir, request: oasa.request, now: () => T0 + DAY, sleep: noWait, log: m => logs.push(m) });
    assert.deepEqual(fallback, { network: kept });
    assert.match(logs.at(-1), /Couldn't fetch the bus network from OASA \(fake OASA: down\) — using the one from 2026-10-20T01:30:00\.000Z/);
});
