import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARRIVALS_TTL_MS, BUSY_TTLS, createArrivals } from '../server/oasa/arrivals.js';
import { createOasaClient } from '../server/oasa/client.js';

// Sharing OASA's 2 requests a second among more people (approved 2026-10-18):
// newcomers first, and longer-lived answers while the queue is busy. The bus
// page's own part (refresh tiers, only stops on screen) is in tools/buses/client.

const quiet = () => {};

test('the approved numbers', () => {
    assert.equal(ARRIVALS_TTL_MS, 30_000);
    assert.deepEqual(BUSY_TTLS, [[5_000, 90_000], [2_000, 60_000]]);
});

// ── The client's two lanes ──────────────────────────────────────────────────

// A clock that stands still unless advanced (the queue's waits take no time),
// and an OASA that records the order of requests
function setupClient() {
    let t = 1_000_000;
    const order = [];
    const client = createOasaClient({
        fetch: async url => { order.push(new URL(url).searchParams.get('p1')); return { ok: true, text: async () => '[]' }; },
        now: () => t, sleep: async () => {}, log: quiet,
    });
    return { client, order, advance: ms => { t += ms; } };
}

test("someone's first look at a stop goes ahead of queued refreshes", async () => {
    const { client, order } = setupClient();
    const refreshes = ['r1', 'r2', 'r3', 'r4'].map(p => client.request('getStopArrivals', p));
    const first = client.request('getStopArrivals', 'new', { lane: 'high' });
    await Promise.all([...refreshes, first]);
    // r1 had its slot already; the newcomer goes next, before r2–r4
    assert.deepEqual(order, ['r1', 'new', 'r2', 'r3', 'r4']);
});

test('queueWait says how long a refresh would wait, and the queue still drops past 8 s', async () => {
    const { client, advance } = setupClient();
    assert.equal(client.queueWait(), 0);
    const asked = Array.from({ length: 10 }, (_, i) => client.request('getStopArrivals', String(i)));
    // One went out at once; nine wait, 500 ms apart
    assert.equal(client.queueWait(), 5_000);
    assert.equal(client.status().queueWaitMs, 5_000);
    await Promise.all(asked);
    advance(10_000);
    // 17 fit in 8 s of queueing at 2 a second (as before the lanes); the 18th is refused
    const many = await Promise.allSettled(Array.from({ length: 18 }, (_, i) => client.request('getStopArrivals', `m${i}`)));
    assert.equal(many.filter(r => r.status === 'fulfilled').length, 17);
});

test('newcomers can fill the queue, but never past 8 s for themselves', async () => {
    const { client } = setupClient();
    const high = await Promise.allSettled(Array.from({ length: 18 }, (_, i) => client.request('getStopArrivals', `h${i}`, { lane: 'high' })));
    assert.equal(high.filter(r => r.status === 'fulfilled').length, 17);
});

// ── The cache under load ────────────────────────────────────────────────────

// A cache over a fake client whose queue wait we set, recording the lane of each request
function setupCache() {
    let t = 1_000_000;
    let wait = 0;
    const calls = [];
    const client = {
        queueWait: () => wait,
        request: async (act, stop, { lane = 'normal' } = {}) => {
            calls.push(`${act}:${stop}:${lane}`);
            if (act === 'webRoutesForStop') return [{ RouteCode: 'R', LineID: '040', RouteDescr: 'Α', RouteDescrEng: 'A' }];
            return [{ route_code: 'R', veh_code: '1', btime2: '12' }];
        },
    };
    const arrivals = createArrivals({ client, now: () => t, log: quiet });
    return { arrivals, calls, advance: ms => { t += ms; }, setWait: ms => { wait = ms; } };
}

const asked = calls => calls.filter(c => c.startsWith('getStopArrivals')).length;

test('with a quiet queue, answers are fresh for 30 s', async () => {
    const s = setupCache();
    await s.arrivals.stopArrivals('1');
    s.advance(29_000);
    assert.equal((await s.arrivals.stopArrivals('1')).stale, false);
    assert.equal(asked(s.calls), 1);
    s.advance(2_000);
    await s.arrivals.stopArrivals('1');
    assert.equal(asked(s.calls), 2);
});

test('while the queue waits over 2 s, answers are fresh for 60 s; over 5 s, 90 s', async () => {
    const s = setupCache();
    await s.arrivals.stopArrivals('1');
    s.setWait(3_000);
    s.advance(45_000);
    const at45 = await s.arrivals.stopArrivals('1');
    assert.equal(asked(s.calls), 1, 'no new request at 45 s');
    assert.equal(at45.stale, false);
    assert.equal(s.arrivals.isCached('1'), true);

    s.setWait(6_000);
    s.advance(30_000);
    const at75 = await s.arrivals.stopArrivals('1');
    assert.equal(asked(s.calls), 1, 'no new request at 75 s');
    // Counted down by the minute that has passed, and marked as older
    assert.equal(at75.arrivals[0].minutes, 11);
    assert.equal(at75.stale, true);

    s.advance(16_000);
    assert.equal(s.arrivals.isCached('1'), false);
    await s.arrivals.stopArrivals('1');
    assert.equal(asked(s.calls), 2, 'a new request after 90 s');

    // The queue clears: back to 30 s
    s.setWait(0);
    s.advance(31_000);
    await s.arrivals.stopArrivals('1');
    assert.equal(asked(s.calls), 3);
});

test("a stop's first look (and its names) go in the high lane, its refreshes in the normal one", async () => {
    const s = setupCache();
    await s.arrivals.stopArrivals('1');
    s.advance(31_000);
    await s.arrivals.stopArrivals('1');
    // Not looked at for over 5 minutes: a newcomer again
    s.advance(6 * 60_000);
    await s.arrivals.stopArrivals('1');
    assert.deepEqual(s.calls, [
        'getStopArrivals:1:high', 'webRoutesForStop:1:high',
        'getStopArrivals:1:normal',
        'getStopArrivals:1:high',
    ]);
});
