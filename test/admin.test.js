import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { createAuth, createLimiter } from '../server/admin/auth.js';
import { createAdmin } from '../server/admin/index.js';
import { loadCurated } from '../server/data/index.js';
import { listen } from './support/listen.js';

test('sessions verify until they expire and depend on the password', () => {
    let now = 1_000;
    const auth = createAuth('secret', { now: () => now });
    const token = auth.issue();
    assert.ok(auth.verify(token));
    assert.ok(!createAuth('other', { now: () => now }).verify(token));
    assert.ok(!auth.verify(token.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))));
    assert.ok(!auth.verify('garbage'));
    now += auth.sessionMs + 1;
    assert.ok(!auth.verify(token));
    assert.ok(auth.checkPassword('secret') && !auth.checkPassword('Secret'));
});

test('the limiter blocks after repeated failures and forgets them later', () => {
    let now = 0;
    const limiter = createLimiter({ max: 2, windowMs: 1000, now: () => now });
    limiter.fail('ip');
    assert.ok(!limiter.blocked('ip'));
    limiter.fail('ip');
    assert.ok(limiter.blocked('ip'));
    now = 1001;
    assert.ok(!limiter.blocked('ip'));
});

// ── The admin API, against the real curated files and a throwaway overlay ──

const PASSWORD = 'test-password';
let server;
let base;
let overlayDir;
let overlayFile;
let rebuilds = 0;

const rail = {
    stations: {
        moschato: { name: { el: 'Μοσχάτο', en: 'Moschato' }, coords: [37.95, 23.68], lines: ['M1'] },
        monastiraki: { name: { el: 'Μοναστηράκι', en: 'Monastiraki' }, coords: [37.97, 23.72], lines: ['M1', 'M3'] },
    },
    lines: {
        M1: { name: 'M1', color: '#4caf50', directions: { kifisia: { toward: { el: 'Κηφισιά', en: 'Kifisia' }, stops: [{ station: 'moschato' }, { station: 'monastiraki' }] } } },
    },
};

before(async () => {
    overlayDir = mkdtempSync(join(tmpdir(), 'move-admin-'));
    overlayFile = join(overlayDir, 'positions.json');
    const app = express();
    app.use('/admin', createAdmin({
        password: PASSWORD,
        loadCurated: () => loadCurated({ overlayDir }),
        loadRail: () => rail,
        rebuild: () => { rebuilds++; },
        render: ({ content }) => content,
        liftNames: () => ({ moschato: ['Προς Πειραιά', 'Προς Κηφισιά'] }),
    }));
    server = await listen(app);
    base = `${server.url}/admin`;
});

after(() => server.close());

async function login(password = PASSWORD) {
    const res = await fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password }),
        redirect: 'manual',
    });
    return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const api = (path, cookie, init = {}) => fetch(`${base}/api${path}`, {
    ...init,
    headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) },
    redirect: 'manual',
});

test('names every object has aren\'t lines, directions or stations: 404, not a crash', async () => {
    const { cookie } = await login();
    for (const path of ['/positions/constructor/kifisia/moschato', '/positions/__proto__/kifisia/moschato', '/positions/M1/constructor/moschato', '/positions/M1/kifisia/toString']) {
        const put = await api(path, cookie, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: { exits: ['front'] } }) });
        assert.equal(put.status, 404, `PUT ${path}`);
        assert.equal((await api(path, cookie, { method: 'DELETE' })).status, 404, `DELETE ${path}`);
    }
});

test('createAdmin is disabled without a password', () => {
    assert.equal(createAdmin({ password: '' }), null);
});

test('pages and API need a session; wrong passwords are rejected', async () => {
    assert.equal((await fetch(`${base}/stations`, { redirect: 'manual' })).headers.get('location'), '/admin/login');
    assert.equal((await fetch(`${base}/usage`, { redirect: 'manual' })).headers.get('location'), '/admin/login');
    assert.equal((await api('/state')).status, 401);
    // The login page's stylesheet must load without a session
    assert.match((await fetch(`${base}/assets/admin.css`)).headers.get('content-type'), /text\/css/);
    const wrong = await login('nope');
    assert.equal(wrong.res.status, 401);
    assert.equal(wrong.cookie, undefined);
});

