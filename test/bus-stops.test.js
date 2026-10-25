import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

const { decodeStops, distanceMeters, nearestStops } = await browserModule('tools/buses/client/stops.js');
const { latinName } = await browserModule('public/js/core/text.js');

// Stops spaced ~111 m apart going north from (38.0, 23.7)
const data = {
    fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'],
    stops: Array.from({ length: 10 }, (_, i) => [String(i), 38 + i * 0.001, 23.7, `ΣΤΑΣΗ ${i}`, i === 0 ? '' : `Stop ${i}`, ['1']]),
};
const stops = decodeStops(data);

test('decodeStops: an English name the file leaves out is the Greek in Latin letters', () => {
    // bus-stops.json has '' where OASA's English is just that (server/data/build-bus.js)
    assert.deepEqual(stops[0], { code: '0', lat: 38, lng: 23.7, name: { el: 'ΣΤΑΣΗ 0', en: 'STASH 0' }, lines: ['1'] });
    // One it keeps is used as it is
    assert.deepEqual(stops[1].name, { el: 'ΣΤΑΣΗ 1', en: 'Stop 1' });
});

test('latinName writes a stop\'s name as OASA does: letter for letter, ordinals in English', () => {
    // Real pairs from OASA's stops
    const pairs = {
        'ΓΕΦΥΡΑ ΑΤΤΙΚΗΣ ΟΔΟΥ': 'GEFYRA ATTIKHS ODOY',
        '14η ΝΤΑΜΑΡΙΑ': '14th NTAMARIA',
        '1η ΠΙΝΔΟΥ': '1st PINDOY',
        '2η ΓΕΝΝΗΜΑΤΑ': '2nd GENNHMATA',
        '3η ΜΑΚ': '3rd MAK',
        '11η ΚΑΙΣΑΡΙΑΝΗΣ': '11th KAISARIANHS',
        '21η ΦΥΛΗΣ': '21st FYLHS',
        '25ης ΜΑΡΤΙΟΥ': '25th MARTIOY',
        '2ας ΜΕΡΑΡΧΙΑΣ': '2nd MERARXIAS',
        'ΜΕΓ. ΑΛΕΞΑΝΔΡΟΥ': 'MEG. ALEXANDROY',
        'ΘΗΣΕΩΣ': 'THHSEOS',
        'ΔΙΨΕΛΙΖΑ': 'DIPSELIZA',
        'ΣΑΡΩΝΙΔΑ 122, 123': 'SARONIDA 122, 123',
        'ΠΡΟΦΗΤΗ ΗΛΙΑ': 'PROFHTH HLIA',
        'ΧΑΪΔΑΡΙ': 'XAIDARI',
    };
    for (const [greek, latin] of Object.entries(pairs)) assert.equal(latinName(greek), latin, greek);
    // A number that isn't an ordinal stays as it is
    assert.equal(latinName('ΣΤΑΣΗ 805'), 'STASH 805');
});

test('distanceMeters', () => {
    assert.equal(distanceMeters(38, 23.7, 38.001, 23.7), 111);
});

test('nearestStops keeps the closest within the radius, up to the limit', () => {
    assert.deepEqual(nearestStops(stops, 38, 23.7, { limit: 6, radius: 500 }).map(s => s.code), ['0', '1', '2', '3', '4']);
    assert.deepEqual(nearestStops(stops, 38, 23.7, { limit: 3, radius: 500 }).map(s => s.code), ['0', '1', '2']);
});

test('nearestStops still returns a few stops when none are close', () => {
    const far = nearestStops(stops, 37.9, 23.7, { limit: 6, radius: 500, min: 3 });
    assert.deepEqual(far.map(s => s.code), ['0', '1', '2']);
    assert.ok(far[0].meters > 10_000);
});
