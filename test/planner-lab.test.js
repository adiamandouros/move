import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { compactBuses, cutToBox } from '../scripts/planner-lab/build-buses.js';
import { liveRoutes, onLiveRoutes, retimed, shared } from '../scripts/planner-lab/live-routes.js';
import { joinNetwork } from '../scripts/planner-lab/network.js';
import { CHANGE_SECONDS, createPlanner, walkSeconds } from '../scripts/planner-lab/raptor.js';
import { askOnce, rushTest, STOPS } from '../scripts/planner-lab/rush-test.js';
import { answer, lateness, quickerWay, rowKey } from '../scripts/planner-lab/answer.js';
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
        ride('M2', [A, C], [minutes(30), minutes(40)]),
        ride('040', [C, D], [minutes(50), minutes(100)]),
        ride('M4', [A, E], [minutes(30), minutes(40)]),
        ride('041', [E, D], [minutes(50), minutes(120)]),
    ] });
    assert.equal(findWays(planner, from(A), to(D), H8, { budget: 1 }).length, 1);
    const ways = findWays(planner, from(A), to(D), H8, { slack: 60 }).map(way => way.legs.at(-1).line);
    assert.deepEqual(ways, ['A2', '040'], 'what follows the first is found, but not searched on from');
});

test('every line from a change to the door is offered, not just what beat the rest', () => {
    // The 750 from Aigaleo: the same bus goes from the start, so the search
    // never needs it after the metro, and the 703 is first from the change
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, B], [minutes(0), minutes(5)]),
        ride('750', [A, B, D], [minutes(0), minutes(20), minutes(40)]),
        ride('703', [B, D], [minutes(10), minutes(20)]),
    ] });
    const ways = findWays(planner, from(A), to(D), H8);
    assert.deepEqual(ways.map(way => way.legs.map(leg => leg.line).join('+')).sort(), ['750', 'M3+703', 'M3+750']);
    assert.deepEqual(ways.map(way => way.at), [minutes(20), minutes(40), minutes(40)]);
});

test('a line after a change is timed to the door, and walks there from a stop nearby', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, C], [minutes(0), minutes(5)]),
        ride('Bus', [C, D], [minutes(10), minutes(20)]),
        ride('Far', [C2, E], [minutes(10), minutes(15)]),
    ] });
    // Sooner off the bus and further to walk: what counts is reaching the door
    const egress = [D, 60, E, 480];
    const rides = planner.onwardRides(C, minutes(5), egress);
    assert.deepEqual(rides.map(({ leg, at }) => [leg.line, at]), [['Bus', minutes(21)], ['Far', minutes(23)]]);
    assert.equal(rides[0].leg.walkBefore, 0);
    assert.equal(rides[1].leg.walkBefore, walkSeconds(stops[C], stops[C2]));
    assert.deepEqual(planner.onwardRides(C, minutes(5), egress, { except: new Set(['Bus']) }).map(({ leg }) => leg.line), ['Far']);
    assert.deepEqual(planner.onwardRides(C, minutes(5), egress, { walkLimit: 10 }).map(({ leg }) => leg.line), ['Bus']);
    assert.deepEqual(planner.onwardRides(C, minutes(12), egress).map(({ leg }) => leg.line), [], 'both have gone');
});

test('a line is offered with its earliest arrival, then the least walking', () => {
    const planner = createPlanner({ stops, routes: [
        ride('Bus', [C2, D], [minutes(10), minutes(20)], [minutes(30), minutes(40)]),
        ride('Bus', [C, D], [minutes(10), minutes(20)]),
    ] });
    const [only, ...others] = planner.onwardRides(C, H8, to(D));
    assert.deepEqual(others, []);
    assert.equal(only.leg.board, C, 'the same bus, with no walk to another stop');
    assert.equal(only.at, minutes(20));
});

test('a way doesn\'t get off a line to get back on it', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, B, D], [minutes(0), minutes(5), minutes(10)], [minutes(20), minutes(25), minutes(30)]),
        ride('Bus', [A, B], [minutes(0), minutes(5)]),
        ride('Tram', [B, D], [minutes(10), minutes(40)]),
    ] });
    const ways = findWays(planner, from(A), to(D), H8);
    assert.ok(ways.every(way => new Set(way.legs.map(leg => leg.line)).size === way.legs.length));
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

// Departures every 5 minutes for 20: few enough to count by hand
const FIVE = { window: 1200, step: 300 };

