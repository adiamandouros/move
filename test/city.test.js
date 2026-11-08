import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBuses, TIMETABLE_SCHEMA } from '../server/data/bus-timetable.js';
import { buildTrains } from '../server/data/build-suburban.js';
import { busDay, createPlanner, joinNetwork, MAX_RIDES, trainDay } from '../tools/subway/client/city.js';
import { board, suburbanCurated, train } from './fixtures/railway.js';

// The whole city for the trip search (tools/subway/client/city.js): a day of
// buses.json and of trains.json as the search reads them. The search itself, its walks and the
// ways it finds are tested on the planner lab's trips (planner-lab.test.js).

const H8 = 8 * 3600;
const DAY = 86_400;
const place = (code, n) => ({ code, el: `Στάση ${code}`, en: '', lat: 37.97 + n * 0.01, lng: 23.7 });
const network = {
    lines: [{ code: 'L1', line: '040', name: { el: '040', en: '040' } }],
    routes: { L1: [{ code: '3922', type: '1', name: { el: 'Α - Β', en: 'A - B' } }] },
    stops: { 3922: { at: '', stops: ['1', '2', '3'].map((code, i) => place(code, i)) } },
};
// Weekdays: 08:00 and 08:10; Saturday: one at 23:50 that's still out at 00:10
const week = {
    schema: TIMETABLE_SCHEMA, feed: { modified: '2026-08-06', validFrom: '2026-08-03', validTo: '2026-08-24' },
    routes: [{
        line: '040', mode: 'bus', stops: ['1', '2', '3'], profiles: [[0, 124, 1200]],
        patterns: [[], [[H8, 0], [H8 + 600, 0]], [[DAY - 600, 0]]], days: [0, 1, 1, 1, 1, 1, 2],
    }],
};
const buses = buildBuses(week, network, { rides: [] }).data;

test('a day of buses.json is the day it was built from, to the 10 s', () => {
    assert.deepEqual(busDay(buses, 3), {
        day: 3,
        // With each stop's English, '' where it's the Greek in Latin letters
        stops: { 1: [37.97, 23.7, 'Στάση 1', ''], 2: [37.98, 23.7, 'Στάση 2', ''], 3: [37.99, 23.7, 'Στάση 3', ''] },
        routes: [{ line: '040', mode: 'bus', code: '3922', stops: ['1', '2', '3'], profiles: [[0, 120, 1200]], trips: [[H8, 0], [H8 + 600, 0]] }],
    });
});

test('after midnight, last night\'s buses still on the road come first, at times before it', () => {
    // Sunday: Saturday's 23:50 gets to its last stop at 00:10, so it's still out
    assert.deepEqual(busDay(buses, 0).routes[0].trips, [[-600, 0]]);
    // Monday: Sunday has none, so only Monday's own
    assert.deepEqual(busDay(buses, 1).routes[0].trips, [[H8, 0], [H8 + 600, 0]]);
    // Friday's last bus left at 08:10, long gone by Saturday
    assert.deepEqual(busDay(buses, 6).routes[0].trips, [[DAY - 600, 0]]);
});

test('a route with no trips that day isn\'t in it, nor are stops only it calls at', () => {
    const quiet = { ...buses, routes: [{ ...buses.routes[0], days: [0, 0, 0, 0, 0, 0, 0] }] };
    assert.deepEqual(busDay(quiet, 3), { day: 3, stops: {}, routes: [] });
});

test('each stop has its names and each route where it goes: a bus\'s last stop, and which of OASA\'s routes it is', () => {
    const { stops, routes } = joinNetwork({ schema: 1, stations: {}, lines: {} }, busDay(buses, 3), 3);
    assert.deepEqual(stops.map(stop => [stop.id, stop.names]), [1, 2, 3].map(n => [`bus:${n}`, { el: `Στάση ${n}`, en: '' }]));
    assert.deepEqual(routes[0].toward, { el: 'Στάση 3', en: '' });
    // As OASA's live times name it (the Trip page's live times, decision 35)
    assert.equal(routes[0].code, '3922');
});

test('the search rides the day\'s buses, from the stops a walk away', () => {
    const rail = { schema: 1, stations: {}, lines: {} };
    const planner = createPlanner(joinNetwork(rail, busDay(buses, 3), 3));
    const from = planner.near({ lat: 37.9701, lng: 23.7 }, 300);
    const to = planner.near({ lat: 37.9899, lng: 23.7 }, 300);
    planner.search(from, H8 - 120, { egress: to });
    assert.equal(planner.arrival(to).at > H8 + 1200, true, 'the 08:00 bus, then the walk to the door');
    assert.equal(planner.arrival(to).at < H8 + 1800, true, 'not the 08:10');
});

// trains.json (decision 41): Sunday the 8th as the fixture's board has it,
// with a train on Saturday the 7th that's still running after midnight
const trains = buildTrains({
    '2026-11-07': { schedules: [train('2026-11-07', '1290', [['o1', '23:40'], ['o2', '23:55'], ['o3', '24:45']]), train('2026-11-07', '1288', [['o1', '20:00'], ['o3', '21:05']])] },
    '2026-11-08': board('2026-11-08'),
}, suburbanCurated()).data;

