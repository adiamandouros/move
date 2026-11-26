import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// A link to the Trip page with where to go, /trip?to=<station> (decision 81,
// tools/trip/client/link.js): the station a star's key names, as address
// search would have found it. The page's side: test/browser/trip.spec.js.

const { linkedKey, linkedPlace, withoutLink } = await browserModule('tools/trip/client/link.js');
const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const trains = JSON.parse(readFileSync(new URL('browser/data/trains.json', import.meta.url), 'utf8'));

test('the key a link names, and the address without it', () => {
    assert.equal(linkedKey('?to=syntagma'), 'syntagma');
    assert.equal(linkedKey('?trace&to=kiato'), 'kiato');
    assert.equal(linkedKey(''), null);
    assert.equal(linkedKey('?to='), null);
    assert.equal(withoutLink('https://wayhop.gr/el/trip?to=syntagma'), '/el/trip');
    assert.equal(withoutLink('https://wayhop.gr/trip?trace&to=syntagma#x'), '/trip?trace=#x');
});

test('a station as search finds a place: by the page\'s language, on its network', () => {
    const [lat, lng] = rail.stations.syntagma.coords;
    assert.deepEqual(linkedPlace(rail, null, 'syntagma', 'en'),
        { name: 'Syntagma', town: '', type: 'place', placeKind: 'metro', lineNames: [], n: null, numbers: 0, lat, lng, kind: 'place' });
    assert.equal(linkedPlace(rail, null, 'syntagma', 'el').name, 'Σύνταγμα');
    assert.equal(linkedPlace(rail, null, 'syntagma-tram', 'en').placeKind, 'tram');
    assert.equal(linkedPlace(rail, trains, 'piraeus-suburban', 'en').placeKind, 'suburban');
    // A suburban station needs trains.json; a key nobody knows is nothing
    assert.equal(linkedPlace(rail, null, 'piraeus-suburban', 'en'), null);
    assert.equal(linkedPlace(rail, trains, 'nowhere', 'en'), null);
});
