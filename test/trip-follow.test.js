import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// My location following the rider on the Trip page (decision 45): when the
// trip is planned again from where they are, and, with Plan 7 (agreed 12
// Nov 2026), where each fix puts them on the way they're on
// (tools/trip/client/follow.js). The page's side: test/browser/location.spec.js.

const follow = await browserModule('tools/trip/client/follow.js');
const { MOVED_METRES, REPLAN_MS, replanDue, waySteps, starting, placeOn, stepOf, offDue, leftStart, stillDue, segmentMeters } = follow;

// Syntagma, and about 0.0009° of latitude to 100 m north of it
const SYNTAGMA = { lat: 37.9755, lng: 23.7348 };
const north = (metres, from = SYNTAGMA) => ({ lat: from.lat + metres / 111_195, lng: from.lng });
const east = (metres, from = SYNTAGMA) => ({ lat: from.lat, lng: from.lng + metres / (111_195 * Math.cos(from.lat * Math.PI / 180)) });
const T = 1_000_000;

test('the numbers agreed for OASA: 200 m from where the trip was planned, at most every 2 minutes', () => {
    assert.equal(MOVED_METRES, 200);
    assert.equal(REPLAN_MS, 120_000);
});

test('planned again once the rider is 200 m or more from where it was planned, and 2 minutes or more after', () => {
    const planned = { ...SYNTAGMA, at: T };
    assert.equal(replanDue(planned, north(200), T + REPLAN_MS), true);
    assert.equal(replanDue(planned, north(2_000), T + 10 * REPLAN_MS), true);
    // Not far enough, however long
    assert.equal(replanDue(planned, north(195), T + 10 * REPLAN_MS), false);
    assert.equal(replanDue(planned, SYNTAGMA, T + 10 * REPLAN_MS), false);
    // Far enough, but too soon, however far: a ride doesn't plan it again every second
    assert.equal(replanDue(planned, north(200), T + REPLAN_MS - 1), false);
    assert.equal(replanDue(planned, north(5_000), T + 1_000), false);
});

test('the distance is from where it was planned, in any direction', () => {
    const planned = { ...SYNTAGMA, at: T };
    assert.equal(replanDue(planned, east(250), T + REPLAN_MS), true);
    assert.equal(replanDue({ ...north(300), at: T }, north(150), T + REPLAN_MS), false);
});

// ── Following the way (Plan 7) ──────────────────────────────────────────────

test('the numbers agreed 12 Nov 2026 for following a ride', () => {
    assert.equal(follow.ROUGH_METRES, 200);
    assert.equal(follow.NEAR_METRES, 100);
    assert.equal(follow.OFF_METRES, 300);
    assert.equal(follow.OFF_MS, 60_000);
    assert.equal(follow.GAP_MS, 120_000);
    assert.equal(follow.LEFT_METRES, 100);
    assert.equal(follow.STILL_METRES, 50);
    assert.equal(follow.STILL_MS, 600_000);
});

test('how far a point is from the straight line between two others, in metres', () => {
    const a = SYNTAGMA;
    const b = north(1_000);
    assert.equal(segmentMeters(north(500), a, b), 0, 'on the line');
    assert.equal(segmentMeters(east(120, north(500)), a, b), 120, 'beside it');
    assert.equal(segmentMeters(north(1_300), a, b), 300, 'past its end: from the end');
    assert.equal(segmentMeters(east(300, north(-400)), a, b), 500, 'before its start: from the start');
    assert.equal(segmentMeters(east(70), a, a), 70, 'a line of no length is its point');
});

// A way of the city's search: 300 m east to the stop, a bus north through 5
// stops 400 m apart (two more past it), 300 m east to the door
const pair = ({ lat, lng }) => [lat, lng];
const BOARD = east(300);
const STOPS = [0, 1, 2, 3, 4].map(i => north(i * 400, BOARD));
const PAST = [5, 6].map(i => north(i * 400, BOARD));
const DOOR = east(300, STOPS[4]);
const bus = { city: true, firstWalk: { minutes: 4, meters: 300 }, lastWalk: { minutes: 4, meters: 300 },
    rides: [{ line: '040', mode: 'bus', along: STOPS.map(pair), past: PAST.map(pair), walkBefore: null }] };