test('the buses from one change to the door are one row: any of them, timed by the first to come', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, B], [minutes(0), minutes(5)], [minutes(10), minutes(15)], [minutes(20), minutes(25)]),
        ride('703', [B, D], [minutes(9), minutes(19)], [minutes(29), minutes(39)]),
        ride('891', [B, D], [minutes(19), minutes(29)], [minutes(39), minutes(49)]),
    ] });
    const { kind, rows, clear, departures } = answer(planner, from(A), to(D), H8, FIVE);
    assert.deepEqual(departures, [0, 5, 10, 15, 20].map(minutes));
    assert.equal(kind, 'clear');
    assert.equal(rows.length, 1);
    assert.equal(clear, rows[0]);
    assert.equal(clear.key, 'M3 at B, a bus');
    assert.deepEqual(clear.lines, ['703', '891']);
    assert.ok(clear.bundle);
    // 19, 29, 29, 39, 39 at the door, from 0, 5, 10, 15, 20: 19 to 24 minutes
    assert.deepEqual(clear.best.map(way => way.at), [19, 29, 29, 39, 39].map(minutes));
    assert.deepEqual(clear.range, [19, 24]);
    assert.equal(clear.every, 600, 'a bus every 10 minutes, the lines together');
    assert.equal(clear.first, 1);
});

test('a row is its rides up to the last bus and where that\'s caught; a train to the end is all its rides', () => {
    const planner = createPlanner({ stops, routes: [] });
    const leg = (line, mode, board, alight) => ({ line, mode, board, alight, boards: H8, arrives: H8, walkBefore: 0 });
    const way = legs => ({ legs, walked: 0, at: H8, walk: 0 });
    assert.equal(rowKey(planner, way([leg('M3', 'metro', A, B), leg('703', 'bus', B, D)])), 'M3 at B, a bus');
    assert.equal(rowKey(planner, way([leg('M3', 'metro', A, B), leg('1', 'trolley', C2, D)])), 'M3 at B, a bus');
    assert.equal(rowKey(planner, way([leg('750', 'bus', A, D)])), 'a bus from the start');
    assert.equal(rowKey(planner, way([leg('M3', 'metro', A, B), leg('M2', 'metro', B, D)])), 'M3 B M2');
});

test('no way at all is no answer', () => {
    const planner = createPlanner({ stops, routes: [ride('M3', [A, B], [minutes(0), minutes(5)])] });
    assert.deepEqual(answer(planner, from(A), to(D), H8, FIVE), { kind: 'none', rows: [], departures: [0, 5, 10, 15, 20].map(minutes) });
});

test('two ways each first often enough, on different first rides: it depends', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, D], [minutes(0), minutes(15)], [minutes(20), minutes(35)]),
        ride('750', [A, D], [minutes(5), minutes(21)], [minutes(10), minutes(26)], [minutes(15), minutes(31)]),
    ] });
    const { kind, rows } = answer(planner, from(A), to(D), H8, FIVE);
    assert.equal(kind, 'depends');
    assert.deepEqual(rows.map(row => [row.key, row.first, row.close]), [['a bus from the start', 0.6, 0.6], ['M1', 0.4, 0.4]]);
});

// The M3 from A every 10 minutes, on to C, where the M2 goes to D. At B, a
// bus to D is quicker for the first train only
const decisionAt = (busLine = '420', mode = 'bus', [leaves, arrives] = [9, 19]) => createPlanner({ stops, routes: [
    ride('M3', [A, B, C], ...[0, 10, 20].map(t => [minutes(t), minutes(t + 5), minutes(t + 10)])),
    ride('M2', [C, D], ...[0, 10, 20].map(t => [minutes(t + 13), minutes(t + 23)])),
    { ...ride(busLine, [B, D], [minutes(leaves), minutes(arrives)]), mode },
] });

test('the same train, and a bus that\'s sometimes much quicker: a decision on the way, the directions staying on', () => {
    const { kind, decision } = answer(decisionAt(), from(A), to(D), H8, FIVE);
    assert.equal(kind, 'decision');
    assert.equal(decision.getOff.key, 'M3 at B, a bus');
    assert.equal(decision.stayOn.key, 'M3 C M2');
    assert.equal(decision.stop, B);
    assert.deepEqual(decision.lines, ['420']);
    assert.equal(decision.ready, minutes(5) + CHANGE_SECONDS);
    // The bus takes 10 minutes and staying on gets there at 08:23
    assert.equal(decision.latest, minutes(13));
});