test('axe-core, for the accessibility check, is only served with a session', async () => {
    const anonymous = await fetch(`${base}/vendor/axe.min.js`, { redirect: 'manual' });
    assert.notEqual(anonymous.status, 200);
    const { cookie } = await login();
    const res = await fetch(`${base}/vendor/axe.min.js`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.match(await res.text(), /axe/);
});

test('saving, reverting and exporting an entry', async () => {
    const { res, cookie } = await login();
    assert.equal(res.status, 303);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(res.headers.get('set-cookie'), /SameSite=Strict/i);

    const state = await (await api('/state', cookie)).json();
    assert.deepEqual(state.lines.M1.directions.kifisia.stations, ['moschato', 'monastiraki']);
    const committed = state.committed.M1.kifisia.moschato;
    assert.ok(Array.isArray(committed.exits));

    const put = (station, entry) => api(`/positions/M1/kifisia/${station}`, cookie, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry }),
    });

    // Invalid data is refused and nothing is written
    const bad = await put('moschato', { exits: ['middle'] });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).details.join(), /unknown position "middle"/);
    assert.equal(existsSync(overlayFile), false);
    assert.equal((await put('kifisia-nowhere', { exits: [] })).status, 404);

    // A valid edit lands in the overlay, tidied, and triggers a rebuild
    const before = rebuilds;
    // (with how the exits are reached: stairs at the back, an escalator at the front)
    const ok = await put('moschato', { exits: ['front', 'back'], escalators: ['front'], stairs: ['back'], note: ' New stairs ' });
    assert.deepEqual(await ok.json(), { entry: { exits: ['back', 'front'], escalators: ['front'], stairs: ['back'], note: 'New stairs' }, edited: true });
    assert.deepEqual(JSON.parse(readFileSync(overlayFile, 'utf8')), { M1: { kifisia: { moschato: { exits: ['back', 'front'], escalators: ['front'], stairs: ['back'], note: 'New stairs' } } } });
    assert.equal(rebuilds, before + 1);

    // Export = committed file with the edit applied, one station per line
    const exported = await (await api('/export', cookie)).text();
    assert.match(exported, /^ {6}"moschato": \{ "exits": \["back", "front"\], "escalators": \["front"\], "stairs": \["back"\], "note": "New stairs" \},$/m);

    // Saving the committed value again removes the edit
    const same = await put('moschato', committed);
    assert.equal((await same.json()).edited, false);
    assert.deepEqual(JSON.parse(readFileSync(overlayFile, 'utf8')), {});

    // DELETE reverts too
    await put('moschato', { exits: ['center'] });
    const reverted = await api('/positions/M1/kifisia/moschato', cookie, { method: 'DELETE' });
    assert.deepEqual(await reverted.json(), { entry: committed, edited: false });
});

test('elevators: STASY\'s names come with the data; one saved as the editor did before names, or as "none", is tidied', async () => {
    const { cookie } = await login();
    const state = await (await api('/state', cookie)).json();
    assert.deepEqual(state.stasyLifts, { moschato: ['Προς Πειραιά', 'Προς Κηφισιά'] });

    const put = entry => api('/positions/M1/kifisia/moschato', cookie, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry }),
    });
    // A phone's queue may still hold edits from the editor before (decision 16)
    assert.deepEqual((await (await put({ exits: ['back'], elevators: ['front'] })).json()).entry, { exits: ['back'], elevators: [{ at: 'front' }] });
    assert.deepEqual((await (await put({ exits: ['back'], elevators: [] })).json()).entry, { exits: ['back'] });
    assert.deepEqual((await (await put({ exits: ['back'], elevators: 'none' })).json()).entry, { exits: ['back'], elevators: 'none' });
    // The way to the other side, tidied like the rest
    const crossing = await (await put({ exits: ['back'], crossing: { at: ['front', 'back'], via: 'bridge', way: ['escalator-up', 'stairs'] } })).json();
    assert.deepEqual(crossing.entry, { exits: ['back'], crossing: { at: ['back', 'front'], via: 'bridge', way: ['stairs', 'escalator-up'] } });
    const named = await (await put({ exits: ['back'], elevators: [{ at: 'front', name: 'Προς Κηφισιά' }] })).json();
    assert.deepEqual(named.entry.elevators, [{ at: 'front', name: 'Προς Κηφισιά' }]);
    assert.deepEqual(JSON.parse(readFileSync(overlayFile, 'utf8')).M1.kifisia.moschato.elevators, [{ at: 'front', name: 'Προς Κηφισιά' }]);

    const bad = await put({ exits: ['back'], elevators: [{ at: 'roof' }] });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).details.join(), /elevators\[0\]\.at: unknown position "roof"/);
    await api('/positions/M1/kifisia/moschato', cookie, { method: 'DELETE' });
});

