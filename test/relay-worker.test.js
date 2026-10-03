import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.js';

const env = { RELAY_KEY: 'secret' };
const realFetch = globalThis.fetch;
let upstream;

beforeEach(() => {
    upstream = [];
    globalThis.fetch = async (url, init) => {
        if (url === 'https://www.cloudflare.com/cdn-cgi/trace') return new Response('fl=1\nip=198.51.100.4\ncolo=ATH\nloc=GR\n');
        upstream.push({ url, ua: init.headers['User-Agent'] });
        return new Response('[{"route_code":"1"}]', { status: 200, headers: { 'Content-Type': 'text/html' } });
    };
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (query, headers = { 'X-Relay-Key': 'secret' }, method = 'GET') =>
    worker.fetch(new Request(`https://relay.example/${query}`, { method, headers }), env);

test('relays allowed calls with the right key, passing the body through', async () => {
    const res = await call('?act=getStopArrivals&p1=10361', { 'X-Relay-Key': 'secret', 'User-Agent': 'Move test' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '[{"route_code":"1"}]');
    assert.deepEqual(upstream, [{ url: 'https://telematics.oasa.gr/api/?act=getStopArrivals&p1=10361', ua: 'Move test' }]);
});

test('refuses missing or wrong keys', async () => {
    assert.equal((await call('?act=getStopArrivals&p1=1', {})).status, 401);
    assert.equal((await call('?act=getStopArrivals&p1=1', { 'X-Relay-Key': 'nope' })).status, 401);
    assert.equal((await worker.fetch(new Request('https://relay.example/?act=getStopArrivals&p1=1', { headers: { 'X-Relay-Key': '' } }), {})).status, 401);
    assert.equal(upstream.length, 0);
});

test('refuses anything but the app\'s own API calls', async () => {
    for (const query of ['?act=getBusLocation&p1=1', '?act=getStopArrivals&p1=1;rm', '?act=getStopArrivals', '?act=webGetLines&p1=1']) {
        assert.equal((await call(query)).status, 400, query);
    }
    assert.equal((await call('?act=getStopArrivals&p1=1', { 'X-Relay-Key': 'secret' }, 'POST')).status, 405);
    assert.equal(upstream.length, 0);
});

test('whereami reports where the Worker\'s requests leave Cloudflare, and needs the key', async () => {
    const res = await call('?act=whereami');
    assert.deepEqual(await res.json(), { receivedAt: null, colo: 'ATH', loc: 'GR', ip: '198.51.100.4' });
    assert.equal((await call('?act=whereami', {})).status, 401);
    assert.equal(upstream.length, 0);
});
