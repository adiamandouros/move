import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, nothingUnder, notices } from './support/markup.js';
import { aboutTime, minutesBadge, minutesMark } from '../public/js/core/times.js';

// OASA's live times on the Trip page's way shown in full (decision 35): the
// way timed again with them in the worker (liveWay in
// tools/trip/client/buses.js), which stops are asked for and when (live.js,
// decision 34), and the way drawn with them (render.js), in both languages;
// and on a decision, the quicker way offered and taken (decision 36); with
// the rider followed, the search ahead and the switch (T14, decision 50).
// Over the test data's metro, tram and the buses between Kallithea and
// Syntagma, on a Wednesday. The page's side: test/browser/trip.spec.js.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { cityPlanner, halfHour, halfView, LIVE_STOPS, liveWay, routeCodes, searchAhead, shownRows } = await browserModule('tools/trip/client/buses.js');
const live = await browserModule('tools/trip/client/live.js');
const { withTram } = await browserModule('tools/subway/client/network.js');
const { latinName } = await browserModule('public/js/core/text.js');
const network = withTram(rail);
const city = cityPlanner(rail, buses, 3);

const point = id => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1] });
// A station picked as the trip's start or end: its platforms, with no walk to them through an exit (decision 51)
const station = id => ({ ...point(id), station: id });
const menelaou = { lat: 37.95463, lng: 23.71049 };
const at = hours => ({ weekday: 3, seconds: hours * 3600 });
const MIN = 60;

function answered(from, to, now) {
    const steps = halfHour(city, from, to, now);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}
const codeOf = stop => stop.id.replace('bus:', '');
// The buses of `line` that ride from `board` to `alight` (stop indexes), as OASA names their routes
const routesOf = (line, board, alight) => [...routeCodes(city, [line], board, new Set([alight])).keys()];

// From Menelaou to Syntagma at 10:00 it depends: any bus from near the door,
// the 040 then the M2 from Syggrou-Fix, or the Β2 then the M2
const depends = shownRows(answered(menelaou, station('syntagma'), at(10)));
const busThenTrain = depends.find(row => row.key.startsWith('040'));
const [bus, train] = busThenTrain.best[0].legs;
const BOARD = codeOf(city.stops[bus.board]);
const [ROUTE] = routesOf('040', bus.board, bus.alight);
const timed = (row, stops, now = at(10)) => liveWay(city, menelaou, station('syntagma'), row, 0, now, stops);

test('the rows the page shows are those the worker times again, in the same order', () => {
    const answer = answered(menelaou, station('syntagma'), at(10));
    assert.deepEqual(halfView(city, menelaou, station('syntagma'), answer).rows.map(row => row.range), shownRows(answer).map(row => row.range));
});

test('which of OASA\'s routes ride a bus: the line\'s routes that get from its stop to where it\'s left, not the way back', () => {
    const both = city.routes.filter(route => route.line === '040').map(route => route.code);
    assert.ok(both.length > 1, '040 has more than one route');
    const there = routesOf('040', bus.board, bus.alight);
    assert.ok(there.length > 0 && there.length < both.length, there.join());
    assert.deepEqual(routesOf('040', bus.alight, bus.board), [], 'nothing rides it backwards');
    assert.deepEqual(routesOf('Β2', bus.board, bus.alight), [], 'another line isn\'t one of them');
});

test('before the live times come: the way for leaving now on the timetable, its bus\'s stop to ask, nothing said', () => {
    const way = timed(busThenTrain, {});
    assert.deepEqual(way.asks, [{ stop: BOARD, at: null }]);
    assert.deepEqual(way.stops, []);
    assert.equal(way.option.rides[0].live, undefined);
    // The first 040 that can be walked to from now, as the search has it
    assert.equal(way.option.rides[0].boards, busThenTrain.best[0].legs[0].boards);
});

test('a bus OASA has coming later than the timetable boards then, and the train after it is timed from there', () => {
    const late = 10 * 3600 + 9 * MIN;
    const stops = { [BOARD]: { buses: [
        // Gone before the rider can walk there (2 min 50 s)
        { route: ROUTE, line: '040', at: 10 * 3600 + 1 * MIN },
        { route: ROUTE, line: '040', at: late },
        { route: ROUTE, line: '040', at: late + 11 * MIN },
    ] } };
    const way = timed(busThenTrain, stops);
    const [first, second] = way.option.rides;
    assert.equal(first.boards, late);
    assert.deepEqual(first.live, { at: late, next: late + 11 * MIN });
    // As long a ride as the timetable's from then
    const [timetable] = city.ride([bus], late);
    assert.equal(first.arrives - first.boards, timetable.arrives - timetable.boards);
    // The M2 the rider can make from it, later than the one the timetable had
    assert.ok(second.boards >= first.arrives + (train.walkBefore ?? 0), 'after the bus');
    assert.ok(second.boards > busThenTrain.best[0].legs[1].boards, 'a later train');
    assert.equal(second.live, undefined, 'a train has no live times');
    assert.deepEqual(way.asks, [{ stop: BOARD, at: late }], 'asked again by when that bus comes');
    assert.ok(way.option.arrives > timed(busThenTrain, {}).option.arrives);
});

test('OASA with no bus the rider can catch: said, and the timetable\'s time stays; none to be had: nothing said', () => {
    // The 040 the other way, and a bus of a route the timetable doesn't have, at the same stop
    const away = city.routes.find(route => route.line === '040' && !routesOf('040', bus.board, bus.alight).includes(route.code)).code;
    const none = timed(busThenTrain, { [BOARD]: { buses: [{ route: away, line: '040', at: 10 * 3600 + 5 * MIN }, { route: '99999', line: '040', at: 10 * 3600 + 6 * MIN }] } });
    assert.deepEqual(none.option.rides[0].live, { none: true });
    assert.equal(none.option.rides[0].boards, timed(busThenTrain, {}).option.rides[0].boards);
    assert.deepEqual(none.asks, [{ stop: BOARD, at: null }]);

    const unavailable = timed(busThenTrain, { [BOARD]: { buses: [], unavailable: true } });
    assert.equal(unavailable.option.rides[0].live, undefined);
});

// ── Followed along the way (Plan 7, decision 50) ────────────────────────────

const SYNTAGMA_STOP = station('syntagma');
const followed = (row, step, stops = {}, now = at(10)) => liveWay(city, menelaou, SYNTAGMA_STOP, row, 0, now, stops, { step });
// The timetable's ride from the 040's `offset`th stop to where it gets off, by the trip the way boards
const rideFrom = offset => {
    const times = city.routes[bus.route].trips.find(trip => trip[bus.boardIndex] === bus.boards);
    return times[bus.alightIndex] - times[bus.boardIndex + offset];
};

