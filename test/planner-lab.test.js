import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { compactBuses } from '../scripts/planner-lab/build-buses.js';
import { joinNetwork } from '../scripts/planner-lab/network.js';
import { createPlanner, walkSeconds } from '../scripts/planner-lab/raptor.js';
import { askOnce, rushTest, STOPS } from '../scripts/planner-lab/rush-test.js';
import { acrossWindow, describeWay, fastest, findWays, fold, secondsTo, spine, wayKey } from '../scripts/planner-lab/ways.js';

const H8 = 8 * 3600;
const minutes = n => H8 + n * 60;

// Stops 1.1 km apart, too far to walk between, and one 56 m from C
const stops = [
    ['A', 37.97], ['B', 37.98], ['C', 37.99], ['D', 38.0], ['E', 38.01],
].map(([id, lat]) => ({ id, name: id, lat, lng: 23.7 }));
stops.push({ id: 'C2', name: 'C2', lat: 37.9905, lng: 23.7 });
const [A, B, C, D, E, C2] = [0, 1, 2, 3, 4, 5];
const ride = (line, along, ...trips) => ({ line, mode: line.startsWith('M') ? 'metro' : 'bus', stops: along, trips });
const from = stop => [stop, 0];
const to = stop => [stop, 0];

test('each round is one more ride, and the fastest can take more of them', () => {
    const planner = createPlanner({ stops, routes: [
        ride('Slow', [A, D], [minutes(5), minutes(60)]),
        ride('M1', [A, B, C], [minutes(0), minutes(5), minutes(10)]),
        ride('Bus', [C, D], [minutes(20), minutes(25)]),
    ] });
    planner.search(from(A), H8);
    assert.equal(planner.arrival(to(D), 1).at, minutes(60));
    assert.equal(planner.arrival(to(D), 2).at, minutes(25));
    assert.deepEqual(planner.journey(D, 2).legs.map(leg => leg.line), ['M1', 'Bus']);
    assert.equal(planner.arrival(to(E)).at, null);
});

test('a change takes time: a bus leaving just after you get off is missed', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, B], [minutes(0), minutes(5)]),
        ride('Bus', [B, D], [minutes(7), minutes(12)], [minutes(20), minutes(25)]),
    ] });
    planner.search(from(B), H8 + 7 * 60);
    assert.equal(planner.arrival(to(D)).at, minutes(12), 'there at the start, it can be caught');
    planner.search(from(A), H8);
    assert.equal(planner.arrival(to(D)).at, minutes(25));
});

test('a change can walk to a stop nearby, up to the limit, and the walk says so', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, C], [minutes(0), minutes(5)]),
        ride('Bus', [C2, D], [minutes(10), minutes(15)]),
    ] });
    planner.search(from(A), H8);
    assert.equal(planner.arrival(to(D)).at, minutes(15));
    const { legs, walked } = planner.journey(D, 2);
    assert.equal(legs[1].walkBefore, walkSeconds(stops[C], stops[C2]));
    assert.equal(walked, legs[1].walkBefore);
    planner.search(from(A), H8, { walkLimit: 10 });
    assert.equal(planner.arrival(to(D)).at, null);
});

test('walks can be stretched, for a slower pace or a weight', () => {
    const planner = createPlanner({ stops, routes: [ride('Bus', [A, D], [minutes(5), minutes(10)])] });
    planner.search([A, 240], H8, { walkFactor: 2 });
    assert.equal(planner.arrival(to(D)).at, null, 'the bus has gone by the time you get there');
    planner.search([A, 240], H8);
    assert.equal(planner.arrival([D, 60], undefined, 2).at, minutes(12));
});

test('a line can be banned, and a stop for every ride but the first', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, B], [minutes(0), minutes(5)]),
        ride('Bus', [B, D], [minutes(10), minutes(15)]),
    ] });
    const banBoard = new Uint8Array(stops.length);
    banBoard[B] = 1;
    planner.search(from(A), H8, { ban: new Set(['Bus']) });
    assert.equal(planner.arrival(to(D)).at, null);
    planner.search(from(A), H8, { banBoard });
    assert.equal(planner.arrival(to(D)).at, null);
    planner.search(from(B), H8, { banBoard });
    assert.equal(planner.arrival(to(D)).at, minutes(15));
});

test('trips that overtake each other are all found', () => {
    const planner = createPlanner({ stops, routes: [
        ride('Bus', [A, D], [minutes(0), minutes(40)], [minutes(5), minutes(20)]),
    ] });
    planner.search(from(A), H8);
    assert.equal(planner.arrival(to(D)).at, minutes(20));
});