test('a way never much worse needs no decision, and a train onward is decided before leaving', () => {
    // Only 2 minutes quicker: not worth getting off for
    assert.equal(answer(decisionAt('420', 'bus', [9, 21]), from(A), to(D), H8, FIVE).kind, 'clear');
    // A tram's in the timetable: the search already knows which is quicker
    assert.equal(answer(decisionAt('T6', 'tram'), from(A), to(D), H8, FIVE).kind, 'clear');
});

test('a bus is later than OASA says, the further ahead it says it', () => {
    assert.deepEqual([0, 900, 901, 1500, 2700, 5000].map(lateness), [60, 60, 90, 150, 210, 420]);
});

test('a quicker way is offered only for a bus that comes in time and saves a tie or more; no prediction offers nothing', () => {
    // Staying on gets there as a bus leaving at 08:15 would
    const decision = { lines: ['420'], ready: minutes(8), latest: minutes(15) };
    const asked = H8;
    const bus = at => ({ line: '420', at });
    assert.deepEqual(quickerWay(decision, [bus(minutes(10))], asked), { offer: true, why: 'quicker', line: '420', at: minutes(10), sooner: 240 }, 'a minute late, still 4 sooner');
    assert.deepEqual(quickerWay(decision, [bus(minutes(12) + 1)], asked), { offer: false, why: 'not-quicker', line: '420', at: minutes(12) + 1, sooner: 119 }, 'not worth changing for 2 minutes');
    assert.deepEqual(quickerWay(decision, [bus(minutes(6))], asked), { offer: false, why: 'missed' }, 'gone before the train gets there');
    assert.equal(quickerWay(decision, [bus(minutes(6)), bus(minutes(11))], asked).offer, true, 'the next one will do');
    assert.deepEqual(quickerWay(decision, [{ line: '12', at: minutes(10) }], asked), { offer: false, why: 'none' }, 'another line isn\'t ours');
    assert.deepEqual(quickerWay(decision, [], asked), { offer: false, why: 'none' });
    // 20 minutes ahead, it's 1.5 later as a rule: 2.5 sooner. Nearer the time, 1 later: 3
    const far = { lines: ['420'], ready: minutes(10), latest: minutes(24) };
    assert.equal(quickerWay(far, [bus(minutes(20))], H8).offer, false);
    assert.equal(quickerWay(far, [bus(minutes(20))], minutes(10)).offer, true, 'asked again nearer the time');
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

});

test('a box keeps the stops inside it, and each trip\'s time from the first of them', () => {
    const buses = {
        day: 3,
        stops: { 1: [37.5, 23.73, 'Έξω'], 2: [37.98, 23.73, 'Α'], 3: [37.99, 23.73, 'Β'], 4: [38.5, 23.73, 'Έξω'] },
        routes: [
            { line: '040', mode: 'bus', stops: ['1', '2', '3', '4'], profiles: [[0, 60, 180, 600]], trips: [[H8, 0]] },
            { line: '12', mode: 'bus', stops: ['3', '4'], profiles: [[0, 60]], trips: [[H8, 0]] },
        ],
    };
    const { routes, stops: kept } = cutToBox(buses, [37.9, 23.7, 38, 23.8]);
    assert.deepEqual(routes, [{ line: '040', mode: 'bus', stops: ['2', '3'], profiles: [[0, 120]], trips: [[H8 + 60, 0]] }], 'one stop left is no route');
    assert.deepEqual(Object.keys(kept), ['2', '3']);
});

// Stops 1.1 km apart along a road, as OASA's live network has them
const place = (code, n) => ({ code, el: `Στάση ${code}`, en: '', lat: 37.97 + n * 0.01, lng: 23.7 });
const liveNetwork = (...routes) => ({
    fetched: '2026-11-01T00:00:00Z',
    lines: [...new Set(routes.map(([line]) => line))].map(line => ({ code: `L${line}`, line, name: { el: line, en: line } })),
    routes: Object.fromEntries([...new Set(routes.map(([line]) => line))].map(line => [`L${line}`,
        routes.filter(([other]) => other === line).map(([, code, name]) => ({ code, type: '1', name: { el: name, en: name } }))])),
    stops: Object.fromEntries(routes.map(([, code, , stops]) => [code, { at: '', stops }])),
});
const feed = (line, codes, offsets, ...starts) => ({ line, mode: 'bus', stops: codes, profiles: [offsets], trips: starts.map(start => [start, 0]) });
const onLive = (routes, network) => onLiveRoutes({ day: 3, stops: {}, routes }, network);

