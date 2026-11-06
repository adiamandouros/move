import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBuses, TIMETABLE_SCHEMA } from '../server/data/bus-timetable.js';
import { busDay, createPlanner, joinNetwork } from '../tools/subway/client/city.js';

// The whole city for the trip search (tools/subway/client/city.js): a day of
// buses.json as the search reads it. The search itself, its walks and the
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