test('a station\'s exits and elevators on the street: saved to street.json\'s overlay, reverted, exported, each exit on its line', async () => {
    const { cookie } = await login();
    const state = await (await api('/state', cookie)).json();
    assert.deepEqual(state.street, { committed: JSON.parse(readFileSync(new URL('../data/curated/street.json', import.meta.url), 'utf8')), overlay: {} });
    // What the editor offers and checks, as the server does
    assert.deepEqual(state.exitWays, ['stairs', 'escalator-up', 'escalator-down']);
    assert.deepEqual(state.crossingWays, ['stairs', 'escalator-up', 'escalator-down', 'lift', 'ramp']);
    assert.deepEqual(Object.keys(state.bounds), ['lat', 'lng']);

    const put = (station, entry) => api(`/street/${station}`, cookie, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry }),
    });
    const streetFile = join(overlayDir, 'street.json');
    const before = rebuilds;
    const saved = await put('monastiraki', { exits: [{ name: { el: ' Αθηνάς ', en: '' }, coords: [37.976012345, 23.725654321], way: ['stairs'] }], lifts: [{ name: '', coords: null }] });
    assert.deepEqual(await saved.json(), { entry: { exits: [{ name: { el: 'Αθηνάς' }, coords: [37.97601, 23.72565], way: ['stairs'] }] }, edited: true });
    assert.deepEqual(JSON.parse(readFileSync(streetFile, 'utf8')), { monastiraki: { exits: [{ name: { el: 'Αθηνάς' }, coords: [37.97601, 23.72565], way: ['stairs'] }] } });
    assert.equal(rebuilds, before + 1);
    assert.deepEqual((await (await api('/state', cookie)).json()).street.overlay.monastiraki.exits[0].name, { el: 'Αθηνάς' });

    // Ready to commit, one exit per line; positions.json is still at its own address
    const exported = await (await api('/export/street.json', cookie)).text();
    assert.match(exported, /^ {4}"exits": \[\n {6}\{ "name": \{ "el": "Αθηνάς" \}, "coords": \[37\.97601, 23\.72565\], "way": \["stairs"\] \}\n {4}\]$/m);
    assert.equal(await (await api('/export/positions.json', cookie)).text(), await (await api('/export', cookie)).text());
    assert.equal((await api('/export/stations.json', cookie)).status, 404);

    // A place that isn't around Athens is refused; a station that isn't one is a 404
    const swapped = await put('monastiraki', { exits: [{ coords: [23.72565, 37.97601] }] });
    assert.equal(swapped.status, 400);
    assert.match((await swapped.json()).details.join(), /monastiraki\.exits\[0\]\.coords must be \[latitude, longitude\] around Athens/);
    for (const station of ['nowhere', 'constructor']) assert.equal((await put(station, { exits: [] })).status, 404, station);

    // Saving nothing for a station with nothing committed, or reverting, removes the edit
    assert.deepEqual(await (await put('monastiraki', { exits: [], lifts: [] })).json(), { entry: {}, edited: false });
    await put('monastiraki', { lifts: [{ name: 'Εξωτερικός Αθηνάς' }] });
    const reverted = await api('/street/monastiraki', cookie, { method: 'DELETE' });
    assert.deepEqual(await reverted.json(), { entry: null, edited: false });
    assert.deepEqual(JSON.parse(readFileSync(streetFile, 'utf8')), {});
});

test('the use of OASA, with a session: nothing counted yet when the app gives no days', async () => {
    const { cookie } = await login();
    const res = await fetch(`${base}/usage`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /<h1 class="fs-5 m-0">Use of OASA<\/h1>[\s\S]*Nothing has been counted yet\./);
});


test('the export key reads the export without a session, and opens nothing else', async () => {
    const KEY = 'k'.repeat(40);
    const app = express();
    const options = { password: PASSWORD, loadCurated: () => loadCurated({ overlayDir }), loadRail: () => rail, rebuild() {}, render: ({ content }) => content };
    app.use('/admin', createAdmin({ ...options, exportKey: KEY }));
    // An editor without a key: no header opens its export
    app.use('/keyless/admin', createAdmin(options));
    const keyed = await listen(app);
    after(() => keyed.close());
    const get = (path, key) => fetch(keyed.url + path, key === undefined ? {} : { headers: { Authorization: `Bearer ${key}` } });

    assert.equal((await get('/admin/api/export/street.json', KEY)).status, 200);
    const res = await get('/admin/api/export', KEY);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    // The committed file as it is, with no edits waiting
    assert.equal(await res.text(), readFileSync(new URL('../data/curated/positions.json', import.meta.url), 'utf8'));
    assert.equal((await get('/admin/api/state', KEY)).status, 401);
    assert.equal((await get('/admin/stations', KEY)).redirected, true);
    assert.equal((await get('/keyless/admin/api/export', '')).status, 401);
    assert.equal((await get('/admin/api/export')).status, 401);
    // Wrong keys count like wrong passwords: the fifth blocks the next try, the right key too
    for (let i = 0; i < 5; i++) assert.equal((await get('/admin/api/export', `${KEY}x`)).status, 401);
    assert.equal((await get('/admin/api/export', KEY)).status, 429);
});
