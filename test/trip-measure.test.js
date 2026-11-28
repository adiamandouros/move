import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// Times measured by riders, on the phone (decision 84,
// tools/trip/client/measure.js): what a followed metro or tram ride's
// positions say happened at and between its stops. The metro's from the two
// traces of 27 November 2026 (the ride only: from waiting on the platform
// on), the tram's from GPS positions made up here. The page's side:
// test/browser/rider-times.spec.js; the server's: test/rider-times.test.js.

const { measure, reportOf, targetsOf, dayType, holidays, byOf, GPS_METRES, STOP_METRES, STOPPED_SPEED, MOVING_SPEED, AFTER_MS, AWAY_METRES, MOST } = await browserModule('tools/trip/client/measure.js');
const { placeOn, starting } = await browserModule('tools/trip/client/follow.js');

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/rider-times/${name}.json`, import.meta.url), 'utf8'));

// A metro or tram ride as the page follows it: waiting at its first stop,
// then riding it, then the walk to the door
const rideSteps = points => [
    { kind: 'wait', ride: 0, at: points[0] },
    { kind: 'ride', ride: 0, points, past: [], close: false },
    { kind: 'last', from: points.at(-1), to: points.at(-1) },
];

// Every fix of `fixes` placed on `steps` (follow.js), then measured, as the
// controller does; the reports that came, and what's measured at the end
function replay(steps, targets, fixes) {
    let state = { ...starting(), step: 0 };
    let m = null;
    const reports = [];
    for (const fix of fixes) {
        state = placeOn(steps, state, fix, fix.got ?? fix.at);
        const next = measure(m, { steps, state, targets, fix });
        m = next.measuring;
        if (next.report) reports.push(next.report);
    }
    return { reports, measuring: m };
}

function traced(name) {
    const f = fixture(name);
    const steps = rideSteps(f.points);
    const targets = [{ line: f.line, dir: f.dir, stops: f.stops, points: f.points }];
    return { f, ...replay(steps, targets, f.fixes) };
}

test('the numbers: GPS is 30 m or better with a speed; at a stop within 60 m, standing under 1 m/s, moving over 4; past the last stop, 3 minutes or 300 m at most; 40 stretches and stops', () => {
    assert.deepEqual([GPS_METRES, STOP_METRES, STOPPED_SPEED, MOVING_SPEED, AFTER_MS, AWAY_METRES, MOST], [30, 60, 1, 4, 180_000, 300, 40]);
});

test('the morning trace: M3 Korydallos to Chalandri, from network fixes underground, one report as the train comes to Chalandri', () => {
    const { f, reports, measuring } = traced('m3-morning');
    assert.equal(measuring, null, 'over');
    assert.equal(reports.length, 1);
    const [r] = reports;
    assert.deepEqual({ line: r.line, dir: r.dir, day: r.day, hour: r.hour }, { line: 'M3', dir: 'doukissis', day: 'weekday', hour: 7 }, 'a Friday, boarded in the 7 o\'clock hour (Athens)');
    // The stations with a signal, each in a row; a silent stretch is one
    // (Agia Marina to Monastiraki, Ethniki Amyna to Chalandri)
    assert.deepEqual(r.stretches.map(s => `${s.from}>${s.to}`), [
        'agia-marina>monastiraki', 'monastiraki>syntagma', 'syntagma>evangelismos', 'evangelismos>megaro-mousikis', 'megaro-mousikis>ampelokipoi',
        'ampelokipoi>panormou', 'panormou>katechaki', 'katechaki>ethniki-amyna', 'ethniki-amyna>chalandri',
    ]);
    assert.ok(r.stretches.every(s => s.by === 'network'));
    // Against the rider's marks as the doors opened (Aigaleo first, so
    // Monastiraki is the 4th): within 15 s, one band, each
    const marks = { monastiraki: 3, syntagma: 4, evangelismos: 5, 'megaro-mousikis': 6, ampelokipoi: 7, panormou: 8, katechaki: 9, 'ethniki-amyna': 10, chalandri: 14 };
    for (const s of r.stretches.filter(s => s.from in marks)) {
        const doors = Math.round((f.marks[marks[s.to]] - f.marks[marks[s.from]]) / 1000);
        assert.ok(Math.abs(s.s - doors) <= 15, `${s.from} to ${s.to}: ${s.s} s, doors to doors ${doors} s`);
    }
    // Nothing from GPS: no stops stood at, no wait
    assert.deepEqual(r.stops, []);
    assert.equal(r.wait, null);
});

test('the evening trace: M3 Megaro Mousikis to Korydallos, the wait on the platform not timed by network fixes, the last stretches silent', () => {
    const { reports } = traced('m3-evening');
    assert.equal(reports.length, 0, 'not over: no fix came at Korydallos within the trace');
    const { f, measuring } = traced('m3-evening');
    const r = reportOf(measuring);
    assert.deepEqual({ line: r.line, dir: r.dir, hour: r.hour }, { line: 'M3', dir: 'dimotiko', hour: 19 });
    assert.deepEqual(r.stretches.map(s => `${s.from}>${s.to}`), ['evangelismos>syntagma', 'syntagma>monastiraki', 'monastiraki>agia-marina']);
    // Monastiraki to Agia Marina, four stations without a signal: doors to doors 10' 2"
    const long = r.stretches[2];
    assert.ok(Math.abs(long.s - (f.marks[7] - f.marks[3]) / 1000) <= 30, `${long.s} s`);
    assert.equal(r.wait, null, 'GPS on the stairs, then a network fix on the platform: no wait');
});

// Along a tram line, 400 m between stops, northward
const BASE = { lat: 37.94, lng: 23.70 };
const north = metres => ({ lat: BASE.lat + metres / 111_195, lng: BASE.lng });
const TRAM = [0, 400, 800, 1200].map(north);
const tramTarget = { line: 'T6', dir: 'syntagma', stops: ['a', 'b', 'c', 'd'], points: TRAM };
// 2026-11-27 10:00:00 Athens (08:00 UTC), a Friday
const T0 = Date.UTC(2026, 10, 27, 8, 0, 0);
// A GPS position every second, `metres` along the line
const gps = (s, metres, speed) => ({ ...north(metres), at: T0 + s * 1000, accuracy: 5, speed });

// The tram's ride, second by second: the rider at stop a from 0 s, the
// tram leaving it at 120 s, standing 20 s at b and 30 s at c, on to d
function tramRide() {
    const fixes = [];
    // Walking about on the platform
    for (let s = 0; s < 120; s++) fixes.push(gps(s, 3 * Math.sin(s / 10), 0.5));
    let at = 0;
    let s = 120;
    const run = to => {
        // 10 m/s between stops
        while (at < to) { at = Math.min(to, at + 10); fixes.push(gps(s++, at, 10)); }
    };
    const stand = seconds => { for (let i = 0; i < seconds; i++) fixes.push(gps(s++, at, 0)); };
    run(400); stand(20); run(800); stand(30); run(1200); stand(15);
    // Off and walking on, away from d
    for (let i = 0; i < 30; i++) fixes.push(gps(s++, 1200 + 1.4 * i, 1.4));
    return fixes;
}

test('a tram ride by GPS: the wait for it, each stretch doors to doors, how long it stood at each stop on the way, sent as it stood at the last', () => {
    const { reports, measuring } = replay(rideSteps(TRAM), [tramTarget], tramRide());
    assert.equal(measuring, null);
    assert.equal(reports.length, 1);
    const [r] = reports;
    assert.deepEqual({ line: r.line, dir: r.dir, day: r.day, hour: r.hour }, { line: 'T6', dir: 'syntagma', day: 'weekday', hour: 10 });
    // a to b isn't timed: the rider was at a before the tram came. b to c:
    // 20 s at b, then 40 s; c to d: 30 s at c, then 40 s
    assert.deepEqual(r.stretches, [
        { from: 'b', to: 'c', s: 60, by: 'gps' },
        { from: 'c', to: 'd', s: 70, by: 'gps' },
    ]);
    assert.deepEqual(r.stops, [
        { stop: 'b', s: 19, by: 'gps' },
        { stop: 'c', s: 29, by: 'gps' },
    ], 'from stopping to the last second standing; not d, where the rider got off');
    assert.deepEqual(r.wait, { stop: 'a', s: 120, by: 'gps' }, 'from reaching the stop to the tram leaving it');
});

test('a run to the doors isn\'t the tram leaving, nor a walk on the platform; a stop at traffic lights between stops isn\'t a stop', () => {
    const fixes = tramRide();
    // A jog at 3 m/s on the platform, under MOVING_SPEED
    assert.ok(3 < MOVING_SPEED);
    fixes.splice(60, 5, ...[0, 1, 2, 3, 4].map(i => gps(60 + i, i * 3, 3)));
    // Standing 30 s halfway from b to c, out of STOP_METRES of either
    assert.ok(200 > STOP_METRES);
    const half = fixes.findIndex(f => f.lat >= north(600).lat);
    const lights = Array.from({ length: 30 }, (_, i) => gps(0, 600, 0));
    fixes.splice(half, 0, ...lights);
    fixes.forEach((f, i) => { f.at = T0 + i * 1000; });
    const { reports } = replay(rideSteps(TRAM), [tramTarget], fixes);
    const [r] = reports;
    assert.deepEqual(r.stretches.map(s => [s.from, s.to, s.s]), [['b', 'c', 90], ['c', 'd', 70]], 'b to c 30 s longer for the lights, still one stretch');
    assert.equal(r.wait.s, 120);
});

test('GPS until the tunnel, network fixes after: a stretch between a stop by one and a stop by the other isn\'t sent', () => {
    const fixes = tramRide().map(f => f.lat > north(700).lat ? { ...f, accuracy: 100, speed: null } : f);
    const { reports } = replay(rideSteps(TRAM), [tramTarget], fixes);
    const [r] = reports;
    // b by GPS; c and d by network fixes, as follow.js places them
    assert.ok(r.stretches.every(s => s.from !== 'b'), 'b (GPS) to c (network) isn\'t a stretch');
    assert.ok(r.stretches.every(s => s.by === 'network'));
    assert.equal(byOf({ accuracy: 100, speed: 0 }), 'network', 'a fused fix with a speed is still rough');
    assert.equal(byOf({ accuracy: 20, speed: null }), 'network', 'Wi-Fi underground: exact, but no speed');
    assert.equal(byOf({ accuracy: 5, speed: 0 }), 'gps');
});

test('past the last stop, GPS waits for the train to stand there, at most AFTER_MS, or till the rider is far on', () => {
    // The tram never stands at d: the rider was carried on
    const fixes = tramRide().filter(f => !(f.lat >= north(1200).lat - 1e-9 && f.speed === 0));
    const far = fixes.at(-1);
    fixes.push({ ...far, ...north(1600), at: far.at + 1000 });
    const { reports } = replay(rideSteps(TRAM), [tramTarget], fixes);
    assert.equal(reports.length, 1, 'over once 300 m on');
    assert.deepEqual(reports[0].stretches.map(s => s.to), ['c'], 'nothing timed to d');
    // Standing near d, but never at it: over after AFTER_MS
    const still = tramRide().filter(f => f.lat < north(1150).lat);
    const last = still.at(-1);
    for (let i = 1; i * 10_000 <= AFTER_MS + 10_000; i++) still.push({ ...last, ...north(1150), speed: 0, at: last.at + i * 10_000 });
    assert.equal(replay(rideSteps(TRAM), [tramTarget], still).reports.length, 1);
});

test('another ride, or another way, sends what the one measured had; a ride boarded unseen starts from the stop it was placed at', () => {
    const steps = rideSteps(TRAM);
    const fixes = tramRide();
    // Planned again on the way (other steps): the ride so far is sent
    let state = starting();
    let m = null;
    const reports = [];
    // Planned again as the tram stands at c
    const half = fixes.findIndex(f => f.speed === 0 && f.lat >= north(800).lat - 1e-9) + 5;
    let current = steps;
    fixes.forEach((fix, i) => {
        if (i === half) { current = rideSteps(TRAM.slice(2)); state = { ...starting(), step: 1 }; }
        state = placeOn(current, state, fix, fix.at);
        const targets = current === steps ? [tramTarget] : [{ ...tramTarget, stops: ['c', 'd'], points: TRAM.slice(2) }];
        const next = measure(m, { steps: current, state, targets, fix });
        m = next.measuring;
        if (next.report) reports.push(next.report);
    });
    assert.deepEqual(reports[0].stretches.map(s => s.to), ['c']);
    assert.equal(reports[0].wait.s, 120);
    // The new way's ride starts at c, where the rider was: when the tram
    // came to c isn't its to know, so d alone times nothing, and nothing more is sent
    assert.equal(reports.length, 1);
});

test('a way switched to on the tram (T14): the same ride, still measured, by the new way\'s stops', () => {
    const fixes = tramRide();
    const switchAt = fixes.findIndex(f => f.speed === 0 && f.lat >= north(400).lat - 1e-9) + 25;
    let current = rideSteps(TRAM);
    let state = starting();
    let m = null;
    const reports = [];
    fixes.forEach((fix, i) => {
        // Switched as the tram leaves b: the same T6 from a, its steps new
        if (i === switchAt) current = rideSteps([...TRAM]);
        state = placeOn(current, state, fix, fix.at);
        const next = measure(m, { steps: current, state, targets: [tramTarget], fix });
        m = next.measuring;
        if (next.report) reports.push(next.report);
    });
    assert.equal(reports.length, 1, 'one report, at the end');
    assert.deepEqual(reports[0].stretches.map(s => [s.from, s.to, s.s]), [['b', 'c', 60], ['c', 'd', 70]]);
    assert.equal(reports[0].wait.s, 120);
});

test('rough fixes count for nothing; a ride that isn\'t the metro\'s or the tram\'s isn\'t measured', () => {
    const steps = rideSteps(TRAM);
    const fixes = tramRide().map(f => ({ ...f, accuracy: 500 }));
    assert.deepEqual(replay(steps, [tramTarget], fixes), { reports: [], measuring: null });
    assert.deepEqual(replay(steps, [null], tramRide()), { reports: [], measuring: null });
    assert.equal(reportOf(null), null);
});

test('a report holds at most MOST stretches and MOST stops', () => {
    const points = Array.from({ length: 60 }, (_, i) => north(i * 400));
    const fixes = [];
    let s = 0;
    for (let i = 0; i < 60; i++) {
        for (let k = 0; k < 10; k++) fixes.push(gps(s++, i * 400, 0));
        for (let k = 1; k < 40; k++) fixes.push(gps(s++, i * 400 + k * 10, 10));
    }
    const target = { line: 'T6', dir: 'syntagma', stops: points.map((_, i) => `s${i}`), points };
    const { reports, measuring } = replay(rideSteps(points), [target], fixes);
    const r = reports[0] ?? reportOf(measuring);
    assert.equal(r.stretches.length, MOST);
    assert.equal(r.stops.length, MOST);
});

test('the ways\' metro and tram rides as measured: their line, direction, stops and where they are; buses, the suburban railway and a last bus of several aren\'t', () => {
    const at = (lat, lng) => ({ lat, lng });
    const city = {
        city: true,
        rides: [
            { mode: 'metro', line: 'M3', dir: 'dimotiko', on: [{ station: 'syntagma' }, { station: 'monastiraki' }], along: [[37.97, 23.73], [37.97, 23.72]] },
            { mode: 'bus', line: '040', on: [{}], along: [[37.9, 23.6]] },
            { mode: 'suburban', line: 'A1', dir: 'x', on: [{ station: 'a' }], along: [[37.9, 23.6]] },
            { mode: 'tram', line: 'T6', dir: 'pikrodafni', on: [{ station: 'syntagma-tram' }, { station: 'zappeio' }], along: [[37.97, 23.73], [37.97, 23.74]], any: [] },
        ],
    };
    assert.deepEqual(targetsOf(city, {}), [
        { line: 'M3', dir: 'dimotiko', stops: ['syntagma', 'monastiraki'], points: [at(37.97, 23.73), at(37.97, 23.72)] },
        null,
        null,
        { line: 'T6', dir: 'pikrodafni', stops: ['syntagma-tram', 'zappeio'], points: [at(37.97, 23.73), at(37.97, 23.74)] },
    ]);
    const rail = {
        stations: { a: { coords: [1, 2] }, b: { coords: [3, 4] }, c: { coords: [5, 6] } },
        lines: { M1: { directions: { up: { stops: [{ station: 'a' }, { station: 'b' }, { station: 'c' }] } } }, A1: { suburban: true, directions: {} } },
    };
    const metro = { plan: { legs: [{ line: 'M1', dir: 'up', fromIndex: 1, toIndex: 2 }, { line: 'A1', dir: 'x', fromIndex: 0, toIndex: 1 }] } };
    assert.deepEqual(targetsOf(metro, rail), [{ line: 'M1', dir: 'up', stops: ['b', 'c'], points: [at(3, 4), at(5, 6)] }, null]);
});

test('the kind of day: weekdays, Saturdays, and Sundays with Greece\'s public holidays, Easter\'s moving with it', () => {
    assert.equal(dayType('2026-11-27', 5), 'weekday');
    assert.equal(dayType('2026-11-28', 6), 'saturday');
    assert.equal(dayType('2026-11-29', 0), 'sunday');
    assert.equal(dayType('2026-10-28', 3), 'sunday', 'Ochi day, a Wednesday');
    assert.equal(dayType('2026-12-26', 6), 'sunday', 'a holiday on a Saturday runs as a Sunday');
    // Orthodox Easter 2026: 12 April; 2027: 2 May
    const y2026 = holidays(2026);
    for (const day of ['02-23', '04-10', '04-13', '06-01', '01-06', '03-25', '05-01', '08-15', '12-25']) assert.ok(y2026.has(day), day);
    assert.ok(!y2026.has('04-12'), 'Easter Sunday is a Sunday anyway');
    const y2027 = holidays(2027);
    for (const day of ['03-15', '04-30', '05-03', '06-21']) assert.ok(y2027.has(day), `2027 ${day}`);
    assert.equal(y2026.size, 12);
});
