import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { countDown, createArrivals } from '../server/oasa/arrivals.js';
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

test('a failed answer says what the relay said went wrong, if anything', async () => {
    const c = clock();
    const answers = [
        { ok: false, status: 502, text: async () => 'Upstream error: The operation was aborted due to timeout\n' },
        { ok: false, status: 502, text: async () => '<html><body>Bad gateway</body></html>' },
        { ok: false, status: 503, text: async () => '' },
    ];
    const client = createOasaClient({ fetch: async () => answers.shift(), now: c.now, sleep: c.sleep, log: quiet });
    await assert.rejects(client.request('webGetStops', '3922'), { message: 'HTTP 502: Upstream error: The operation was aborted due to timeout' });
    await assert.rejects(client.request('webGetStops', '3922'), { message: 'HTTP 502' });
    await assert.rejects(client.request('webGetStops', '3922'), { message: 'HTTP 503' });
    assert.equal(client.status().routes[0].lastError.message, 'HTTP 503');
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
    // One minute later, the bus that was 4 minutes away is 3 minutes away
    assert.equal(stale.arrivals[0].minutes, 3);

    c.advance(5 * 60_000);
    assert.deepEqual(await arrivals.stopArrivals('1'), { arrivals: [], updated: null, stale: false, unavailable: true });
});

test('countDown subtracts elapsed whole minutes and drops buses that have arrived', () => {
    const list = [{ minutes: 1 }, { minutes: 4 }, { minutes: 12 }];
    assert.deepEqual(countDown(list, 59_000).map(a => a.minutes), [1, 4, 12]);
    assert.deepEqual(countDown(list, 3 * 60_000 + 5_000).map(a => a.minutes), [1, 9]);
    assert.deepEqual(countDown(list, 20 * 60_000), []);
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

// ── Relay fallback ──────────────────────────────────────────────────────────

const RELAY = { name: 'relay', url: 'https://relay.example/', key: 'k' };

// Direct calls go to telematics.oasa.gr, relay calls to relay.example
function routedFetch({ directUp }) {
    const calls = [];
    const fetch = async (url, { headers }) => {
        const relayed = url.startsWith(RELAY.url);
        calls.push(relayed ? `relay(${headers['X-Relay-Key']})` : 'direct');
        if (!relayed && !directUp()) throw new Error('blocked');
        return { ok: true, text: async () => '[]' };
    };
    return { fetch, calls };
}

// Lets background work (a route's test) finish
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

test('at startup a route with a fallback is tested in the background; visitors use the next route meanwhile', async () => {
    const c = clock();
    const logs = [];
    const { fetch, calls } = routedFetch({ directUp: () => false });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: m => logs.push(m), relays: [RELAY] });
    // A visitor right away doesn't wait for the test
    assert.deepEqual(await client.request('getStopArrivals', '1'), []);
    await settle();
    assert.deepEqual(calls, ['direct', 'relay(k)'], 'the test, then the visitor\'s request through the relay');
    assert.match(logs.join('\n'), /^\[oasa\] direct can't reach OASA \(blocked\); using the relay — testing it again in 24 h$/m);
    calls.length = 0;
    await client.request('getStopArrivals', '1');
    assert.deepEqual(calls, ['relay(k)']);
    assert.equal(client.status().routes[0].resting, true);
});

test('once its test passes, a route is used and the ones behind it are not', async () => {
    const c = clock();
    const { fetch, calls } = routedFetch({ directUp: () => true });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: quiet, relays: [RELAY] });
    await settle();
    for (let i = 0; i < 3; i++) await client.request('getStopArrivals', '1');
    assert.deepEqual(calls, ['direct', 'direct', 'direct', 'direct']);
});

test('the test asks for one central stop', async () => {
    const c = clock();
    const urls = [];
    createOasaClient({ fetch: async url => { urls.push(url); return { ok: true, text: async () => '[]' }; }, now: c.now, sleep: c.sleep, log: quiet, relays: [RELAY] });
    await settle();
    assert.deepEqual(urls, ['https://telematics.oasa.gr/api/?act=getStopArrivals&p1=10361']);
});

