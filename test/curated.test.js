import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { validateCurated } from '../server/data/validate.js';

const load = name => JSON.parse(readFileSync(new URL(`../data/curated/${name}.json`, import.meta.url), 'utf8'));
const real = () => ({ stations: load('stations'), lines: load('lines'), positions: load('positions') });

test('the committed curated files are valid', () => {
    const { errors } = validateCurated(real());
    assert.deepEqual(errors, []);
});

test('catches typical editing mistakes', () => {
    const c = real();
    c.positions.M1.kifisia.faliro = { exit: ['back'], exits: ['middle'], transfers: { 'M1/piraeus': ['back'], 'M4/x': [] } };
    c.stations.stations.kat.gtfs.push('MON1');

    const { errors } = validateCurated(c);
    assert.ok(errors.some(e => e.includes('unknown field "exit"')));
    assert.ok(errors.some(e => e.includes('unknown position "middle"')));
    assert.ok(errors.some(e => e.includes('"M1/piraeus" is on the same line')));
    assert.ok(errors.some(e => e.includes('unknown direction "M4/x"')));
    assert.ok(errors.some(e => e.includes('MON1 is used by both')));
});

test('how STASY writes a name: a list of names, each leading to one station', () => {
    const c = real();
    c.stations.stations.omonia.stasy = 'ΟΜΟΝΟΙΑ';
    c.stations.stations.kat.stasy = ['Σύνταγμα'];
    const { errors } = validateCurated(c);
    assert.ok(errors.includes('stations.json: omonia.stasy must be a list of names'), errors.join('\n'));
    assert.ok(errors.includes('stations.json: the name "Σύνταγμα" is used by both kat and syntagma'), errors.join('\n'));
});
