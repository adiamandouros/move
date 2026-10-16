import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'http';
import express from 'express';
import { canonicalHost, RETIRED_WORKER } from '../server/canonical-host.js';

// Other addresses redirect to SITE_URL; installed copies at the old address retire

let server;
let base;
before(async () => {
    const app = express();
    app.use(canonicalHost());
    app.use((req, res) => res.send(`page ${req.method} ${req.originalUrl}`));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
});
after(() => server.close());
// fetch can't set Host, so a plain http request stands in for each address
const get = (path, host, { method = 'GET' } = {}) => new Promise((resolve, reject) => {
    request(base + path, { method, headers: { Host: host } }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: { get: name => res.headers[name] }, text: async () => body }));
    }).on('error', reject).end();
});

test('without SITE_URL nothing redirects', async () => {
    delete process.env.SITE_URL;
    const res = await get('/subway', 'move.sonovabitc.win');
    assert.equal(res.status, 200);
});

test('the old address redirects permanently, keeping the path and query', async () => {
    process.env.SITE_URL = 'https://wayhop.gr';
    const res = await get('/el/subway?to=syntagma', 'move.sonovabitc.win');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), 'https://wayhop.gr/el/subway?to=syntagma');
    assert.equal((await get('/', 'www.wayhop.gr')).headers.get('location'), 'https://wayhop.gr/');
});

test('form posts keep their method', async () => {
    process.env.SITE_URL = 'https://wayhop.gr';
    const res = await get('/admin/login', 'move.sonovabitc.win', { method: 'POST' });
    assert.equal(res.status, 308);
});

test('the new address, localhost, /api and /data are served as usual', async () => {
    process.env.SITE_URL = 'https://wayhop.gr/';
    assert.equal((await get('/subway', 'wayhop.gr')).status, 200);
    assert.equal((await get('/subway', 'localhost')).status, 200);
    assert.equal((await get('/api/arrivals?stops=1', 'move.sonovabitc.win')).status, 200);
    assert.equal((await get('/data/rail.json', 'move.sonovabitc.win')).status, 200);
});

test('the old address gets a service worker that clears its cache and leaves', async () => {
    process.env.SITE_URL = 'https://wayhop.gr';
    const res = await get('/sw.js', 'move.sonovabitc.win');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.equal(await res.text(), RETIRED_WORKER);
    assert.match(RETIRED_WORKER, /caches\.delete[\s\S]*unregister\(\)[\s\S]*navigate/);
    assert.equal(await (await get('/sw.js', 'wayhop.gr')).text(), 'page GET /sw.js');
});