const steps = waySteps(bus, SYNTAGMA, DOOR, null);
const fixAt = (point, at, more = {}) => ({ ...point, at, ...more });
// At the stop a second before `at`, then at `point`: on the bus, at `point`'s stop
const onBus = (point, at, on = steps) => placeOn(on, placeOn(on, starting(), fixAt(BOARD, at - 1_000), at - 1_000), fixAt(point, at), at);

test('a way with a bus as the steps it\'s followed by: the walk, waiting, the ride, the last walk', () => {
    assert.deepEqual(steps, [
        { kind: 'walk', ride: 0, from: SYNTAGMA, to: BOARD },
        { kind: 'wait', ride: 0, at: BOARD },
        { kind: 'ride', ride: 0, points: STOPS, past: PAST },
        { kind: 'last', from: STOPS[4], to: DOOR },
    ]);
    // Starting at the stop, and getting off at the door: no walks
    const atStops = { ...bus, firstWalk: null, lastWalk: null };
    assert.deepEqual(waySteps(atStops, BOARD, STOPS[4], null).map(step => step.kind), ['wait', 'ride']);
    // A change: the walk between rides is a step; the same stop isn't
    const change = { ...bus, rides: [bus.rides[0], { line: '106', mode: 'bus', along: [pair(STOPS[4]), pair(north(400, STOPS[4]))], past: [], walkBefore: null },
        { line: '136', mode: 'bus', along: [pair(east(200, STOPS[4])), pair(DOOR)], past: [], walkBefore: { minutes: 3, meters: 200 } }] };
    assert.deepEqual(waySteps(change, SYNTAGMA, DOOR, null).map(step => step.kind), ['walk', 'wait', 'ride', 'wait', 'ride', 'walk', 'wait', 'ride', 'last']);
});

test('a metro option as its steps, the stations from rail: the walk to the station, each ride\'s stations, the walk between, the walk to the door', () => {
    const station = (id, point) => [id, { coords: pair(point) }];
    const rail = {
        stations: Object.fromEntries([station('a', BOARD), station('b', STOPS[1]), station('c', STOPS[2]), station('d', STOPS[3]), station('e', STOPS[4]), station('f', east(200, STOPS[4]))]),
        lines: { M1: { directions: { up: { stops: ['a', 'b', 'c', 'd', 'e'].map(id => ({ station: id })) } } }, M2: { directions: { out: { stops: ['f', 'e', 'd'].map(id => ({ station: id })) } } } },
    };
    const metro = { city: false, start: { station: 'a', walk: { minutes: 4 } }, end: { station: 'd', walk: { minutes: 4 } },
        plan: { legs: [{ line: 'M1', dir: 'up', from: 'a', to: 'c', fromIndex: 0, toIndex: 2 }, { line: 'M2', dir: 'out', from: 'f', to: 'd', fromIndex: 0, toIndex: 2 }] } };
    assert.deepEqual(waySteps(metro, SYNTAGMA, DOOR, rail), [
        { kind: 'walk', ride: 0, from: SYNTAGMA, to: BOARD },
        { kind: 'wait', ride: 0, at: BOARD },
        { kind: 'ride', ride: 0, points: [BOARD, STOPS[1], STOPS[2]], past: [STOPS[3], STOPS[4]] },
        { kind: 'walk', ride: 1, from: STOPS[2], to: east(200, STOPS[4]) },
        { kind: 'wait', ride: 1, at: east(200, STOPS[4]) },
        { kind: 'ride', ride: 1, points: [east(200, STOPS[4]), STOPS[4], STOPS[3]], past: [] },
        { kind: 'last', from: STOPS[3], to: DOOR },
    ]);
    // A walk from the first station to the line, and from the line to the last station (plan.js walkFirst, walkLast)
    const walked = { ...metro, start: { station: 'b', walk: null }, plan: { ...metro.plan, legs: [metro.plan.legs[0]], walkFirst: 3, walkLast: 5 }, end: { station: 'd', walk: null } };
    assert.deepEqual(waySteps(walked, BOARD, STOPS[3], rail).map(step => [step.kind, step.ride]), [['walk', 0], ['wait', 0], ['ride', 0], ['walk', 1]]);
});