test('every live route is read, its stops in order, without codes the live times can\'t use', () => {
    const network = liveNetwork(
        ['040 ', '1', 'Α - Β', [place('1', 0), { ...place('X9', 1) }, place('2', 2)]],
        ['12', '2', 'Γ', [place('3', 0)]],
    );
    assert.deepEqual(liveRoutes(network).map(({ line, code, stops: along }) => [line, code, along.map(stop => stop.code)]), [['040', '1', ['1', '2']]]);
});

test('stops shared with a route count in order, so the way back isn\'t the same route', () => {
    assert.deepEqual(shared(['1', '2', '3'], ['1', '9', '3']), [[0, 0], [2, 2]]);
    assert.equal(shared(['1', '2', '3'], ['3', '2', '1']).length, 1);
});

test('a live route with the same stops keeps the feed\'s times exactly', () => {
    const { buses: out, untimed, gone } = onLive(
        [feed('040', ['1', '2', '3'], [0, 100, 250], H8, H8 + 600)],
        liveNetwork(['040', 'r', 'Α - Β', ['1', '2', '3'].map((code, i) => place(code, i))]),
    );
    // With the OASA route it's on, for measured ride times (rides.js)
    assert.deepEqual(out.routes, [{ line: '040', mode: 'bus', code: 'r', stops: ['1', '2', '3'], profiles: [[0, 100, 250]], trips: [[H8, 0], [H8 + 600, 0]] }]);
    assert.deepEqual(out.stops['2'], [37.98, 23.7, 'Στάση 2']);
    assert.deepEqual([untimed, gone], [[], []]);
});

test('a stop that\'s moved is mended, the rest of the row stays', () => {
    const { buses: out } = onLive(
        [feed('750', ['1', '8', '3', '4'], [0, 100, 400, 500], H8)],
        liveNetwork(['750', 'r', 'Α - Β', [place('1', 0), place('9', 1), place('3', 2), place('4', 3)]]),
    );
    const [route] = out.routes;
    assert.deepEqual(route.stops, ['1', '9', '3', '4']);
    assert.deepEqual(route.profiles, [[0, 200, 400, 500]], 'halfway between its neighbours, by the road');
    assert.equal(out.stops['8'], undefined);
});

test('a live route that starts earlier gets a stop before the feed\'s first, at the trip\'s speed', () => {
    const { buses: out } = onLive(
        [feed('750', ['2', '3', '4'], [0, 300, 600], H8)],
        liveNetwork(['750', 'r', 'Α - Β', ['1', '2', '3', '4'].map((code, i) => place(code, i))]),
    );
    assert.deepEqual(out.routes[0].profiles, [[0, 300, 600, 900]]);
    assert.deepEqual(out.routes[0].trips, [[H8 - 300, 0]]);
});

test('a time past the feed\'s last stop goes on at the trip\'s speed, and one shared stop has none', () => {
    assert.deepEqual(retimed([0, 300], [[0, 0], [1, 1]], [0, 1000, 2000]), [0, 300, 600]);
    assert.deepEqual(retimed([500], [[0, 1]], [0, 1000, 2000]), [500, 500, 500]);
});

test('a list of the feed goes on the route of its line it fits best, the plain one if a variant fits as well', () => {
    const stopsOf = (...codes) => codes.map((code, i) => place(code, i));
    const network = liveNetwork(
        ['822', 'market', 'Α - Β [Λαϊκή κάθε Πέμπτη]', stopsOf('1', '2', '3', '4')],
        ['822', 'plain', 'Α - Β', stopsOf('1', '2', '3', '4')],
        ['822', 'short', 'Α - Β [ΕΩΣ Γ]', stopsOf('1', '2')],
        ['822', 'back', 'Β - Α', stopsOf('4', '3', '2', '1')],
    );
    const { buses: out, untimed } = onLive([
        feed('822', ['1', '2', '3', '4'], [0, 100, 200, 300], H8),
        feed('822', ['1', '2'], [0, 100], H8),
    ], network);
    assert.deepEqual(out.routes.map(route => route.stops.length), [4, 2]);
    assert.deepEqual(untimed.map(route => route.code), ['market', 'back'], 'no times are made up for these');
});

