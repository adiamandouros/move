import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildBusRides, hourOf, readPasses, RIDE_DAYS, ridesFrom, RIDES_SCHEMA } from '../server/data/build-rides.js';
import { checkOutput, shrinkage } from '../server/data/check-output.js';
import { MIN_RIDES, withRides } from '../scripts/planner-lab/rides.js';

// Roadmap Plan 3: how long buses really take between two stops, from the
// buses the server saw pass (decision 26), and the lab's timetable with them.

const S = 1000;
// Athens time in winter, as seconds
const athens = (date, time) => Date.parse(`${date}T${time}+02:00`) / S;
// A route's stops in the live network's shape
const network = routes => ({ stops: Object.fromEntries(Object.entries(routes).map(([code, stops]) => [code, { stops: stops.map(c => ({ code: c })) }])) });
const NET = network({ 100: ['1', '2', '3', '4', '5'], 200: ['5', '4', '3'], 300: ['7', '8', '9', '7', '8'] });
const pass = (stop, at, vehicle = 'v', route = '100', line = 'Α2') => ({ at, stop, route, line, vehicle });

// ── Passes to rides ─────────────────────────────────────────────────────────

test('a bus passing one stop of its route and then a later one is a ride', () => {
    const t = athens('2026-11-03', '08:00:00');
    assert.deepEqual(ridesFrom([pass('4', t + 600), pass('2', t)], NET), [{ route: '100', line: 'Α2', from: '2', to: '4', left: t, seconds: 600 }]);
});

test('no ride from a route\'s first stop, where a bus is seen arriving, not leaving', () => {
    const t = athens('2026-11-03', '08:00:00');
    assert.deepEqual(ridesFrom([pass('1', t), pass('3', t + 600)], NET), []);
});

test('no ride across routes, buses, back along the route, or over 90 minutes', () => {
    const t = athens('2026-11-03', '08:00:00');
    assert.deepEqual(ridesFrom([
        pass('2', t), pass('4', t + 300, 'v', '200'),          // the same bus on its way back
        pass('3', t, 'w'), pass('4', t + 300, 'x'),            // two buses
        pass('4', t, 'y'), pass('2', t + 300, 'y'),            // backwards
        pass('2', t, 'z'), pass('4', t + 91 * 60, 'z'),        // too long
        pass('9', t, 'q', '999'), pass('8', t + 60, 'q', '999'), // a route the network doesn't have
    ], NET), []);
});

test('round a loop, the nearest pair of the two stops in order', () => {
    const t = athens('2026-11-03', '08:00:00');
    assert.deepEqual(ridesFrom([pass('8', t, 'v', '300'), pass('7', t + 120, 'v', '300')], NET).map(r => [r.from, r.to]), [['8', '7']]);
});

test('each ride\'s hour is the kind of day and the hour it left, Athens time', () => {
    assert.equal(hourOf(athens('2026-11-03', '08:59:59')), 'wd 8');
    assert.equal(hourOf(athens('2026-11-07', '23:30:00')), 'sa 23');
    // 23:30 UTC on Saturday is 01:30 on Sunday in Athens
    assert.equal(hourOf(Date.parse('2026-11-07T23:30:00Z') / S), 'su 1');
});

// ── The table ───────────────────────────────────────────────────────────────

test('rides of a stretch at an hour: how many, the median and the slowest tenth, in seconds', () => {
    const t = athens('2026-11-03', '08:00:00');
    const passes = [300, 360, 420, 480, 1200].flatMap((seconds, i) => [pass('2', t + i * 60, `b${i}`), pass('3', t + i * 60 + seconds, `b${i}`)]);
    passes.push(pass('2', athens('2026-11-03', '17:00:00'), 'e'), pass('3', athens('2026-11-03', '17:09:00'), 'e'));
    const { data, warnings } = buildBusRides({ passes, days: ['2026-11-03'] }, NET);
    assert.deepEqual(data, {
        schema: RIDES_SCHEMA, from: '2026-11-03', to: '2026-11-03', days: 1,
        rides: [{ route: '100', line: 'Α2', from: '2', to: '3', times: { 'wd 8': [5, 420, 1200], 'wd 17': [1, 540, 540] } }],
    });
    assert.deepEqual(warnings, []);
    assert.deepEqual(checkOutput('bus-rides.json', data), []);
    // No bus numbers in what's served
    assert.doesNotMatch(JSON.stringify(data), /"b\d"/);
});