test('through a metro station\'s exits (decision 51): a walk into it ends at its way in, one out of it starts at its way out; a walk from the door past a station to a stop beside it doesn\'t', () => {
    const station = (id, point, exits) => [id, { coords: pair(point), ...exits && { exits } }];
    const IN = north(80, BOARD);
    const OUT = east(60, STOPS[2]);
    const rail = {
        stations: Object.fromEntries([station('a', BOARD, [{ at: pair(IN) }]), station('b', STOPS[1]), station('c', STOPS[2], [{ at: pair(north(50, STOPS[2])) }, { at: pair(OUT) }]), station('t', east(200, STOPS[2]))]),
        lines: { M1: { directions: { up: { stops: ['a', 'b', 'c'].map(id => ({ station: id })) } } }, T1: { directions: { out: { stops: ['t', 'b'].map(id => ({ station: id })) } } } },
        walkExits: { c: { t: 1 }, t: { c: 1 } },
    };
    const metro = { city: false, start: { station: 'a', walk: { minutes: 4, in: 0 } }, end: { station: 'c', walk: { minutes: 4, out: 1 } },
        plan: { legs: [{ line: 'M1', dir: 'up', from: 'a', to: 'c', fromIndex: 0, toIndex: 2 }] } };
    const steps = waySteps(metro, SYNTAGMA, DOOR, rail);
    assert.deepEqual([steps[0].to, steps.at(-1).from], [IN, OUT]);
    // Off the M1 at c, out by its exit to the tram, as tram.json says
    const toTram = { ...metro, end: { station: 't', walk: null }, plan: { legs: [metro.plan.legs[0], { line: 'T1', dir: 'out', from: 't', to: 'b', fromIndex: 0, toIndex: 1 }] } };
    assert.deepEqual(waySteps(toTram, SYNTAGMA, DOOR, rail)[3], { kind: 'walk', ride: 1, from: OUT, to: east(200, STOPS[2]) });
    // From the door to c, then on foot to the tram stop beside it: never through c's exits
    const pastIt = { city: false, start: { station: 'c', walk: { minutes: 3, in: 0 } }, end: { station: 'b', walk: null }, plan: { legs: [toTram.plan.legs[1]], walkFirst: 4 } };
    assert.deepEqual(waySteps(pastIt, SYNTAGMA, DOOR, rail).slice(0, 2).map(step => [step.from, step.to]), [[SYNTAGMA, STOPS[2]], [STOPS[2], east(200, STOPS[2])]]);
    // A way of the city's search: its walks say the exits of the stops they leave and walk into
    const exits = [{ at: pair(IN) }];
    const city = { ...bus, firstWalk: { minutes: 3, meters: 200, in: 0 }, lastWalk: { minutes: 4, meters: 300, out: 0 },
        rides: [{ ...bus.rides[0], board: { exits }, alight: { exits: [{ at: pair(OUT) }] } }] };
    const followed = waySteps(city, SYNTAGMA, DOOR, null);
    assert.deepEqual([followed[0].to, followed.at(-1).from], [IN, OUT]);
});

test('each fix places the rider: along the walk, at the stop, on the bus stop by stop, off at the last, to the door', () => {
    let state = starting();
    const place = (point, at, more) => { state = placeOn(steps, state, fixAt(point, at, more), at); return state; };
    const kind = () => stepOf(steps, state).kind;

    place(SYNTAGMA, T);
    assert.equal(kind(), 'walk');
    assert.deepEqual([state.moved, state.off, state.at], [false, false, T]);
    place(east(150), T + 60_000);
    assert.equal(kind(), 'walk');
    assert.equal(state.moved, false);
    // At the stop (within 100 m): waiting
    place(east(240), T + 120_000);
    assert.equal(kind(), 'wait');
    assert.deepEqual([state.moved, state.at], [true, T + 120_000]);
    // Drifting 80 m while waiting isn't boarding
    place(north(80, BOARD), T + 180_000);
    assert.equal(kind(), 'wait');
    // Nearer the next stop than the one waited at: on the bus
    place(north(300, BOARD), T + 240_000);
    assert.equal(kind(), 'ride');
    assert.deepEqual([state.stop, state.moved], [1, true]);
    place(north(850, BOARD), T + 300_000);
    assert.deepEqual([state.stop, state.moved], [2, true]);
    // A wander 150 m to the side of the road: the same stop, not off
    place(east(150, STOPS[2]), T + 330_000);
    assert.deepEqual([state.stop, state.moved, state.off, state.offSince], [2, false, false, null]);
    // GPS behind the bus never moves the rider back
    place(north(500, BOARD), T + 360_000);
    assert.equal(state.stop, 2);
    place(north(1250, BOARD), T + 420_000);
    assert.equal(state.stop, 3);
    // At the last stop: off the bus, on the last walk
    place(north(1620, BOARD), T + 480_000);
    assert.equal(kind(), 'last');
    assert.equal(state.moved, true);
    place(east(150, STOPS[4]), T + 540_000);
    assert.equal(kind(), 'last');
    place(east(260, STOPS[4]), T + 600_000);
    assert.equal(kind(), 'arrived');
    assert.deepEqual([state.moved, state.off], [true, false]);
    // Arrived, nothing more happens
    place(north(400, DOOR), T + 660_000);
    assert.deepEqual([kind(), state.off], ['arrived', false]);
});

