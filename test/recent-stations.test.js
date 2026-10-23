import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The stations picked lately (tools/subway/client/recent.js), kept on the
// device for the station lists. The browser tests (test/browser/planner.spec.js)
// go through it on the page.

// localStorage of its own, or one that throws, as when it's blocked
function storage(t, { blocked = false } = {}) {
    const stored = new Map();
    const refuse = () => { throw new Error('blocked'); };
    const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true, writable: true,
        value: blocked ? { getItem: refuse, setItem: refuse } : {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, String(value)),
        },
    });
    t.after(() => before ? Object.defineProperty(globalThis, 'localStorage', before) : delete globalThis.localStorage);
    return stored;
}

const recent = () => browserModule('tools/subway/client/recent.js');

test('the last three stations picked, most recent first, once each', async t => {
    storage(t);
    const { addRecentStation, recentStations } = await recent();
    assert.deepEqual(recentStations(), []);
    for (const id of ['syntagma', 'airport', 'omonia', 'syntagma', 'kifisia']) addRecentStation(id);
    assert.deepEqual(recentStations(), ['kifisia', 'syntagma', 'omonia']);
});

test('anything else saved under the name counts as none', async t => {
    const stored = storage(t);
    const { addRecentStation, recentStations } = await recent();
    for (const saved of ['not json', '{"a":1}', '"syntagma"', 'null']) {
        stored.set('recent-stations', saved);
        assert.deepEqual(recentStations(), [], saved);
        addRecentStation('airport');
        assert.deepEqual(recentStations(), ['airport'], saved);
    }
    stored.set('recent-stations', '["syntagma", 3, null]');
    assert.deepEqual(recentStations(), ['syntagma']);
});

test('without storage nothing is offered, and nothing breaks', async t => {
    storage(t, { blocked: true });
    const { addRecentStation, recentStations } = await recent();
    assert.doesNotThrow(() => addRecentStation('syntagma'));
    assert.deepEqual(recentStations(), []);
});
