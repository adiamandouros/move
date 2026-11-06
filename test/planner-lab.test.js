import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { cutToBox, dayOf } from '../scripts/planner-lab/build-buses.js';
import { AFTER_WALK_SECONDS, CHANGE_SECONDS, createPlanner, joinNetwork, walkSeconds } from '../tools/subway/client/city.js';
import { askOnce, rushTest, STOPS } from '../scripts/planner-lab/rush-test.js';
import { answer, lateness, quickerWay, rowKey } from '../tools/subway/client/answer.js';
import { cost } from '../tools/subway/client/weights.js';
import { acrossWindow, describeWay, fastest, findWays, fold, secondsTo, spine, wayKey } from '../tools/subway/client/ways.js';

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

test('with the door given, what gets somewhere after its best is left out, and the door\'s answers stay', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, B], [minutes(0), minutes(5)]),
        ride('Bus', [B, D], [minutes(10), minutes(15)]),
        ride('Same', [A, D], [minutes(2), minutes(15)]),
        ride('Late', [A, E], [minutes(5), minutes(40)]),
    ] });
    const door = [D, 60];
    planner.search(from(A), H8);
    const without = [1, 2].map(rides => planner.arrival(door, rides));
    const way = fastest(planner, from(A), door);
    assert.equal(planner.arrival(to(E)).at, minutes(40));
    planner.search(from(A), H8, { egress: door });
    assert.equal(planner.arrival(to(E)).at, null, 'past 08:16 at the door: no use');
    assert.deepEqual([1, 2].map(rides => planner.arrival(door, rides)), without);
    assert.deepEqual(fastest(planner, from(A), door), way, 'as early with one ride: the same way is chosen');
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
const decisionAt = (busLine = '420', mode = 'bus', [leaves, arrives] = [9, 19], first = ride('M3', [A, B, C], ...[0, 10, 20].map(t => [minutes(t), minutes(t + 5), minutes(t + 10)]))) => createPlanner({ stops, routes: [
    first,
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

test('the same bus can be the first ride of a decision too', () => {
    const bus = { ...ride('750', [A, B, C], ...[0, 10, 20].map(t => [minutes(t), minutes(t + 5), minutes(t + 10)])), mode: 'bus' };
    const { kind, decision } = answer(decisionAt('420', 'bus', [9, 19], bus), from(A), to(D), H8, FIVE);
    assert.equal(kind, 'decision');
    assert.equal(decision.stayOn.key, '750 C M2');
    assert.equal(decision.getOff.key, '750 at B, a bus');
    assert.equal(decision.reaches, minutes(5));
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

test('on a bus, how late your own bus is counts: later to the change, and later staying on', () => {
    // By the timetable the 750 reaches the change at 08:05
    const decision = { lines: ['420'], ready: minutes(8), latest: minutes(15), reaches: minutes(5) };
    const bus = at => ({ line: '420', at });
    assert.equal(quickerWay(decision, [bus(minutes(10))], H8).offer, true, 'by the timetable, it\'s caught');
    // OASA has the 750 there at 08:07, so 08:08 as a rule: 3 minutes late
    const here = minutes(7);
    assert.deepEqual(quickerWay(decision, [bus(minutes(10))], H8, { here }), { offer: false, why: 'missed' });
    assert.deepEqual(quickerWay(decision, [bus(minutes(12))], H8, { here }), { offer: true, why: 'quicker', line: '420', at: minutes(12), sooner: 300 }, 'staying on is late too');
    assert.equal(quickerWay(decision, [bus(minutes(10))], H8, { here: minutes(4) }).sooner, 240, 'on time, or early, is the timetable');
});

test('the same rides on another timetable: the first trip of each line, once in from the ride before', () => {
    const routes = (late = 0) => [
        ride('M3', [A, C], [minutes(0), minutes(5)]),
        { ...ride('420', [C2, D], [minutes(10), minutes(15)], [minutes(20), minutes(25)], [minutes(30), minutes(35)]), mode: 'bus' },
        { ...ride('Bus', [A, B], [minutes(0), minutes(5 + late)]), mode: 'bus' },
        ride('M1', [B, D], [minutes(9), minutes(14)], [minutes(19), minutes(24)]),
    ];
    const usual = createPlanner({ stops, routes: routes() });
    usual.search(from(A), H8);
    const [way] = findWays(usual, from(A), to(D), H8).filter(w => w.legs[0].line === 'M3');
    const timed = usual.ride(way.legs, H8);
    assert.deepEqual(timed.map(({ line, boards, arrives, next }) => [line, boards, arrives, next]), [['M3', H8, minutes(5), null], ['420', minutes(10), minutes(15), minutes(20)]]);
    // A bus that's 3 minutes later misses its change and takes the next train
    const late = createPlanner({ stops, routes: routes(3) });
    const legs = [{ line: 'Bus', mode: 'bus', board: A, alight: B, boards: H8, arrives: minutes(5), walkBefore: 0 }, { line: 'M1', mode: 'metro', board: B, alight: D, boards: minutes(9), arrives: minutes(14), walkBefore: 0 }];
    assert.deepEqual(late.ride(legs, H8).map(leg => leg.arrives), [minutes(8), minutes(24)]);
    assert.equal(late.ride(legs, minutes(1)), null, 'the bus has gone');
});

test('what a way costs: its bad-day arrival, walking at 1.5, 3 minutes a change, and a tight walked change\'s risk', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M3', [A, C], [minutes(0), minutes(5)]),
        { ...ride('420', [C2, D], [minutes(10), minutes(15)], [minutes(25), minutes(30)]), mode: 'bus' },
    ] });
    const walk = walkSeconds(stops[C], stops[C2]);
    const legs = [
        { line: 'M3', mode: 'metro', board: A, alight: C, boards: H8, arrives: minutes(5), walkBefore: 0 },
        { line: '420', mode: 'bus', board: C2, alight: D, boards: minutes(10), arrives: minutes(15), walkBefore: walk },
    ];
    const way = { legs, walked: walk, at: minutes(15) + 120, walk: walk + 120 };
    // 15 minutes and 2 on foot to the door, a change, half of all the walking again
    assert.equal(cost(planner, way, H8, from(A), [D, 120]), 17 * 60 + 180 + 0.5 * (walk + 120));
    // On a bad day the 420 takes 10, not 5
    const bad = createPlanner({ stops, routes: [
        ride('M3', [A, C], [minutes(0), minutes(5)]),
        { ...ride('420', [C2, D], [minutes(10), minutes(20)], [minutes(25), minutes(35)]), mode: 'bus' },
    ] });
    assert.equal(cost(bad, way, H8, from(A), [D, 120]) - cost(planner, way, H8, from(A), [D, 120]), 300);
    // Off the train with the walk and 30 seconds to spare: half the 15 minutes to the next 420
    const in30 = Math.round(minutes(10) - walk - AFTER_WALK_SECONDS - 30);
    const tight = createPlanner({ stops, routes: [
        ride('M3', [A, C], [minutes(0), in30]),
        { ...ride('420', [C2, D], [minutes(10), minutes(15)], [minutes(25), minutes(30)]), mode: 'bus' },
    ] });
    assert.equal(cost(tight, way, H8, from(A), [D, 120]) - cost(planner, way, H8, from(A), [D, 120]), 450);
    // The last 420 of the day: as bad as an hour's wait
    const last = createPlanner({ stops, routes: [
        ride('M3', [A, C], [minutes(0), in30]),
        { ...ride('420', [C2, D], [minutes(10), minutes(15)]), mode: 'bus' },
    ] });
    assert.equal(Math.round(cost(last, way, H8, from(A), [D, 120]) - cost(planner, way, H8, from(A), [D, 120])), 1800);
    assert.equal(cost(planner, way, minutes(11), from(A), [D, 120]), Infinity, 'the train has gone');
});

test('the weights only put rows in order: a way 3 minutes quicker with a 10-minute walk comes second, and real times still say what\'s quickest', () => {
    const every5 = (from, to) => [0, 5, 10, 15, 20].map(t => [minutes(t + from), minutes(t + to)]);
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, D], ...every5(2, 24)),
        { ...ride('750', [B, D], ...every5(11, 21)), mode: 'bus' },
    ] });
    const { kind, rows, clear } = answer(planner, [A, 0, B, 600], to(D), H8, FIVE);
    assert.deepEqual(rows.map(row => [row.key, row.first]), [['M1', 0], ['a bus from the start', 1]]);
    assert.deepEqual(rows.map(row => row.range), [[24, 24], [21, 21]]);
    assert.equal(kind, 'clear');
    assert.equal(clear, rows[0], 'both within a tie of the quickest: the first in order');
});

