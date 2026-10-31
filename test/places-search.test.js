import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../scripts/places/build.js';
import { editOne, fold, keyOf, load, locate, meters, search, streetMiddle, wordsOf } from '../server/places/search.js';
import { raw, rail } from './fixtures/places.js';

// Address search: as exact as the data allows, and honest about how exact.
// The real index is held to the same in scripts/places/check.js.

const db = load(buildIndex(raw, rail).index);
const first = query => search(db, query).results[0];
// Numbers along a straight street running east
const line = [{ lat: 37.955, lng: 23.70 }, { lat: 37.955, lng: 23.72 }];
const house = (n, lng, range = false) => ({ n, lng, lat: 37.955, range });
const street = (...pts) => ({ lines: [line], pts });

test('Greek and Latin spellings of a name fold to the same thing', () => {
    for (const spelling of ['Μενελάου', 'ΜΕΝΕΛΑΟΥ', 'Menelaou', 'menelaoy']) assert.equal(fold(spelling), 'menelav', spelling);
    assert.equal(fold('Χαλάνδρι'), fold('Chalandri'));
    assert.equal(fold('Κηφισσίας'), fold('Kifisias'));
    assert.equal(fold('28ης Οκτωβρίου'), fold('28 Οκτωβρίου'));
});

test('words that only say what kind of street it is don\'t count', () => {
    assert.deepEqual(wordsOf('Λεωφόρος Κηφισίας'), ['kifisias']);
    assert.equal(keyOf('Οδός Μενελάου'), 'menelav');
    assert.deepEqual(wordsOf('Οδός'), ['odos'], 'unless that\'s all there is');
});

test('one letter off, added or missing, and no more', () => {
    assert.ok(editOne('menelav', 'menelaf'));
    assert.ok(editOne('menelav', 'menela'));
    assert.ok(editOne('menela', 'menelav'));
    assert.equal(editOne('abcd', 'abxy'), false);
    assert.equal(editOne('abcd', 'abcdef'), false);
});

test('a number on the map is exact, one from a range says so', () => {
    const pts = [house(10, 23.705), house(12, 23.706, true)];
    assert.equal(locate(street(...pts), 10).kind, 'exact');
    assert.equal(locate(street(...pts), 12).kind, 'range');
});

test('a number between two known ones is worked out from them', () => {
    const found = locate(street(house(10, 23.705), house(20, 23.71)), 14);
    assert.deepEqual([found.kind, found.lo, found.hi], ['between', 10, 20]);
    assert.ok(Math.abs(found.lng - 23.707) < 1e-9);
});

test('odd numbers are worked out from their own side of the street', () => {
    const found = locate(street(house(9, 23.705), house(10, 23.7055), house(12, 23.7058), house(19, 23.71)), 15);
    assert.deepEqual([found.lo, found.hi], [9, 19]);
});

test('between numbers too far apart to be one stretch, it gives the nearest', () => {
    const found = locate(street(house(10, 23.70), house(14, 23.72)), 11);
    assert.deepEqual([found.kind, found.near], ['nearest', 10]);
});

test('past the last known number, it goes on the way the numbers run', () => {
    const pts = [house(40, 23.706), house(60, 23.708), house(80, 23.71), house(100, 23.712)];
    const low = locate(street(...pts), 20), high = locate(street(...pts), 120);
    assert.deepEqual([low.kind, low.near], ['beyond', 40]);
    assert.ok(low.lng < 23.706 && low.away > 100, `${low.lng}`);
    assert.ok(high.lng > 23.712);
});

test('past the last, without a clear direction, it gives the nearest', () => {
    const muddled = [house(40, 23.71), house(42, 23.704), house(44, 23.712), house(46, 23.702)];
    assert.equal(locate(street(...muddled), 80).kind, 'nearest');
    assert.equal(locate(street(house(40, 23.71), house(42, 23.711)), 80).kind, 'nearest', 'two numbers show no direction');
    assert.equal(locate(street(house(40, 23.71), house(42, 23.71), house(44, 23.71)), 80).kind, 'nearest', 'nor do three in one spot');
});

test('past the last on a street with no line, it still goes on', () => {
    const pts = [house(40, 23.706), house(60, 23.708), house(80, 23.71)];
    assert.equal(locate({ lines: [], pts }, 100).kind, 'beyond');
});

test('too far past the last to guess, it gives the nearest', () => {
    const pts = [house(40, 23.706), house(41, 23.708), house(42, 23.71)];
    assert.equal(locate(street(...pts), 400).kind, 'nearest');
});

