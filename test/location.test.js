import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The device's location as the bus and subway pages get it
// (public/js/core/location.js): when it asks, how long a position is kept and
// shared, how precise the saved one is, and what pages hear when it's
// blocked, unavailable or slow. The browser tests check the same pages with a
// fake location service; these go through every rule in milliseconds.

const MINUTE = 60_000;

// A browser of its own for each test: storage, the location service, page
// visibility, and a clock the test moves (so no real 20 s timer is left
// running). `permission`: what navigator.permissions says; `geolocation:
// false` for a browser without it.
function browser(t, { permission = 'prompt', geolocation = true, permissionsApi = true } = {}) {
    try { t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 * MINUTE }); } catch { /* a second browser in the same test */ }
    const stored = new Map();
    const calls = { quick: [], watch: [], cleared: [] };
    let watcher = null;
    const listeners = {};
    const env = {
        localStorage: {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, String(value)),
            removeItem: key => stored.delete(key),
        },
        navigator: {
            geolocation: geolocation ? {
                getCurrentPosition: (ok, fail, options) => calls.quick.push({ ok, fail, options }),
                watchPosition: (ok, fail, options) => { watcher = { ok, fail }; calls.watch.push(options); return calls.watch.length; },
                clearWatch: id => calls.cleared.push(id),
            } : undefined,
            permissions: permissionsApi ? { query: async () => ({ state: permission }) } : undefined,
        },
        document: {
            hidden: false,
            addEventListener: (type, fn) => { listeners[type] = fn; },
        },
    };
    for (const [name, value] of Object.entries(env)) {
        const before = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
    }
    return {
        stored,
        calls,
        // The location service answering the watch, or failing (1: denied, 2: unavailable)
        position: (lat, lng, timestamp = Date.now()) => watcher.ok({ coords: { latitude: lat, longitude: lng }, timestamp }),
        quickFix: (lat, lng, timestamp) => calls.quick.at(-1).ok({ coords: { latitude: lat, longitude: lng }, timestamp }),
        fail: code => watcher.fail({ code }),
        hide: () => { env.document.hidden = true; listeners.visibilitychange(); },
        show: () => { env.document.hidden = false; listeners.visibilitychange(); },
    };
}
const load = () => browserModule('public/js/core/location.js', 'en', { fresh: true });

test('a position from the last 10 minutes is used straight away; an older one is forgotten', async t => {
    const b = browser(t);
    const location = await load();
    assert.equal(location.lastPosition(), null);

    b.stored.set('location', JSON.stringify({ lat: 37.9755, lng: 23.7348, at: Date.now() - 9 * MINUTE }));
    assert.deepEqual(location.lastPosition(), { lat: 37.9755, lng: 23.7348, at: Date.now() - 9 * MINUTE });

    t.mock.timers.tick(2 * MINUTE);
    assert.equal(location.lastPosition(), null);
    assert.equal(b.stored.has('location'), false, 'removed once too old');

    b.stored.set('location', 'not json');
    assert.equal(location.lastPosition(), null);
});

test('whether a page can start without the browser asking', async t => {
    const cases = [
        [{ permission: 'granted' }, null, 'granted'],
        [{ permission: 'prompt' }, null, 'prompt'],
        // Allowed before, though some browsers keep saying "prompt"
        [{ permission: 'prompt' }, '1', 'granted'],
        [{ permission: 'denied' }, '1', 'denied'],
        [{ permissionsApi: false }, null, 'prompt'],
        [{ permissionsApi: false }, '1', 'granted'],
        [{ geolocation: false }, '1', 'denied'],
    ];
    for (const [setup, allowed, expected] of cases) {
        await t.test(`${JSON.stringify(setup)}, allowed before: ${Boolean(allowed)} → ${expected}`, async t => {
            const b = browser(t, setup);
            if (allowed) b.stored.set('location-allowed', allowed);
            assert.equal(await (await load()).locationPermission(), expected);
        });
    }
});

