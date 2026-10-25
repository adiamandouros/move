import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// Finding a bus stop by name or code and a line by its number
// (tools/buses/client/search.js), in the browser tests' copy of the real data

const read = name => JSON.parse(readFileSync(new URL(`./browser/data/${name}`, import.meta.url), 'utf8'));
const { decodeStops } = await browserModule('tools/buses/client/stops.js');
const { findLines, findStops, lineKey } = await browserModule('tools/buses/client/search.js');
const stops = decodeStops(read('bus-stops.json'));
const { lines } = read('bus-lines.json');
const SYNTAGMA = { lat: 37.9755, lng: 23.7348 };

test('a line by its number, typed with Greek or Latin letters', () => {
    for (const query of ['Χ95', 'χ95', 'X95', 'x95', 'x 95']) assert.deepEqual(findLines(lines, query).map(l => l.line), ['Χ95'], query);
    assert.equal(lineKey('A10'), 'α10');
    assert.equal(lineKey('B12'), lineKey('Β12'));
    assert.equal(lineKey('e14'), lineKey('Ε14'));
    assert.equal(lineKey('th'), lineKey('Θ'));
    assert.deepEqual(findLines(lines, ''), []);
    assert.deepEqual(findLines(lines, 'syntagma'), []);
});

test('the line with that number comes before lines that start with it', () => {
    const all = [{ line: '0400' }, { line: '40' }, { line: '040' }, { line: '04' }];
    assert.deepEqual(findLines(all, '04').map(l => l.line), ['04', '0400', '040']);
    assert.deepEqual(findLines(lines, '0').map(l => l.line), ['040']);
});

test('a stop by its code: that stop first, then codes that start with it', () => {
    const found = findStops(stops, '10341');
    assert.equal(found[0].code, '10341');
    assert.ok(findStops(stops, '103').every(s => s.code.startsWith('103')));
    assert.ok(findStops(stops, '103').length > 1);
    assert.deepEqual(findStops(stops, '  '), []);
});

test('a stop by either name, with or without accents or capitals', () => {
    for (const query of ['ΣΥΝΤΑΓΜΑ', 'Σύνταγμα', 'συνταγμα', 'SYNTAGMA', 'syntagma', 'Syntagma']) {
        const found = findStops(stops, query);
        assert.ok(found.length >= 5, query);
        assert.equal(found[0].name.el, 'ΣΥΝΤΑΓΜΑ', query);
    }
});

test('names that start with what was typed, then a word that does, then anywhere', () => {
    const found = findStops(stops, 'συντ');
    const ranks = found.map(s => {
        const n = s.name.el.toLowerCase();
        return n.startsWith('συντ') ? 0 : n.split(/[ .\-(/]/).some(w => w.startsWith('συντ')) ? 1 : 2;
    });
    assert.deepEqual(ranks, [...ranks].sort());
    // Every word typed, in any order
    const both = findStops(stops, 'συνταγματος πλ');
    assert.ok(both.length && both.every(s => s.name.el === 'ΠΛ. ΣΥΝΤΑΓΜΑΤΟΣ'));
});

test('with a location, equally good stops come nearest first, with their distance', () => {
    const found = findStops(stops, 'syntagma', SYNTAGMA);
    const same = found.filter(s => s.name.el === 'ΣΥΝΤΑΓΜΑ');
    // Found by their English name, which bus-stops.json leaves for the browser to work out ('')
    assert.equal(same.length, 8);
    assert.ok(same.every(s => s.name.en === 'SYNTAGMA'));
    assert.ok(same.every(s => typeof s.meters === 'number'));
    assert.deepEqual(same.map(s => s.meters), same.map(s => s.meters).sort((a, b) => a - b));
    // Without one: by name, no distance
    assert.ok(findStops(stops, 'syntagma').every(s => s.meters === undefined));
});