test('on the bus: the ride gets off when the timetable says from the stop the rider is at, the train after it is timed from that, and the bus\'s stop isn\'t asked', () => {
    const T = 10 * 3600 + 20 * MIN;
    const way = followed(busThenTrain, { leg: 0, kind: 'ride', stop: 2, at: T, walk: 0 });
    const [first, second] = way.option.rides;
    assert.equal(first.boards, bus.boards, 'as the way had it');
    assert.equal(first.arrives, T + rideFrom(2));
    assert.ok(rideFrom(2) > 0 && rideFrom(2) < rideFrom(0), 'less of the ride left than from where it boards');
    assert.ok(second.boards >= first.arrives + (train.walkBefore ?? 0), 'the M2 from when the bus gets there');
    assert.deepEqual(way.asks, [], 'the stop boarded at is behind the rider');
    assert.equal(first.live, undefined);
    assert.equal(way.option.arrives, second.arrives, 'to the door at the station');
});

test('walking to the bus with 3 minutes to go: the first bus from then; waiting at its stop: the first from now; a bus OASA has coming is caught as before', () => {
    const T = 10 * 3600 + 5 * MIN;
    const walking = followed(busThenTrain, { leg: 0, kind: 'walk', stop: 0, at: T, walk: 180 });
    assert.equal(walking.option.rides[0].boards, city.ride([bus], T + 180)[0].boards);
    const waiting = followed(busThenTrain, { leg: 0, kind: 'wait', stop: 0, at: T, walk: 0 });
    assert.equal(waiting.option.rides[0].boards, city.ride([bus], T)[0].boards);
    assert.deepEqual(waiting.asks, [{ stop: BOARD, at: null }], 'still asked for');
    const coming = followed(busThenTrain, { leg: 0, kind: 'wait', stop: 0, at: T, walk: 0 }, { [BOARD]: { buses: [{ route: ROUTE, line: '040', at: T - MIN }, { route: ROUTE, line: '040', at: T + 4 * MIN }] } });
    assert.deepEqual(coming.option.rides[0].live, { at: T + 4 * MIN, next: null }, 'one gone a minute ago isn\'t theirs');
    // Underground: timed as at the last fix, however late the clock is
    const frozen = followed(busThenTrain, { leg: 0, kind: 'wait', stop: 0, at: T, walk: 0 }, {}, at(10.5));
    assert.equal(frozen.option.rides[0].boards, waiting.option.rides[0].boards);
});

test('on the last walk, the door is as far as what\'s left of it; arrived, it\'s now; nothing asked for either', () => {
    const T = 11 * 3600;
    const walking = followed(busThenTrain, { leg: 2, kind: 'last', stop: 0, at: T, walk: 240 });
    assert.equal(walking.option.arrives, T + 240);
    assert.deepEqual(walking.option.rides.map(ride => ride.boards), busThenTrain.best[0].legs.map(leg => leg.boards), 'the rides as the way had them');
    assert.deepEqual(walking.asks, []);
    const arrived = followed(busThenTrain, { leg: 2, kind: 'arrived', stop: 0, at: T, walk: 0 });
    assert.equal(arrived.option.arrives, T);
    assert.deepEqual(arrived.asks, []);
});

test('the rider\'s own bus: of their lines, the one due nearest when they boarded; the stop they get off asked for it, saying so, and the ride off when OASA has it there', () => {
    const T = 10 * 3600 + 20 * MIN;
    const answer = { buses: [{ route: ROUTE, vehicle: 'a', line: '040', at: T - 3 * MIN }, { route: ROUTE, vehicle: 'b', line: '040', at: T + MIN }, { route: '9', vehicle: 'c', line: 'Β2', at: T }] };
    assert.equal(live.ownBus(answer, ['040'], T), 'b');
    assert.equal(live.ownBus(answer, ['040'], T - 2 * MIN), 'a');
    assert.equal(live.ownBus(answer, ['Β2', '040'], T), 'c');
    assert.equal(live.ownBus(answer, ['550'], T), null, 'none of their lines');
    assert.equal(live.ownBus(undefined, ['040'], T), null, 'no answer yet');
    assert.equal(live.ownBus({ buses: [{ route: ROUTE, vehicle: null, line: '040', at: T }] }, ['040'], T), null, 'no code for it');

    const ALIGHT = codeOf(city.stops[bus.alight]);
    const step = { leg: 0, kind: 'ride', stop: 2, at: T, walk: 0 };
    const own = { leg: 0, vehicle: 'b' };
    const asked = liveWay(city, menelaou, SYNTAGMA_STOP, busThenTrain, 0, at(10), {}, { step, own });
    assert.deepEqual(asked.asks, [{ stop: ALIGHT, at: null, ride: true }], 'the stop they get off, marked as for the ride');
    assert.equal(asked.option.rides[0].arrives, T + rideFrom(2), 'by the timetable until OASA says');
    const there = T + 9 * MIN;
    const stops = { [ALIGHT]: { buses: [{ route: ROUTE, vehicle: 'a', line: '040', at: T + 2 * MIN }, { route: ROUTE, vehicle: 'b', line: '040', at: there }] } };
    const said = liveWay(city, menelaou, SYNTAGMA_STOP, busThenTrain, 0, at(10), stops, { step, own });
    assert.deepEqual(said.asks, [{ stop: ALIGHT, at: there, ride: true }], 'asked again by when their bus is due there');
    assert.equal(said.option.rides[0].arrives, there, 'off when OASA has their bus there');
    assert.ok(said.option.rides[1].boards >= there + (train.walkBefore ?? 0), 'the M2 from then');
    // Said to be there already: the timetable's word from where they are
    const passed = liveWay(city, menelaou, SYNTAGMA_STOP, busThenTrain, 0, at(10), { [ALIGHT]: { buses: [{ route: ROUTE, vehicle: 'b', line: '040', at: T - MIN }] } }, { step, own });
    assert.equal(passed.option.rides[0].arrives, T + rideFrom(2));
    // Their bus is another ride's: nothing asked for this one
    assert.deepEqual(liveWay(city, menelaou, SYNTAGMA_STOP, busThenTrain, 0, at(10), {}, { step, own: { leg: 1, vehicle: 'b' } }).asks, []);
    // Still waiting for it: the stop they board at, as before
    assert.deepEqual(liveWay(city, menelaou, SYNTAGMA_STOP, busThenTrain, 0, at(10), {}, { step: { ...step, kind: 'wait' }, own: null }).asks, [{ stop: BOARD, at: null }]);
});

test('a stop first asked for the ride the rider is on says so', () => {
    assert.equal(live.arrivalsUrl('240115', 'ride'), '/api/arrivals?stops=240115&for=plan-ride');
});

