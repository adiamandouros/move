import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, nothingUnder, notices } from './support/markup.js';
import { escapeHtml } from '../public/js/core/html.js';
import { aboutTime, minutesMark } from '../public/js/core/times.js';

// How late the suburban trains run, on the Trip page's way shown in full
// (decision 42): a train ride timed with it (trainRide in
// tools/trip/client/trains.js, through liveWay in buses.js), when the trains
// are asked for again, and the way drawn with it, in both languages: the
// train's ride as the Subway page's card, its badges when its trains
// actually leave (decision 47). Over the test data's metro and suburban
// railway on a Wednesday: from Megara, the A4 toward Piraeus (train 1323 at
// 17:08, at Athens 17:51; the next, 1325, an hour later), the walk to
// Larissa Station and the M2 to Syntagma. The page's side:
// test/browser/trip.spec.js.

const read = name => JSON.parse(readFileSync(new URL(`browser/data/${name}`, import.meta.url), 'utf8'));
const rail = read('rail.json');
const { cityPlanner, halfHour, halfView, liveWay, shownRows } = await browserModule('tools/trip/client/buses.js');
const { trainDay } = await browserModule('tools/subway/client/city.js');
const { withSuburban, withTram } = await browserModule('tools/subway/client/network.js');
const { refreshEvery } = await browserModule('tools/buses/client/timing.js');
const trains = await browserModule('tools/trip/client/trains.js');
const live = await browserModule('tools/trip/client/live.js');
const day = read('trains.json');
const city = cityPlanner(rail, read('buses.json'), 3, trainDay(day, '2026-10-21'));
const network = withTram(rail);
const DATE = '2026-10-21';
// What the page draws on once its own trains.json is in (main.js)
const joined = withSuburban(network, day, DATE);

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
const rides = way => way.option.rides.map(ride => [ride.line, ride.boards, ride.arrives]);
// A train ride's number and when it leaves by the timetable, by which the page shows when it actually leaves
const train = way => [way.option.rides[0].train, way.option.rides[0].timetable];

test('with no lateness known, the way is the timetable\'s, as before; its train says its number', () => {
    const way = timed(null);
    const [ride, metro] = row.best[0].legs;
    assert.deepEqual([ride.line, ride.boards, ride.arrives, metro.line], ['A4', A4, 17 * H + 51 * MIN, 'M2']);
    assert.deepEqual(rides(way), [['A4', A4, ride.arrives], ['M2', metro.boards, metro.arrives]]);
    assert.deepEqual(train(way), ['1323', A4]);
    assert.equal(way.train, A4, 'when its train leaves, for asking about the trains');
    assert.deepEqual(timed({ 9999: { late: 600, exact: true } }).option, way.option, 'another train\'s lateness changes nothing');
    // Not timed with the lateness: the half hour's own way says it too
    const [untimed] = halfView(city, megara, syntagma, answer).rows[0].options[0].rides;
    assert.deepEqual([untimed.train, untimed.timetable], ['1323', A4]);
    assert.ok(!('train' in way.option.rides[1]), 'a metro ride has no train number');
});

test('a late train leaves at the timetable\'s time, gets there later, and the rest of the way is timed from then', () => {
    const way = timed({ 1323: { late: 5 * MIN, exact: true } });
    const [ride, metro] = rides(way);
    assert.deepEqual(ride, ['A4', A4, 17 * H + 56 * MIN]);
    assert.deepEqual(train(way), ['1323', A4]);
    assert.equal(metro[0], 'M2');
    assert.ok(metro[1] > 18 * H, `the M2 after it, not the 18:00 (${metro[1] / MIN} min)`);
    assert.ok(way.option.arrives > 18 * H + 6 * MIN);
    // At least so late: the same
    assert.equal(rides(timed({ 1323: { late: 4 * MIN + 10, exact: false } }))[0][2], 17 * H + 55 * MIN + 10);
});

