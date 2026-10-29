import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The trip finder's logic (tools/buses/client/trips.js): which buses go from
// the stops near you to the stops near where you're going, and what live
// answers say about them. Made-up stops along a street, a stop every ~111 m.

const { ALIGHT_REFRESH_MS, findTrips, MAX_OPTIONS, rankTrips, tripBuses, tripDue, tripOptions, tripStops, walkMinutes } = await browserModule('tools/buses/client/trips.js');
const { REFRESH_SLOW_MS, SLACK_MS } = await browserModule('tools/buses/client/timing.js');

// Stop n is n × 0.001° north of 37.9, 23.7
const stop = n => ({ code: String(10000 + n), lat: 37.9 + n / 1000, lng: 23.7, name: { el: `ΣΤΑΣΗ ${n}`, en: `STOP ${n}` }, lines: [] });
const near = (n, meters) => ({ ...stop(n), meters });
const code = n => String(10000 + n);
const line = (number, ...directions) => ({
    line: number, name: { el: number, en: number },
    directions: directions.map((stops, i) => ({ to: { el: `ΠΡΟΣ ${i}`, en: `TO ${i}` }, route: `${number}-${i}`, stops: stops.map(code) })),
});
const short = o => [o.line, o.direction, o.board.code, o.alight.code, o.stops];

test('the agreed numbers: at most 5 lines, the stop you get off at once a minute', () => {
    assert.equal(MAX_OPTIONS, 5);
    assert.equal(ALIGHT_REFRESH_MS, 60_000);
});

test('a line that calls near you and later near the destination: the stop nearest you, the stop nearest there', () => {
    const from = [near(1, 50), near(2, 300)];
    const to = [near(5, 100), near(4, 200)];
    const options = tripOptions([
        // Both ways: only the one that comes to the destination after you
        line('A', [0, 1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1, 0]),
        // Only from the further stop
        line('B', [2, 3, 4]),
        // Never near the destination
        line('C', [1, 2, 3]),
    ], from, to);
    // The fewest metres walked first (A: 50 + 100; B: 300 + 200)
    assert.deepEqual(options.map(short), [['A', 0, code(1), code(5), 4], ['B', 0, code(2), code(4), 2]]);
    assert.deepEqual(options[0].to, { el: 'ΠΡΟΣ 0', en: 'TO 0' });
    assert.equal(options[0].route, 'A-0');
});

test('each line once, at most 5; equal walks, the fewest stops ridden first', () => {
    const from = [near(1, 100)];
    const to = [near(9, 100)];
    const lines = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'].map((n, i) => line(n, [1, ...Array.from({ length: 6 - i }, (_, k) => 20 + k), 9]));
    const options = tripOptions(lines, from, to);
    assert.equal(options.length, MAX_OPTIONS);
    assert.deepEqual(options.map(o => o.line), ['L7', 'L6', 'L5', 'L4', 'L3']);
});

test('a circular line passing a stop twice; a stop in both areas isn\'t a trip', () => {
    // The 830 starts and ends at stop 8: from 9 to 8 is its last leg
    assert.deepEqual(tripOptions([line('830', [8, 9, 8])], [near(9, 10)], [near(8, 10)]).map(short), [['830', 0, code(9), code(8), 1]]);
    assert.deepEqual(tripOptions([line('A', [1, 2])], [near(1, 10), near(2, 10)], [near(1, 10)]), []);
});

test('from where you are: the stops within 500 m, or 1500 m when no bus goes from those; from a picked stop, 400 m', () => {
    // Around the destination, stop 30, only 30 and 31: stop 10, 2 km away, isn't
    const stops = [0, 1, 2, 3, 10, 30, 31].map(stop);
    const lines = [line('A', [0, 30]), line('B', [10, 31])];
    const to = { lat: stop(30).lat, lng: 23.7 };
    // At stop 0: the A, within 500 m
    assert.deepEqual(findTrips(stops, lines, { lat: stop(0).lat, lng: 23.7 }, to).map(o => o.line), ['A']);
    // At stop 6 (no stop there): stop 3 is 333 m away but nothing goes from 1–3; stop 10 is 444 m, the B
    assert.deepEqual(findTrips(stops, lines, { lat: stop(6).lat, lng: 23.7 }, to).map(o => o.line), ['B']);
    // At stop 5: stop 0 is 555 m away; widened to 1500 m, the A from there
    assert.deepEqual(findTrips(stops, [line('A', [0, 30])], { lat: stop(5).lat, lng: 23.7 }, to).map(o => o.line), ['A']);
    // A picked stop: no widening past 400 m
    assert.deepEqual(findTrips(stops, [line('A', [0, 30])], { lat: stop(5).lat, lng: 23.7, picked: true }, to), []);
    // Nothing within 400 m of a station at stop 36's place: its nearest stop, 31 (on the B, 1.1 km from stop 0)
    assert.deepEqual(findTrips(stops, lines, { lat: stop(0).lat, lng: 23.7 }, { lat: stop(36).lat, lng: 23.7 }).map(short), [['B', 0, code(10), code(31), 1]]);
});

test('the stops to ask for: each option\'s two, once each', () => {
    const options = tripOptions([line('A', [1, 5]), line('B', [1, 4])], [near(1, 0)], [near(5, 0), near(4, 10)]);
    assert.deepEqual(tripStops(options), [code(1), code(5), code(4)]);
});