test('a last bus that can be any of several: its stops while the rider walks to them or waits, none once they\'re on it', () => {
    const anyBus = depends.find(row => row.bundle);
    const last = anyBus.best[0].legs.length - 1;
    const T = 10 * 3600 + 10 * MIN;
    const waiting = followed(anyBus, { leg: last, kind: 'wait', stop: 0, at: T, walk: 0 });
    assert.equal(waiting.stops.length, anyBus.stops.length);
    assert.ok(waiting.asks.length > 0);
    const riding = followed(anyBus, { leg: last, kind: 'ride', stop: 1, at: T, walk: 0 });
    assert.deepEqual(riding.stops, []);
    assert.deepEqual(riding.asks, []);
});

test('a way that can\'t be made from now, as its last bus has gone for the night, keeps its own times', () => {
    assert.equal(timed(busThenTrain, {}, at(27)), null);
    assert.equal(liveWay(city, menelaou, station('syntagma'), { ...busThenTrain, best: busThenTrain.best.map(() => null) }, 0, at(10), {}), null);
});

test('any bus from near the door: the stops with a bus the rider can catch first, by when it comes, the rest nearest first; at most 10 asked', () => {
    const fix = point('syggrou-fix');
    const [row] = shownRows(answered(menelaou, fix, at(12)));
    assert.ok(row.bundle && row.stops.length > LIVE_STOPS, `${row.stops.length} stops`);
    const doors = new Set(city.near(fix, 15 * MIN).filter((_, i) => i % 2 === 0));
    const busAt = ({ stop, walk, lines }, after) => {
        const [route] = routeCodes(city, lines, stop, doors);
        return { route: route[0], line: route[1], at: 12 * 3600 + walk + after };
    };
    const [nearest, second, third] = row.stops;
    const stops = {
        // Due 10 minutes after the rider gets there, and 2 minutes after, and gone a minute before
        [codeOf(city.stops[nearest.stop])]: { buses: [busAt(nearest, 10 * MIN)] },
        [codeOf(city.stops[third.stop])]: { buses: [busAt(third, 2 * MIN)] },
        [codeOf(city.stops[second.stop])]: { buses: [busAt(second, -MIN)] },
    };
    const way = liveWay(city, menelaou, fix, row, 0, at(12), stops);
    const order = way.stops.map(({ stop }) => stop.id);
    const ids = row.stops.map(({ stop }) => city.stops[stop].id);
    assert.deepEqual(order.slice(0, 2), [ids[2], ids[0]], 'the bus soonest first');
    assert.deepEqual(order.slice(2), ids.filter(id => id !== ids[0] && id !== ids[2]), 'then nearest first');
    assert.deepEqual(way.stops[0].buses, [{ line: busAt(third, 0).line, at: busAt(third, 2 * MIN).at }]);
    assert.deepEqual(way.stops[0].arrivals, [{ line: busAt(third, 0).line, to: null, at: busAt(third, 2 * MIN).at }], 'for its row opened');
    assert.deepEqual(way.stops[2].buses, [], 'answered, but its bus can\'t be caught');
    assert.deepEqual(way.stops[2].arrivals, []);
    assert.equal(way.stops.at(-1).buses, null, 'not asked');
    assert.deepEqual(way.stops.at(-1).arrivals, []);
    // The nearest 10 asked, each by when the bus the rider can catch there comes
    assert.deepEqual(way.asks.map(({ stop }) => stop), ids.slice(0, LIVE_STOPS).map(id => id.replace('bus:', '')));
    assert.deepEqual(way.asks.slice(0, 3).map(({ at: when }) => when), [busAt(nearest, 10 * MIN).at, null, busAt(third, 2 * MIN).at]);
});

test('any bus after a train: the M2 to Syggrou-Fix, then the stops there, each caught from when the train gets in', () => {
    const syntagma = station('syntagma');
    const [row] = shownRows(answered(syntagma, menelaou, at(8.5)));
    assert.equal(row.key, 'M2 at Συγγρού Φιξ, a bus');
    const before = liveWay(city, syntagma, menelaou, row, 0, at(8.5), {});
    const [m2] = before.option.rides;
    assert.equal(m2.line, 'M2');
    assert.deepEqual(before.asks.map(({ stop }) => stop), row.stops.map(({ stop }) => codeOf(city.stops[stop])), 'every stop there, and no train');
    // A bus at the nearest stop before the train gets in can't be caught; one after it can
    const [nearest] = row.stops;
    const doors = new Set(city.near(menelaou, 15 * MIN).filter((_, i) => i % 2 === 0));
    const [[route, line]] = routeCodes(city, nearest.lines, nearest.stop, doors);
    const code = codeOf(city.stops[nearest.stop]);
    const ready = m2.arrives + (nearest.walk ? nearest.walk + 60 : 30);
    const to = { el: 'ΓΛΥΦΑΔΑ', en: 'GLYFADA' };
    const elsewhere = { route: 'not-the-riders', line: '999', to, at: ready + MIN };
    const way = liveWay(city, syntagma, menelaou, row, 0, at(8.5), { [code]: { buses: [{ route, line, to, at: ready + 12 * MIN }, { route, line, at: m2.arrives - MIN }, elsewhere, { route, line, to, at: ready + 4 * MIN }] } });
    assert.deepEqual(way.stops[0].buses, [{ line, at: ready + 4 * MIN }]);
    // Opened, its row lists every bus of the rider's lines they can still catch, soonest first, with where it goes (decision 48)
    assert.deepEqual(way.stops[0].arrivals, [{ line, to, at: ready + 4 * MIN }, { line, to, at: ready + 12 * MIN }]);
});

// ── The page's side (live.js) ───────────────────────────────────────────────

test('a stop is asked for by itself, the trip\'s first request saying it starts a search, a re-plan\'s that it was planned again', () => {
    assert.equal(live.arrivalsUrl('240115', 'start'), '/api/arrivals?stops=240115&for=plan-start');
    assert.equal(live.arrivalsUrl('240115', 'moved'), '/api/arrivals?stops=240115&for=plan-moved');
    assert.equal(live.arrivalsUrl('240115', null), '/api/arrivals?stops=240115&for=plan');
    assert.equal(live.arrivalsUrl('240115'), '/api/arrivals?stops=240115&for=plan');
});

test('an answer\'s buses are due at a time of day, so they count down by themselves, with where they go, and say when they were said; one that couldn\'t be had says so', () => {
    const came = 10 * 3600;
    const piraeus = { el: 'ΠΕΙΡΑΙΑΣ', en: 'PIRAEUS' };
    // OASA's code for each vehicle stays with the bus, so the one the rider boarded is known again (Plan 7)
    assert.deepEqual(live.stopLive({ arrivals: [{ route: '3922', vehicle: '70412', line: '040', to: piraeus, minutes: 4 }, { route: '3922', line: null, to: null, minutes: 0 }, { route: '3922', vehicle: null, line: '040', minutes: 9 }] }, came),
        { buses: [{ route: '3922', vehicle: '70412', line: '040', to: piraeus, at: came + 4 * MIN }, { route: '3922', vehicle: null, line: null, to: null, at: came }, { route: '3922', vehicle: null, line: '040', to: null, at: came + 9 * MIN }], asked: came });
    assert.deepEqual(live.stopLive({ arrivals: [], stale: true }, came), { buses: [], asked: came, stale: true });
    assert.deepEqual(live.stopLive({ arrivals: [], unavailable: true }, came), { buses: [], asked: came, unavailable: true });
    // Asking failed: the last answer, possibly old, or none
    const last = { buses: [{ route: '3922', line: '040', at: came }] };
    assert.deepEqual(live.unanswered(last), { ...last, stale: true });
    assert.deepEqual(live.unanswered(undefined), { buses: [], unavailable: true });
    assert.deepEqual(live.unanswered({ buses: [], unavailable: true }), { buses: [], unavailable: true });
});

