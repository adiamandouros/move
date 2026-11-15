import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The last 3 places picked on the Trip page, kept on the device (decision 56,
// tools/trip/client/recent.js). The page's side: test/browser/trip.spec.js.

const { addRecentPlace, matchesTyped, recentFirst, recentPlaces } = await browserModule('tools/trip/client/recent.js');

// localStorage, as a page has it
const saved = new Map();
globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: key => saved.delete(key),
};
beforeEach(() => saved.clear());

// Places as search finds them
const MENELAOU = { type: 'address', name: 'Μενελάου', n: '45', town: 'Καλλιθέα', lat: 37.955, lng: 23.707 };
const MENELAOU_85 = { ...MENELAOU, n: '85', lng: 23.711 };
const FIX = { type: 'place', placeKind: 'metro', name: 'Συγγρού-Φιξ', n: null, lat: 37.964, lng: 23.726 };
const PARK = { type: 'place', name: 'Άλσος', n: null, lat: 37.951, lng: 23.71 };

test('the last three places picked, most recent first, each once', () => {
    assert.deepEqual(recentPlaces(), []);
    for (const place of [MENELAOU, FIX, PARK, { ...MENELAOU }, MENELAOU_85]) addRecentPlace(place);
    assert.deepEqual(recentPlaces(), [MENELAOU_85, MENELAOU, PARK]);
});

test('anything else saved under the name counts as none', () => {
    for (const kept of ['not json', '{"a":1}', 'null', '[1, null, {"name": "x"}]']) {
        saved.set('recent-places', kept);
        assert.deepEqual(recentPlaces(), [], kept);
    }
    saved.set('recent-places', JSON.stringify([7, FIX]));
    assert.deepEqual(recentPlaces(), [FIX], 'a place among others is kept');
});

test('blocked storage: nothing kept, nothing breaks', () => {
    const before = globalThis.localStorage;
    const refuse = () => { throw new Error('blocked'); };
    globalThis.localStorage = { getItem: refuse, setItem: refuse, removeItem: refuse };
    try {
        addRecentPlace(FIX);
        assert.deepEqual(recentPlaces(), []);
    } finally {
        globalThis.localStorage = before;
    }
});

test('what\'s typed matches each word\'s start, Greek or Latin, with or without accents, the town too', () => {
    for (const typed of ['Μενελάου', 'μενελαου 4', 'menelaou 45', 'Menel', 'καλλιθ μεν', 'kallithea']) assert.ok(matchesTyped(MENELAOU, typed), typed);
    for (const typed of ['Μενελάου 8', 'Φιξ', 'ελαου', '', '  ']) assert.ok(!matchesTyped(MENELAOU, typed), typed);
    assert.ok(matchesTyped(FIX, 'syggrou'));
});

test('while typing, the places picked lately that match come first, and nothing twice', () => {
    const found = [MENELAOU_85, { ...MENELAOU }, PARK];
    assert.deepEqual(recentFirst([FIX, MENELAOU], found, 'Μενελάου'), [MENELAOU, MENELAOU_85, PARK]);
    assert.deepEqual(recentFirst([FIX], found, 'Μενελάου'), found, 'none matching: what search found, as it was');
    assert.deepEqual(recentFirst([MENELAOU], [], 'menelaou'), [MENELAOU], 'one search didn\'t find');
});