test('a day of trains.json: its own trains, and the day before\'s still running after midnight at times before it', () => {
    const day = trainDay(trains, '2026-11-08');
    assert.equal(day.stations, trains.stations);
    assert.equal(day.walks, trains.walks);
    assert.deepEqual(day.outside, ['airport']);
    assert.deepEqual(day.routes, [
        // Saturday's 23:40 gets to the airport at 00:45, so it's still out; its 20:00 isn't
        { line: 'A1', stops: ['piraeus', 'athens', 'airport'], profiles: [[0, 900, 3900]], trips: [[-1200, 0]] },
        ...trains.dates['2026-11-08'],
    ]);
    // Saturday: the day before it wasn't fetched
    assert.deepEqual(trainDay(trains, '2026-11-07').routes, trains.dates['2026-11-07']);
    // A day with no board: no trains at all, so the Trip page can say so
    assert.equal(trainDay(trains, '2026-11-09'), null);
});

test('the trains\' stations are stops with their names, their routes the suburban railway\'s, going where their last station is', () => {
    const { stops, routes, index } = joinNetwork({ schema: 1, stations: {}, lines: {} }, busDay(buses, 0), 0, trainDay(trains, '2026-11-08'));
    const station = stops[index.get('train:athens')];
    assert.deepEqual([station.lat, station.lng, station.names], [37.99284, 23.72015, { el: 'Αθήνα', en: 'Athens' }]);
    assert.equal(station.station, undefined, 'not a metro station');
    // Outside OASA's ticket: the airport's
    assert.equal(stops[index.get('train:airport')].oasaTicket, false);
    assert.equal(station.oasaTicket, undefined);
    const suburban = routes.filter(route => route.mode === 'suburban');
    assert.deepEqual(suburban.map(route => [route.line, route.stops.map(i => stops[i].id), route.toward.en, route.trips.length]), [
        ['A1', ['train:piraeus', 'train:athens', 'train:airport'], 'Airport', 1],
        ['A1', ['train:piraeus', 'train:athens', 'train:airport'], 'Airport', 2],
        ['A1', ['train:airport', 'train:athens', 'train:piraeus'], 'Piraeus', 1],
    ]);
    // Each trip's time at each station
    assert.deepEqual(suburban[1].trips, [[8 * 3600, 8 * 3600 + 900, 8 * 3600 + 3900], [9 * 3600, 9 * 3600 + 900, 9 * 3600 + 3900]]);
    // Without trains, no stations and no trains
    assert.equal(joinNetwork({ schema: 1, stations: {}, lines: {} }, busDay(buses, 0), 0).routes.filter(route => route.mode === 'suburban').length, 0);
});

test('the search rides the day\'s trains, from the stations a walk away', () => {
    const planner = createPlanner(joinNetwork({ schema: 1, stations: {}, lines: {} }, busDay(buses, 0), 0, trainDay(trains, '2026-11-08')));
    // Near Athens station, to near the airport's
    const from = planner.near({ lat: 37.9935, lng: 23.7205 }, 600);
    const to = planner.near({ lat: 37.9372, lng: 23.9440 }, 600);
    planner.search(from, 8 * 3600, { egress: to });
    const [leg] = planner.journey(planner.arrival(to).stop, MAX_RIDES).legs;
    assert.deepEqual([leg.mode, leg.line, planner.stops[leg.board].id, planner.stops[leg.alight].id, leg.boards], ['suburban', 'A1', 'train:athens', 'train:airport', 8 * 3600 + 900]);
});

test('a known walk is the search\'s, either way round and however far, with its note; one to a stop the network doesn\'t have is left out', () => {
    const rail = { schema: 1, stations: {}, lines: {} };
    const date = '2026-11-08';
    // From the airport to Athens, then from Piraeus to Ano Liosia; Piraeus and Athens are 8 km apart, so it takes the walk between them
    const day = {
        ...trainDay(buildTrains({ [date]: { schedules: [
            train(date, '1', [['o3', '08:00'], ['o2', '08:40']]),
            train(date, '2', [['o1', '08:50'], ['o4', '09:30']]),
        ] } }, suburbanCurated()).data, date),
        walks: [['train:piraeus', 'train:athens', 300, { el: 'Σήμα', en: 'A note' }], ['train:athens', 'rail:b', 240]],
    };
    const network = joinNetwork(rail, busDay(buses, 0), 0, day);
    const [piraeus, athens] = ['train:piraeus', 'train:athens'].map(id => network.index.get(id));
    assert.deepEqual(network.knownWalks, [[piraeus, athens, 300, { el: 'Σήμα', en: 'A note' }]], 'rail:b isn\'t in this network');
    const planner = createPlanner(network);
    assert.deepEqual(planner.walkNote(athens, piraeus), { el: 'Σήμα', en: 'A note' });
    assert.equal(planner.walkNote(athens, network.index.get('train:airport')), null);
    const from = planner.near({ lat: 37.9372, lng: 23.9445 }, 300);
    const to = planner.near({ lat: 38.0708, lng: 23.7099 }, 300);
    planner.search(from, 7 * 3600 + 55 * 60, { egress: to });
    const { legs } = planner.journey(planner.arrival(to).stop, MAX_RIDES);
    assert.deepEqual(legs.map(leg => [planner.stops[leg.board].id, planner.stops[leg.alight].id, leg.boards, leg.walkBefore]), [
        ['train:airport', 'train:athens', 8 * 3600, 0],
        // Off at 08:40, 5 minutes on foot and the minute after a walk: the 08:50
        ['train:piraeus', 'train:liosia', 8 * 3600 + 50 * 60, 300],
    ]);
});
