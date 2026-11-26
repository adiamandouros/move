import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// What Home's "Near you" works out (decision 81, public/js/core/near.js),
// on the browser tests' real network and trains. The page: test/browser/home.spec.js.

const { nearestBusStop, nearestStation, stationTrains, starredStations } = await browserModule('public/js/core/near.js');
const { withTram } = await browserModule('tools/subway/client/network.js');
const { decodeStops } = await browserModule('tools/buses/client/stops.js');
const read = name => JSON.parse(readFileSync(new URL(`browser/data/${name}`, import.meta.url), 'utf8'));
const metro = read('rail.json');
const trains = read('trains.json');
const rail = withTram(metro);
// The Wednesday the browser tests run on, at noon in Athens
const NOON = { weekday: 3, seconds: 12 * 3600, date: '2026-10-21' };

test('the nearest station or tram stop, and how far it is', () => {
    const [lat, lng] = metro.stations.syntagma.coords;
    assert.deepEqual(nearestStation(rail, lat + 0.0005, lng), { id: 'syntagma', meters: 56 });
    // On the coast, a tram stop
    const [tLat, tLng] = metro.tram.stations.achilleos.coords;
    assert.equal(rail.stations[nearestStation(rail, tLat, tLng).id].tram, true);
});

test('each line and direction leaving a station with its next two trains, in order; none from where a line ends', () => {
    const rows = stationTrains(rail, 'syntagma', NOON);
    assert.deepEqual(rows.map(r => r.line), ['M2', 'M2', 'M3', 'M3']);
    for (const row of rows) {
        assert.equal(row.departures.length, 2);
        assert.ok(row.departures[0].departs >= NOON.seconds && row.departures[1].departs > row.departures[0].departs);
    }
    // A line's end: only the way back
    const ends = stationTrains(rail, 'kifisia', NOON);
    assert.deepEqual(ends.map(r => r.line), ['M1']);
    // At 03:00, the first trains of the morning
    assert.ok(stationTrains(rail, 'syntagma', { ...NOON, seconds: 3 * 3600 }).every(r => r.departures[0].departs > 5 * 3600));
});

test('the nearest bus stop, however far', () => {
    const stops = decodeStops(read('bus-stops.json'));
    const stop = stops[0];
    assert.deepEqual(nearestBusStop(stops, stop.lat, stop.lng), { ...stop, meters: 0 });
    assert.equal(nearestBusStop([], stop.lat, stop.lng), null);
});

test('the starred stations Home can name, in the order starred; a suburban one once its trains are in', () => {
    const keys = ['piraeus-suburban', 'syntagma', 'gone', 'syntagma-tram'];
    assert.deepEqual(starredStations(metro, null, keys, 'en'), [{ key: 'syntagma', name: 'Syntagma' }, { key: 'syntagma-tram', name: 'Syntagma' }]);
    assert.deepEqual(starredStations(metro, trains, keys, 'el').map(s => s.name), ['Πειραιάς', 'Σύνταγμα', 'Σύνταγμα']);
});

// Found on CI (#339): the error page's link took a test to Home on rail.json
// with a station's position missing (test-site.js brokenData), and a
// position coming in failed the page
test('a station with no position is left out, not a failure', () => {
    const broken = structuredClone(rail);
    const [lat, lng] = broken.stations.omonia.coords;
    delete broken.stations.omonia.coords;
    const found = nearestStation(broken, lat, lng);
    assert.notEqual(found.id, 'omonia');
    assert.ok(found.meters > 0);
});