test('the stops around a point, by how long the walk takes', () => {
    const planner = createPlanner({ stops, routes: [] });
    const around = planner.near(stops[C], 120);
    assert.deepEqual(around, [C, 0, C2, Math.floor(walkSeconds(stops[C], stops[C2]))]);
    assert.deepEqual(planner.near(stops[C], 120, C), [C2, Math.floor(walkSeconds(stops[C], stops[C2]))]);
    assert.equal(secondsTo(around, C2), around[3]);
    assert.equal(secondsTo(around, D), Infinity);
});

test('fastest takes the fewest rides that get there first, and finds nothing where nothing goes', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, B], [minutes(0), minutes(5)]),
        ride('Bus', [B, D], [minutes(10), minutes(15)]),
    ] });
    planner.search(from(A), H8);
    // Nothing gets there with one ride: that isn't a way with no arrival
    assert.deepEqual(fastest(planner, from(A), to(D)).legs.map(leg => leg.line), ['M1', 'Bus']);
    assert.equal(fastest(planner, from(A), to(E)), null);
    assert.deepEqual(findWays(planner, from(A), to(E), H8), []);
});

test('the same lines changing somewhere else are another way', () => {
    // Korydallos to Kallithea by M3 and 040: at Syntagma, or at Piraeus
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, B], [minutes(0), minutes(5)]),
        ride('M3', [A, C], [minutes(0), minutes(10)]),
        ride('040', [B, D], [minutes(10), minutes(20)]),
        ride('040', [C, D], [minutes(15), minutes(30)]),
    ] });
    const ways = findWays(planner, from(A), to(D), H8);
    assert.deepEqual(ways.map(way => way.at), [minutes(20), minutes(30)]);
    assert.deepEqual(ways.map(way => wayKey(planner, way)), ['M3 B 040', 'M3 C 040']);
});

test('a way behind two better lines still comes up', () => {
    // M3 and M1 via Piraeus were lost behind the A2 and the 040
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, B], [minutes(0), minutes(5)]),
        ride('A2', [B, D], [minutes(10), minutes(20)]),
        ride('040', [B, D], [minutes(10), minutes(25)]),
        ride('M1', [B, D], [minutes(10), minutes(30)]),
    ] });
    const ways = findWays(planner, from(A), to(D), H8);
    assert.deepEqual(ways.map(way => way.legs[1].line), ['A2', '040', 'M1']);
});

test('the search stops at its budget, and a way too far behind gets no more searches', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, B], [minutes(0), minutes(5)]),
        ride('A2', [B, D], [minutes(10), minutes(20)]),
        ride('040', [B, D], [minutes(10), minutes(25)]),
        ride('M1', [B, D], [minutes(10), minutes(100)]),
    ] });
    assert.equal(findWays(planner, from(A), to(D), H8, { budget: 1 }).length, 1);
    const ways = findWays(planner, from(A), to(D), H8, { slack: 60 }).map(way => way.legs.at(-1).line);
    assert.deepEqual(ways, ['A2', '040'], 'what follows the first is found, but not searched on from');
});

test('the same bus caught at two stops is one way, with the least walking', () => {
    const leg = { line: '703', mode: 'bus', board: A, alight: D, boards: H8, arrives: H8, walkBefore: 0 };
    const near = { legs: [leg], walked: 0, at: minutes(20), walk: 300 };
    const further = { legs: [{ ...leg, board: B }], walked: 0, at: minutes(20), walk: 420 };
    const other = { legs: [{ ...leg, line: '891' }], walked: 0, at: minutes(20), walk: 300 };
    assert.deepEqual(fold([further, near, other]), [near, other]);
});

test('a window gives the fastest way of each departure, and a way reads as its rides', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, B], [minutes(0), minutes(5)], [minutes(10), minutes(15)]),
        ride('Bus', [B, D], [minutes(20), minutes(25)]),
        ride('Slow', [A, D], [minutes(30), minutes(50)]),
    ] });
    const departures = acrossWindow(planner, from(A), to(D), { from: H8, to: minutes(30), step: 900 });
    assert.deepEqual(departures.map(({ now, way }) => [now, way.at]), [[H8, minutes(25)], [minutes(15), minutes(50)], [minutes(30), minutes(50)]]);
    const [{ way: first }, { way: second }] = departures;
    assert.equal(spine(planner, first), 'M1 to B');
    assert.equal(spine(planner, second), 'buses only');
    assert.equal(describeWay(planner, first, H8), '08:25, 25 min, 1 changes, 0 on foot: 08:00 M1 A > B | 08:20 Bus B > D');
});