test('how often a stop is asked: by the first bus the rider can catch there, on the Buses page\'s tiers', () => {
    const seconds = 10 * 3600;
    const asks = [
        { stop: 'soon', at: seconds + 5 * MIN },
        { stop: 'later', at: seconds + 15 * MIN },
        { stop: 'far', at: seconds + 25 * MIN },
        { stop: 'none', at: null },
        { stop: 'new', at: null },
        { stop: 'busy', at: null },
        { stop: 'down', at: null },
    ];
    const answers = new Map(['soon', 'later', 'far', 'none', 'busy'].map(stop => [stop, { buses: [] }]));
    answers.set('down', { buses: [], unavailable: true });
    const state = since => ({ asking: new Set(['busy']), answers, asked: new Map(['soon', 'later', 'far', 'none', 'busy', 'down'].map(stop => [stop, 1_000_000 - since])) });
    const due = since => live.dueStops(asks, state(since), 1_000_000, seconds);
    // Never asked: at once; being asked: never twice
    assert.deepEqual(due(0), ['new']);
    assert.deepEqual(due(31_000), ['new']);
    assert.deepEqual(due(32_000), ['soon', 'new', 'down'], 'due within 10 minutes, and none to be had: every 30 s');
    assert.deepEqual(due(62_000), ['soon', 'later', 'new', 'down'], 'within 20: every minute');
    assert.deepEqual(due(122_000), ['soon', 'later', 'far', 'none', 'new', 'down'], 'later or none: every 2 minutes');
});

// ── The quicker way on a decision (decision 36) ─────────────────────────────

// From Σταύρου 1 to Μενελάου 45 at noon: the directions stay on the T6 to
// Megalou Alexandrou for any bus there; the quicker way gets off at Agia
// Foteini for any of its buses
const stavrou = { lat: 37.9535, lng: 23.7255 };
const menelaou45 = { lat: 37.955, lng: 23.707 };
const NOON = at(12);
const decided = answered(stavrou, menelaou45, NOON);
const { decision } = decided;
const [directions] = shownRows(decided);
const DEPARTURE = directions.best.findIndex(Boolean);
const QUICKER = codeOf(city.stops[decision.stop]);
const offered = (stops, more = {}) => liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, stops, { decision, ...more });
// The quicker way's bus: its line, and a route of it that gets to where it's left
const [, OFF_BUS] = decision.getOff.best.find(Boolean).legs;
const [QUICKER_ROUTE] = routesOf(OFF_BUS.line, decision.stop, OFF_BUS.alight);
// Every stop asked answered with no bus, but the quicker way's: its buses due `after` seconds from noon
const quickerBus = (after, more = {}) => Object.fromEntries(offered({}).asks.map(({ stop }) => [stop, stop === QUICKER
    ? { buses: after.map(seconds => ({ route: QUICKER_ROUTE, line: OFF_BUS.line, at: NOON.seconds + seconds })), asked: NOON.seconds, ...more }
    : { buses: [], asked: NOON.seconds }]));

test('a decision whose directions have no bus to ask for of their own: the quicker way\'s stop is asked first, nothing offered before it answers', () => {
    assert.equal(decided.kind, 'decision');
    assert.equal(directions, decision.stayOn);
    const way = offered({});
    assert.equal(way.offer, null);
    assert.deepEqual(way.asks[0], { stop: QUICKER, at: null });
    // Then the stops of the directions' last bus, nearest first, as without the decision
    const own = directions.stops.map(({ stop }) => codeOf(city.stops[stop])).slice(0, LIVE_STOPS);
    assert.deepEqual(liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, {}).asks.map(({ stop }) => stop), own);
    assert.deepEqual(way.asks.slice(1).map(({ stop }) => stop), own.filter(stop => stop !== QUICKER));
});

test('OASA has the quicker way\'s bus coming in time, and nothing as quick staying on: offered, how much sooner, where to get off it, the walk', () => {
    const way = offered(quickerBus([16 * MIN, 31 * MIN]));
    const off = decision.getOff.best.find(Boolean);
    assert.equal(way.offer.line, OFF_BUS.line);
    assert.equal(way.offer.at, NOON.seconds + 16 * MIN);
    assert.ok(way.offer.sooner >= 180, `${way.offer.sooner} s`);
    assert.deepEqual(way.offer.ride, { line: 'T6', mode: 'tram' });
    assert.equal(way.offer.change.id, city.stops[off.legs[0].alight].id);
    assert.equal(way.offer.stop.id, city.stops[decision.stop].id);
    assert.equal(way.offer.walk.minutes, Math.max(1, Math.round(off.legs[1].walkBefore / 60)));
    assert.deepEqual(way.asks[0], { stop: QUICKER, at: NOON.seconds + 16 * MIN }, 'asked again by when that bus comes');
    // The directions stay as they are
    assert.deepEqual(way.option, offered({}).option);
});

test('not offered: a bus gone before the tram gets there, one as soon staying on, an older answer, or none to be had', () => {
    assert.equal(offered(quickerBus([MIN])).offer, null, 'gone');
    // Staying on, any of its buses will do: sooner than one of them by the timetable isn't enough
    assert.ok(offered(quickerBus([22 * MIN])).offer);
    assert.equal(offered(quickerBus([24 * MIN])).offer, null, 'no sooner than the first of the directions\' buses');
    assert.equal(offered(quickerBus([16 * MIN], { stale: true })).offer, null, 'older');
    assert.equal(offered(quickerBus([], { unavailable: true })).offer, null, 'none to be had');
    // A bus at the directions' own stops as soon: staying on is as quick
    const stops = quickerBus([16 * MIN]);
    for (const { stop, lines } of directions.stops) {
        const [route] = routeCodes(city, lines, stop, new Set(city.near(menelaou45, 15 * MIN).filter((_, i) => i % 2 === 0)));
        stops[codeOf(city.stops[stop])] = { buses: [{ route: route[0], line: route[1], at: NOON.seconds + 16 * MIN }], asked: NOON.seconds };
    }
    assert.equal(offered(stops).offer, null, 'as soon');
    // Its line the other way, or a bus of a route the timetable doesn't have, isn't the quicker way's
    const away = city.routes.find(route => route.line === OFF_BUS.line && route.code !== QUICKER_ROUTE && !route.stops.includes(decision.stop));
    const other = quickerBus([16 * MIN]);
    other[QUICKER].buses = [away?.code ?? '99999', '99999'].map(route => ({ route, line: OFF_BUS.line, at: NOON.seconds + 16 * MIN }));
    assert.equal(offered(other).offer, null, 'not its route');
});

