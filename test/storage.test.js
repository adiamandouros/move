import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// What pages keep in the browser (public/js/core/storage.js): localStore on
// the device, sessionStore for the tab, and nothing breaking when either is
// blocked, full or missing. The modules that keep things have their own
// tests (favourites, location, recent, remember, theme, the Trip page's kept
// trip); this is the one helper they share.

const { localStore, sessionStore } = await browserModule('public/js/core/storage.js');

// The browser's storage under `name`: one of its own, one that throws (as
// when it's blocked, or full on a write), or none
function storage(t, name, kind = 'working') {
    const stored = new Map();
    const refuse = () => { throw new Error('blocked'); };
    const value = {
        working: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) },
        blocked: { getItem: refuse, setItem: refuse, removeItem: refuse },
    }[kind];
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    if (value) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    else delete globalThis[name];
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
    return stored;
}

test('kept, read back and removed, each in its own storage', t => {
    const device = storage(t, 'localStorage');
    const tab = storage(t, 'sessionStorage');
    localStore.set('theme', 'light');
    sessionStore.set('view:subway', '?from=a');
    assert.equal(localStore.get('theme'), 'light');
    assert.equal(sessionStore.get('view:subway'), '?from=a');
    assert.deepEqual([...device.keys()], ['theme']);
    assert.deepEqual([...tab.keys()], ['view:subway']);
    assert.equal(localStore.get('nothing'), null);
    localStore.remove('theme');
    assert.equal(localStore.get('theme'), null);
});

test('blocked or full: a read gives null and a write keeps nothing, with no error', t => {
    storage(t, 'localStorage', 'blocked');
    storage(t, 'sessionStorage', 'blocked');
    for (const store of [localStore, sessionStore]) {
        assert.doesNotThrow(() => store.set('a', '1'));
        assert.doesNotThrow(() => store.remove('a'));
        assert.equal(store.get('a'), null);
    }
});

test('missing altogether (no such storage in this browser): the same', t => {
    storage(t, 'localStorage', 'missing');
    storage(t, 'sessionStorage', 'missing');
    for (const store of [localStore, sessionStore]) {
        assert.doesNotThrow(() => store.set('a', '1'));
        assert.doesNotThrow(() => store.remove('a'));
        assert.equal(store.get('a'), null);
    }
});

test('looked up on each call: storage that comes, goes or changes is used as it is then', t => {
    const first = storage(t, 'localStorage');
    localStore.set('a', '1');
    const second = storage(t, 'localStorage');
    localStore.set('b', '2');
    assert.deepEqual([...first.keys()], ['a']);
    assert.deepEqual([...second.keys()], ['b']);
});