test('the network joins rail.json and the buses, each stop findable', () => {
    const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
    const buses = {
        day: 3,
        stops: { 100: [37.98, 23.7, 'Στάση'], 200: [37.99, 23.7, 'Άλλη'] },
        routes: [{ line: '1', mode: 'trolley', stops: ['100', '200'], profiles: [[0, 300]], trips: [[H8, 0]] }],
    };
    const { stops: all, routes, index } = joinNetwork(rail, buses, 3);
    assert.equal(all[index.get('rail:syntagma')].name, 'Σύνταγμα');
    assert.equal(all[index.get('bus:200')].name, 'Άλλη');
    const trolley = routes.find(route => route.line === '1');
    assert.deepEqual(trolley.trips, [[H8, H8 + 300]]);
    assert.deepEqual(trolley.stops, [index.get('bus:100'), index.get('bus:200')]);
    assert.deepEqual([...new Set(routes.map(route => route.mode))].sort(), ['metro', 'tram', 'trolley']);
    // Last night's trains are there, from before today's midnight
    assert.ok(routes.some(route => route.mode === 'metro' && route.trips.some(trip => trip[0] < 0)));
});

test('a day of the bus feed comes out small: its routes, trips and stops', async () => {
    const files = {
        routes: 'route_id,route_short_name,route_long_name,route_type\n1,040,ΠΕΙΡΑΙΑΣ,3\n2,12,ΟΜΟΝΟΙΑ,11\n',
        trips: 'route_id,service_id,trip_id\n1,day_3,a\n1,day_3,b\n1,day_4,thursday\n2,day_3,c\n',
        stops: 'stop_id,stop_code,stop_name,stop_lat,stop_lon,stop_url\n10,10,"Πλ, Κάνιγγος",37.98,23.73,x\n20,20,Β,37.99,23.73,x\n30,30,Γ,38.5,23.73,x\n',
    };
    const lines = [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        'a,08:00:00,08:00:00,10,1', 'a,08:05:00,08:05:00,20,2', 'a,08:30:00,08:30:00,30,3',
        'b,09:00:00,09:00:00,10,1', 'b,09:05:00,09:05:00,20,2', 'b,09:30:00,09:30:00,30,3',
        'thursday,10:00:00,10:00:00,10,1', 'thursday,10:05:00,10:05:00,20,2',
        'c,08:00:00,08:00:00,10,1', 'c,08:06:00,08:06:00,99,2', 'c,08:09:00,08:09:00,20,3',
    ];
    const whole = await compactBuses(files, lines);
    assert.deepEqual(whole.routes.map(r => [r.line, r.mode, r.stops.length]), [['040', 'bus', 3], ['12', 'trolley', 2]]);
    assert.deepEqual(whole.routes[0].profiles, [[0, 300, 1800]], 'trips with the same times share a profile');
    assert.deepEqual(whole.routes[0].trips, [[H8, 0], [9 * 3600, 0]]);
    assert.deepEqual(whole.stops['10'], [37.98, 23.73, '"Πλ, Κάνιγγος"']);

    const boxed = await compactBuses(files, lines, { box: [37.9, 23.7, 38, 23.8] });
    assert.deepEqual(boxed.routes[0].stops, ['10', '20'], 'stops outside the box go');
    assert.equal(boxed.stops['30'], undefined);
    const none = await compactBuses(files, lines, { box: [37.9, 23.7, 37.985, 23.8] });
    assert.deepEqual(none.routes, [], 'one stop left is no route');
});

const response = (status, body) => ({ ok: status === 200, status, json: async () => body });

test('the rush-hour test keeps which buses and when, and writes failures down too', async () => {
    const arrivals = [{ line: '703', route: '5229', vehicle: '44554', minutes: 3, to: { el: 'Ψ', en: 'Y' } }];
    let asked;
    const answer = await askOnce(['70040', '420116'], 1000, async (url, options) => {
        asked = { url, agent: options.headers['User-Agent'] };
        return response(200, { stops: { 70040: { arrivals, stale: true }, 420116: { unavailable: true } } });
    });
    assert.equal(asked.url, 'https://wayhop.gr/api/arrivals?stops=70040,420116');
    assert.equal(asked.agent, 'Wayhop rush-hour test');
    assert.deepEqual(answer, {
        at: 1000,
        stops: {
            70040: { arrivals: [{ line: '703', route: '5229', vehicle: '44554', minutes: 3 }], stale: true },
            420116: { arrivals: [], unavailable: true },
        },
    });
    assert.deepEqual(await askOnce(['1'], 5, async () => response(429)), { at: 5, status: 429 });
    assert.deepEqual(await askOnce(['1'], 5, async () => { throw new Error('no signal'); }), { at: 5, error: 'no signal' });
});