test('a working route that fails a request falls through to the next one', async () => {
    const c = clock();
    let up = true;
    const { fetch, calls } = routedFetch({ directUp: () => up });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: quiet, relays: [RELAY] });
    await settle();
    up = false;
    calls.length = 0;
    assert.deepEqual(await client.request('getStopArrivals', '1'), []);
    assert.deepEqual(calls, ['direct', 'relay(k)']);
});

test('after 5 failures in a row a route rests a day, then is tested again in the background', async () => {
    const c = clock();
    let up = true;
    const logs = [];
    const { fetch, calls } = routedFetch({ directUp: () => up });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: m => logs.push(m), relays: [RELAY] });
    await settle();
    up = false;
    for (let i = 0; i < 5; i++) await client.request('getStopArrivals', '1');
    assert.match(logs.join(), /5 direct failures in a row.*resting it for 24 h — using the relay meanwhile/);

    calls.length = 0;
    c.advance(23 * 3_600_000 + 59 * 60_000);
    await client.request('getStopArrivals', '1');
    assert.deepEqual(calls, ['relay(k)']);

    // The rest is over and direct works again: the next visitor still goes through
    // the relay while direct is tested, and later visitors go direct
    up = true;
    c.advance(60_001);
    calls.length = 0;
    await client.request('getStopArrivals', '1');
    await settle();
    assert.deepEqual(calls.toSorted(), ['direct', 'relay(k)']);
    assert.match(logs.at(-1), /direct access is working again/);
    calls.length = 0;
    await client.request('getStopArrivals', '1');
    assert.deepEqual(calls, ['direct']);
});

test('a route that fails its test is tested again a day later, quietly', async () => {
    const c = clock();
    const logs = [];
    const { fetch, calls } = routedFetch({ directUp: () => false });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: m => logs.push(m), relays: [RELAY] });
    await settle();
    c.advance(24 * 3_600_000 + 1);
    calls.length = 0;
    await client.request('getStopArrivals', '1');
    await settle();
    assert.deepEqual(calls.toSorted(), ['direct', 'relay(k)']);
    assert.equal(logs.length, 1, 'only the first failed test is logged');
    assert.equal(client.status().routes[0].resting, true);
});

test('routes with a fallback wait 3 s for an answer, the last route 8 s', async () => {
    const c = clock();
    const seen = [];
    const original = AbortSignal.timeout;
    AbortSignal.timeout = ms => { seen.push(ms); return original.call(AbortSignal, ms); };
    try {
        const { fetch } = routedFetch({ directUp: () => false });
        const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: quiet, relays: [RELAY] });
        await client.request('getStopArrivals', '1');
        await settle();
    } finally {
        AbortSignal.timeout = original;
    }
    assert.deepEqual(seen.toSorted((a, b) => a - b), [3000, 8000]);
});

test('the background test and each request take one slot each, however many routes they try', async () => {
    const c = clock();
    const sendAt = [];
    const client = createOasaClient({
        fetch: async () => { throw new Error('down'); },
        now: c.now,
        sleep: async ms => { sendAt.push(ms); },
        log: quiet,
        relays: [RELAY],
    });
    await settle();
    await assert.rejects(client.request('getStopArrivals', '1'), OasaUnavailable);
    await assert.rejects(client.request('getStopArrivals', '1'), OasaUnavailable);
    // The test went at once; each request waits its own 500 ms
    assert.deepEqual(sendAt, [500, 1000]);
});

// What the bus page does: several stops requested at the same moment
test('simultaneous failures put a route to rest once, with one log line', async () => {
    const c = clock();
    let up = true;
    const logs = [];
    const { fetch, calls } = routedFetch({ directUp: () => up });
    const client = createOasaClient({ fetch, now: c.now, sleep: async () => {}, log: m => logs.push(m), relays: [RELAY] });
    await settle();
    up = false;
    const results = await Promise.all(Array.from({ length: 12 }, () => client.request('getStopArrivals', '1')));
    assert.equal(results.length, 12); // all answered through the relay
    assert.equal(logs.filter(m => m.includes('direct failures')).length, 1);
    // Requests that were already in flight don't restart the rest: the next one goes straight to the relay
    calls.length = 0;
    await client.request('getStopArrivals', '1');
    assert.deepEqual(calls, ['relay(k)']);
});

