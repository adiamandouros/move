import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { NETWORK_MAX_AGE_MS, PACE_MS, RETRY_WAITS_MS, ROUTE_STOPS_MAX_AGE_MS, fetchNetwork, lastFetchFile, liveNetwork } from '../server/data/oasa-network.js';
import { readJson } from '../server/files.js';
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
    assert.deepEqual(RETRY_WAITS_MS, [10_000, 30_000, 60_000]);
});

test('the lines, each line\'s routes, each route\'s stops, one at a time and a second apart', async () => {
    const oasa = fakeOasa({ stops: 10 });
    const pauses = [];
    const { network, requests } = await fetchNetwork({ request: oasa.request, now: () => T0, sleep: async ms => { pauses.push(ms); }, log: () => assert.fail('nothing to log') });
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

test('a failed request is tried again after 10 s, then 30 s, and each failure is logged', async () => {
    const oasa = fakeOasa({ stops: 10 });
    oasa.fail('webGetStops', '3923', { times: 2 });
    const pauses = [];
    const logs = [];
    const { network, requests } = await fetchNetwork({ request: oasa.request, sleep: async ms => { pauses.push(ms); }, log: m => logs.push(m) });
    assert.equal(network.stops['3923'].stops.length, 10);
    assert.equal(requests, 15);
    assert.equal(oasa.calls.filter(([act, p1]) => act === 'webGetStops' && p1 === '3923').length, 3);
    // Each try a second after the request before it, as always, plus the wait
    assert.deepEqual(pauses.filter(ms => ms !== PACE_MS), [10_000, 30_000]);
    assert.deepEqual(logs, [
        '[data] OASA webGetStops 3923 (route 3923) failed: HTTP 502 — trying again in 10 s',
        '[data] OASA webGetStops 3923 (route 3923) failed: HTTP 502 — trying again in 30 s',
    ]);
});

test('a request failing 4 times, or answering what isn\'t a list 4 times, stops the fetch; a request we got wrong isn\'t tried again', async () => {
    const oasa = fakeOasa({ stops: 10 });
    const pauses = [];
    const logs = [];
    const fetch = () => fetchNetwork({ request: oasa.request, sleep: async ms => { pauses.push(ms); }, log: m => logs.push(m) });
    oasa.fail('webGetRoutes', '1020', { message: 'HTTP 502: Upstream error: The operation was aborted due to timeout' });
    await assert.rejects(fetch(), { message: 'line Α10: HTTP 502: Upstream error: The operation was aborted due to timeout (4 tries)' });
    assert.deepEqual(pauses.filter(ms => ms !== PACE_MS), [10_000, 30_000, 60_000]);
    assert.equal(logs.length, 4);
    assert.match(logs[3], /^\[data\] OASA webGetRoutes 1020 \(line Α10\) failed: HTTP 502: Upstream error: The operation was aborted due to timeout$/);

    oasa.fail('webGetRoutes', '1020', { times: 0 });
    oasa.broken();
    await assert.rejects(fetch(), { message: 'route 3922: OASA answered {"error":"Something went wrong"} for route 3922 (4 tries)' });

    oasa.broken(false);
    oasa.fail('webGetLines', '', { message: 'HTTP 400' });
    oasa.calls.length = 0;
    await assert.rejects(fetch(), { message: 'the lines: HTTP 400' });
    assert.equal(oasa.calls.length, 1);
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
    assert.deepEqual(none, { network: null, error: 'the lines: fake OASA: down (4 tries)' });
    assert.deepEqual(await liveNetwork({ rawDir, request: null }), { network: null, error: 'not fetched yet' });

    const kept = { fetched: new Date(T0).toISOString(), lines: [], routes: {}, stops: {} };
    mkdirSync(join(rawDir, 'oasa'), { recursive: true });
    writeFileSync(join(rawDir, 'oasa', 'network.json'), JSON.stringify(kept));
    const fallback = await liveNetwork({ rawDir, request: oasa.request, now: () => T0 + DAY, sleep: noWait, log: m => logs.push(m) });
    assert.deepEqual(fallback, { network: kept });
    assert.match(logs.at(-1), /Couldn't fetch the bus network from OASA \(the lines: fake OASA: down \(4 tries\)\) after \d+ s; 0 route\(s\) saved for the next try — using the network from 2026-10-20T01:30:00\.000Z/);
});

test('each route\'s stops are saved as they arrive: after a failed fetch, the next one asks only for the routes still missing', async () => {
    const rawDir = tempDir();
    const oasa = fakeOasa({ stops: 10 });
    const logs = [];
    const live = time => liveNetwork({ rawDir, request: oasa.request, now: () => time, sleep: noWait, log: m => logs.push(m) });
    const progress = join(rawDir, 'oasa', 'progress.jsonl');

    // Routes 3922 and 3923 arrive, 3924 doesn't
    oasa.fail('webGetStops', '3924');
    assert.deepEqual(await live(T0), { network: null, error: 'route 3924: HTTP 502 (4 tries)' });
    assert.ok(!existsSync(join(rawDir, 'oasa', 'network.json')));
    assert.match(logs.at(-1), /Couldn't fetch the bus network from OASA \(route 3924: HTTP 502 \(4 tries\)\) after \d+ s; 2 route\(s\) saved for the next try$/);
    // How far it got, for the diagnostics
    assert.deepEqual(readJson(lastFetchFile(rawDir)), {
        at: new Date(T0).toISOString(), ok: false, seconds: 0, error: 'route 3924: HTTP 502 (4 tries)',
        lines: { done: 5, total: 5 }, stops: { done: 2, total: 7 },
    });
    // The process stopped while saving a third
    appendFileSync(progress, '{"code":"6051","at":"2026');

    oasa.fail('webGetStops', '3924', { times: 0 });
    oasa.calls.length = 0;
    const { network } = await live(T0 + 3_600_000);
    assert.match(logs.find(l => /saved by the last try/.test(l)), /with 2 route\(s\) saved by the last try/);
    // The lines and routes again (6), then only the 5 routes' stops still missing
    assert.deepEqual(oasa.calls.filter(([act]) => act === 'webGetStops').map(([, code]) => code), ['3924', '6051', '6052', '3690', '6038']);
    assert.equal(network.stops['3922'].at, new Date(T0).toISOString());
    assert.equal(network.stops['3924'].at, new Date(T0 + 3_600_000).toISOString());
    assert.deepEqual(JSON.parse(readFileSync(join(rawDir, 'oasa', 'network.json'), 'utf8')), network);
    // Kept in network.json now: the saved stops are done with
    assert.ok(!existsSync(progress));
    assert.deepEqual(readJson(lastFetchFile(rawDir)), {
        at: new Date(T0 + 3_600_000).toISOString(), ok: true, seconds: 0,
        lines: { done: 5, total: 5 }, stops: { done: 5, total: 5 },
    });
});
