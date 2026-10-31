import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// The trip page's door-to-door trip (tools/trip/client/plan.js), over the
// test data's real metro. What's drawn: trip-render.test.js.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const { doorToDoor, stationsNear, walkBetween } = await browserModule('tools/trip/client/plan.js');

// A Wednesday in the timetable, 10:00
const NOW = { weekday: 3, seconds: 10 * 3600, date: '2026-10-21' };
const menelaou = { lat: 37.95463, lng: 23.71049 };
const syntagma = { lat: rail.stations.syntagma.coords[0], lng: rail.stations.syntagma.coords[1], station: 'syntagma' };
const far = { lat: 37.97805, lng: 23.62674 };

test('a walk is the straight line plus a third, at 80 m a minute, and at least a minute', () => {
    const walk = walkBetween({ lat: 37.95, lng: 23.7 }, { lat: 37.959, lng: 23.7 });
    assert.ok(Math.abs(walk.meters - 1302) < 5, `${walk.meters}`);
    assert.equal(walk.minutes, 16);
    assert.equal(walkBetween(menelaou, menelaou).minutes, 1);
});

test('tries the three nearest stations, nearest first', () => {
    assert.deepEqual(stationsNear(rail, menelaou).map(s => s.station), ['tavros', 'kallithea', 'petralona']);
    const walks = stationsNear(rail, menelaou).map(s => s.walk.minutes);
    assert.deepEqual(walks, [...walks].sort((a, b) => a - b));
});

test('a station is that station, with no walk', () => {
    assert.deepEqual(stationsNear(rail, syntagma), [{ station: 'syntagma', walk: null }]);
});

test('door to door: walk, ride, and the first to arrive first', () => {
    const { options, walkFirst, longWalk } = doorToDoor(rail, menelaou, syntagma, NOW);
    assert.equal(walkFirst, false);
    assert.equal(longWalk, false);
    assert.ok(options.length >= 2 && options.length <= 3);
    const arrivals = options.map(o => o.arrives);
    assert.deepEqual(arrivals, [...arrivals].sort((a, b) => a - b));
    const [best] = options;
    assert.ok(best.plan.legs[0].departures[0].departs >= NOW.seconds + best.start.walk.minutes * 60, 'catches a train after the walk');
    assert.equal(best.minutes, Math.round((best.arrives - NOW.seconds) / 60));
});

test('no two options read the same', () => {
    const places = doorToDoor(rail, menelaou, { lat: 37.9535, lng: 23.736 }, NOW).options
        .map(o => `${o.start.station} ${o.plan.legs.map(leg => leg.line)}`);
    assert.deepEqual(places, [...new Set(places)]);
});

test('the walk at the far end counts in the arrival', () => {
    const toAddress = doorToDoor(rail, syntagma, menelaou, NOW).options[0];
    assert.ok(toAddress.end.walk.minutes > 0);
    assert.equal(toAddress.arrives, toAddress.plan.arrives + toAddress.end.walk.minutes * 60);
});

test('close enough to walk: walking comes first', () => {
    const near = { lat: syntagma.lat + 0.002, lng: syntagma.lng };
    const { walkFirst, walk } = doorToDoor(rail, near, syntagma, NOW);
    assert.equal(walkFirst, true);
    assert.ok(walk.minutes < 10);
});

test('the same station at both ends has no train, only the walk', () => {
    const { options, walkFirst } = doorToDoor(rail, syntagma, syntagma, NOW);
    assert.deepEqual(options, []);
    assert.equal(walkFirst, true);
});

test('a long way from the metro says so', () => {
    assert.equal(doorToDoor(rail, far, syntagma, NOW).longWalk, true);
});

test('after the last train, the morning\'s first, and on foot is sooner', () => {
    const late = { ...NOW, seconds: 2 * 3600 + 30 * 60 };
    const { options, walkFirst } = doorToDoor(rail, menelaou, syntagma, late);
    assert.ok(options.length > 0);
    assert.equal(options[0].morning, true);
    assert.equal(walkFirst, true);
});

test('late at night, the next day\'s trains count from today\'s midnight', () => {
    const { options } = doorToDoor(rail, menelaou, syntagma, { ...NOW, seconds: 85_000 });
    if (options[0].morning) assert.ok(options[0].arrives > 86_400);
    assert.ok(options[0].minutes > 0);
});

test('a walk that runs past midnight catches the next day\'s trains', () => {
    const lastMinute = { ...NOW, seconds: 86_000 };
    assert.ok(doorToDoor(rail, far, syntagma, lastMinute).options.length > 0);
});
