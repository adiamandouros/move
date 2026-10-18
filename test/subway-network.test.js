import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athensNow, departures, findRoutes, isTimetableExpired, legPositions, nextDay, planJourney, planTrip } from '../tools/subway/client/network.js';

const H = 3600;
const everyDay = patternIndex => [0, 0, 0, 0, 0, 0, 0].map(() => patternIndex);

// Two lines crossing at x:  A —(L1)— x —(L1)— B,  x —(L2)— C
// One direction each, which is all the routing needs.
const rail = {
    feed: { validTo: '2026-08-31' },
    stations: {
        a: { lines: ['L1'], coords: [37.9, 23.6] },
        x: { lines: ['L1', 'L2'], coords: [38.0, 23.7] },
        b: { lines: ['L1'], coords: [38.1, 23.8] },
        c: { lines: ['L2'], coords: [38.0, 23.9] },
    },
    lines: {
        L1: {
            directions: {
                east: {
                    stops: [
                        { station: 'a', exits: ['front'] },
                        { station: 'x', exits: ['back'], elevators: ['center'], transfers: { 'L2/east': ['center-front'] } },
                        { station: 'b', exits: ['center'] },
                    ],
                    timetable: {
                        // Full trips a→x→b (5 + 5 min) and short trips a→x
                        profiles: [{ stops: [0, 1, 2], offsets: [0, 300, 600] }, { stops: [0, 1], offsets: [0, 300] }],
                        patterns: [[[8 * H, 0], [8 * H + 20, 0], [8 * H + 600, 1], [9 * H, 0], [24.5 * H, 0]]],
                        days: everyDay(0),
                    },
                },
            },
        },
        L2: {
            directions: {
                east: {
                    stops: [{ station: 'x', exits: [] }, { station: 'c', exits: ['back'] }],
                    timetable: {
                        profiles: [{ stops: [0, 1], offsets: [0, 240] }],
                        patterns: [[[8 * H + 400, 0], [8 * H + 600, 0], [8 * H + 900, 0]]],
                        days: everyDay(0),
                    },
                },
            },
        },
    },
};

test('findRoutes prefers direct routes and otherwise changes at interchanges', () => {
    assert.deepEqual(findRoutes(rail, 'a', 'b'), [{ legs: [{ line: 'L1', dir: 'east', from: 'a', to: 'b', fromIndex: 0, toIndex: 2 }] }]);
    const [route] = findRoutes(rail, 'a', 'c');
    assert.equal(route.via, 'x');
    assert.deepEqual(route.legs.map(l => `${l.line}:${l.from}-${l.to}`), ['L1:a-x', 'L2:x-c']);
    assert.deepEqual(findRoutes(rail, 'b', 'a'), []); // only one direction in the fixture
    assert.deepEqual(findRoutes(rail, 'a', 'a'), []);
});

test('departures skip near-duplicates, short trips and past trains, and flag the last ones', () => {
    const [leg] = findRoutes(rail, 'a', 'b')[0].legs;
    const deps = departures(rail, leg, { weekday: 3, after: 8 * H, count: 5 });
    assert.deepEqual(deps.map(d => d.departs), [8 * H, 9 * H, 24.5 * H]);
    assert.equal(deps[1].isSecondLast, true);
    assert.equal(deps[2].isLast, true);
});

test("departures include yesterday's trains that run past midnight", () => {
    const [leg] = findRoutes(rail, 'a', 'b')[0].legs;
    const [first] = departures(rail, leg, { weekday: 4, after: 0 });
    assert.equal(first.departs, 0.5 * H);
    assert.equal(first.isLast, true);
});

test('planJourney times the second leg from the first arrival plus a change', () => {
    const [plan] = planJourney(rail, 'a', 'c', { weekday: 3, seconds: 8 * H });
    // Arrive at x 08:05, change takes 3 min, so 08:06:40 is missed and 08:10 is the first train
    assert.equal(plan.legs[1].departures[0].departs, 8 * H + 600);
    assert.equal(plan.arrives, 8 * H + 840);
});

test('planTrip plans for now while a route still gets there today', () => {
    const now = { weekday: 3, seconds: 8 * H, date: '2026-10-14' };
    const trip = planTrip(rail, 'a', 'c', now);
    assert.equal(trip.tomorrow, false);
    assert.equal(trip.now, now);
    assert.equal(trip.plans[0].arrives, 8 * H + 840);
});

test("after the last train, planTrip plans tomorrow's first trains of the day", () => {
    // 10:00: line 1 still runs (until 00:30) but line 2's last train left at 08:15
    const trip = planTrip(rail, 'a', 'c', { weekday: 3, seconds: 10 * H, date: '2026-10-14' });
    assert.equal(trip.tomorrow, true);
    assert.deepEqual(trip.now, { weekday: 4, seconds: 0, date: '2026-10-15' });
    // Not tonight's 00:30 on line 1 (that would mean waiting at x until 08:06),
    // but tomorrow's 08:00, which makes the 08:10 change
    const [plan] = trip.plans;
    assert.deepEqual(plan.legs.map(l => l.departures[0].departs), [8 * H, 8 * H + 600]);
    assert.equal(plan.arrives, 8 * H + 840);
    // A direct trip after its last train is planned for tomorrow too
    const direct = planTrip(rail, 'a', 'b', { weekday: 3, seconds: 24.6 * H, date: '2026-10-14' });
    assert.equal(direct.tomorrow, true);
    assert.equal(direct.plans[0].legs[0].departures[0].departs, 8 * H);
    // No route at all: nothing to plan for tomorrow either
    assert.deepEqual(planTrip(rail, 'b', 'a', { weekday: 3, seconds: 10 * H, date: '2026-10-14' }).plans, []);
});

test('nextDay moves to the next date and weekday, over months and years', () => {
    assert.deepEqual(nextDay({ weekday: 6, seconds: 80_000, date: '2026-10-31' }), { weekday: 0, seconds: 0, date: '2026-11-01' });
    assert.deepEqual(nextDay({ weekday: 4, seconds: 1, date: '2026-12-31' }), { weekday: 5, seconds: 0, date: '2027-01-01' });
});

test('legPositions uses transfer positions at interchanges', () => {
    const [first, second] = findRoutes(rail, 'a', 'c')[0].legs;
    assert.deepEqual(legPositions(rail, first, second).exits, ['center-front']);
    assert.deepEqual(legPositions(rail, first, null).exits, ['back']);
    assert.deepEqual(legPositions(rail, first, second).elevators, ['center']);
});

test('athensNow converts to Athens time and the expiry check uses Athens dates', () => {
    const now = athensNow(new Date('2026-10-03T21:30:00Z')); // 00:30 Sunday in Athens (UTC+3)
    assert.deepEqual(now, { weekday: 0, seconds: 0.5 * H, date: '2026-10-04' });
    assert.equal(isTimetableExpired(rail, now), true);
    assert.equal(isTimetableExpired(rail, { date: '2026-08-31' }), false);
});
