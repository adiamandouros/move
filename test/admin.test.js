import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { createAuth, createLimiter } from '../server/admin/auth.js';
import { createAdmin } from '../server/admin/index.js';
import { loadCurated } from '../server/data/index.js';

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
    overlayFile = join(mkdtempSync(join(tmpdir(), 'move-admin-')), 'positions.json');
    const app = express();
    app.use('/admin', createAdmin({
        password: PASSWORD,
        overlayFile,
        loadCurated: () => loadCurated({ overlayFile }),
        loadRail: () => rail,
        rebuild: () => { rebuilds++; },
        render: ({ content }) => content,
    }));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}/admin`;
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

test('createAdmin is disabled without a password', () => {
    assert.equal(createAdmin({ password: '' }), null);
});

test('pages and API need a session; wrong passwords are rejected', async () => {
    assert.equal((await fetch(`${base}/stations`, { redirect: 'manual' })).headers.get('location'), '/admin/login');
    assert.equal((await api('/state')).status, 401);
    // The login page's stylesheet must load without a session
    assert.match((await fetch(`${base}/assets/admin.css`)).headers.get('content-type'), /text\/css/);
    const wrong = await login('nope');
    assert.equal(wrong.res.status, 401);
    assert.equal(wrong.cookie, undefined);
});

test('saving, reverting and exporting an entry', async () => {
    const { res, cookie } = await login();
    assert.equal(res.status, 303);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(res.headers.get('set-cookie'), /SameSite=Strict/i);

    const state = await (await api('/state', cookie)).json();
    assert.deepEqual(state.lines.M1.directions.kifisia.stations, ['moschato', 'monastiraki']);
    assert.deepEqual(state.committed.M1.kifisia.moschato, { exits: [] });

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
    const ok = await put('moschato', { exits: ['front', 'back'], note: ' New stairs ' });
    assert.deepEqual(await ok.json(), { entry: { exits: ['back', 'front'], note: 'New stairs' }, edited: true });
    assert.deepEqual(JSON.parse(readFileSync(overlayFile, 'utf8')), { M1: { kifisia: { moschato: { exits: ['back', 'front'], note: 'New stairs' } } } });
    assert.equal(rebuilds, before + 1);

    // Export = committed file with the edit applied, one station per line
    const exported = await (await api('/export', cookie)).text();
    assert.match(exported, /^ {6}"moschato": \{ "exits": \["back", "front"\], "note": "New stairs" \},$/m);

    // Saving the committed value again removes the edit
    const same = await put('moschato', { exits: [] });
    assert.equal((await same.json()).edited, false);
    assert.deepEqual(JSON.parse(readFileSync(overlayFile, 'utf8')), {});

    // DELETE reverts too
    await put('moschato', { exits: ['center'] });
    const reverted = await api('/positions/M1/kifisia/moschato', cookie, { method: 'DELETE' });
    assert.deepEqual(await reverted.json(), { entry: { exits: [] }, edited: false });
});
