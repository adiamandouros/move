import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createArrivals } from '../server/oasa/arrivals.js';
import { createOasaClient, OasaUnavailable } from '../server/oasa/client.js';

// A fake clock where sleeping just moves time forward
function clock() {
    let t = 1_000_000;
    return { now: () => t, sleep: async ms => { t += ms; }, advance: ms => { t += ms; } };
}

// A fake telematics API that records every request
function fakeOasa(handlers) {
    const calls = [];
    const fetch = async url => {
        const { searchParams } = new URL(url);
        const act = searchParams.get('act');
        const p1 = searchParams.get('p1');
        calls.push(`${act}:${p1}`);
        const body = await handlers[act](p1);
        if (body instanceof Error) throw body;
        return { ok: true, text: async () => JSON.stringify(body) };
    };
    return { fetch, calls };
}

const quiet = () => {};

test('requests are spaced to 2 per second and dropped when the queue is too long', async () => {
    const c = clock();
    const sendAt = [];
    // Record when each queued request was scheduled to go out
    const sleep = async ms => { sendAt.push(c.now() + ms); };
    const client = createOasaClient({ fetch: async () => ({ ok: true, text: async () => 'null' }), now: c.now, sleep, log: quiet });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => client.request('getStopArrivals', '1')));
    const times = [c.now(), ...sendAt];
    assert.deepEqual(times.slice(1).map((t, i) => t - times[i]), Array(16).fill(500));
    // 8 s of queueing at 2/s fits 17 requests; the rest are refused
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 17);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason instanceof OasaUnavailable));
});

test('after 5 failures in a row the client stops calling for a minute', async () => {
    const c = clock();
    let calls = 0;
    const client = createOasaClient({ fetch: async () => { calls++; throw new Error('down'); }, now: c.now, sleep: c.sleep, log: quiet });
    for (let i = 0; i < 5; i++) await assert.rejects(client.request('x', '1'), OasaUnavailable);
    await assert.rejects(client.request('x', '1'), /paused/);
    assert.equal(calls, 5);
    c.advance(60_001);
    await assert.rejects(client.request('x', '1'), /down/);
    assert.equal(calls, 6);
});

function setup(handlers) {
    const c = clock();
    const oasa = fakeOasa(handlers);
    const client = createOasaClient({ fetch: oasa.fetch, now: c.now, sleep: c.sleep, log: quiet });
    const routesFile = join(mkdtempSync(join(tmpdir(), 'move-oasa-')), 'routes.json');
    const arrivals = createArrivals({ client, routesFile, now: c.now, log: quiet });
    return { c, oasa, arrivals, routesFile };
}

const routesAt = {
    webRoutesForStop: () => [{ RouteCode: '2052', LineID: 'Χ95', RouteDescr: 'ΣΥΝΤΑΓΜΑ - ΑΕΡΟΔΡΟΜΙΟ ', RouteDescrEng: 'SYNTAGMA - AIRPORT ' }],
};

test('arrivals are cached for 30 s, shared by simultaneous requests and named', async () => {
    const { c, oasa, arrivals } = setup({
        ...routesAt,
        getStopArrivals: () => [{ route_code: '2052', veh_code: '1', btime2: '9' }, { route_code: '2052', veh_code: '2', btime2: '3' }],
    });

    const [a, b] = await Promise.all([arrivals.stopArrivals('10361'), arrivals.stopArrivals('10361')]);
    assert.equal(a, b);
    assert.deepEqual(a.arrivals.map(x => [x.line, x.minutes, x.to.en]), [['Χ95', 3, 'SYNTAGMA - AIRPORT'], ['Χ95', 9, 'SYNTAGMA - AIRPORT']]);
    assert.deepEqual(oasa.calls, ['getStopArrivals:10361', 'webRoutesForStop:10361']);

    c.advance(29_000);
    await arrivals.stopArrivals('10361');
    assert.equal(oasa.calls.length, 2);

    // After 30 s arrivals are fetched again, but the known route names are reused
    c.advance(2_000);
    await arrivals.stopArrivals('10361');
    assert.deepEqual(oasa.calls.slice(2), ['getStopArrivals:10361']);
});

test('answers age from when OASA was asked, so a slow reply is not reused past 30 s', async () => {
    const c = clock();
    const oasa = fakeOasa({
        ...routesAt,
        // The reply takes 3 s to arrive
        getStopArrivals: async () => { c.advance(3_000); return [{ route_code: '2052', veh_code: '1', btime2: '4' }]; },
    });
    const client = createOasaClient({ fetch: oasa.fetch, now: c.now, sleep: c.sleep, log: quiet });
    const arrivals = createArrivals({ client, now: c.now, log: quiet });

    const asked = c.now();
    await arrivals.stopArrivals('1');
    // The page's next poll, 32 s after it first asked
    c.advance(asked + 32_000 - c.now());
    await arrivals.stopArrivals('1');
    assert.equal(oasa.calls.filter(x => x.startsWith('getStopArrivals')).length, 2);
});

test('"no buses" answers are cached too', async () => {
    const { c, oasa, arrivals } = setup({ ...routesAt, getStopArrivals: () => null });
    assert.deepEqual((await arrivals.stopArrivals('1')).arrivals, []);
    c.advance(10_000);
    await arrivals.stopArrivals('1');
    assert.deepEqual(oasa.calls, ['getStopArrivals:1']);
});

test('when OASA fails, the last answer is served as stale for up to 5 minutes', async () => {
    let up = true;
    const { c, arrivals } = setup({
        ...routesAt,
        getStopArrivals: () => (up ? [{ route_code: '2052', veh_code: '1', btime2: '4' }] : new Error('down')),
    });
    await arrivals.stopArrivals('1');
    up = false;

    c.advance(60_000);
    const stale = await arrivals.stopArrivals('1');
    assert.equal(stale.stale, true);
    assert.equal(stale.arrivals[0].minutes, 4);

    c.advance(5 * 60_000);
    assert.deepEqual(await arrivals.stopArrivals('1'), { arrivals: [], updated: null, stale: false, unavailable: true });
});

test('route names are saved to disk and survive a restart', async () => {
    const { routesFile, arrivals } = setup({ ...routesAt, getStopArrivals: () => [{ route_code: '2052', veh_code: '1', btime2: '4' }] });
    await arrivals.stopArrivals('1');
    await new Promise(resolve => setTimeout(resolve, 1100)); // saving is debounced by 1 s

    const saved = JSON.parse(readFileSync(routesFile, 'utf8'));
    assert.equal(saved['2052'].line, 'Χ95');

    const c = clock();
    const oasa = fakeOasa({ getStopArrivals: () => [{ route_code: '2052', veh_code: '1', btime2: '4' }] });
    const restarted = createArrivals({ client: createOasaClient({ fetch: oasa.fetch, now: c.now, sleep: c.sleep }), routesFile, now: () => saved['2052'].at });
    assert.equal((await restarted.stopArrivals('1')).arrivals[0].line, 'Χ95');
    assert.deepEqual(oasa.calls, ['getStopArrivals:1']);
});