test('an option\'s buses: its line going its way, in time to walk there; the ride from the same bus at both stops', () => {
    const option = { line: 'A', direction: 0, to: { el: '', en: '' }, route: 'A-0', board: near(1, 200), alight: near(5, 100), stops: 4 };
    const at = (...arrivals) => ({ arrivals: arrivals.map(([line, route, vehicle, minutes]) => ({ line, route, vehicle, minutes })) });
    const board = at(
        ['A', 'A-0', 'v1', 1],     // gone before you get there (3 min walk)
        ['A', 'A-0', 'v2', 4],     // predicted at both stops: 9 minutes' ride
        ['A', 'A-0', 'v3', 12],    // not predicted there yet: no ride
        ['A', 'A-1', 'v4', 5],     // the other way
        ['A', 'A-9', 'v5', 6],     // a short working that goes there
        ['A', 'A-8', 'v6', 7],     // one that doesn't (or not yet known)
        ['B', 'B-0', 'v7', 5],     // another line
        ['A', 'A-0', 'v8', 20],    // there before it's here: a different trip of the bus, no ride
    );
    const alight = at(['A', 'A-0', 'v2', 13], ['A', 'A-9', 'v5', 15], ['A', 'A-0', 'v8', 3]);
    assert.equal(walkMinutes(200), 3);
    assert.deepEqual(tripBuses(option, board, alight, walkMinutes(option.board.meters)), [
        { vehicle: 'v2', minutes: 4, ride: 9, arrives: 13 },
        { vehicle: 'v5', minutes: 6, ride: 9, arrives: 15 },
        { vehicle: 'v3', minutes: 12, ride: null, arrives: null },
        { vehicle: 'v8', minutes: 20, ride: null, arrives: null },
    ]);
    // Nothing in yet
    assert.deepEqual(tripBuses(option, undefined, undefined, 1), []);
    assert.deepEqual(tripBuses(option, board, undefined, 1).map(b => b.ride), [null, null, null, null]);
});

test('walking: at about 80 m a minute, at least a minute', () => {
    assert.deepEqual([0, 80, 81, 400, 1500].map(walkMinutes), [1, 1, 2, 5, 19]);
});

test('the order: by when you\'d get there, then by when the bus leaves, then those with none', () => {
    const option = (line, alightMeters) => ({ line, alight: { meters: alightMeters } });
    const bus = (minutes, arrives = null) => ({ vehicle: 'v', minutes, ride: arrives === null ? null : arrives - minutes, arrives });
    const ranked = rankTrips([
        { option: option('none', 0), buses: [] },
        { option: option('leaves-2', 0), buses: [bus(2)] },
        { option: option('there-20', 80), buses: [bus(5, 19)] },            // 19 + 1 min walk
        { option: option('there-15', 400), buses: [bus(1), bus(3, 10)] },  // 10 + 5 min walk
        { option: option('leaves-1', 0), buses: [bus(1)] },
    ]);
    assert.deepEqual(ranked.map(t => t.option.line), ['there-15', 'there-20', 'leaves-1', 'leaves-2', 'none']);
});

test('what to ask for: the stop you board at by its line\'s next bus, the stop you get off at once a minute', () => {
    const options = tripOptions([line('A', [1, 5]), line('B', [2, 6])], [near(1, 0), near(2, 10)], [near(5, 0), near(6, 0)]);
    const t0 = 1_000_000;
    const answered = (line, minutes) => ({ arrivals: [{ line, route: '', vehicle: 'x', minutes }] });
    const trip = {
        options,
        asking: new Set(),
        asked: { [code(1)]: t0, [code(2)]: t0, [code(5)]: t0, [code(6)]: t0 },
        fetched: { [code(1)]: t0, [code(2)]: t0, [code(5)]: t0, [code(6)]: t0 },
        // At stop 1 an A in 3 minutes; at stop 2 only another line's bus is soon
        results: { [code(1)]: answered('A', 3), [code(2)]: answered('Z', 2), [code(5)]: answered('A', 9), [code(6)]: answered('B', 9) },
    };
    // Nothing is due straight after the answers
    assert.deepEqual(tripDue(trip, t0), []);
    // Stop 1 every 30 s (+2); stops 5 and 6 every 60 s (+2); stop 2 has no B coming: every 2 minutes (+2)
    assert.deepEqual(tripDue(trip, t0 + 32_000), [code(1)]);
    assert.deepEqual(tripDue(trip, t0 + ALIGHT_REFRESH_MS + SLACK_MS).sort(), [code(1), code(5), code(6)]);
    assert.deepEqual(tripDue(trip, t0 + REFRESH_SLOW_MS + SLACK_MS).sort(), [code(1), code(2), code(5), code(6)]);
    // Not while it's being asked for; never asked: at once
    assert.deepEqual(tripDue({ ...trip, asking: new Set([code(1)]) }, t0 + 32_000), []);
    assert.deepEqual(tripDue({ ...trip, asked: {}, fetched: {}, results: {} }, t0).sort(), [code(1), code(2), code(5), code(6)]);
});

test('a stop that is both a boarding and an alighting stop is asked for at the faster of the two', () => {
    const options = tripOptions([line('A', [1, 5]), line('B', [5, 9])], [near(1, 0), near(5, 300)], [near(5, 10), near(9, 0)]);
    assert.deepEqual(options.map(short), [['A', 0, code(1), code(5), 1], ['B', 0, code(5), code(9), 1]]);
    const t0 = 1_000_000;
    const trip = { options, asking: new Set(), asked: { [code(1)]: t0, [code(5)]: t0, [code(9)]: t0 }, fetched: { [code(1)]: t0, [code(5)]: t0, [code(9)]: t0 }, results: {} };
    // No answer yet counts as the fastest tier for a boarding stop
    assert.deepEqual(tripDue(trip, t0 + 32_000).sort(), [code(1), code(5)]);
});
