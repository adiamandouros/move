import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayServer } from '../proxy/node.js';

const realFetch = globalThis.fetch;
const BIG_PAGE = `<html>${'<article>Ανακοίνωση</article>'.repeat(5000)}</html>`;
let server;
let base;
let upstream;

before(async () => {
    server = createRelayServer({ RELAY_KEY: 'secret' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    // Fake OASA and Cloudflare; requests to the relay itself go out for real
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith(base)) return realFetch(url, init);
        if (url === 'https://www.cloudflare.com/cdn-cgi/trace') return new Response('ip=198.51.100.4\ncolo=ATH\nloc=GR\n');
        upstream.push({ url, ua: init.headers['User-Agent'] });
        if (String(url).startsWith('https://www.stasy.gr/')) return new Response(BIG_PAGE, { status: 200, headers: { 'Content-Type': 'text/html' } });
        return new Response('[{"route_code":"1"}]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
});
after(() => {
    globalThis.fetch = realFetch;
    server.close();
});

const call = (query, headers = { 'X-Relay-Key': 'secret' }, method = 'GET') => {
    upstream = [];
    return fetch(`${base}/${query}`, { method, headers });
};

test('relays allowed calls over HTTP with the right key', async () => {
    const res = await call('?act=getStopArrivals&p1=10361', { 'X-Relay-Key': 'secret', 'User-Agent': 'Move test' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(await res.text(), '[{"route_code":"1"}]');
    assert.deepEqual(upstream, [{ url: 'https://telematics.oasa.gr/api/?act=getStopArrivals&p1=10361', ua: 'Move test' }]);
});

test('keeps the Worker\'s guards: key, allowed calls and method', async () => {
    assert.equal((await call('?act=getStopArrivals&p1=1', {})).status, 401);
    assert.equal((await call('?act=getStopArrivals&p1=1', { 'X-Relay-Key': 'nope' })).status, 401);
    assert.equal((await call('?act=getBusLocation&p1=1')).status, 400);
    assert.equal((await call('?act=getStopArrivals&p1=1', { 'X-Relay-Key': 'secret' }, 'POST')).status, 405);
    assert.equal(upstream.length, 0);
});

test('whereami reports where the machine\'s requests come from', async () => {
    const res = await call('?act=whereami');
    assert.deepEqual(await res.json(), { receivedAt: null, colo: 'ATH', loc: 'GR', ip: '198.51.100.4' });
});

test('compresses large answers for clients that accept gzip', async () => {
    const res = await call('?act=stasyPage&path=news', { 'X-Relay-Key': 'secret', 'Accept-Encoding': 'gzip' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-encoding'), 'gzip');
    // fetch unpacks it, as it does on the server
    assert.equal(await res.text(), BIG_PAGE);
    assert.ok(Number(res.headers.get('content-length')) < Buffer.byteLength(BIG_PAGE) / 10);
});