test('the checks catch a broken table, and a smaller one is never refused', () => {
    assert.deepEqual(checkOutput('bus-rides.json', { schema: 1 }), ['bus-rides.json: no rides list']);
    assert.match(checkOutput('bus-rides.json', { schema: 1, rides: [{ route: '1', from: '2', to: '3', times: { 'wd 8': [1, 0.5, 2] } }] })[0], /whole seconds/);
    assert.match(checkOutput('bus-rides.json', { schema: 1, rides: [{ route: 'x', from: '2', to: '3', times: {} }] })[0], /bad route/);
    // Rides come and go with the days kept
    assert.deepEqual(shrinkage('bus-rides.json', { rides: [] }, { rides: [1, 2, 3] }), []);
});

test('the passes of the last RIDE_DAYS days are read; anything else in the folder, or a cut line, is left out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wayhop-rides-'));
    const line = (stop, at) => `${JSON.stringify({ at, stop, route: '100', line: 'Α2', vehicle: 'v' })}\n`;
    writeFileSync(join(dir, '2026-11-03.jsonl'), `${line('2', 1)}${line('3', 2)}{"at":`);
    writeFileSync(join(dir, '2026-08-04.jsonl'), line('2', 3)); // RIDE_DAYS + 1 days before
    writeFileSync(join(dir, '2026-11-04.jsonl'), line('2', 4)); // after today
    writeFileSync(join(dir, 'notes.txt'), 'x');
    assert.equal(RIDE_DAYS, 91);
    const read = readPasses(dir, '2026-11-03');
    assert.deepEqual(read.days, ['2026-11-03']);
    assert.deepEqual(read.passes.map(p => p.at), [1, 2]);
    assert.deepEqual(readPasses(join(dir, 'none'), '2026-11-03'), { passes: [], days: [] });
});

// ── The lab's timetable with them ───────────────────────────────────────────

// One route of 4 stops, 2 minutes apart in the feed, a trip at 08:00 and one at 12:00, on a Wednesday
const BUSES = {
    day: 3, stops: {},
    routes: [{ line: 'Α2', mode: 'bus', code: '100', stops: ['1', '2', '3', '4'], profiles: [[0, 120, 240, 360]], trips: [[8 * 3600, 0], [12 * 3600, 0]] }],
};
const table = (from, to, times) => ({ rides: [{ route: '100', from, to, times }] });

test('a measured stretch takes its median, and the stops after it move with it', () => {
    const { buses, retimed } = withRides(BUSES, table('2', '4', { 'wd 8': [MIN_RIDES, 600, 900] }));
    const [route] = buses.routes;
    assert.deepEqual(route.profiles, [[0, 120, 420, 720], [0, 120, 240, 360]]);
    // Only the trip at 08:00: 12:00 has no rides
    assert.deepEqual(route.trips, [[8 * 3600, 0], [12 * 3600, 1]]);
    assert.equal(retimed, 1);
});

test('too few rides, another kind of day, or another route: the feed\'s times stay', () => {
    for (const times of [{ 'wd 8': [MIN_RIDES - 1, 600, 900] }, { 'sa 8': [9, 600, 900] }]) {
        assert.deepEqual(withRides(BUSES, table('2', '4', times)).buses, BUSES);
    }
    assert.deepEqual(withRides(BUSES, { rides: [{ route: '999', from: '2', to: '4', times: { 'wd 8': [9, 600, 900] } }] }).buses, BUSES);
});

test('stretches one after the other both count; one overlapping a measured one doesn\'t', () => {
    const rides = {
        rides: [
            { route: '100', from: '1', to: '2', times: { 'wd 8': [5, 300, 300] } },
            { route: '100', from: '1', to: '3', times: { 'wd 8': [5, 900, 900] } },
            { route: '100', from: '2', to: '4', times: { 'wd 8': [5, 600, 600] } },
        ],
    };
    const [route] = withRides(BUSES, rides).buses.routes;
    assert.deepEqual(route.profiles[route.trips[0][1]], [0, 300, 600, 900]);
});