test('after a rest, simultaneous requests send a single probe', async () => {
    const c = clock();
    let relayUp = false;
    const logs = [];
    const relayCalls = [];
    // The probe's answer is held until every request has had its slot
    let answer;
    const answered = new Promise(resolve => { answer = resolve; });
    const fetch = async url => {
        await Promise.resolve();
        if (!url.startsWith(RELAY.url)) throw new Error('blocked');
        relayCalls.push(c.now());
        if (!relayUp) throw new Error('relay down');
        await answered;
        return { ok: true, text: async () => '[]' };
    };
    const client = createOasaClient({ fetch, now: c.now, sleep: async () => {}, log: m => logs.push(m), relays: [RELAY] });

    // Both routes fail until both are resting
    await Promise.allSettled(Array.from({ length: 12 }, () => client.request('getStopArrivals', '1')));
    assert.equal(logs.filter(m => m.includes('relay failures')).length, 1);

    // The relay's 60 s rest is over and it has recovered; 6 stops are asked for at once
    relayUp = true;
    c.advance(60_001);
    relayCalls.length = 0;
    const asked = Promise.allSettled(Array.from({ length: 6 }, () => client.request('getStopArrivals', '1')));
    await new Promise(resolve => setTimeout(resolve, 0));
    answer();
    const results = await asked;
    assert.equal(relayCalls.length, 1, 'one probe, not a burst');
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(logs.at(-1), /relay access is working again/);

    // With the probe successful, the relay is back in normal use
    const after = await Promise.allSettled(Array.from({ length: 6 }, () => client.request('getStopArrivals', '1')));
    assert.ok(after.every(r => r.status === 'fulfilled'));
});

// ── Several relays: direct, then the Cloudflare Worker, then the home relay ──

const HOME = { name: 'home relay', url: 'https://home.example/', key: 'h' };

// `up` says which routes answer; calls are logged as direct / relay / home
function chainFetch(up) {
    const calls = [];
    const fetch = async url => {
        const name = url.startsWith(RELAY.url) ? 'relay' : url.startsWith(HOME.url) ? 'home' : 'direct';
        calls.push(name);
        if (!up[name]) throw new Error(`${name} down`);
        return { ok: true, text: async () => '[]' };
    };
    return { fetch, calls };
}

test('routes are used in order once their tests pass: direct, the relay, then the home relay', async () => {
    const c = clock();
    const { fetch, calls } = chainFetch({ direct: false, relay: true, home: true });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: quiet, relays: [RELAY, HOME] });
    // Before the tests answer, the last route carries the traffic
    await client.request('getStopArrivals', '1');
    await settle();
    assert.deepEqual(calls.toSorted(), ['direct', 'home', 'relay']);
    // Then the earliest working route
    calls.length = 0;
    await client.request('getStopArrivals', '1');
    assert.deepEqual(calls, ['relay']);
});

// Today's production: OASA blocks both the server and the Worker
test('with direct and the relay blocked, no visitor ever waits on them', async () => {
    const c = clock();
    const logs = [];
    const { fetch, calls } = chainFetch({ direct: false, relay: false, home: true });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: m => logs.push(m), relays: [RELAY, HOME] });
    await settle();
    assert.match(logs.join('\n'), /direct can't reach OASA \(direct down\); using the relay/);
    assert.match(logs.join('\n'), /relay can't reach OASA \(relay down\); using the home relay — testing it again in 24 h/);

    // Every visitor's request goes straight to the home relay
    calls.length = 0;
    for (let i = 0; i < 5; i++) await client.request('getStopArrivals', '1');
    assert.deepEqual(calls, Array(5).fill('home'));

    // A day later both are tested again in the background; the visitor still goes home
    c.advance(24 * 3_600_000 + 1);
    calls.length = 0;
    await client.request('getStopArrivals', '1');
    await settle();
    assert.deepEqual(calls.toSorted(), ['direct', 'home', 'relay']);
});

test('the last route rests only a minute, since nothing comes after it', async () => {
    const c = clock();
    const logs = [];
    const { fetch } = chainFetch({ direct: false, relay: false, home: false });
    const client = createOasaClient({ fetch, now: c.now, sleep: c.sleep, log: m => logs.push(m), relays: [RELAY, HOME] });
    await settle();
    for (let i = 0; i < 5; i++) await assert.rejects(client.request('getStopArrivals', '1'), OasaUnavailable);
    assert.match(logs.join('\n'), /5 home relay failures in a row \(last: home down\); resting it for 60 s$/m);
});