test('a fix at the stop ends the walk and starts the wait in one go; one past the first stop boards at once', () => {
    const state = placeOn(steps, starting(), fixAt(BOARD, T), T);
    assert.equal(stepOf(steps, state).kind, 'wait');
    const boarded = placeOn(steps, state, fixAt(north(1_200, BOARD), T + 60_000), T + 60_000);
    assert.deepEqual([stepOf(steps, boarded).kind, boarded.stop], ['ride', 3]);
});

test('off the way: over 300 m from every point of the step for a minute; back within it, forgotten', () => {
    let state = onBus(north(850, BOARD), T);
    assert.equal(state.stop, 2);
    const aside = east(350, STOPS[2]);
    state = placeOn(steps, state, fixAt(aside, T + 10_000), T + 10_000);
    assert.deepEqual([state.off, state.offSince], [false, T + 10_000]);
    state = placeOn(steps, state, fixAt(aside, T + 50_000), T + 50_000);
    assert.equal(state.off, false, 'not a minute yet');
    // Back near the road: forgotten
    state = placeOn(steps, state, fixAt(east(100, STOPS[2]), T + 55_000), T + 55_000);
    assert.deepEqual([state.off, state.offSince], [false, null]);
    state = placeOn(steps, state, fixAt(aside, T + 60_000), T + 60_000);
    // No fix since (a phone standing still): off once the minute has gone by
    assert.equal(offDue(state, T + 119_000), false);
    assert.equal(offDue(state, T + 120_000), true);
    state = placeOn(steps, state, fixAt(aside, T + 120_000), T + 120_000);
    assert.equal(state.off, true);
    assert.equal(offDue(state, T + 120_000), true);
    assert.equal(offDue(starting(), T), false);
    // On the walk, it's the distance from the straight line, not the ends
    let walking = placeOn(steps, starting(), fixAt(north(250, east(150)), T), T);
    assert.deepEqual([walking.off, walking.offSince], [false, null]);
    walking = placeOn(steps, walking, fixAt(north(320, east(150)), T + 1_000), T + 1_000);
    assert.equal(walking.offSince, T + 1_000);
});

test('after two minutes without a fix (underground), one fix that doesn\'t fit is enough', () => {
    let state = placeOn(steps, starting(), fixAt(BOARD, T), T);
    assert.equal(stepOf(steps, state).kind, 'wait');
    // A fix 119 s later is weighed as any other
    const nearly = placeOn(steps, state, fixAt(east(500, BOARD), T + 119_000), T + 119_000);
    assert.deepEqual([nearly.off, nearly.offSince], [false, T + 119_000]);
    state = placeOn(steps, state, fixAt(east(500, BOARD), T + 121_000), T + 121_000);
    assert.equal(state.off, true);
    // One that fits after the gap places them as usual
    const fits = placeOn(steps, placeOn(steps, starting(), fixAt(BOARD, T), T), fixAt(north(1_250, BOARD), T + 600_000), T + 600_000);
    assert.deepEqual([stepOf(steps, fits).kind, fits.stop, fits.off], ['ride', 3, false]);
});

