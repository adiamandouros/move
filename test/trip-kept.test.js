import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The trip kept on the Trip page for the session, 12 hours at most (decision
// 49, tools/trip/client/kept.js). The page's side: test/browser/trip.spec.js.

const { KEEP_MS, forgetTrip, keepTrip, keptTrip } = await browserModule('tools/trip/client/kept.js');

// sessionStorage, as a page has it
const saved = new Map();
globalThis.sessionStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: key => saved.delete(key),
};
beforeEach(() => saved.clear());

// Two places as search finds them
const MENELAOU = { type: 'address', name: 'Μενελάου', n: '45', lat: 37.955, lng: 23.707 };
const FIX = { type: 'place', placeKind: 'metro', name: 'Συγγρού-Φιξ', n: null, lat: 37.964, lng: 23.726 };
const T = 1_000_000;

test('12 hours at most', () => {
    assert.equal(KEEP_MS, 12 * 60 * 60 * 1000);
});

test('the trip comes back as it was set, one end set too', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    assert.deepEqual(keptTrip(T + 1), { from: MENELAOU, to: FIX });
    keepTrip({ from: null, to: FIX }, T);
    assert.deepEqual(keptTrip(T + 1), { from: null, to: FIX });
});

test('forgotten 12 hours after it was set, and the same trip kept again doesn\'t make it younger', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepTrip({ from: MENELAOU, to: FIX }, T + KEEP_MS - 1);
    assert.deepEqual(keptTrip(T + KEEP_MS - 1), { from: MENELAOU, to: FIX });
    assert.equal(keptTrip(T + KEEP_MS), null);
    assert.equal(saved.size, 0, 'an old trip is cleared away');
});

test('a changed trip counts from when it changed', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepTrip({ from: FIX, to: MENELAOU }, T + KEEP_MS - 1);
    assert.deepEqual(keptTrip(T + KEEP_MS), { from: FIX, to: MENELAOU });
});

test('no ends, the link to the page, or nothing readable: nothing kept', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepTrip({ from: null, to: null }, T);
    assert.equal(keptTrip(T), null);
    keepTrip({ from: MENELAOU, to: FIX }, T);
    forgetTrip();
    assert.equal(keptTrip(T), null);
    saved.set('trip', '{not json');
    assert.equal(keptTrip(T), null);
    saved.set('trip', JSON.stringify({ from: MENELAOU }));
    assert.equal(keptTrip(T), null);
});

test('storage blocked: nothing kept, and nothing breaks', () => {
    const own = globalThis.sessionStorage;
    globalThis.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    try {
        keepTrip({ from: MENELAOU, to: FIX }, T);
        assert.equal(keptTrip(T), null);
        forgetTrip();
    } finally {
        globalThis.sessionStorage = own;
    }
});
