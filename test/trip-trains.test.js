import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems } from './support/markup.js';
import { minutesMark } from '../public/js/core/times.js';

// How late the suburban trains run, on the Trip page's way shown in full
// (decision 42): a train ride timed with it (trainRide in
// tools/trip/client/trains.js, through liveWay in buses.js), when the trains
// are asked for again, and the way drawn with it, in both languages. Over the
// test data's metro and suburban railway on a Wednesday: from Megara, the A4
// to Athens (train 1323 at 17:08, there 17:51), the walk to Larissa Station
// and the M2 to Syntagma. The page's side: test/browser/trip.spec.js.

const read = name => JSON.parse(readFileSync(new URL(`browser/data/${name}`, import.meta.url), 'utf8'));
const rail = read('rail.json');
const { cityPlanner, halfHour, halfView, liveWay, shownRows } = await browserModule('tools/trip/client/buses.js');
const { trainDay } = await browserModule('tools/subway/client/city.js');
const { withTram } = await browserModule('tools/subway/client/network.js');
const { refreshEvery } = await browserModule('tools/buses/client/timing.js');
const trains = await browserModule('tools/trip/client/trains.js');
const live = await browserModule('tools/trip/client/live.js');
const day = read('trains.json');
const city = cityPlanner(rail, read('buses.json'), 3, trainDay(day, '2026-10-21'));
const network = withTram(rail);

const MIN = 60;
const H = 3600;
const megara = { lat: day.stations.megara[0], lng: day.stations.megara[1] };
const syntagma = { lat: rail.stations.syntagma.coords[0], lng: rail.stations.syntagma.coords[1] };
const answered = now => {
    const steps = halfHour(city, megara, syntagma, now);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
};
const at = hours => ({ weekday: 3, seconds: hours * H });
const answer = answered(at(17));
const [row] = shownRows(answer);
const A4 = 17 * H + 8 * MIN;
// The way shown in full, leaving at `now`, with these trains' lateness
const timed = (late, now = at(17)) => liveWay(city, megara, syntagma, row, 0, now, {}, { trains: late });
const rides = way => way.option.rides.map(ride => [ride.line, ride.boards, ride.arrives, ride.late ?? null]);

test('with no lateness known, the way is the timetable\'s, as before', () => {
    const way = timed(null);
    const [train, metro] = row.best[0].legs;
    assert.deepEqual([train.line, train.boards, train.arrives, metro.line], ['A4', A4, 17 * H + 51 * MIN, 'M2']);
    assert.deepEqual(rides(way), [['A4', A4, train.arrives, null], ['M2', metro.boards, metro.arrives, null]]);
    assert.equal(way.train, A4, 'when its train leaves, for asking about the trains');
    assert.deepEqual(timed({ 9999: { late: 600, exact: true } }).option, way.option, 'another train\'s lateness changes nothing');
});

test('a late train leaves at the timetable\'s time, gets there later, and the rest of the way is timed from then', () => {
    const way = timed({ 1323: { late: 5 * MIN, exact: true } });
    const [train, metro] = rides(way);
    assert.deepEqual(train, ['A4', A4, 17 * H + 56 * MIN, { minutes: 5, exact: true }]);
    assert.equal(metro[0], 'M2');
    assert.ok(metro[1] > 18 * H, `the M2 after it, not the 18:00 (${metro[1] / MIN} min)`);
    assert.ok(way.option.arrives > 18 * H + 6 * MIN);
    // At least so late, and said so
    assert.deepEqual(rides(timed({ 1323: { late: 4 * MIN + 10, exact: false } }))[0][3], { minutes: 4, exact: false });
});

test('a train the timetable would miss is caught when measured late enough to leave 2 minutes to spare', () => {
    const now = at(17 + 10 / 60);
    const next = 18 * H + 8 * MIN;
    // 6 minutes late, due at 17:14: there at 17:10, so it's caught, at the time it's expected
    assert.deepEqual(rides(timed({ 1323: { late: 6 * MIN, exact: true } }, now))[0], ['A4', A4 + 6 * MIN, 17 * H + 57 * MIN, { minutes: 6, exact: true, timetable: A4 }]);
    // Due at 17:11: not enough; only at least 10 minutes late: not measured; or no lateness: the next train
    for (const late of [{ late: 3 * MIN, exact: true }, { late: 10 * MIN, exact: false }]) {
        assert.equal(rides(timed({ 1323: late }, now))[0][1], next, JSON.stringify(late));
    }
    assert.equal(rides(timed(null, now))[0][1], next);
});