test('a train the timetable would miss is caught when measured late enough to leave 2 minutes to spare', () => {
    const now = at(17 + 10 / 60);
    const next = 18 * H + 8 * MIN;
    // 6 minutes late, due at 17:14: there at 17:10, so it's caught, at the time it's expected
    const caught = timed({ 1323: { late: 6 * MIN, exact: true } }, now);
    assert.deepEqual(rides(caught)[0], ['A4', A4 + 6 * MIN, 17 * H + 57 * MIN]);
    assert.deepEqual(train(caught), ['1323', A4]);
    assert.equal(caught.train, A4 + 6 * MIN, 'when it leaves, for asking about the trains');
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
    assert.deepEqual(ride(null), { ...leg, timetable: 1000, train: 'A' });
    // A running 2 minutes late: B, leaving later, gets there first
    assert.deepEqual(ride({ A: { late: 120, exact: true } }), { ...leg, route: 1, boards: 1050, arrives: 1150, timetable: 1050, train: 'B' });
    // Only at least 30 s late: still there first
    assert.deepEqual(ride({ A: { late: 30, exact: false } }), { ...leg, arrives: 1130, timetable: 1000, train: 'A' });
    // No train left by the timetable, none late enough to catch
    assert.equal(trains.trainRide(planner, leg, 1301, { B: { late: 60, exact: true } }), null);
    assert.equal(trains.trainRide(planner, leg, 1200, null).train, null, 'a trip with no number');
    // Left at 900 by the timetable: caught at 1000 with 2 minutes to spare exactly, not 1 second less
    const missed = { routes: [{ line: 'A1', mode: 'suburban', stops: [10, 20], trips: [[900, 1000], [2000, 2100]], numbers: ['E', 'F'] }] };
    assert.equal(trains.SPARE_SECONDS, 2 * MIN);
    const caught = trains.trainRide(missed, leg, 1000, { E: { late: 100 + trains.SPARE_SECONDS, exact: true } });
    assert.deepEqual([caught.boards, caught.timetable, caught.train], [1000 + trains.SPARE_SECONDS, 900, 'E']);
    assert.deepEqual(trains.trainRide(missed, leg, 1000, { E: { late: 99 + trains.SPARE_SECONDS, exact: true } }).boards, 2000);
});