test('following the location: a quick rough fix and a precise watch, saved to about 10 m', async t => {
    const b = browser(t);
    const location = await load();
    const heard = [];
    location.onLocation(p => heard.push(p));

    location.startLocation();
    location.startLocation(); // a second page asking doesn't start a second watch
    assert.equal(b.calls.quick.length, 1);
    assert.deepEqual(b.calls.quick[0].options, { enableHighAccuracy: false, maximumAge: 5 * MINUTE, timeout: 10_000 });
    assert.deepEqual(b.calls.watch, [{ enableHighAccuracy: true }]);

    b.position(37.975512345, 23.734812345);
    assert.deepEqual(heard, [{ lat: 37.975512345, lng: 23.734812345, at: Date.now() }]);
    assert.deepEqual(JSON.parse(b.stored.get('location')), { lat: 37.9755, lng: 23.7348, at: Date.now() });
    assert.equal(b.stored.get('location-allowed'), '1');

    // The quick fix arriving after the watch, and older: ignored
    b.quickFix(38, 24, Date.now() - MINUTE);
    assert.equal(heard.length, 1);
});

test('blocked: pages hear "denied", and nothing is kept', async t => {
    const b = browser(t);
    const location = await load();
    const problems = [];
    location.onLocationProblem(p => problems.push(p));
    b.stored.set('location-allowed', '1');
    location.startLocation();
    b.position(37.9755, 23.7348);
    b.fail(1);
    assert.deepEqual(problems, ['denied']);
    assert.equal(b.stored.has('location'), false);
    assert.equal(b.stored.has('location-allowed'), false);
    assert.deepEqual(b.calls.cleared, [1]);
});

test('unavailable for a moment: pages hear it, and the watch keeps trying', async t => {
    const b = browser(t);
    const location = await load();
    const problems = [];
    location.onLocationProblem(p => problems.push(p));
    location.startLocation();
    b.fail(2);
    assert.deepEqual(problems, ['unavailable']);
    assert.deepEqual(b.calls.cleared, []);
});

test('no position after 20 s: pages hear "slow", unless a recent one is saved', async t => {
    browser(t);
    const location = await load();
    const problems = [];
    location.onLocationProblem(p => problems.push(p));
    location.startLocation();
    t.mock.timers.tick(19_999);
    assert.deepEqual(problems, []);
    t.mock.timers.tick(1);
    assert.deepEqual(problems, ['slow']);

    // Another page, with a position from a minute ago
    const b2 = browser(t);
    b2.stored.set('location', JSON.stringify({ lat: 37.9755, lng: 23.7348, at: Date.now() - MINUTE }));
    const other = await load();
    const heard = [];
    other.onLocationProblem(p => heard.push(p));
    other.startLocation();
    t.mock.timers.tick(21_000);
    assert.deepEqual(heard, []);
});

test('in the background for 10 minutes the GPS stops, and starts again on return', async t => {
    const b = browser(t);
    const location = await load();
    location.startLocation();
    b.hide();
    t.mock.timers.tick(10 * MINUTE - 1);
    assert.deepEqual(b.calls.cleared, []);
    t.mock.timers.tick(1);
    assert.deepEqual(b.calls.cleared, [1]);
    b.show();
    assert.equal(b.calls.watch.length, 2, 'watching again');

    // Back within 10 minutes: never stopped
    b.hide();
    t.mock.timers.tick(5 * MINUTE);
    b.show();
    t.mock.timers.tick(10 * MINUTE);
    assert.deepEqual(b.calls.cleared, [1]);
});

test('a browser without location: pages hear "unsupported"', async t => {
    browser(t, { geolocation: false });
    const location = await load();
    const problems = [];
    location.onLocationProblem(p => problems.push(p));
    location.startLocation();
    assert.deepEqual(problems, ['unsupported']);
});