test('a line the live network no longer has is gone, and a route too different isn\'t its stand-in', () => {
    const { buses: out, gone, untimed } = onLive([
        feed('122Θ', ['1', '2'], [0, 100], H8),
        feed('836', ['1', '2', '3', '4', '5'], [0, 100, 200, 300, 400], H8),
    ], liveNetwork(['836', 'r', 'Α - Β', ['1', '7', '8', '9'].map((code, i) => place(code, i))]));
    assert.deepEqual(out.routes, []);
    assert.deepEqual(gone, ['122Θ', '836']);
    assert.deepEqual(untimed.map(route => route.code), ['r']);
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

test('to Peristeri: M3 to Aigaleo, then a bus, gets there first on most departures', () => {
    // The same bus can be reached other ways too: a tie still counts
    const byAigaleo = way => way.legs[0].line === 'M3' && at('rail:aigaleo') === lab.stops[way.legs[0].alight];
    const departures = [];
    for (let now = MORNING.from; now <= MORNING.to; now += MORNING.step) departures.push(waysAt(PERISTERI, now));
    const first = departures.filter(ways => ways.some(way => way.at === ways[0].at && byAigaleo(way)));
    assert.ok(first.length / departures.length >= 0.8, `${first.length} of ${departures.length}`);
});

test('to Peristeri: the 750 from Aigaleo is offered too', () => {
    assert.ok(has(waysAt(PERISTERI, 8.5 * 3600), legs => lines(legs).join() === 'M3,750'));
});

test('to Peristeri: every line from Aigaleo that reaches the door is offered', () => {
    const fromAigaleo = waysAt(PERISTERI, 8.5 * 3600).filter(way => way.legs[0].line === 'M3' && way.legs.length === 2 && at('rail:aigaleo') === lab.stops[way.legs[0].alight]);
    const offered = new Set(fromAigaleo.map(way => way.legs[1].line));
    for (const line of ['703', '891', '845', '750']) assert.ok(offered.has(line), `${line} of ${[...offered]}`);
});

// Each trip's answer for 30 minutes of departures from 08:30, worked out once
const answers = new Map();
const answerAt = id => answers.get(id) ?? answers.set(id, answer(lab, start, towards(id), 8.5 * 3600)).get(id);

test('to Peristeri, leaving at 08:30: one clear way, M3 to Aigaleo, then any of its buses', () => {
    const { kind, clear } = answerAt(PERISTERI);
    assert.equal(kind, 'clear');
    assert.equal(clear.key, 'M3 at Αιγάλεω, a bus');
    for (const line of ['703', '891', '845', '750']) assert.ok(clear.lines.includes(line), `${line} of ${clear.lines}`);
    assert.ok(clear.every <= 360, `a bus every ${clear.every} s`);
});

test('to Kolonos, leaving at 08:30: stay on the M3, offered the 420 from Aigaleo if it comes in time', () => {
    const { kind, decision } = answerAt(KOLONOS);
    assert.equal(kind, 'decision');
    assert.deepEqual(decision.lines, ['420']);
    assert.equal(decision.getOff.way.legs[0].line, 'M3');
    assert.equal(lab.stops[decision.getOff.way.legs[0].alight], at('rail:aigaleo'));
    assert.ok(walkSeconds(at('rail:aigaleo'), lab.stops[decision.stop]) <= 600, 'the 420\'s stop is a walk from the station');
    assert.ok(decision.ready < decision.latest);
    assert.equal(lab.stops[decision.stayOn.way.legs[0].alight], at('rail:syntagma'), 'the directions stay on to Syntagma');
    assert.equal(quickerWay(decision, [], decision.ready).offer, false, 'no 420 predicted: nothing offered');
    assert.equal(quickerWay(decision, [{ line: '420', at: decision.ready }], decision.ready).offer, true);
});

test('to Kallithea, leaving at 08:30: the way ends with any of several buses', () => {
    const [first] = answerAt(KALLITHEA).rows;
    assert.ok(first.bundle, first.lines.join());
});

test('to Kallithea, leaving at 08:30: clearly by M3 and M2 to Syggrou-Fix, then any bus', { todo: 'needs real bus times by stretch and hour: the feed says 2.6 from Syntagma' }, () => {
    const { kind, clear } = answerAt(KALLITHEA);
    assert.equal(kind, 'clear');
    assert.equal(clear.key, 'M3 Σύνταγμα M2 at Συγγρού Φιξ, a bus');
});

test('the test data is on the live routes: short workings there, each trip keeping its order', () => {
    const on = line => buses.routes.filter(route => route.line === line);
    assert.ok(on('822').length >= 3, 'the short workings of the 822');
    assert.ok(on('730').length >= 2);
    for (const { line, profiles } of buses.routes) {
        for (const offsets of profiles) assert.ok(offsets.every((offset, i) => !i || offset >= offsets[i - 1]), `${line}: ${offsets}`);
    }
});