test('the train there first, of the line\'s trains to any end; another line, or a trip with no number, isn\'t timed', () => {
    // A1 from station 10 to 20: one train on to 30, one ending at 20
    const planner = { routes: [
        { line: 'A1', mode: 'suburban', stops: [10, 20, 30], trips: [[1000, 1100, 1200]], numbers: ['A'] },
        { line: 'A1', mode: 'suburban', stops: [10, 20], trips: [[1050, 1150], [1300, 1400]], numbers: ['B', null] },
        { line: 'A3', mode: 'suburban', stops: [10, 20], trips: [[1010, 1020]], numbers: ['C'] },
        { line: 'A1', mode: 'suburban', stops: [20, 10], trips: [[1000, 1010]], numbers: ['D'] },
    ] };
    const leg = { line: 'A1', mode: 'suburban', board: 10, alight: 20, route: 0, boardIndex: 0, alightIndex: 1, boards: 1000, arrives: 1100 };
    const ride = late => trains.trainRide(planner, leg, 1000, late);
    assert.deepEqual(ride(null), { leg, late: null });
    // A running 2 minutes late: B, leaving later, gets there first
    assert.deepEqual(ride({ A: { late: 120, exact: true } }), { leg: { ...leg, route: 1, boards: 1050, arrives: 1150 }, late: null });
    assert.deepEqual(ride({ A: { late: 30, exact: false } }).late, { minutes: 1, exact: false });
    // No train left by the timetable, none late enough to catch
    assert.equal(trains.trainRide(planner, leg, 1301, { B: { late: 60, exact: true } }), null);
    // Left at 900 by the timetable: caught at 1000 with 2 minutes to spare exactly, not 1 second less
    const missed = { routes: [{ line: 'A1', mode: 'suburban', stops: [10, 20], trips: [[900, 1000], [2000, 2100]], numbers: ['E', 'F'] }] };
    assert.equal(trains.SPARE_SECONDS, 2 * MIN);
    assert.deepEqual(trains.trainRide(missed, leg, 1000, { E: { late: 100 + trains.SPARE_SECONDS, exact: true } }).leg.boards, 1000 + trains.SPARE_SECONDS);
    assert.deepEqual(trains.trainRide(missed, leg, 1000, { E: { late: 99 + trains.SPARE_SECONDS, exact: true } }).leg.boards, 2000);
});

test('the trains are asked for again on the Buses page\'s tiers by when the way\'s train leaves; not while being asked for', () => {
    const now = 10 * H;
    const state = (answer, asking = false) => ({ asking, asked: 0, answer });
    const due = (train, answer) => refreshEvery(answer && { unavailable: answer.unavailable, arrivals: [{ minutes: Math.floor((train - now) / 60) }] });
    for (const [train, answer] of [[now + 5 * MIN, { trains: {} }], [now + 15 * MIN, { trains: {} }], [now + 40 * MIN, { trains: {} }], [now + 5 * MIN, { unavailable: true }], [now + 5 * MIN, null]]) {
        const wait = due(train, answer);
        assert.equal(trains.trainsDue(train, state(answer), wait - 1, now), false);
        assert.equal(trains.trainsDue(train, state(answer), wait, now), true);
    }
    assert.ok(due(now + 5 * MIN, { trains: {} }) < due(now + 40 * MIN, { trains: {} }), 'sooner for a train leaving soon');
    assert.equal(trains.trainsDue(now, state(null, true), 1e12, now), false);
});

test('a failed request keeps the last answer, marked as possibly old; with none, there are none', () => {
    assert.deepEqual(trains.trainsUnanswered({ trains: { 1: { late: 0, exact: true } } }), { trains: { 1: { late: 0, exact: true } }, stale: true });
    assert.deepEqual(trains.trainsUnanswered({ unavailable: true }), { unavailable: true });
    assert.deepEqual(trains.trainsUnanswered(null), { unavailable: true });
});