test('with no numbers at all, the middle of the street', () => {
    assert.deepEqual(locate(street(), 5), { kind: 'street', lat: 37.955, lng: 23.71 });
});

test('the middle of a straight road isn\'t one of its ends', () => {
    const middle = streetMiddle({ lines: [line], pts: [] });
    assert.ok(meters(middle, { lat: 37.955, lng: 23.71 }) < 1, `${middle.lng}`);
    assert.deepEqual(streetMiddle({ lines: [], pts: [house(5, 23.70)] }), house(5, 23.70));
    assert.equal(streetMiddle({ lines: [], pts: [] }), null);
});

test('a street, a number and a town, however they\'re written', () => {
    for (const query of ['Μενελάου 45, Καλλιθέα', 'Μενελαου 45 Καλλιθεα', '45 Μενελάου Καλλιθέα', 'Menelaou 45, kallithea', 'Οδός Μενελάου 45']) {
        const found = first(query);
        assert.deepEqual([found.name, found.town, found.kind, found.n], ['Μενελάου', 'Καλλιθέας', 'exact', 45], query);
    }
});

test('a name alone gives the street\'s middle, and a number with a letter its number', () => {
    assert.equal(first('Μενελάου').kind, 'street');
    assert.equal(first('Μενελάου 45Α').kind, 'exact');
});

test('nothing typed, nothing found', () => {
    assert.deepEqual(search(db, '  ').results, []);
    assert.deepEqual(search(db, 'Ξυζξυζ 12').results, []);
    assert.deepEqual(search(db, 'Οδός, Καλλιθέα').results.length, 0);
});

test('one letter wrong is mended, and says so', () => {
    const { results, corrected } = search(db, 'Ομήριου 4');
    assert.equal(results[0].name, 'Ομήρου');
    assert.equal(corrected, true);
});

test('a street that isn\'t in that town says so, and never jumps next door silently', () => {
    const { results, notInTown, noSuchTown } = search(db, 'Μενελάου 45, Νέα Σμύρνη');
    assert.equal(notInTown, 'nea smirni');
    assert.equal(noSuchTown, false);
    assert.equal(results[0].town, 'Καλλιθέας');
});

test('the same with no comma', () => {
    assert.equal(search(db, 'Μενελάου 45 Νέα Σμύρνη').notInTown, 'nea smirni');
});

test('a town that doesn\'t exist is told apart from a street that isn\'t there', () => {
    const { results, notInTown, noSuchTown } = search(db, 'Μενελάου 45, Ασδφγ');
    assert.ok(notInTown);
    assert.equal(noSuchTown, true);
    assert.equal(results[0].name, 'Μενελάου');
});

test('the town counts from its second letter, as it\'s typed', () => {
    assert.equal(first('Θησέως 12, Κα').town, 'Καλλιθέας');
    assert.equal(first('Θησέως 12, Νέ').town, 'Νέας Σμύρνης');
    assert.equal(search(db, 'Θησέως 12, Κ').notInTown, null);
    assert.equal(first('Θησέως 12, Νέα Σ').town, 'Νέας Σμύρνης');
});

test('a town cut short with no comma, once nothing else makes sense', () => {
    assert.equal(first('Μενελάου 45 Καλλι').town, 'Καλλιθέας');
});

test('a neighbourhood stands in for a town, by how far it is', () => {
    assert.equal(first('Μενελάου 45, Τζιτζιφιές').name, 'Μενελάου');
    assert.equal(search(db, 'Μενελάου 45, Τζιτζιφιές').notInTown, null);
    assert.equal(first('Άλσος, Τζιτζιφιές').name, 'Άλσος');
});

test('a road through two towns is listed once', () => {
    assert.equal(search(db, 'Θησέως').results.length, 1);
});

test('stations and airports are found by any of their names', () => {
    assert.deepEqual([first('Συγγρού-Φιξ').placeKind, first('Sygrou-Fix').placeKind], ['metro', 'metro']);
    assert.deepEqual(first('Μετρό Συγγρού-Φιξ').lineNames, ['M2']);
    assert.equal(first('Κασομούλη').placeKind, 'tram');
    assert.equal(first('Αεροδρόμιο').placeKind, 'airport');
});

test('a number never lands on a place', () => {
    assert.ok(search(db, 'Άλσος 12').results.every(result => result.type === 'street'));
});

test('a limit on how many', () => {
    assert.equal(search(db, 'Κύπρου').results.length, 2);
    assert.equal(search(db, 'Κύπρου', 1).results.length, 1);
});