test('the quicker way taken: it\'s the way timed, from the same tram, with its own stops asked, and nothing more offered', () => {
    const stops = quickerBus([16 * MIN]);
    const taken = offered(stops, { taken: true });
    const directed = offered(stops);
    assert.equal(taken.offer, null);
    assert.deepEqual(taken.option.rides[0].alight, city.stops[decision.getOff.best.find(Boolean).legs[0].alight], 'off the tram sooner');
    assert.equal(taken.option.rides[0].boards, directed.option.rides[0].boards, 'the same tram');
    assert.ok(taken.stops.some(({ stop, buses }) => stop.id === city.stops[decision.stop].id && buses?.[0]?.at === NOON.seconds + 16 * MIN), 'its bus at its stop');
    assert.ok(taken.asks.some(({ stop }) => stop === QUICKER));
    // The directions' bus ride can't be left, so there's nothing to take
    assert.equal(liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, stops, { decision: { ...decision, getOff: { ...decision.getOff, best: decision.getOff.best.map(() => null) } }, taken: true }), null);
});

// The search ahead and the switch (T14, decision 50): the rider followed on
// the directions' T6, two minutes past its second stop
const TRAM = directions.best[DEPARTURE].legs[0];
const ON_TRAM = { leg: 0, kind: 'ride', stop: 1, at: TRAM.boards + 2 * MIN, walk: 0 };
const ahead = (more = {}) => searchAhead(city, stavrou, menelaou45, directions, DEPARTURE, NOON, {}, { step: ON_TRAM, ...more });
const AHEAD = ahead();
const [, ONWARD] = AHEAD.way.legs;
const ONWARD_STOP = codeOf(city.stops[ONWARD.board]);
const [ONWARD_ROUTE] = routesOf(ONWARD.line, ONWARD.board, ONWARD.alight);
// OASA's answer at the way ahead's stop: its bus due `late` seconds after the timetable says
const onwardBus = (late, more = {}) => ({ [ONWARD_STOP]: { buses: [{ route: ONWARD_ROUTE, line: ONWARD.line, at: ONWARD.boards + late }], asked: ON_TRAM.at, ...more } });
const switching = (stops, more = {}) => liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, stops, { step: ON_TRAM, ahead: AHEAD, ...more });

test('the search ahead, on the tram: off it sooner for a bus, the tram as far as there as it\'s timed, from the stops still to come only', () => {
    assert.equal(AHEAD.key, decision.getOff.key, 'the decision\'s other way, found from the tram');
    assert.equal(AHEAD.leg, 0);
    const [tram] = AHEAD.way.legs;
    assert.equal(tram.line, 'T6');
    assert.equal(tram.boards, TRAM.boards, 'the same tram');
    assert.ok(tram.alightIndex < TRAM.alightIndex && tram.alightIndex > TRAM.boardIndex + ON_TRAM.stop, 'off before where the directions get off, after where the rider is');
    assert.ok(ONWARD.boards >= tram.arrives + ONWARD.walkBefore, 'the bus from when they can be at its stop');
    assert.ok(AHEAD.way.at < directions.best[DEPARTURE].at, 'sooner by the timetable');
    // Past where it leaves the tram, it's another way or none; off a ride, none
    const later = ahead({ step: { ...ON_TRAM, stop: tram.alightIndex - TRAM.boardIndex } });
    assert.ok(!later || later.way.legs[0].alightIndex > tram.alightIndex);
    assert.equal(ahead({ step: { ...ON_TRAM, kind: 'wait', stop: 0 } }), null, 'not yet on it');
    assert.equal(ahead({ step: null }), null, 'not followed');
    // Declined, it's never found again
    assert.notEqual(ahead({ declined: [AHEAD.key] })?.key, AHEAD.key);
});

test('the switch: its bus\'s stop asked for the ride, offered when OASA has the bus coming in time and it saves 3\' or more, with its key', () => {
    const before = switching({});
    assert.equal(before.switchTo, null, 'nothing before its stop answers');
    assert.deepEqual(before.asks[0], { stop: ONWARD_STOP, at: null, ride: true }, 'asked first, as for the rider\'s own ride');
    const offer = switching(onwardBus(0)).switchTo;
    assert.equal(offer.key, AHEAD.key);
    assert.equal(offer.line, ONWARD.line);
    assert.equal(offer.at, ONWARD.boards);
    assert.ok(offer.sooner >= 180, `${offer.sooner} s`);
    assert.deepEqual(offer.ride, { line: 'T6', mode: 'tram' });
    assert.equal(offer.change.id, city.stops[AHEAD.way.legs[0].alight].id);
    assert.equal(offer.stop.id, city.stops[ONWARD.board].id);
    assert.equal(offer.walk?.minutes ?? 0, ONWARD.walkBefore ? Math.max(1, Math.round(ONWARD.walkBefore / 60)) : 0);
    assert.ok(switching(onwardBus(3 * MIN)).switchTo, 'as late as it saves 3\'');
    assert.equal(switching(onwardBus(4 * MIN)).switchTo, null, 'later: not worth it');
    assert.equal(switching(onwardBus(-5 * MIN)).switchTo, null, 'gone before the tram gets there');
    assert.equal(switching(onwardBus(0, { stale: true })).switchTo, null, 'an older answer');
    // The directions stay as they are; the decision's own quicker way isn't
    // offered on the tram, where the search ahead has taken over
    assert.deepEqual(switching(onwardBus(0)).option, liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, onwardBus(0), { step: ON_TRAM }).option);
    assert.equal(switching(quickerBus([16 * MIN]), { decision }).offer, null);
    assert.ok(liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, quickerBus([16 * MIN]), { decision, step: { ...ON_TRAM, kind: 'wait', stop: 0, at: NOON.seconds } }).offer, 'waiting for it, still offered');
    // Past where it leaves the tram, or on the walk to it: nothing
    assert.equal(switching(onwardBus(0), { step: { ...ON_TRAM, stop: AHEAD.way.legs[0].alightIndex - TRAM.boardIndex } }).switchTo, null);
    assert.equal(switching(onwardBus(0), { step: { ...ON_TRAM, kind: 'walk', stop: 0, walk: 60 } }).switchTo, null);
});

