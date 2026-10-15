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

test('relays STASY pages: one path segment on www.stasy.gr, with the key', async () => {
    const res = await call(`?act=stasyPage&path=${encodeURIComponent('%ce%bd%ce%ad%ce%b1-%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82')}`);
    assert.equal(res.status, 200);
    await call('?act=stasyPage&path=anak_pragm_sinentefksewn_gia_prok_5_2026');
    assert.deepEqual(upstream.map(u => u.url), [
        'https://www.stasy.gr/%ce%bd%ce%ad%ce%b1-%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/',
        'https://www.stasy.gr/anak_pragm_sinentefksewn_gia_prok_5_2026/',
    ]);
    assert.equal((await call('?act=stasyPage&path=news', {})).status, 401);
});

test('refuses STASY paths that could reach anything else', async () => {
    for (const path of ['', '..', 'a/b', '../etc', 'wp-admin/x', '.hidden', 'a?b=1', 'a#b', '//evil.example', 'a b', 'https:']) {
        assert.equal((await call(`?act=stasyPage&path=${encodeURIComponent(path)}`)).status, 400, JSON.stringify(path));
    }
    assert.equal(upstream.length, 0);
});
