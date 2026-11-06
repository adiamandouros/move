import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// The trip page's door-to-door trip (tools/trip/client/plan.js), over the
// test data's real metro, with the tram, and with the buses between Kallithea
// and Syntagma (tools/trip/client/buses.js). What's drawn: trip-render.test.js.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { doorToDoor, stationsNear, walkBetween } = await browserModule('tools/trip/client/plan.js');
const { busOptions, cityPlanner, halfHour } = await browserModule('tools/trip/client/buses.js');
const { answer } = await browserModule('tools/subway/client/answer.js');
const { withTram } = await browserModule('tools/subway/client/network.js');
const network = withTram(rail);
// rail.json as it is: the city's search joins the tram itself
const city = cityPlanner(rail, buses, 3);
const withBuses = (to, now = NOW) => ({ buses: busOptions(city, menelaou, to, now) });

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

test('with the tram, a stop within 15 minutes is tried too, and the three nearest metro stations still are', () => {
    assert.deepEqual(stationsNear(network, menelaou).map(s => [s.station, s.walk.minutes, s.nearest]),
        [['aigaiou', 15, false], ['tavros', 17, true], ['kallithea', 21, true], ['petralona', 25, true]]);
});

test('a station is that station, with no walk', () => {
    assert.deepEqual(stationsNear(rail, syntagma), [{ station: 'syntagma', walk: null, nearest: true }]);
    assert.deepEqual(stationsNear(network, { lat: 0, lng: 0, station: 'kasomouli' }), [{ station: 'kasomouli', walk: null, nearest: true }]);
});

test('a tram stop beyond the nearest metro stations, when it gets there first', () => {
    const [best, ...others] = doorToDoor(network, menelaou, { lat: 0, lng: 0, station: 'kasomouli' }, NOW).options;
    assert.deepEqual([best.start.station, best.plan.legs.map(leg => leg.line).join()], ['aigaiou', 'T6']);
    assert.ok(others.every(o => o.arrives > best.arrives + 20 * 60), 'the metro takes 20 minutes more');
});

test('along the coast, the tram instead of an hour\'s walk to the metro', () => {
    const near = (id, lat = 0.003, lng = 0.002) => ({ lat: network.stations[id].coords[0] + lat, lng: network.stations[id].coords[1] + lng });
    const [from, to] = [near('floisvos'), near('kalamaki')];
    const tram = doorToDoor(network, from, to, NOW);
    assert.equal(tram.walkFirst, false);
    assert.deepEqual(tram.options[0].plan.legs.map(leg => leg.line), ['T7']);
    assert.ok(tram.options[0].minutes <= 30, `${tram.options[0].minutes}`);
    // The metro alone, as when the tram is hidden: walk to the metro for most of an hour
    const metro = doorToDoor(rail, from, to, NOW);
    assert.ok(metro.options.every(o => o.plan.legs.every(leg => !network.lines[leg.line].tram)));
    assert.ok(metro.options[0].start.walk.minutes > 45);
});

test('the same way is offered once, however it\'s walked to: from the stop, or from the station beside it', () => {
    for (const [from, to] of [[menelaou, syntagma], [syntagma, { lat: 0, lng: 0, station: 'kasomouli' }], [{ lat: 37.958, lng: 23.73 }, { lat: 37.9595, lng: 23.7185 }]]) {
        const ways = doorToDoor(network, from, to, NOW).options.map(o => `${o.plan.legs[0].from} ${o.plan.legs.map(leg => leg.line)}`);
        assert.deepEqual(ways, [...new Set(ways)]);
    }
});

