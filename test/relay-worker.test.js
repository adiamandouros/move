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

test('relays the data build\'s calls: the lines (no code), a line\'s routes, a route\'s stops', async () => {
    for (const query of ['?act=webGetLines', '?act=webGetRoutes&p1=938', '?act=webGetStops&p1=3922', '?act=webRoutesForStop&p1=280054']) {
        assert.equal((await call(query)).status, 200, query);
    }
    assert.deepEqual(upstream.map(u => u.url), [
        'https://telematics.oasa.gr/api/?act=webGetLines',
        'https://telematics.oasa.gr/api/?act=webGetRoutes&p1=938',
        'https://telematics.oasa.gr/api/?act=webGetStops&p1=3922',
        'https://telematics.oasa.gr/api/?act=webRoutesForStop&p1=280054',
    ]);
});

test('refuses anything but the app\'s own API calls', async () => {
    for (const query of ['?act=getBusLocation&p1=1', '?act=getStopArrivals&p1=1;rm', '?act=getStopArrivals', '?act=webGetLines&p1=1', '?act=webGetRoutes', '?act=webGetStops&p1=abc', '?act=webGetLinesWithMLInfo']) {
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

test('relays STASY\'s Greek timetable page for metro lines 1 to 3, and nothing else', async () => {
    for (const line of ['1', '2', '3']) assert.equal((await call(`?act=stasyTimetable&line=${line}`)).status, 200, line);
    assert.deepEqual(upstream.map(u => decodeURI(u.url)), [1, 2, 3].map(n => `https://www.stasy.gr/δρομολόγια/γραμμή-${n}/`));
    for (const line of ['', '0', '4', '12', '1/..', 'a']) {
        assert.equal((await call(`?act=stasyTimetable&line=${encodeURIComponent(line)}`)).status, 400, JSON.stringify(line));
    }
    assert.equal((await call('?act=stasyTimetable&line=1', {})).status, 401);
    assert.equal(upstream.length, 3);
});

test('relays PDFs STASY has uploaded (the airport timetable), as they are, and nothing else', async () => {
    const pdf = 'wp-content/uploads/2024/06/%CE%94%CE%99%CE%95%CE%9B%CE%95%CE%A5%CE%A3%CE%95%CE%99%CE%A3-%CE%A3%CE%A5%CE%A1%CE%9C%CE%A9%CE%9D.pdf';
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0xe2]);
    globalThis.fetch = async (url, init) => {
        upstream.push({ url, accept: init.headers.Accept });
        return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    };
    const res = await call(`?act=stasyFile&path=${encodeURIComponent(pdf)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/pdf');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
    assert.deepEqual(upstream, [{ url: `https://www.stasy.gr/${pdf}`, accept: 'application/pdf' }]);

    for (const path of ['', 'x.pdf', 'wp-content/uploads/2024/06/a.html', 'wp-content/uploads/2024/06/../../wp-config.pdf', 'wp-content/uploads/2024/06/a%2F..%2Fb.pdf',
        'wp-content/uploads/2024/6/a.pdf', 'wp-content/uploads/2024/06/sub/a.pdf', 'wp-admin/uploads/2024/06/a.pdf', 'wp-content/uploads/2024/06/a.pdf?x=1', '//evil.example/a.pdf']) {
        assert.equal((await call(`?act=stasyFile&path=${encodeURIComponent(path)}`)).status, 400, JSON.stringify(path));
    }
    assert.equal((await call(`?act=stasyFile&path=${encodeURIComponent(pdf)}`, {})).status, 401);
    assert.equal(upstream.length, 1);
});
