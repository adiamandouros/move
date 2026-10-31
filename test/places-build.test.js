import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../scripts/places/build.js';
import { load, search } from '../server/places/search.js';
import { raw, rail } from './fixtures/places.js';

// From OpenStreetMap's answers to the index address search reads

const { index, stats } = buildIndex(raw, rail, '2026-11-01');
const db = load(index);
const streets = name => index.streets.filter(street => street[0][0] === name);
const numbers = street => street[3].filter((_, i) => i % 3 === 0);
const townName = i => index.towns[i][0];

test('the index says when it was built and whose data it is', () => {
    assert.equal(index.built, '2026-11-01');
    assert.match(index.licence, /OpenStreetMap contributors/);
});

test('towns go by their own names, without "Δήμος", with the name people write', () => {
    const withCity = buildIndex({
        ...raw,
        addresses: [...raw.addresses, ...[1, 2, 3, 4, 5].map(n => ({ type: 'node', lat: 37.956, lon: 23.705 + n / 1e4, tags: { 'addr:street': 'Μενελάου', 'addr:housenumber': `${n}`, 'addr:city': 'Τζιτζιφιές' } }))],
    }, rail).index;
    assert.deepEqual(index.towns, [['Καλλιθέας', 'Kallithea'], ['Νέας Σμύρνης', 'Nea Smyrni']]);
    assert.deepEqual(withCity.towns[0], ['Καλλιθέας', 'Kallithea', 'Τζιτζιφιές']);
});

test('a road through two towns is in both, a road elsewhere in neither, and stops are no roads', () => {
    assert.deepEqual(streets('Θησέως').map(street => townName(street[1])), ['Καλλιθέας', 'Νέας Σμύρνης']);
    assert.deepEqual(streets('Μακριά'), []);
    assert.deepEqual(streets('Στάση'), []);
});

test('the same name far apart is two streets, a road with two names is one', () => {
    assert.equal(streets('Κύπρου').length, 2);
    assert.equal(stats['streets joined: one road, two names'], 1);
    const joined = index.streets.filter(street => street[0].includes('Συγγρού'));
    assert.equal(joined.length, 1);
    assert.deepEqual([...joined[0][0]].sort(), ['Ανδρέα Συγγρού', 'Συγγρού']);
});

test('a side street named after a road stays a street of its own', () => {
    assert.equal(streets('Πάροδος Μενελάου').length, 1);
    assert.deepEqual(numbers(streets('Πάροδος Μενελάου')[0]), []);
});

test('a street keeps its other names, split at the semicolons', () => {
    assert.deepEqual(streets('Μενελάου')[0][0], ['Μενελάου', 'Menelaou', 'Old Menelaou']);
});

test('numbers go on their street, whichever way the map names it', () => {
    assert.deepEqual(numbers(streets('Μενελάου')[0]), [45, 65, 85, 105]);
    assert.equal(stats['numbers: part of the name, close by'], 1, '"Ανδρ. Συγγρού" on Συγγρού');
    assert.equal(stats['numbers: misspelt by a letter, close by'], 1, '"Σταύρυ" on Σταύρου');
    assert.equal(stats['numbers: a corner, one of its streets'], 1, '"Κύπρου & Κάπου" on Κύπρου');
    assert.deepEqual(numbers(streets('Σταύρου')[0]), [1]);
});

test('a number close to a street of that name in the next town goes on it', () => {
    const { stats } = buildIndex({ ...raw, addresses: [{ type: 'node', lat: 37.958, lon: 23.7195, tags: { 'addr:street': 'Ομήρου', 'addr:housenumber': '1' } }] }, rail);
    const close = { ...raw, streets: [...raw.streets, { type: 'way', tags: { highway: 'residential', name: 'Ομήρου' }, geometry: [{ lat: 37.958, lon: 23.7205 }, { lat: 37.958, lon: 23.7215 }] }] };
    assert.equal(stats['numbers: no street found'], 1, 'too far from the street');
    assert.equal(buildIndex({ ...close, addresses: [{ type: 'node', lat: 37.958, lon: 23.7195, tags: { 'addr:street': 'Ομήρου', 'addr:housenumber': '1' } }] }, rail).stats['numbers: same name, town next door'], 1);
});

test('a number on a street that isn\'t mapped can still be found by name', () => {
    assert.deepEqual(numbers(streets('Άγνωστη')[0]), [9]);
    assert.deepEqual(streets('Άγνωστη')[0][2], []);
    assert.equal(search(db, 'Άγνωστη 9').results[0].kind, 'exact');
});

test('a span means both its ends, and a list each of its numbers', () => {
    assert.deepEqual(numbers(streets('Θησέως')[0]), [12, 16, 20, 22]);
});