test('switched to: the way ahead is the way timed, from the same tram, its bus\'s stop asked, and from it another way ahead can be searched', () => {
    const row = { key: AHEAD.key, best: [AHEAD.way], bundle: false, lines: [], stops: [] };
    const way = liveWay(city, stavrou, menelaou45, row, 0, NOON, onwardBus(0), { step: ON_TRAM });
    assert.equal(way.option.rides[0].boards, TRAM.boards);
    assert.equal(way.option.rides[0].alight.id, city.stops[AHEAD.way.legs[0].alight].id);
    assert.deepEqual(way.option.rides[1].live, { at: ONWARD.boards, next: null }, 'its bus as OASA has it');
    assert.deepEqual(way.asks[0], { stop: ONWARD_STOP, at: ONWARD.boards });
    assert.equal(way.switchTo, null);
    assert.notEqual(searchAhead(city, stavrou, menelaou45, row, 0, NOON, {}, { step: ON_TRAM })?.key, AHEAD.key, 'not the way it is');
});

test('what\'s said above the answer: paused, none to be had anywhere, or older times', () => {
    const asks = [{ stop: 'a', at: null }, { stop: 'b', at: null }];
    const answers = entries => new Map(entries);
    assert.equal(live.liveStatus(asks, answers([]), true), 'paused');
    assert.equal(live.liveStatus(asks, answers([]), false), null);
    assert.equal(live.liveStatus(asks, answers([['a', { buses: [], unavailable: true }]]), false), 'unavailable');
    assert.equal(live.liveStatus(asks, answers([['a', { buses: [], unavailable: true }], ['b', { buses: [] }]]), false), null);
    assert.equal(live.liveStatus(asks, answers([['a', { buses: [], stale: true }], ['b', { buses: [] }]]), false), 'stale');
});

// ── Drawn ───────────────────────────────────────────────────────────────────

