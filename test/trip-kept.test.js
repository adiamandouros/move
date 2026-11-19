import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The trip kept on the Trip page on the device, for 3 hours, with the ride
// followed on it and the way picked from the other ways (decisions 52, 58
// and 64, tools/trip/client/kept.js). The page's side: test/browser/trip.spec.js.

const { KEEP_MS, forgetTrip, keepPicked, keepRide, keepTrip, keptTrip } = await browserModule('tools/trip/client/kept.js');

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
    assert.deepEqual(keptTrip(T + 1), { from: MENELAOU, to: FIX, ride: null, picked: null });
    keepTrip({ from: null, to: FIX }, T);
    assert.deepEqual(keptTrip(T + 1), { from: null, to: FIX, ride: null, picked: null });
});

test('forgotten 3 hours after it was set, and the same trip kept again doesn\'t make it younger', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepTrip({ from: MENELAOU, to: FIX }, T + KEEP_MS - 1);
    assert.deepEqual(keptTrip(T + KEEP_MS - 1), { from: MENELAOU, to: FIX, ride: null, picked: null });
    assert.equal(keptTrip(T + KEEP_MS), null);
    assert.equal(saved.size, 0, 'an old trip is cleared away');
});

test('a changed trip counts from when it changed', () => {
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepTrip({ from: FIX, to: MENELAOU }, T + KEEP_MS - 1);
    assert.deepEqual(keptTrip(T + KEEP_MS), { from: FIX, to: MENELAOU, ride: null, picked: null });
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
    assert.deepEqual(keptTrip(T + 2), { from: null, to: FIX, ride: RIDE, picked: null });
    // The same ends kept again (each draw does) keep it
    keepTrip({ from: null, to: FIX }, T + 3);
    assert.deepEqual(keptTrip(T + 4).ride, RIDE);
    keepRide(null, T + 5);
    assert.deepEqual(keptTrip(T + 6), { from: null, to: FIX, ride: null, picked: null });
    keepRide(RIDE, T + 7);
    keepTrip({ from: null, to: MENELAOU }, T + 8);
    assert.deepEqual(keptTrip(T + 9), { from: null, to: MENELAOU, ride: null, picked: null });
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
        assert.deepEqual(keptTrip(T), { from: null, to: FIX, ride: null, picked: null });
    }
});

// A way's key, as the half hour's rows have it (rowKey in answer.js)
const PICKED = 'M3 Syntagma>Neos Kosmos at Neos Kosmos, a bus';

test('the way picked comes back with the trip, a pick counting as a change; it goes with other ends', () => {
    keepPicked(PICKED, T);
    assert.equal(keptTrip(T), null, 'nothing without a trip kept');
    keepTrip({ from: MENELAOU, to: FIX }, T);
    keepPicked(PICKED, T + KEEP_MS - 10);
    assert.deepEqual(keptTrip(T + KEEP_MS + 10), { from: MENELAOU, to: FIX, ride: null, picked: PICKED });
    // The same ends kept again (each draw does) keep it, and the ride followed beside it
    keepTrip({ from: MENELAOU, to: FIX }, T + KEEP_MS + 11);
    keepRide(RIDE, T + KEEP_MS + 12);
    assert.deepEqual(keptTrip(T + KEEP_MS + 13), { from: MENELAOU, to: FIX, ride: RIDE, picked: PICKED });
    keepPicked(null, T + KEEP_MS + 14);
    assert.equal(keptTrip(T + KEEP_MS + 15).picked, null, 'the half hour\'s own again');
    assert.deepEqual(keptTrip(T + KEEP_MS + 15).ride, RIDE, 'the ride stays');
    keepPicked(PICKED, T + KEEP_MS + 16);
    keepTrip({ from: FIX, to: MENELAOU }, T + KEEP_MS + 17);
    assert.equal(keptTrip(T + KEEP_MS + 18).picked, null);
});

test('a kept pick that isn\'t a key (an older copy, broken): none, the trip still there', () => {
    saved.set('trip', JSON.stringify({ at: T, from: MENELAOU, to: FIX, picked: 3 }));
    assert.deepEqual(keptTrip(T), { from: MENELAOU, to: FIX, ride: null, picked: null });
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