test('what\'s said above the answer with a train: its lateness unavailable, with the buses\' too, or older', () => {
    const asks = [{ stop: 'a', at: null }];
    const answers = entries => new Map(entries);
    assert.equal(live.liveStatus(asks, answers([]), false, { trains: {} }), null);
    assert.equal(live.liveStatus(asks, answers([]), false, { unavailable: true }), 'trains-unavailable');
    assert.equal(live.liveStatus(asks, answers([['a', { buses: [], unavailable: true }]]), false, { unavailable: true }), 'all-unavailable');
    assert.equal(live.liveStatus(asks, answers([]), false, { trains: {}, stale: true }), 'stale');
    assert.equal(live.liveStatus(asks, answers([]), true, { unavailable: true }), 'paused');
});

// ── Drawn ───────────────────────────────────────────────────────────────────

for (const lang of ['en', 'el']) {
    const r = await browserModule('tools/trip/client/render.js', lang);
    const keys = Object.keys(strings(lang));
    const s = strings(lang);
    const check = view => assert.deepEqual(markupProblems(String(view), { keys }), []);
    const escaped = text => text.replace(/'/g, '&#39;');
    const json = value => JSON.parse(JSON.stringify(value));
    const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
    const half = json(halfView(city, megara, syntagma, answer));
    const drawn = (way, now = at(17).seconds) => String(r.renderHalf(network, half.kind, r.halfWays(half, now), syntagma, { live: { way: json(way), now } }));
    // Minutes as every page writes them (/js/core/times.js): "5'"
    const note = (key, minutes) => s[key].replace('{minutes}', String(minutesMark(minutes, k => s[k])));

    test(`${lang}: a late train says how late at the timetable's time, the M2 timed after it, and the note says whose estimate it is`, () => {
        const way = timed({ 1323: { late: 5 * MIN, exact: true } });
        const html = drawn(way);
        check(html);
        assert.ok(html.includes(`<span class="trip-step-when">${clock(A4)}</span>`), 'the timetable\'s time, without "~"');
        assert.ok(html.includes(`<div class="trip-step-note trip-train-late">${note('trip.train-late', 5)}</div>`));
        assert.ok(html.includes(`<span class="trip-step-when">${clock(way.option.rides[1].boards)}</span>`), 'the M2 after it');
        assert.ok(html.includes(escaped(s['trip.train-late-estimates'])));
        const atLeast = drawn(timed({ 1323: { late: 4 * MIN, exact: false } }));
        assert.ok(atLeast.includes(note('trip.train-late-at-least', 4)));
    });

    test(`${lang}: on time when measured so; nothing said of a train only known to be at least on time, nor the note`, () => {
        assert.ok(drawn(timed({ 1323: { late: 20, exact: true } })).includes(`<div class="trip-step-note trip-train-late">${s['trip.train-on-time']}</div>`));
        const unknown = drawn(timed({ 1323: { late: 20, exact: false } }));
        assert.ok(!unknown.includes('trip-train-late'));
        assert.ok(!drawn(timed(null)).includes(escaped(s['trip.train-late-estimates'])));
    });

    test(`${lang}: a late train caught: "~" its expected time, and the timetable's beside how late it is`, () => {
        const now = at(17 + 10 / 60);
        const html = drawn(timed({ 1323: { late: 6 * MIN, exact: true } }, now), now.seconds);
        check(html);
        assert.ok(html.includes(`<span class="trip-step-when">~${clock(A4 + 6 * MIN)}</span>`));
        assert.ok(html.includes(`${note('trip.train-late', 6)} · ${s['trip.train-timetable'].replace('{time}', clock(A4))}`));
    });

    test(`${lang}: the notices: the trains' lateness unavailable, with the buses' too`, () => {
        for (const status of ['trains-unavailable', 'all-unavailable']) {
            const html = String(r.liveNotice(status));
            check(html);
            assert.ok(html.includes(escaped(s[status === 'all-unavailable' ? 'trip.all-live-unavailable' : 'trip.trains-live-unavailable'])));
        }
    });
}