test('the rush-hour test stays inside what was agreed, on each whole minute, and stops on time', async () => {
    assert.ok(STOPS.length <= 12, 'one request, a request takes at most 12 stops');
    assert.equal(new Set(STOPS).size, STOPS.length);
    let clock = 90_000;
    const written = [];
    const waits = [];
    const options = {
        stops: ['1'], write: line => written.push(line), fetch: async () => response(200, { stops: {} }),
        now: () => clock, wait: async ms => { waits.push(ms); clock += ms; },
    };
    assert.equal(await rushTest({ ...options, until: 240_000 }), 3);
    assert.deepEqual(written.map(line => line.at), [90_000, 120_000, 180_000]);
    assert.deepEqual(waits, [30_000, 60_000, 60_000]);
    assert.equal(await rushTest({ ...options, rounds: 1 }), 1);
    assert.equal(waits.length, 3, 'no wait after the last round');
});

// Trips the user makes, with what they found out by making them. They're from
// Korydallos station to public stops beside where they end: real addresses
// don't belong in this public repository. Buses are the August feed's, cut
// to the area (build-buses.js), on a Wednesday. A `todo` is something riders
// know and the model doesn't yet: it says what it needs.
const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('fixtures/planner-lab/wednesday.json', import.meta.url), 'utf8'));
const network = joinNetwork(rail, buses, 3);
const lab = createPlanner(network);
const END_WALK = 1200;
const at = id => network.stops[network.index.get(id)];
const start = lab.near(at('rail:korydallos'), END_WALK);
const towards = id => lab.near(at(id), END_WALK);
const waysAt = (id, time) => fold(findWays(lab, start, towards(id), time));
const has = (ways, check) => ways.some(way => check(way.legs));
const lines = legs => legs.map(leg => leg.line);
const MORNING = { from: 8 * 3600, to: 9.5 * 3600, step: 180 };
const spineOf = id => acrossWindow(lab, start, towards(id), MORNING).map(({ way }) => spine(lab, way));
const KALLITHEA = 'bus:240003';
const KOLONOS = 'bus:60217';
const PERISTERI = 'bus:420116';

test('to Kallithea: M3, M2 to Syggrou-Fix, then a bus is offered', () => {
    assert.ok(has(waysAt(KALLITHEA, 8.5 * 3600), legs => lines(legs).slice(0, 2).join() === 'M3,M2' && at('rail:syggrou-fix') === lab.stops[legs[1].alight]));
});

test('to Kallithea: that way comes first, as a bus from Syntagma to Syggrou takes 10 to 30 minutes', { todo: 'needs real bus times by stretch and hour: the feed says 2.6' }, () => {
    const [first] = waysAt(KALLITHEA, 8.5 * 3600);
    assert.deepEqual(lines(first.legs).slice(0, 2), ['M3', 'M2']);
});

test('to Kolonos: both of the ways a rider uses are offered', () => {
    const ways = waysAt(KOLONOS, 8.5 * 3600);
    assert.ok(has(ways, legs => lines(legs).join().startsWith('M3,420')), 'M3 to Aigaleo, then the 420: a 10 minute walk at the change');
    assert.ok(has(ways, legs => lines(legs).slice(0, 2).join() === 'M3,M2' && at('rail:metaxourghio') === lab.stops[legs[1].alight]), 'through the centre to Metaxourgio');
});

test('to Kolonos: which is fastest depends on the departure', () => {
    const spines = spineOf(KOLONOS);
    const byAigaleo = spines.filter(way => way === 'M3 to Αιγάλεω').length;
    assert.ok(byAigaleo > 0 && byAigaleo < spines.length, `${byAigaleo} of ${spines.length}`);
});

test('to Peristeri: M3 to Aigaleo, then a bus, is the fastest on most departures', () => {
    const spines = spineOf(PERISTERI);
    assert.ok(spines.filter(way => way === 'M3 to Αιγάλεω').length / spines.length >= 0.8);
});

test('to Peristeri: the 750 from Aigaleo is offered too', { todo: 'needs every line at a change point: the search hides it behind the same bus from Korydallos' }, () => {
    assert.ok(has(waysAt(PERISTERI, 8.5 * 3600), legs => lines(legs).join() === 'M3,750'));
});