test('a way found on few departures goes to the end, whatever it costs when it\'s there', () => {
    const planner = createPlanner({ stops, routes: [
        ride('M1', [A, D], ...[0, 5, 10, 15, 20].map(t => [minutes(t + 1), minutes(t + 30)])),
        { ...ride('Once', [A, D], [minutes(1), minutes(10)]), mode: 'bus' },
    ] });
    const { rows } = answer(planner, from(A), to(D), H8, FIVE);
    assert.deepEqual(rows.map(row => [row.key, row.cost]), [['M1', 30 * 60], ['a bus from the start', Infinity]]);
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

test('the lab searches a day of the app\'s bus week, with the live network\'s stops', () => {
    const network = { stops: { r: { stops: [{ code: '1', el: 'Α', lat: 37.98, lng: 23.7 }, { code: '2', el: 'Β', lat: 37.99, lng: 23.7 }] } } };
    const routes = [
        { line: '040', mode: 'bus', code: 'r', stops: ['1', '2'], profiles: [[0, 300]], patterns: [[], [[H8, 0]]], days: [0, 1, 1, 1, 1, 1, 0] },
        { line: 'Χ95', mode: 'bus', code: 's', stops: ['1', '2'], profiles: [[0, 60]], patterns: [[[H8, 0]], []], days: [0, 1, 1, 1, 1, 1, 0] },
    ];
    assert.deepEqual(dayOf(routes, network, 3), {
        day: 3,
        stops: { 1: [37.98, 23.7, 'Α'], 2: [37.99, 23.7, 'Β'] },
        routes: [{ line: '040', mode: 'bus', code: 'r', stops: ['1', '2'], profiles: [[0, 300]], trips: [[H8, 0]] }],
    }, 'a route with no trips that day is left out');
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

test('with the door given, the search answers the same on the real network, lines banned too', () => {
    const answers = (egress, now, ban, door) => {
        lab.search(start, now, { ban, egress: door });
        const way = fastest(lab, start, egress);
        return { rides: [1, 2, 3, 4, 5, 6].map(rides => lab.arrival(egress, rides)), way };
    };
    for (const id of [KALLITHEA, KOLONOS, PERISTERI]) {
        const egress = towards(id);
        for (const now of [7.5, 8.5, 13, 23].map(hour => hour * 3600)) {
            const plain = answers(egress, now, new Set(), null);
            assert.deepEqual(answers(egress, now, new Set(), egress), plain, `${id} at ${now}`);
            for (const leg of plain.way?.legs ?? []) {
                const ban = new Set([leg.line]);
                assert.deepEqual(answers(egress, now, ban, egress), answers(egress, now, ban, null), `${id} at ${now} without ${leg.line}`);
            }
        }
    }
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
