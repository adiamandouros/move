import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameParts, offeredExits } from '../public/js/core/osm-exits.js';
import { exitsByStation } from '../scripts/osm-exits.js';

// Syntagma's square exit, and OpenStreetMap's around it
const square = { name: { el: 'Πλατεία Συντάγματος', en: 'Syntagma Square' }, coords: /** @type {[number, number]} */ ([37.97536, 23.7353]), way: ['stairs'] };
const osm = [
    { ids: ['n1'], name: { el: 'Πλατεία Συντάγματος' }, coords: /** @type {[number, number]} */ ([37.97556, 23.7354]) },
    { ids: ['n2'], name: { el: 'Οδός Κρήτης' }, coords: /** @type {[number, number]} */ ([37.9768, 23.7356]) },
    { ids: ['n3', 'n4'], coords: /** @type {[number, number]} */ ([37.9740, 23.7362]) },
];

test('an exit\'s name as the streets it names, however the sign writes them', () => {
    assert.deepEqual(nameParts('Οδός Αθηνάς / Θέμιδος'), ['αθηνασ', 'θεμιδοσ']);
    assert.deepEqual(nameParts('Agiou Georgiou str.'), ['agiougeorgiou']);
    assert.deepEqual(nameParts('Έξοδος Πλατεία'), ['πλατεια']);
    assert.deepEqual(nameParts(undefined), []);
});

test('OpenStreetMap\'s exits are offered where nothing recorded stands for them; what\'s recorded always wins (decision 57)', () => {
    assert.deepEqual(offeredExits(osm, undefined), osm, 'nothing recorded: all of them');
    assert.deepEqual(offeredExits(undefined, { exits: [square] }), [], 'none in OpenStreetMap');
    assert.deepEqual(offeredExits(osm, { exits: [square] }).map(e => e.ids), [['n2'], ['n3', 'n4']], 'one of ours 23 m away is the same exit');
    // By name, however far: OpenStreetMap's place may be off
    const kritis = { name: { el: 'Κρήτης / Βενιζέλου' }, coords: /** @type {[number, number]} */ ([37.9790, 23.7380]) };
    assert.deepEqual(offeredExits(osm, { exits: [kritis] }).map(e => e.ids), [['n1'], ['n3', 'n4']]);
    assert.deepEqual(offeredExits(osm, { exits: [{ name: { en: 'Kritis' } }] }).length, 3, 'only Greek with Greek, English with English');
    // Dealt with on a field trip: one of a building's doors stands for it
    assert.deepEqual(offeredExits(osm, { osm: ['n4', 'n2'] }).map(e => e.ids), [['n1']]);
});

test('Overpass\'s entrances as each station\'s exits: lifts, closed and far ones left out, a building\'s doors of one name as one exit', () => {
    const stations = {
        syntagma: { name: { el: 'Σύνταγμα', en: 'Syntagma' }, coords: /** @type {[number, number]} */ ([37.9755, 23.7355]) },
        omonia: { name: { el: 'Ομόνοια', en: 'Omonia' }, coords: /** @type {[number, number]} */ ([37.9841, 23.7280]) },
    };
    const entrance = (id, lat, lon, tags = {}) => ({ type: 'node', id, lat, lon, tags: { railway: 'subway_entrance', ...tags } });
    const exits = exitsByStation([
        entrance(12, 37.97536, 23.7353, { name: 'Πλατεία Συντάγματος', 'name:en': 'Syntagma Square' }),
        entrance(11, 37.97556, 23.7354, { name: 'Πλατεία Συντάγματος' }),
        entrance(13, 37.9748, 23.7356, { 'name:el': 'Αμαλίας', entrance: 'exit' }),
        entrance(14, 37.9750, 23.7358, { highway: 'elevator' }),
        entrance(15, 37.9751, 23.7359, { access: 'private' }),
        entrance(16, 37.9900, 23.7000),
        { type: 'way', id: 17, center: { lat: 37.9843, lon: 23.7282 }, tags: { railway: 'subway_entrance', name: 'Ομόνοια', 'name:en': 'Omonia' } },
        { type: 'node', id: 18, lat: 37.9841, lon: 23.7280, tags: { railway: 'station' } },
    ], stations);
    assert.deepEqual(exits, {
        omonia: [{ ids: ['w17'], coords: [37.9843, 23.7282] }],
        syntagma: [
            { ids: ['n11', 'n12'], name: { el: 'Πλατεία Συντάγματος', en: 'Syntagma Square' }, coords: [37.97546, 23.73535] },
            { ids: ['n13'], name: { el: 'Αμαλίας' }, coords: [37.9748, 23.7356], only: 'out' },
        ],
    });
});