for (const lang of ['en', 'el']) {
    const r = await browserModule('tools/trip/client/render.js', lang);
    const subway = await browserModule('tools/subway/client/render.js', lang);
    const keys = Object.keys(strings(lang));
    const s = strings(lang);
    const check = view => assert.deepEqual(markupProblems(String(view), { keys }), []);
    const escaped = text => text.replace(/'/g, '&#39;');
    // A train's first badge on its card (decision 46), counted from `now`
    const firstTrain = (departs, at) => `<span class="schedule-chips">${subway.departureChip({ departs, isLast: false, isSecondLast: false }, { seconds: at }, false)}`;
    // Minutes as every page writes them (/js/core/times.js), and a time that's a guess
    const mark = (minutes, options) => String(minutesMark(minutes, key => s[key], options));
    const about = time => String(aboutTime(time, key => s[key]));
    const view = viewOf => JSON.parse(JSON.stringify(viewOf));
    const now = 10 * 3600;
    const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
    const half = view(halfView(city, menelaou, station('syntagma'), answered(menelaou, station('syntagma'), at(10))));
    // The 040 then the M2 first, as the way shown in full
    const shown = { ...half, rows: half.rows.filter(row => !row.bundle) };
    const ways = r.halfWays(shown, now);
    const drawn = (way, more = {}) => String(r.renderHalf(network, shown.kind, ways, station('syntagma'), { now, weekday: 3, live: { way: view(way) }, ...more }));

    test(`${lang}: followed along the way (decision 50): the step the rider is on marked and said, the steps done greyed, the heading when they arrive`, () => {
        const way = timed(busThenTrain, {});
        const steps = html => [...html.matchAll(/<li class="(trip-step|trip-leg)([^"]*)"( aria-current="step")?/g)].map(m => (m[3] ? 'now' : m[2].includes('done') ? 'done' : '') + (m[2].includes('now') && !m[3] ? '!' : ''));
        // The walk to the 040, the 040, the walk to the M2, the M2's card (the door is the station)
        assert.deepEqual(steps(drawn(way)), ['', '', '', '']);
        const heading = html => html.match(/<h2 class="trip-total" tabindex="-1">(.*?)<\/h2>/)[1];
        assert.ok(!heading(drawn(way)).startsWith(s['trip.arrive'].split('{')[0]), 'the range, for someone at the start');
        const walking = drawn(way, { following: { kind: 'walk', ride: 0 } });
        assert.deepEqual(steps(walking), ['now', '', '', '']);
        assert.equal(heading(walking), s['trip.arrive'].replace('{time}', clock(way.option.arrives)), 'when they arrive');
        assert.deepEqual(steps(drawn(way, { following: { kind: 'wait', ride: 0 } })), ['done', 'now', '', '']);
        assert.deepEqual(steps(drawn(way, { following: { kind: 'ride', ride: 0 } })), ['done', 'now', '', '']);
        assert.deepEqual(steps(drawn(way, { following: { kind: 'walk', ride: 1 } })), ['done', 'done', 'now', '']);
        assert.deepEqual(steps(drawn(way, { following: { kind: 'wait', ride: 1 } })), ['done', 'done', 'done', 'now']);
        assert.deepEqual(steps(drawn(way, { following: { kind: 'ride', ride: 1, stop: 2 } })), ['done', 'done', 'done', 'now']);
        assert.deepEqual(steps(drawn(way, { following: { kind: 'last' } })), ['done', 'done', 'done', 'done']);
        assert.deepEqual(steps(drawn(way, { following: { kind: 'arrived' } })), ['done', 'done', 'done', 'done']);
        check(drawn(way, { following: { kind: 'ride', ride: 0 } }));
    });
    // When a ride leaves, on the left of its step, strong
    const leaves = time => `<span class="trip-step-when trip-step-leaves">${time}</span>`;
    // The badges at the right of a bus ride's heading: OASA's, marked live, or the timetable's
    const badges = (live, ...minutes) => `<span class="trip-step-badges${live ? ' trip-live' : ''}">${minutes.map((m, i) => minutesBadge(m, key => s[key], { said: i ? s['trip.next-in'] : undefined })).join('')}</span>`;

    test(`${lang}: a bus OASA has coming, by its time, its minutes and the next one's, at the right of its heading`, () => {
        const way = timed(busThenTrain, { [BOARD]: { buses: [{ route: ROUTE, line: '040', at: now + 6 * MIN + 30 }, { route: ROUTE, line: '040', at: now + 14 * MIN }] } });
        const html = drawn(way);
        check(html);
        assert.ok(html.includes(leaves(clock(now + 6 * MIN + 30))), 'no "~": it\'s OASA\'s');
        assert.ok(html.includes(`<span class="time-badge time-close"><span aria-hidden="true">6'</span><span class="sr-only">${s['shell.minutes'].replace('{minutes}', 6)}</span></span>`));
        assert.ok(html.includes(`${badges(true, 6, 14)}</div>`), 'the next one, "14\'" too, "next in 14 minutes" to a screen reader, ending the heading');
        assert.ok(html.includes(`<span class="sr-only">${s['trip.next-in'].replace('{minutes}', s['shell.minutes'].replace('{minutes}', 14))}</span>`));
        assert.ok(html.includes(firstTrain(way.option.rides[1].boards, now)), 'the train after it, timed from it');
        assert.ok(nothingUnder(html), 'nothing under the answer');
    });

    test(`${lang}: a bus due in 3 minutes or less says so; one that's the last on the road has no "next"`, () => {
        const html = drawn(timed(busThenTrain, { [BOARD]: { buses: [{ route: ROUTE, line: '040', at: now + 3 * MIN }] } }));
        check(html);
        assert.ok(html.includes(`<span class="time-badge time-due"><span aria-hidden="true">3'</span><span class="sr-only">${s['shell.minutes'].replace('{minutes}', 3)}, ${s['shell.arriving-soon']}</span></span>`));
        assert.ok(html.includes(badges(true, 3)), 'no "next"');
    });

    test(`${lang}: no bus on OASA's live times yet: said, with the timetable's "~" time, "about" to a screen reader, and its badges`, () => {
        const way = timed(busThenTrain, { [BOARD]: { buses: [] } });
        const html = drawn(way);
        check(html);
        assert.ok(html.includes(s['trip.live-none']));
        const [bus] = way.option.rides;
        assert.ok(html.includes(leaves(about(clock(bus.boards)))));
        assert.ok(html.includes(badges(false, ...[bus.boards, bus.next].map(at => Math.floor((at - now) / 60)).filter(m => m < 60))), 'the timetable\'s, not marked live');
        assert.ok(nothingUnder(html), 'nothing under the answer');
    });

    test(`${lang}: any bus from near the door: each stop the Buses page's row, the one with a bus first, its next bus and every bus of the rider's lines when opened (decision 48)`, () => {
        const fix = point('syggrou-fix');
        const half12 = view(halfView(city, menelaou, fix, answered(menelaou, fix, at(12))));
        const [row] = shownRows(answered(menelaou, fix, at(12)));
        const [nearest, second, third] = row.stops;
        const doors = new Set(city.near(fix, 15 * MIN).filter((_, i) => i % 2 === 0));
        const [[route, line]] = routeCodes(city, second.lines, second.stop, doors);
        const glyfada = { el: 'ΓΛΥΦΑΔΑ', en: 'GLYFADA' };
        const code = codeOf(city.stops[second.stop]);
        const way = liveWay(city, menelaou, fix, row, 0, at(12), {
            [code]: { buses: [{ route, line, to: glyfada, at: 12 * 3600 + second.walk + 9 * MIN }, { route, line, to: glyfada, at: 12 * 3600 + second.walk + 25 * MIN }] },
            [codeOf(city.stops[nearest.stop])]: { buses: [] },
        });
        const drawnWith = stops => String(r.renderHalf(network, half12.kind, r.halfWays(half12, 12 * 3600), fix, { now: 12 * 3600, weekday: 3, live: { way: view(way) }, stops }));
        const html = drawnWith(new Set());
        check(html);
        assert.ok(!html.includes('stop-favourite'), 'no star on the Trip page');
        // After "Any of these buses": the stop with a bus, then the nearest, answered with none, then one not asked yet
        const [, first, next, unasked] = html.split(/<li class="trip-stop(?: trip-live)?">/);
        assert.equal(html.split('<li class="trip-stop trip-live">').length - 1, 1, 'only the stop with buses from OASA marked live');
        assert.ok(html.indexOf('<li class="trip-stop trip-live">') < html.indexOf('<li class="trip-stop">'), 'and it comes first');
        assert.ok(first.includes(`data-stop="${code}"`) && first.includes('aria-controls="trip-stop-0"') && first.includes('aria-expanded="false"'));
        // Beside its code, the walk to it, "about" to a screen reader
        const walk = way.stops[0].walk.minutes;
        assert.ok(first.includes(`<span class="stop-distance"><span class="sr-only">, </span><span aria-hidden="true">~${walk}'</span><span class="sr-only">${s['trip.walk-short'].replace('{minutes}', s['shell.about'].replace('{what}', s[walk === 1 ? 'shell.minute' : 'shell.minutes'].replace('{minutes}', walk)))}</span></span>`), first);
        // The next bus as on the Buses page: its large plate, where it goes, its minutes beside the button
        assert.ok(first.includes(`<span class="next-bus-line"><span class="bus-plate pill-l">${line}</span></span>`), first);
        assert.ok(first.includes(`<span class="next-bus-dest">${glyfada[lang]}</span>`));
        const due = Math.floor((second.walk + 9 * MIN) / 60);
        assert.ok(first.includes(`<span class="header-badge-wrap" aria-hidden="true"><span class="time-badge time-later"><span aria-hidden="true">${due}'`), 'counted from now');
        assert.ok(first.includes(`aria-label="${s['trip.stop-buses'].replace('{stop}', (names => lang === 'el' ? names.el : names.en || latinName(names.el))(city.stops[second.stop].names))}"`), 'only the rider\'s buses, so not "all arrivals"');
        // Opened: both its buses, each with where it goes; its lines, not links away from the trip
        assert.equal(first.split('class="arrival-row').length - 1, 2);
        assert.ok(!first.includes('plate-link'));
        assert.ok(next.includes(s['trip.live-none']) && !next.includes('arrival-row'));
        assert.ok(next.split('</button>')[0].includes(`<span class="sr-only">. ${s['buses.lines']}: </span>`), 'with none on live times, its lines still beside it');
        assert.ok(unasked.includes(`data-stop="${codeOf(city.stops[third.stop])}"`));
        assert.ok(unasked.split('</button>')[0].includes(`<span class="sr-only">. ${s['buses.lines']}: </span>`) && !unasked.includes('time-badge') && !unasked.includes(s['trip.live-none']), 'its lines, no minutes');
        // Opened by the rider, it stays opened through the redraws
        const opened = drawnWith(new Set([code])).split(/<li class="trip-stop(?: trip-live)?">/)[1];
        assert.ok(opened.includes('aria-expanded="true"') && opened.includes('accordion-collapse collapse show'));
    });

    // From Σταύρου 1 to Μενελάου 45 at noon, a decision (decision 36)
    const decidedView = view(halfView(city, stavrou, menelaou45, decided));
    const decidedWays = r.halfWays(decidedView, NOON.seconds);
    const target = { ...menelaou45, title: 'Μενελάου 45', exact: null };
    const drawnDecided = (way, more = {}) => String(r.renderHalf(network, decidedView.kind, decidedWays, target, { now: NOON.seconds, weekday: NOON.weekday, live: way && { way: view(way) }, ...more }));
    const stopNamed = stop => lang === 'el' ? stop.names.el : stop.names.en || latinName(stop.names.el);

    test(`${lang}: the quicker way offered under the directions: how much sooner, where to get off the tram for which bus, the walk, the choice`, () => {
        const way = offered(quickerBus([16 * MIN]));
        const html = drawnDecided(way, { offer: true });
        check(html);
        const [directed, offer] = html.split('<div class="trip-card" id="trip-quicker">');
        assert.ok(directed.includes('<h2 class="trip-total" tabindex="-1">'), 'the directions first');
        assert.ok(offer.includes(`<h2 class="trip-total trip-total-small">${s['trip.quicker-title'].replace('{minutes}', mark(Math.floor(way.offer.sooner / 60)))}</h2>`));
        assert.equal(r.quickerSummary(way.offer), s['trip.quicker-title'].replace('{minutes}', s['shell.minutes'].replace('{minutes}', Math.floor(way.offer.sooner / 60))), 'in words for a screen reader');
        // Off the T6 at its stop, a tram's ("στη στάση" in Greek, not a station's)
        assert.ok(offer.includes('line-t6'));
        const change = network.stations[way.offer.change.station].name[lang];
        assert.ok(offer.includes(escaped(s['trip.quicker-off'].split('{ride}')[1].replace('{change}', change))), change);
        // For the bus, at its stop, by OASA's time, after the walk
        assert.ok(offer.includes(`<span class="bus-plate pill-m">${OFF_BUS.line}</span>`));
        assert.ok(offer.includes(escaped(s['trip.quicker-bus'].split('{bus}')[1]
            .replace('{stop}', stopNamed(way.offer.stop)).replace('{time}', clock(way.offer.at))).replace('{minutes}', mark(way.offer.walk.minutes, { about: true }))));
        assert.ok(offer.includes(`<button type="button" id="trip-quicker-take" class="btn btn-primary btn-sm rounded-pill px-4">${escaped(s['trip.quicker-take'])}</button>`));
        assert.ok(offer.includes(`<button type="button" id="trip-quicker-keep" class="btn btn-sm locate-btn">${escaped(s['trip.quicker-keep'])}</button>`));
        // Kept, or none in time: the directions alone
        assert.ok(!drawnDecided(way, { offer: false }).includes('trip-quicker'));
        assert.ok(!drawnDecided(offered({}), { offer: true }).includes('trip-quicker'));
    });

    test(`${lang}: the quicker way taken: its steps in the directions' place, said, with the way back; before its live times, the half hour's own`, () => {
        const taken = offered(quickerBus([16 * MIN]), { taken: true });
        const html = drawnDecided(taken, { offer: true, taken: decidedView.quicker });
        check(html);
        const [low, high] = decidedView.quicker.range;
        assert.ok(html.includes(`<h2 class="trip-total" tabindex="-1">${low === high ? mark(low, { about: true }) : mark([low, high])}</h2>`));
        assert.ok(html.includes(`<span class="trip-arrives">${escaped(s['trip.quicker-taken'])}</span>`));
        assert.ok(html.includes(`<button type="button" id="trip-quicker-back" class="btn btn-sm locate-btn trip-stand">${escaped(s['trip.quicker-back'])}</button>`));
        assert.ok(!html.includes('trip-quicker-take'), 'nothing more offered');
        assert.ok(html.includes(`<span class="next-bus-line"><span class="bus-plate pill-l">${OFF_BUS.line}</span></span>`) && html.includes('<span class="header-badge-wrap" aria-hidden="true"><span class="time-badge'), 'its bus with its minutes');
        const waiting = drawnDecided(null, { taken: decidedView.quicker });
        check(waiting);
        assert.ok(waiting.includes(escaped(s['trip.quicker-back'])) && waiting.includes(escaped(s['trip.any-bus-then'])));
    });

    test(`${lang}: on the way, the switch to a way 3' sooner in the quicker way's place, with when it's taken by itself; switched, that way with the way back`, () => {
        const way = switching(onwardBus(0));
        const html = drawnDecided(way, { offer: true, switching: { offer: way.switchTo, seconds: 7 }, following: { kind: 'ride', ride: 0, stop: 1 } });
        check(html);
        const [, offer] = html.split('<div class="trip-card" id="trip-quicker">');
        assert.ok(offer.includes(`<h2 class="trip-total trip-total-small">${s['trip.quicker-title'].replace('{minutes}', mark(Math.floor(way.switchTo.sooner / 60)))}</h2>`));
        assert.ok(offer.includes('line-t6') && offer.includes(`<span class="bus-plate pill-m">${ONWARD.line}</span>`), 'off the tram for the bus');
        assert.ok(offer.includes(`<p class="trip-other" id="trip-switch-timer" role="timer">${escaped(r.switchIn(7))}</p>`));
        assert.equal(r.switchIn(7), s['trip.switch-in'].replace('{seconds}', 7));
        assert.ok(offer.includes('id="trip-quicker-take"') && offer.includes('id="trip-quicker-keep"'));
        // Onward by train: its pill
        const byTrain = drawnDecided(way, { switching: { offer: { ...way.switchTo, line: 'M2', mode: 'metro' }, seconds: 7 } });
        assert.ok(byTrain.split('id="trip-quicker"')[1].includes('line-m2'));
        // Switched: the way ahead timed, in the directions' place, said, with the way back
        const row = { key: AHEAD.key, best: [AHEAD.way], bundle: false, lines: [], stops: [] };
        const onto = liveWay(city, stavrou, menelaou45, row, 0, NOON, onwardBus(0), { step: ON_TRAM });
        const switched = drawnDecided(onto, { switched: true, following: { kind: 'ride', ride: 0, stop: 1 } });
        check(switched);
        assert.ok(switched.includes(`<span class="trip-arrives">${escaped(s['trip.quicker-taken'])}</span>`));
        assert.ok(switched.includes(`<button type="button" id="trip-quicker-back" class="btn btn-sm locate-btn trip-stand">${escaped(s['trip.quicker-back'])}</button>`));
        assert.ok(!switched.includes('trip-quicker-take') && !switched.includes(escaped(s['trip.any-bus-then'])), 'its bus a ride of its own, nothing more offered');
        assert.ok(switched.split('route-option-label')[0].includes(`<span class="bus-plate pill-m">${ONWARD.line}</span>`), 'its bus in the way shown');
    });

    test(`${lang}: paused, unavailable or older live times, said above the answer: an error when they can't be had, a warning when the answer may be off; paused with a button`, () => {
        check(r.liveNotice('paused'));
        assert.match(String(r.liveNotice('paused')), new RegExp(`${s['trip.live-paused']} <button type="button" class="btn btn-link btn-sm p-0 align-baseline">${s['trip.live-resume']}</button>`));
        assert.deepEqual(notices(r.liveNotice('paused')).map(({ tone, icon }) => [tone, icon]), [['warn', 'warning']]);
        assert.deepEqual(notices(r.liveNotice('unavailable')), [{ tone: 'danger', icon: 'error', text: s['trip.live-unavailable'] }]);
        assert.deepEqual(notices(r.liveNotice('stale')), [{ tone: 'warn', icon: 'warning', text: s['trip.live-stale'] }]);
        assert.equal(r.liveNotice(null), '');
    });
}