test('a ride of the timetable\'s says its train\'s number, null where trains.json has none', () => {
    const planner = { routes: [{ line: 'A1', mode: 'suburban', stops: [10, 20], trips: [[1050, 1150], [1300, 1400]], numbers: ['B', null] }, { line: 'A1', mode: 'suburban', stops: [10, 20], trips: [[1000, 1100]] }] };
    assert.equal(trains.trainOf(planner, { route: 0, boardIndex: 0, boards: 1050 }), 'B');
    assert.equal(trains.trainOf(planner, { route: 0, boardIndex: 1, boards: 1400 }), null);
    assert.equal(trains.trainOf(planner, { route: 1, boardIndex: 0, boards: 1000 }), null, 'a trains.json from before the numbers');
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
    const subway = await browserModule('tools/subway/client/render.js', lang);
    const keys = Object.keys(strings(lang));
    const s = strings(lang);
    const check = view => assert.deepEqual(markupProblems(String(view), { keys }), []);
    const json = value => JSON.parse(JSON.stringify(value));
    const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
    const half = json(halfView(city, megara, syntagma, answer));
    // The half hour's answer, its first way timed with these trains'
    // lateness, drawn on `on`: the page's network with its trains.json
    // joined (main.js), or without it, before it's in
    const drawn = (way, late = null, now = at(17).seconds, on = joined) => String(r.renderHalf(on, half.kind, r.halfWays(half, now), syntagma, { now, weekday: 3, date: DATE, live: { way: json(way) }, trains: late }));
    const minutes = m => String(minutesMark(m, k => s[k]));
    // A card's badges, as the Subway page draws them, counted from `now`
    const chips = (now, ...departs) => `<span class="schedule-chips">${departs.map(d => subway.departureChip({ departs: d, isLast: false, isSecondLast: false }, { seconds: now }, false)).join('')}</span>`;
    // The train's card: from the first card to the next (the M2's)
    const trainCard = html => html.split('<li class="trip-leg">')[1];
    const name = id => day.stations[id][lang === 'el' ? 2 : 3];
    const ticket = key => escapeHtml(s[key].replace('{station}', name('megara')));
    // A time that's a guess: "~12:06", "about 12:06" for screen readers
    const about = time => String(aboutTime(time, k => s[k]));
    // When a ride leaves, on the left of its step, strong
    const leaves = time => `<span class="trip-step-when trip-step-leaves">${time}</span>`;

    test(`${lang}: a suburban ride is the Subway page's card: its train, then the next toward the same end`, () => {
        const html = drawn(timed(null));
        check(html);
        const card = trainCard(html);
        assert.ok(card.includes(chips(at(17).seconds, A4, A4 + H)), '1323 at 17:08, then 1325 at 18:08');
        assert.ok(!html.includes(leaves(clock(A4))), 'not a row');
        assert.ok(card.includes(`<p class="leg-boarding">${s['subway.board-at'].replace('{station}', name('megara'))}</p>`), 'its station not a link');
        assert.match(card, new RegExp(`class="direction-text">[\\s\\S]*${name('piraeus')}<`), 'toward where its train ends, without "(suburban)"');
        assert.ok(card.includes(ticket('subway.train-ticket')), 'Megara is outside OASA\'s ticket');
        assert.ok(!card.includes('train-diagram') && !card.includes(s['subway.no-position-data']), 'no train diagram');
        assert.ok(card.includes(`<span class="leg-ride">${minutes(43)} · <button`), 'its ride\'s minutes');
        assert.ok(card.includes(s['subway.transfer-at']), 'a change to the M2 after it');
        assert.ok(nothingUnder(html), 'nothing under the answer but the legend (decisions 43, 46)');
    });

    test(`${lang}: a late train's badge is when it actually leaves, the next one's as late as it runs; no timetable time, no words`, () => {
        const late = { 1323: { late: 5 * MIN, exact: true }, 1325: { late: 2 * MIN, exact: false } };
        const way = timed(late);
        const html = drawn(way, late);
        check(html);
        assert.ok(trainCard(html).includes(chips(at(17).seconds, A4 + 5 * MIN, A4 + H + 2 * MIN)));
        assert.ok(!html.includes(clock(A4)), 'not its timetable time');
        assert.ok(!html.includes('trip-train-late'), 'no line saying how late');
        assert.ok(trainCard(html).includes(`<span class="leg-ride">${minutes(43)} · <button`), 'as long a ride');
        // Over an hour away, by the clock, as on the Subway page
        const { boards } = way.option.rides[1];
        assert.ok(boards - at(17).seconds > H);
        const m2 = String(subway.departureChip({ departs: boards, isLast: false, isSecondLast: false }, { seconds: at(17).seconds }, true));
        assert.ok(html.includes(`<span class="schedule-chips">${m2}`), 'the M2 after it, its card\'s first train timed from it');
        assert.ok(nothingUnder(html));
        // Only at least so late: the same
        const atLeast = { 1323: { late: 4 * MIN, exact: false } };
        assert.ok(trainCard(drawn(timed(atLeast), atLeast)).includes(chips(at(17).seconds, A4 + 4 * MIN, A4 + H)));
    });

    test(`${lang}: a late train caught is its card's first badge, when it's expected`, () => {
        const now = at(17 + 10 / 60);
        const late = { 1323: { late: 6 * MIN, exact: true } };
        const html = drawn(timed(late, now), late, now.seconds);
        check(html);
        assert.ok(trainCard(html).includes(chips(now.seconds, A4 + 6 * MIN, A4 + H)), 'in 4 minutes, at 17:14');
        assert.ok(!html.includes(clock(A4)) && !html.includes(about(clock(A4 + 6 * MIN))), 'no timetable time, no "~"');
    });

    test(`${lang}: the badges are the timetable's until the way is timed with the trains' lateness`, () => {
        const late = { 1323: { late: 5 * MIN, exact: true } };
        const now = at(17).seconds;
        const untimed = String(r.renderHalf(joined, half.kind, r.halfWays(half, now), syntagma, { now, weekday: 3, date: DATE, trains: late }));
        check(untimed);
        assert.ok(trainCard(untimed).includes(chips(now, A4, A4 + H)));
    });

    test(`${lang}: until the page's trains.json is in, a train is a row, its time when it actually leaves`, () => {
        const late = { 1323: { late: 5 * MIN, exact: true } };
        const html = drawn(timed(late), late, at(17).seconds, network);
        check(html);
        assert.ok(html.includes(leaves(clock(A4 + 5 * MIN))), 'without "~"');
        assert.ok(html.includes(ticket('trip.train-ticket')));
        assert.ok(!html.includes('trip-train-late'));
        assert.equal(html.split('<li class="trip-leg">').length, 2, 'the M2 still a card');
        assert.ok(drawn(timed(null), null, at(17).seconds, network).includes(leaves(clock(A4))), 'on time by the timetable');
    });

    test(`${lang}: the notices: the trains' lateness unavailable, with the buses' too, an error either way`, () => {
        for (const status of ['trains-unavailable', 'all-unavailable']) {
            const html = String(r.liveNotice(status));
            check(html);
            assert.deepEqual(notices(html), [{ tone: 'danger', icon: 'error', text: s[status === 'all-unavailable' ? 'trip.all-live-unavailable' : 'trip.trains-live-unavailable'] }]);
        }
    });
}