test('riding past the stop: nearer a stop after it than to it, off at once', () => {
    let state = onBus(north(1_250, BOARD), T);
    assert.equal(state.stop, 3);
    // Just past the last stop, still nearer it: not yet
    state = placeOn(steps, state, fixAt(north(1_690, BOARD), T + 30_000), T + 30_000);
    assert.deepEqual([stepOf(steps, state).kind, state.off], ['last', false]);
    // Nearer the stop after it
    const past = placeOn(steps, onBus(north(1_250, BOARD), T), fixAt(north(1_900, BOARD), T + 30_000), T + 30_000);
    assert.deepEqual([stepOf(steps, past).kind, past.off], ['ride', true]);
    // A ride with no stops after it (the line ends there) can't be ridden past
    const ending = waySteps({ ...bus, rides: [{ ...bus.rides[0], past: [] }] }, SYNTAGMA, DOOR, null);
    const end = placeOn(ending, onBus(north(1_250, BOARD), T, ending), fixAt(north(1_900, BOARD), T + 30_000), T + 30_000);
    assert.deepEqual([stepOf(ending, end).kind, end.off], ['last', false]);
});

test('a rough fix (over 200 m) places nobody and isn\'t remembered', () => {
    const state = placeOn(steps, starting(), fixAt(BOARD, T), T);
    const rough = placeOn(steps, state, fixAt(north(1_250, BOARD), T + 60_000, { accuracy: 250 }), T + 60_000);
    assert.deepEqual([rough.step, rough.stop, rough.moved, rough.off, rough.fix], [state.step, state.stop, false, false, state.fix]);
    const fine = placeOn(steps, state, fixAt(north(1_250, BOARD), T + 60_000, { accuracy: 199 }), T + 60_000);
    assert.equal(fine.stop, 3);
});

test('left the start at 100 m; standing still 10 minutes with the page untouched as long pauses', () => {
    assert.equal(leftStart(north(99), SYNTAGMA), false);
    assert.equal(leftStart(north(100), SYNTAGMA), true);

    let state = placeOn(steps, starting(), fixAt(SYNTAGMA, T), T);
    assert.deepEqual(state.anchor, { ...SYNTAGMA, at: T });
    // 40 m on: still where they were
    state = placeOn(steps, state, fixAt(east(40), T + 300_000), T + 300_000);
    assert.equal(state.anchor.at, T);
    assert.equal(stillDue(state, T, T + 599_000), false);
    assert.equal(stillDue(state, T, T + 600_000), true);
    // Touched 5 minutes ago: not paused, however still
    assert.equal(stillDue(state, T + 300_000, T + 600_000), false);
    // 50 m on: moving
    state = placeOn(steps, state, fixAt(east(90), T + 400_000), T + 400_000);
    assert.deepEqual(state.anchor, { ...east(90), at: T + 400_000 });
    assert.equal(stillDue(state, T, T + 600_000), false);
    assert.equal(stillDue(starting(), T, T + 600_000), false, 'no fix yet: not still');
});

test('switched to a way that leaves the bus sooner, or back: still on the bus at the same stop; a way that isn\'t the same there starts over', () => {
    // Off at the third stop for a 106 there
    const sooner = { ...bus, lastWalk: null, rides: [{ ...bus.rides[0], along: STOPS.slice(0, 3).map(pair), past: [] },
        { line: '106', mode: 'bus', along: [pair(STOPS[2]), pair(DOOR)], past: [], walkBefore: null }] };
    const switched = waySteps(sooner, SYNTAGMA, DOOR, null);
    const riding = onBus(STOPS[1], T);
    assert.equal(riding.step, 2);
    const carried = follow.carry(steps, riding, switched);
    assert.deepEqual([carried.step, carried.stop], [2, 1], 'on the bus at its second stop');
    assert.equal(stepOf(switched, carried).kind, 'ride');
    assert.deepEqual(carried.fix, riding.fix);
    // Further along than the new way rides: at its last stop, so the next fix gets them off
    const further = follow.carry(steps, onBus(STOPS[3], T), switched);
    assert.equal(further.stop, 2);
    // And back again
    assert.deepEqual(follow.carry(switched, carried, steps).stop, 1);
    // A way that isn't the same where they are: from its start, where the last fix had them
    const other = waySteps({ ...bus, firstWalk: null }, SYNTAGMA, DOOR, null);
    const over = follow.carry(steps, riding, other);
    assert.deepEqual([over.step, over.stop, over.at], [0, 0, riding.fix.at]);
    assert.deepEqual(over, follow.startOver(riding));
});
