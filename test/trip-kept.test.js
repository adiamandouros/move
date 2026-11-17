import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The trip kept on the Trip page on the device, for 3 hours, with the ride
// followed on it (decisions 52 and 58, tools/trip/client/kept.js). The page's side: test/browser/trip.spec.js.

const { KEEP_MS, forgetTrip, keepRide, keepTrip, keptTrip } = await browserModule('tools/trip/client/kept.js');

// localStorage, as a page has it
const saved = new Map();
globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: key => saved.delete(key),
};
beforeEach(() => saved.clear());

// Two places as search finds them
const MENELAOU = { type: 'address', name: 'Μενελάου', n: '45', lat: 37.955, lng: 23.707 };
const FIX = { type: 'place', placeKind: 'metro', name: 'Συγγρού-Φιξ', n: null, lat: 37.964, lng: 23.726 };
const T = 1_000_000;

test('3 hours', () => {
    assert.equal(KEEP_MS, 3 * 60 * 60 * 1000);
});

test('the trip comes back as it was set, one end set too', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    assert.deepEqual(keptTrip(T + 1), { from: MENELAOU, to: FIX, ride: null });
    keepTrip({ from: null, to: FIX }, T);
    assert.deepEqual(keptTrip(T + 1), { from: null, to: FIX, ride: null });
});

test('forgotten 3 hours after it was set, and the same trip kept again doesn\'t make it younger', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepTrip({ from: MENELAOU, to: FIX }, T + KEEP_MS - 1);
    assert.deepEqual(keptTrip(T + KEEP_MS - 1), { from: MENELAOU, to: FIX, ride: null });
    assert.equal(keptTrip(T + KEEP_MS), null);
    assert.equal(saved.size, 0, 'an old trip is cleared away');
});

test('a changed trip counts from when it changed', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepTrip({ from: FIX, to: MENELAOU }, T + KEEP_MS - 1);
    assert.deepEqual(keptTrip(T + KEEP_MS), { from: FIX, to: MENELAOU, ride: null });
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

// A ride followed from My location, as main.js keeps it
const RIDE = { from: { lat: 37.955, lng: 23.707 }, now: { weekday: 3, seconds: 43_200, date: '2026-10-21' }, at: T, key: 'bus:1>bus:2',
    steps: [{ kind: 'walk', ride: 0, from: { lat: 37.955, lng: 23.707 }, to: { lat: 37.9555, lng: 23.7017 } }], state: { step: 0, stop: 0, at: T, offSince: null, fix: null, anchor: null, moved: false, off: false },
    choice: null, own: null };

test('the ride followed comes back with the trip, and goes with other ends or none', () => {
    keepRide(RIDE, T);
    assert.equal(keptTrip(T), null, 'nothing without a trip kept');
    keepTrip({ from: null, to: FIX }, T);
    keepRide(RIDE, T + 1);
    assert.deepEqual(keptTrip(T + 2), { from: null, to: FIX, ride: RIDE });
    // The same ends kept again (each draw does) keep it
    keepTrip({ from: null, to: FIX }, T + 3);
    assert.deepEqual(keptTrip(T + 4).ride, RIDE);
    keepRide(null, T + 5);
    assert.deepEqual(keptTrip(T + 6), { from: null, to: FIX, ride: null });
    keepRide(RIDE, T + 7);
    keepTrip({ from: null, to: MENELAOU }, T + 8);
    assert.deepEqual(keptTrip(T + 9), { from: null, to: MENELAOU, ride: null });
});

test('a ride followed keeps the trip from growing old; none kept doesn\'t', () => {
    keepTrip({ from: null, to: FIX }, T);
    keepRide(RIDE, T + KEEP_MS - 10);
    assert.deepEqual(keptTrip(T + KEEP_MS + 10).ride, RIDE);
    keepRide(null, T + 2 * KEEP_MS - 20);
    assert.equal(keptTrip(T + 2 * KEEP_MS - 9), null);
});

test('a kept ride in another shape (an older copy, broken): no ride, the trip still there', () => {
    keepTrip({ from: null, to: FIX }, T);
    for (const ride of [{ ...RIDE, steps: null }, { ...RIDE, from: null }, { ...RIDE, state: {} }, { ...RIDE, now: null }, 'ride']) {
        keepRide(ride, T);
        assert.deepEqual(keptTrip(T), { from: null, to: FIX, ride: null });
    }
});

test('storage blocked: nothing kept, and nothing breaks', () => {
    const own = globalThis.localStorage;
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    try {
        keepTrip({ from: MENELAOU, to: FIX }, T);
        assert.equal(keptTrip(T), null);
        forgetTrip();
    } finally {
        globalThis.localStorage = own;
    }
});
