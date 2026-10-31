import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems } from './support/markup.js';

// What the trip page draws (tools/trip/client/render.js), in both languages:
// how exact an address is, the trip, and the hard cases. Each is checked for
// accessibility, and for strings shown as their keys.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const NOW = { weekday: 3, seconds: 10 * 3600, date: '2026-10-21' };
const menelaou = { lat: 37.95463, lng: 23.71049, title: 'Μενελάου 25', exact: 'About here' };
const syntagma = { lat: rail.stations.syntagma.coords[0], lng: rail.stations.syntagma.coords[1], station: 'syntagma', title: 'Σύνταγμα', exact: null };
const street = (kind, more = {}) => ({ type: 'street', name: 'Μενελάου', n: 25, town: 'Καλλιθέας', kind, numbers: 4, ...more });

for (const lang of ['en', 'el']) {
    const r = await browserModule('tools/trip/client/render.js', lang);
    const { doorToDoor } = await browserModule('tools/trip/client/plan.js', lang);
    const { listNote } = await browserModule('tools/trip/client/picker.js', lang);
    const keys = Object.keys(strings(lang));
    const check = view => assert.deepEqual(markupProblems(String(view), { keys }), []);
    const s = strings(lang);

    test(`${lang}: an exact number needs no words, the rest say how far to trust them`, () => {
        assert.equal(r.howExact(street('exact')), null);
        assert.equal(r.howExact(street('range')), null);
        assert.equal(r.howExact(street('between', { lo: 23, hi: 27 })).words, s['trip.exact-between'].replace('{lo}', 23).replace('{hi}', 27));
        assert.equal(r.howExact(street('beyond', { near: 45 })).words, s['trip.exact-beyond'].replace('{near}', 45));
        assert.equal(r.howExact(street('nearest', { near: 31 })).words, s['trip.exact-nearest'].replace('{near}', 31));
        assert.deepEqual(r.howExact(street('street')), { words: s['trip.exact-street'], warn: true });
    });

    test(`${lang}: a street without a number is simply that street`, () => {
        assert.equal(r.howExact(street('street', { n: null })), null);
        assert.equal(r.placeTitle(street('street', { n: null })), 'Μενελάου');
        assert.equal(r.placeTitle(street('exact')), 'Μενελάου 25');
    });

    test(`${lang}: places say what they are, when it matters`, () => {
        assert.equal(r.howExact({ type: 'place', placeKind: 'metro' }).words, s['trip.kind-metro']);
        assert.equal(r.howExact({ type: 'place', placeKind: 'tram' }).words, s['trip.kind-tram']);
        assert.equal(r.howExact({ type: 'place', placeKind: 'airport' }).words, s['trip.kind-airport']);
        assert.equal(r.howExact({ type: 'place', placeKind: 'park' }), null);
    });

    test(`${lang}: a row of the list: name, town, how exact, and a station's lines`, () => {
        const row = String(r.placeOption(street('street'), 0, rail, 'list'));
        for (const text of ['Μενελάου 25', 'Καλλιθέας', s['trip.exact-street'].replace(/'/g, '&#39;'), 'trip-exact-warn']) assert.ok(row.includes(text), text);
        const station = { type: 'place', placeKind: 'metro', name: 'Σύνταγμα', town: 'Αθηναίων', n: null, lineNames: ['M2', 'M3'] };
        assert.match(String(r.placeOption(station, 1, rail, 'list')), /line-m2[\s\S]*line-m3/);
        assert.deepEqual(markupProblems(`<ul role="listbox" aria-label="x">${r.placeOption(street('street'), 0, rail, 'list')}</ul>`, { keys }), []);
    });

    test(`${lang}: the note over the list`, () => {
        const one = [{}];
        assert.equal(listNote({ results: [] }), s['trip.nothing-found']);
        assert.equal(listNote({ results: one, noSuchTown: true, notInTown: 'x' }), s['trip.no-such-town']);
        assert.equal(listNote({ results: one, notInTown: 'x' }), s['trip.not-in-town']);
        assert.equal(listNote({ results: one, corrected: true }), s['trip.mended']);
        assert.equal(listNote({ results: one }), '');
    });

    test(`${lang}: the trip: walk, train by train, and where to stand`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        const view = String(r.renderTrip(rail, trip, syntagma));
        check(view);
        assert.match(view, /trip-total/);
        assert.match(view, /google\.com\/maps\/dir/, 'the walk links to directions');
        assert.ok(view.includes(lang === 'el' ? '/el/subway?from=' : '"/subway?from='), 'where to stand is the Subway page');
        assert.ok(view.includes(s['trip.estimates']));
        assert.ok(view.includes(s['trip.other-ways']));
    });

    test(`${lang}: to an address, the last walk is there too`, () => {
        const trip = doorToDoor(rail, syntagma, menelaou, NOW);
        const view = String(r.renderTrip(rail, trip, menelaou));
        check(view);
        assert.ok(view.includes('Μενελάου 25'));
    });

    test(`${lang}: what's chosen, with how exact it is`, () => {
        const view = String(r.renderChosen(menelaou, syntagma));
        check(view);
        for (const text of ['Μενελάου 25', 'About here', 'Σύνταγμα', s['trip.change']]) assert.ok(view.includes(text), text);
    });

    test(`${lang}: close enough to walk`, () => {
        const near = { lat: syntagma.lat + 0.002, lng: syntagma.lng };
        const view = String(r.renderTrip(rail, doorToDoor(rail, near, syntagma, NOW), syntagma));
        check(view);
        assert.ok(view.indexOf(s['trip.walk-quicker']) < view.indexOf(s['trip.other-ways']) || !view.includes(s['trip.other-ways']));
    });

    test(`${lang}: a long walk says a bus may be better, and points to them`, () => {
        const far = { lat: 37.97805, lng: 23.62674 };
        const view = String(r.renderTrip(rail, doorToDoor(rail, far, syntagma, NOW), syntagma));
        check(view);
        assert.ok(view.includes(s['trip.look-for-buses']));
    });

    test(`${lang}: after the last train it says so, with the morning's times`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, { ...NOW, seconds: 2.5 * 3600 });
        const view = String(r.renderTrip(rail, trip, syntagma));
        check(view);
        assert.ok(view.includes(s['trip.no-trains']));
        assert.equal(view.includes('trip-total'), false, 'no count of minutes until the morning');
    });

    test(`${lang}: a timetable that has ended is said`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        assert.ok(String(r.renderTrip(rail, trip, syntagma, { expired: true })).includes(s['trip.timetable-ended']));
    });
}
