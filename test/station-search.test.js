import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// Finding a station by typing part of its name (tools/subway/client/search.js),
// in the real network: either language's name, with or without accents or
// capitals, names that start with what was typed first.

const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
const en = await browserModule('tools/subway/client/search.js', 'en');
const el = await browserModule('tools/subway/client/search.js', 'el');
const names = (ids, lang = 'en') => ids.map(id => rail.stations[id].name[lang]);

test('normalise ignores capitals, accents, the final sigma and extra spaces', async () => {
    const { normalise } = await browserModule('public/js/core/text.js');
    assert.equal(normalise('  Σύνταγμα '), 'συνταγμα');
    assert.equal(normalise('ΠΕΙΡΑΙΆΣ'), 'πειραιασ');
    assert.equal(normalise('Πειραιάς'), 'πειραιασ');
    assert.equal(normalise('Ευαγγελισμός'), normalise('ευαγγελισμοσ'));
    assert.equal(normalise('Ampelókipoi'), 'ampelokipoi');
    assert.equal(normalise('GEFYRA  ATTIKHS ODOY'), 'gefyra attikhs odoy');
});

test('either name finds a station, however it\'s typed', () => {
    for (const query of ['Syntagma', 'syntagma', 'SYNTAGMA', 'Σύνταγμα', 'συνταγμα', 'ΣΥΝΤΑΓΜΑ', 'Συντ']) {
        assert.equal(en.matchStations(rail.stations, query)[0], 'syntagma', query);
        assert.equal(el.matchStations(rail.stations, query)[0], 'syntagma', query);
    }
    assert.equal(en.matchStations(rail.stations, 'Πειραιας')[0], 'piraeus');
});

test('names that start with what was typed come before names that contain it', () => {
    assert.deepEqual(names(en.matchStations(rail.stations, 'ma')), ['Maniatika', 'Marousi', 'Agia Marina', 'Nomismatokopio', 'Syntagma']);
});

test('equally good matches are in alphabetical order of the page\'s language', () => {
    const english = names(en.matchStations(rail.stations, 'agios'));
    assert.deepEqual(english, [...english].sort((a, b) => a.localeCompare(b, 'el')));
    const greek = names(el.matchStations(rail.stations, 'αγιος'), 'el');
    assert.deepEqual(greek, [...greek].sort((a, b) => a.localeCompare(b, 'el')));
});

test('at most eight suggestions; nothing for an empty or unknown name', () => {
    assert.equal(en.matchStations(rail.stations, 'a').length, 8);
    assert.deepEqual(en.matchStations(rail.stations, ''), []);
    assert.deepEqual(en.matchStations(rail.stations, '   '), []);
    assert.deepEqual(en.matchStations(rail.stations, 'zzz'), []);
});