test('what can\'t be placed is left out, and counted', () => {
    assert.equal(stats['numbers that are not numbers: left out'], 1);
    assert.equal(stats['numbers without a street name: left out'], 1);
    assert.equal(stats['numbers outside any municipality'], 1);
    assert.equal(stats['street ways outside any municipality'], 1);
});

test('a range fills in the numbers between its ends, marked as worked out', () => {
    assert.deepEqual(numbers(streets('Ομήρου')[0]), [2, -4, -6, -8, 10]);
    const { kind, lng } = search(db, 'Ομήρου 6').results[0];
    assert.equal(kind, 'range');
    assert.ok(Math.abs(lng - 23.728) < 0.0001, `halfway along it, got ${lng}`);
});

test('a mapped number beats one worked out from a range', () => {
    const mapped = { type: 'node', lat: 37.9581, lon: 23.7281, tags: { 'addr:street': 'Ομήρου', 'addr:housenumber': '6' } };
    const { index } = buildIndex({ ...raw, addresses: [...raw.addresses, mapped] }, rail);
    const street = index.streets.find(s => s[0][0] === 'Ομήρου');
    assert.deepEqual(numbers(street), [2, -4, 6, -8, 10]);
});

test('the same number twice is averaged', () => {
    const twice = { type: 'node', lat: 37.955, lon: 23.7072, tags: { 'addr:street': 'Μενελάου', 'addr:housenumber': '45' } };
    const db = load(buildIndex({ ...raw, addresses: [...raw.addresses, twice] }, rail).index);
    assert.equal(search(db, 'Μενελάου 45').results[0].lng, 23.7071);
});

test('a range that makes no sense is skipped', () => {
    const range = (a, b, kind = 'even') => ({ type: 'way', tags: { 'addr:interpolation': kind }, geometry: [{ lat: 37.958, lon: a }, { lat: 37.958, lon: b }] });
    const end = (n, lon, street = 'Ομήρου') => ({ type: 'node', lat: 37.958, lon, tags: { 'addr:street': street, 'addr:housenumber': `${n}` } });
    const { stats } = buildIndex({ ...raw, addresses: [
        end(2, 23.726), end(5, 23.7265), end(2000, 23.727),
        range(23.726, 23.7265), // odd step
        range(23.726, 23.727), // over 400 numbers
        range(23.726, 23.739), // no number at one end
    ] }, rail);
    assert.equal(stats['ranges that make no sense'], 2);
    assert.equal(stats['ranges without two numbered ends'], 1);
});

test('a range numbered downwards, and one of every number', () => {
    const line = { type: 'way', tags: { 'addr:interpolation': 'all' }, geometry: [{ lat: 37.958, lon: 23.73 }, { lat: 37.958, lon: 23.726 }] };
    const ends = raw.addresses.filter(a => a.tags['addr:street'] === 'Ομήρου');
    const street = buildIndex({ ...raw, addresses: [...ends, { ...ends[0], lat: 37.958, lon: 23.73, tags: { ...ends[0].tags, 'addr:housenumber': '5' } }, line] }, rail).index.streets.find(s => s[0][0] === 'Ομήρου');
    assert.ok(numbers(street).includes(-3), `got ${numbers(street)}`);
});

test('a road that bends keeps its bend, and loses points that add nothing', () => {
    const bent = { type: 'way', tags: { highway: 'residential', name: 'Στροφή' }, geometry: [[37.951, 23.71], [37.95105, 23.711], [37.951, 23.712], [37.952, 23.713]].map(([lat, lon]) => ({ lat, lon })) };
    const street = buildIndex({ ...raw, streets: [bent] }, rail).index.streets[0];
    assert.equal(street[2][0].length / 2, 3, 'the 5 m wobble goes, the corner stays');
});

test('places: named, with their kind and town, each once', () => {
    const parks = index.places.filter(place => place[2] === 'park');
    assert.equal(parks.length, 1);
    assert.equal(townName(parks[0][1]), 'Νέας Σμύρνης');
    assert.equal(index.places.filter(place => place[2] === 'neighbourhood').length, 1);
    assert.equal(index.places.filter(place => place[2] === 'locality').length, 0);
});

test('metro stations and tram stops come from Wayhop\'s own list', () => {
    const [metro] = index.places.filter(place => place[2] === 'metro');
    assert.deepEqual(metro, [['Συγγρού-Φιξ', 'Sygrou-Fix'], 1, 'metro', 3795250, 2373500, ['M2']]);
    assert.equal(index.places.filter(place => place[2] === 'tram').length, 1);
});

test('only the airports people fly from, under the names people use', () => {
    const airports = index.places.filter(place => place[2] === 'airport');
    assert.equal(airports.length, 1);
    assert.ok(airports[0][0].includes('Αεροδρόμιο'));
    assert.equal(search(db, 'athens airport').results[0].placeKind, 'airport');
});