test('door to door: walk, ride, and in order by what they cost a rider', () => {
    const { options, walkFirst, longWalk } = doorToDoor(rail, menelaou, syntagma, NOW);
    assert.equal(walkFirst, false);
    assert.equal(longWalk, false);
    assert.ok(options.length >= 2 && options.length <= 3);
    // The weights (weights.js): the minutes to the door and more for each one on foot and each change
    const costs = options.map(o => o.cost);
    assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
    for (const o of options) assert.ok(o.cost >= o.arrives - NOW.seconds + o.changes * 180);
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

// ── With the buses (decision 31) ────────────────────────────────────────────

test('with the buses, a way by bus that costs less comes first: Menelaou to Syntagma by the 040', () => {
    const { options } = doorToDoor(network, menelaou, syntagma, NOW, withBuses(syntagma));
    const [best] = options;
    assert.equal(best.city, true);
    assert.deepEqual(best.rides.map(ride => ride.lines), [['040']]);
    assert.ok(best.minutes < doorToDoor(network, menelaou, syntagma, NOW).options[0].minutes, 'sooner than the tram, on the August timetable');
    assert.deepEqual(options.map(o => o.cost), options.map(o => o.cost).sort((a, b) => a - b), 'all of them in order by the weights');
    // From the door to the first stop, and from the last to Syntagma
    assert.ok(best.firstWalk.minutes > 0 && best.firstWalk.meters > 0);
    assert.ok(best.rides[0].boards >= NOW.seconds + best.firstWalk.minutes * 60 - 60, 'caught after the walk');
    // There when the last ride gets in, and the walk is done (its minutes are rounded)
    assert.ok(Math.abs(best.arrives - (best.rides.at(-1).arrives + best.lastWalk.minutes * 60)) <= 30);
    assert.equal(best.minutes, Math.round((best.arrives - NOW.seconds) / 60));
});

test('the same ride on different buses is one option, with each line, and no two options ride between the same stops', () => {
    const options = busOptions(city, menelaou, syntagma, NOW);
    const both = options.find(o => o.rides[0].lines.includes('550'));
    assert.ok(both.rides[0].lines.includes('10'), 'the 550 or the 10 from Efesou');
    const rides = options.map(o => o.rides.map(ride => `${ride.mode === 'bus' ? 'bus' : ride.line} ${ride.board.id} ${ride.alight.id}`).join());
    assert.deepEqual(rides, [...new Set(rides)]);
});

test('every option the buses add has one, and a ride names its stops and where it goes', () => {
    const options = busOptions(city, menelaou, syntagma, NOW);
    assert.ok(options.length > 0);
    for (const o of options) assert.ok(o.rides.some(ride => ['bus', 'trolley'].includes(ride.mode)));
    const [ride] = options[0].rides;
    assert.ok(ride.board.names.el && ride.alight.names.el && ride.toward.el);
    assert.ok(ride.stops > 0 && ride.arrives > ride.boards);
});

test('without the buses, the metro and the tram, as before', () => {
    assert.ok(doorToDoor(network, menelaou, syntagma, NOW).options.every(o => !o.city));
});

test('the half hour: a departure every 2 minutes, one at a time, and what kind of answer the trip has', () => {
    const steps = halfHour(city, menelaou, syntagma, NOW);
    let departures = 0;
    let step = steps.next();
    while (!step.done) {
        departures++;
        step = steps.next();
    }
    assert.equal(departures, 16, 'from now to 30 minutes on');
    assert.deepEqual(step.value.departures, Array.from({ length: 16 }, (_, i) => NOW.seconds + i * 120));
    assert.equal(step.value.kind, 'depends', 'by the 040, or by M2 from Syggrou-Fix');
    assert.deepEqual(step.value, answer(city, city.near(menelaou, 900), city.near(syntagma, 900), NOW.seconds), 'the lab\'s answer, as it is');
    const fix = { lat: rail.stations['syggrou-fix'].coords[0], lng: rail.stations['syggrou-fix'].coords[1] };
    const noon = { ...NOW, seconds: 12 * 3600 };
    const clear = answer(city, city.near(menelaou, 900), city.near(fix, 900), noon.seconds);
    assert.equal(clear.kind, 'clear', 'to Syggrou-Fix at noon: any of the buses from the start');
    assert.equal(clear.clear.key, 'a bus from the start');
});
