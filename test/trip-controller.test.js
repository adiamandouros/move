import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The Trip page's trip, its search answers, its live times, the ride
// followed and the rider's choices (roadmap Trip · state,
// tools/trip/client/controller.js): given these events, these jobs. Each
// test is a case main.js meets; the page's side: test/browser/trip.spec.js.

const { AHEAD_MS, HALF_REWORK_SECONDS, SWITCH_SECONDS, tripController } = await browserModule('tools/trip/client/controller.js');
const { CHECK_WAIT_MS, FRESH_MS } = await browserModule('tools/trip/client/live.js');

// A Wednesday morning in Athens, `seconds` since midnight, the page in sight
const AT = 8.5 * 3600;
const clock = (seconds = AT, hidden = false) => ({ ms: seconds * 1000, now: { weekday: 3, seconds, date: '2026-11-18' }, hidden });

// The ends as main.js makes them: places found, and My location
const SYNTAGMA = { lat: 37.9755, lng: 23.7353, title: 'Syntagma', station: 'syntagma' };
const MENELAOU = { lat: 37.955, lng: 23.707, title: 'Μενελάου 45' };
const FIX = { lat: 37.964, lng: 23.726, title: 'Syggrou-Fix', station: 'syggrou-fix' };
const HERE = { lat: 37.97, lng: 23.73, title: 'My location' };
const ON = { lat: 37.968, lng: 23.729, title: 'My location' };

// A way to follow, of the city's search: from START 300 m east to the 040's
// stop, three stops north 400 m apart, then 300 m east to the door
const north = (metres, from) => ({ lat: from.lat + metres / 111_195, lng: from.lng });
const east = (metres, from) => ({ lat: from.lat, lng: from.lng + metres / (111_195 * Math.cos(from.lat * Math.PI / 180)) });
const START = { lat: 37.9755, lng: 23.7353 };
const BOARD = east(300, START);
const STOPS = [0, 1, 2].map(i => north(i * 400, BOARD));
const DOOR = { ...east(300, STOPS[2]), title: 'Door' };
const BUS = { city: true, firstWalk: { minutes: 4, meters: 300 }, lastWalk: { minutes: 4, meters: 300 },
    rides: [{ line: '040', lines: ['040'], mode: 'bus', board: { id: 'bus:60002' }, alight: { id: 'bus:60010' }, along: STOPS.map(({ lat, lng }) => [lat, lng]), past: [], walkBefore: null }] };
// Another way with a bus, the 550 from the same stop; and with what OASA's
// live times say of its bus (buses.js RideLive)
const OTHER = { ...BUS, rides: [{ ...BUS.rides[0], line: '550', lines: ['550'] }] };
const timedOther = live => ({ ...OTHER, rides: [{ ...OTHER.rides[0], live }] });
// 50 m along the walk to the stop: the start left
const LEFT = east(50, START);

// The worker's answers: the ways with a bus for leaving now, and a half hour
// from `first` (its first departure), each of its rows a way by the same
// option at both departures: the bus way, unless said
const OPTIONS = [{ city: true, minutes: 24 }];
const row = (key, o) => ({ key, options: [o, o], range: [20, 24], bundle: false, lines: [] });
const view = (first = AT, rows = [row('bus', BUS)], kind = 'clear') => ({ kind, departures: [first, first + 120], rows, ms: 40 });
// The bus way and the 550 beside it
const twoWays = (first = AT) => view(first, [row('bus', BUS), row('550', OTHER)]);
const timing = { city: 120, answer: 30 };

// The page: the controller, told events at `clock()` unless said, opened at AT
function page({ buses = true, suburban = true } = {}) {
    const trip = tripController({ buses, suburban, at: AT * 1000, hereTitle: 'My location', railOn: () => null });
    const tell = (event, at = clock()) => trip.tell(event, at);
    return { trip, tell };
}
// My location at `point`, as the controller makes it
const mine = point => ({ lat: point.lat, lng: point.lng, title: 'My location' });
// A fix from the phone at `point`, `seconds` after midnight, 5 m exact
const fix = (point, seconds = AT) => ({ lat: point.lat, lng: point.lng, at: seconds * 1000, accuracy: 5 });
const located = (point, seconds, more = {}) => ({ type: 'located', position: fix(point, seconds), typing: false, held: false, ...more });

const did = jobs => jobs.map(job => job.do);
const asked = jobs => jobs.find(job => job.do === 'search')?.ask;
const drawn = jobs => jobs.find(job => job.do === 'draw');
const rendered = jobs => jobs.find(job => job.do === 'render');
const timedAsk = jobs => jobs.find(job => job.do === 'time' && 'live' in job.ask)?.ask;
const othersAsk = jobs => jobs.find(job => job.do === 'time' && 'others' in job.ask)?.ask;
const stopsAsked = jobs => jobs.filter(job => job.do === 'ask-stop');

// The answer drawn, as main.js draws it for a draw job: the answer for
// leaving now worked out on the page (with no ways of its own, walking not
// quicker unless said), for when the trip was asked (AT unless said)
const ANSWER = { options: [], walkFirst: false };
const WALK = { options: [], walkFirst: true };
const drawing = (tell, more = {}, at = clock()) => tell({ type: 'drawing', now: clock().now, answer: ANSWER, speak: false, sayHalf: false, ...more }, at);

// The worker's timing of a way that asks OASA for `stops` (and has `train`)
const liveWay = (stops, train = null) => ({ asks: stops.map(stop => ({ stop, at: null })), train });
// The clock's second and the page back in sight, no fix and nobody in the
// answer (nor a switch on the page to count down)
const SECOND = { type: 'second', position: null, held: false, counting: false };
const VISIBLE = { type: 'visible', position: null, held: false };
// A stop's answer from OASA: a bus `minutes` away
const arrivals = (minutes = 4) => ({ buses: [{ route: '1', vehicle: null, line: '040', to: null, at: AT + minutes * 60 }], asked: AT });

// A trip from Syntagma to Menelaou 45, asked, and its answer for leaving now in
function answered(options) {
    const p = page(options);
    p.tell({ type: 'from', place: SYNTAGMA, say: true });
    const search = asked(p.tell({ type: 'to', place: MENELAOU, say: true }));
    p.tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false });
    return { ...p, search };
}
// And its half hour in too
function withHalf(options, half = view()) {
    const p = answered(options);
    p.tell({ type: 'half', id: p.search.id, view: half, held: false });
    return p;
}
// My location at HERE to Menelaou 45, answered with its half hour; nothing
// drawn yet to follow, so the trip is planned again once the rider has moved
// far enough (moveOn)
function fromHere() {
    const p = page();
    p.tell({ type: 'to', place: MENELAOU });
    const search = asked(p.tell({ type: 'use-location', position: fix(HERE), say: true }));
    p.tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false });
    p.tell({ type: 'half', id: search.id, view: view(), held: false });
    return { ...p, search };
}
// The rider moved on to `point` 2 minutes after the trip was planned: planned again from there
const moveOn = (tell, point = ON, seconds = AT + 120) => tell(located(point, seconds), clock(seconds));
// My location at START to the door, the bus way answered with its half hour
// and drawn for following, and the rider 50 m along the walk to the stop
function followed() {
    const p = page();
    p.tell({ type: 'to', place: DOOR });
    const search = asked(p.tell({ type: 'use-location', position: fix(START), say: true }));
    p.tell({ type: 'answer', id: search.id, options: [BUS], trains: true, timing, held: false });
    p.tell({ type: 'half', id: search.id, view: view(), held: false });
    drawing(p.tell);
    p.tell(located(LEFT, AT + 10), clock(AT + 10));
    return { ...p, search };
}
// Off the way for a minute from 2 minutes after it was planned: planned again from there
function offTheWay(tell, point = north(500, START), seconds = AT + 130) {
    tell(located(point, seconds), clock(seconds));
    return tell(located(point, seconds + 70), clock(seconds + 70));
}

test('one end only: the page says what it does, and keeps the end it has (a start picked: My location off)', () => {
    const { trip, tell } = page();
    const jobs = tell({ type: 'from', place: SYNTAGMA, say: true });
    assert.deepEqual(did(jobs), ['following', 'keep-ride', 'keep', 'intro']);
    assert.deepEqual(jobs[2], { do: 'keep', from: SYNTAGMA, to: null });
    assert.equal(trip.stage, 'none');
});

test('both ends: said to be worked out, the live times started over, and searched for leaving now with its half hour', () => {
    const { trip, tell } = page();
    tell({ type: 'from', place: SYNTAGMA });
    const jobs = tell({ type: 'to', place: MENELAOU, say: true });
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'show-live', 'search']);
    assert.deepEqual(asked(jobs), { id: asked(jobs).id, from: SYNTAGMA, to: MENELAOU, now: clock().now, half: true });
    assert.equal(trip.stage, 'searching');
    assert.equal(trip.answer(), null);
});

test('its answer: drawn for when it was asked, and said when an end was picked', () => {
    const { trip, tell } = page();
    tell({ type: 'from', place: SYNTAGMA });
    const search = asked(tell({ type: 'to', place: MENELAOU, say: true }));
    const jobs = tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false }, clock(AT + 5));
    assert.deepEqual(jobs, [{ do: 'draw', now: clock().now, buses: OPTIONS, speak: true }]);
    assert.equal(trip.stage, 'answered');
    assert.deepEqual(trip.answer(), { from: SYNTAGMA, to: MENELAOU, now: clock().now, options: OPTIONS });
});

test('an end picked again before the answer came: the first answer is dropped, the second drawn', () => {
    const { trip, tell } = page();
    tell({ type: 'from', place: SYNTAGMA });
    const first = asked(tell({ type: 'to', place: MENELAOU }));
    const second = asked(tell({ type: 'to', place: FIX }));
    assert.deepEqual(tell({ type: 'answer', id: first.id, options: OPTIONS, trains: true, timing, held: false }), []);
    assert.equal(trip.stage, 'searching');
    assert.deepEqual(did(tell({ type: 'answer', id: second.id, options: OPTIONS, trains: true, timing, held: false })), ['draw']);
    assert.equal(trip.answer().to, FIX);
});

test('the half hour: its timing, then drawn with the answer and said once drawn', () => {
    const { trip, tell, search } = answered();
    const jobs = tell({ type: 'half', id: search.id, view: view(), held: false });
    assert.deepEqual(jobs, [{ do: 'timing' }, { do: 'draw', now: clock().now, buses: OPTIONS, speak: false, half: { say: true } }]);
    assert.equal(trip.halfHour().view.kind, 'clear');
    assert.equal(trip.timing.half.ms, 40);
});

test('the half hour before the answer for leaving now: its timing only, and drawn with the answer', () => {
    const { trip, tell } = page();
    tell({ type: 'from', place: SYNTAGMA });
    const search = asked(tell({ type: 'to', place: MENELAOU }));
    assert.deepEqual(tell({ type: 'half', id: search.id, view: view(), held: false }), [{ do: 'timing' }]);
    assert.ok(trip.halfHour(), 'kept for the answer to draw');
    assert.deepEqual(did(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false })), ['draw']);
});

test('someone in the answer: nothing is drawn under them, the next refresh does it', () => {
    const { trip, tell } = page();
    tell({ type: 'from', place: SYNTAGMA });
    const search = asked(tell({ type: 'to', place: MENELAOU }));
    assert.deepEqual(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: true }), []);
    assert.equal(trip.stage, 'answered', 'in, only not drawn');
    assert.deepEqual(tell({ type: 'half', id: search.id, view: view(), held: true }), [{ do: 'timing' }]);
    assert.deepEqual(tell({ type: 'redraw', held: true }), []);
    assert.deepEqual(tell({ type: 'refresh', held: true }), []);
    assert.deepEqual(did(tell({ type: 'redraw', held: false })), ['draw']);
});

test('the minute\'s refresh: searched again for now, the half hour too only once it\'s 10 minutes old', () => {
    const { trip, tell } = withHalf();
    const minute = tell({ type: 'refresh', held: false }, clock(AT + 60));
    assert.deepEqual(did(minute), ['keep', 'search', 'retime'], 'the same trip: not started over');
    assert.equal(asked(minute).half, false);
    assert.equal(asked(minute).now.seconds, AT + 60);
    assert.equal(trip.stage, 'answered', 'the answer before stays till the new one');
    assert.equal(asked(tell({ type: 'refresh', held: false }, clock(AT + HALF_REWORK_SECONDS - 1))).half, false);
    assert.equal(asked(tell({ type: 'refresh', held: false }, clock(AT + HALF_REWORK_SECONDS))).half, true);
});

test('a refresh\'s answer is drawn for its own time; the half hour asked before it still counts', () => {
    const { tell, search } = answered();
    const minute = asked(tell({ type: 'refresh', held: false }, clock(AT + 60)));
    assert.equal(drawn(tell({ type: 'answer', id: minute.id, options: OPTIONS, trains: true, timing, held: false })).now.seconds, AT + 60);
    assert.deepEqual(did(tell({ type: 'half', id: search.id, view: view(), held: false })), ['timing', 'draw']);
    assert.deepEqual(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false }), [], 'the first search, overtaken');
});

test('past midnight the half hour is worked out again', () => {
    const p = answered();
    p.tell({ type: 'half', id: p.search.id, view: view(86_000), held: false });
    assert.equal(asked(p.tell({ type: 'refresh', held: false }, clock(100))).half, true);
});

test('a refresh while the rider is followed along the way: drawn as it is, not searched for leaving the start now', () => {
    const { tell } = followed();
    const jobs = tell({ type: 'refresh', held: false }, clock(AT + 60));
    assert.deepEqual(did(jobs), ['keep', 'draw', 'retime']);
    assert.equal(drawn(jobs).now.seconds, AT);
});

test('a refresh with no trip: nothing', () => {
    const { tell } = page();
    tell({ type: 'to', place: MENELAOU });
    assert.deepEqual(tell({ type: 'refresh', held: false }), []);
});

test('planned again from where the rider moved to: the answer before stays till the new half hour, which isn\'t said', () => {
    const { trip, tell } = fromHere();
    const jobs = moveOn(tell);
    assert.deepEqual(did(jobs), ['keep', 'show-live', 'search'], 'not started over: the stops keep their answers');
    assert.deepEqual(asked(jobs), { id: asked(jobs).id, from: mine(ON), to: MENELAOU, now: clock(AT + 120).now, half: true });
    assert.equal(trip.plannedAt, (AT + 120) * 1000);
    assert.equal(trip.stage, 'searching');
    const { id } = asked(jobs);
    assert.deepEqual(tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false }), [], 'held till its half hour');
    assert.ok(trip.holding());
    assert.deepEqual(tell({ type: 'redraw', held: false }), []);
    assert.deepEqual(tell({ type: 'half', id, view: view(AT + 120), held: false }),
        [{ do: 'timing' }, { do: 'draw', now: clock(AT + 120).now, buses: OPTIONS, speak: false, half: { say: false } }]);
    assert.equal(trip.holding(), false);
    assert.equal(trip.stage, 'answered');
    // Said again for the next trip picked
    const next = asked(tell({ type: 'to', place: FIX }));
    tell({ type: 'answer', id: next.id, options: OPTIONS, trains: true, timing, held: false });
    assert.deepEqual(tell({ type: 'half', id: next.id, view: view(), held: false })[1].half, { say: true });
});

test('planned again, and the minute\'s refresh before its half hour is in: still held till the half hour, which isn\'t said', () => {
    const { trip, tell } = fromHere();
    const { id } = asked(moveOn(tell));
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    const minute = tell({ type: 'refresh', held: false }, clock(AT + 150));
    assert.equal(asked(minute).half, false, 'its half hour is still being worked out');
    assert.deepEqual(tell({ type: 'answer', id: asked(minute).id, options: OPTIONS, trains: true, timing, held: false }), []);
    assert.ok(trip.holding());
    assert.deepEqual(tell({ type: 'half', id, view: view(AT + 120), held: false })[1].half, { say: false });
});

// Its own search still out: nothing more asked, as the answer is on its way.
// Asked again, the trip started over: the answer kept while planned again
// taken away for "Working out the trip…", every stop's live times asked again
test('the minute\'s refresh before the answer planned again from where the rider moved to: nothing asked again, the answer before kept, the stops keep their answers', () => {
    const { trip, tell } = followed();
    const way = timedAsk(tell({ type: 'retime' }, clock(AT + 10))).live;
    const [stop] = stopsAsked(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }, clock(AT + 10)));
    const { id } = asked(offTheWay(tell));
    assert.deepEqual(did(tell({ type: 'refresh', held: false }, clock(AT + 230))), ['keep', 'retime']);
    assert.notDeepEqual(tell({ type: 'stop', code: '60002', ticket: stop.ticket, answer: arrivals() }, clock(AT + 231)), [], 'not started over: the stop\'s answer still counts');
    assert.ok(trip.holding());
    assert.deepEqual(tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false }), [], 'held till its half hour, as before');
    assert.deepEqual(tell({ type: 'half', id, view: view(AT + 200), held: false })[1],
        { do: 'draw', now: clock(AT + 200).now, buses: OPTIONS, speak: false, half: { say: false } });
});

test('the minute\'s refresh before a new trip\'s answer: not asked again, and the answer said as the end picked asked', () => {
    const { tell } = page();
    tell({ type: 'from', place: SYNTAGMA });
    const search = asked(tell({ type: 'to', place: MENELAOU, say: true }));
    assert.deepEqual(did(tell({ type: 'refresh', held: false }, clock(AT + 60))), ['keep', 'retime']);
    assert.deepEqual(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false }), [{ do: 'draw', now: clock().now, buses: OPTIONS, speak: true }]);
});

test('the page opening once My location has asked for the trip kept: not asked again', () => {
    const { tell } = page();
    tell({ type: 'kept', from: null, to: MENELAOU, picked: null });
    const search = asked(tell({ type: 'use-location', position: fix(HERE), say: false }));
    assert.deepEqual(did(tell({ type: 'open' })), ['keep']);
    assert.equal(drawn(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false })).speak, false);
});

test('the minute\'s refresh while the ride kept is still being searched: not searched again for now, the ride still passed on once', () => {
    const { tell } = page();
    tell({ type: 'kept', from: null, to: MENELAOU, picked: null });
    const ride = { from: ON, at: 5_000, now: clock(AT - 900).now, key: 'bus:1>bus:2', steps: [], state: {} };
    const search = asked(tell({ type: 'resume', ride }));
    assert.deepEqual(did(tell({ type: 'refresh', held: false }, clock(AT + 60))), ['keep', 'retime']);
    assert.deepEqual(drawn(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false })).now, ride.now);
});

test('planned again: the half hour held in the answer, so the next answer after it is drawn', () => {
    const { trip, tell } = fromHere();
    const { id } = asked(moveOn(tell));
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    assert.deepEqual(tell({ type: 'half', id, view: view(), held: true }), [{ do: 'timing' }]);
    assert.equal(trip.holding(), false, 'the half hour is in');
    assert.deepEqual(did(tell({ type: 'redraw', held: false })), ['draw']);
});

test('the answers still to come: planned again drops the way\'s and the other ways\' timing, not the stops\'; a new trip drops all', () => {
    const p = page();
    const { trip, tell } = p;
    tell({ type: 'to', place: DOOR });
    const { id } = asked(tell({ type: 'use-location', position: fix(START), say: true }));
    tell({ type: 'answer', id, options: [BUS], trains: true, timing, held: false });
    tell({ type: 'half', id, view: twoWays(), held: false });
    // Drawn before the rider leaves: the way shown and the other way timed
    const shown = drawing(tell);
    const others = othersAsk(shown).others;
    const [stop, other] = stopsAsked(tell({ type: 'timed', seq: timedAsk(shown).live.seq, way: liveWay(['60002', '240003']), others: null }));
    // The rider leaves: timed again from where they are, then off the way
    const way = timedAsk(tell(located(LEFT, AT + 10), clock(AT + 10))).live;
    offTheWay(tell);
    assert.deepEqual(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }), []);
    assert.deepEqual(tell({ type: 'others-timed', seq: others.seq, ways: [] }), []);
    assert.equal(trip.times.way, null);
    assert.ok(tell({ type: 'stop', code: '60002', ticket: stop.ticket, answer: arrivals() }).length, 'the stop\'s answer counts');
    assert.ok(trip.times.answers.has('60002'));
    tell({ type: 'to', place: FIX });
    assert.deepEqual(tell({ type: 'stop', code: '240003', ticket: other.ticket, answer: arrivals() }), []);
    assert.equal(trip.times.answers.size, 0, 'a new trip asks its stops again');
});

test('the ends swapped: a new trip the other way', () => {
    const { trip, tell } = withHalf();
    const jobs = tell({ type: 'swap' });
    assert.deepEqual(did(jobs), ['following', 'keep-ride', 'keep', 'new-trip', 'show-live', 'search']);
    assert.equal(asked(jobs).from, MENELAOU);
    assert.equal(asked(jobs).to, SYNTAGMA);
    assert.equal(trip.halfHour(), null, 'the half hour was the other way\'s');
    assert.equal(trip.timing.half, null);
});

test('From following the rider before there\'s a To: nothing asked, and the trip starts from there', () => {
    const { trip, tell } = page();
    tell({ type: 'use-location', position: fix(HERE), say: true });
    assert.deepEqual(tell({ type: 'located', position: fix(ON), typing: false, held: false }), []);
    assert.deepEqual(trip.from, mine(ON));
    assert.deepEqual(asked(tell({ type: 'to', place: MENELAOU })).from, mine(ON));
});

test('the trip kept: set as the page opens, asked once it\'s ready', () => {
    const { trip, tell } = page();
    assert.deepEqual(tell({ type: 'kept', from: SYNTAGMA, to: MENELAOU, picked: null }), []);
    assert.equal(trip.stage, 'searching', 'not asked yet');
    const jobs = tell({ type: 'open' });
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'show-live', 'search']);
    assert.equal(asked(jobs).speak, undefined);
    assert.equal(drawn(tell({ type: 'answer', id: asked(jobs).id, options: OPTIONS, trains: true, timing, held: false })).speak, false, 'nothing picked: not said');
});

test('the ride kept taken up: searched for when it was, and planned as of then', () => {
    const { trip, tell } = page();
    tell({ type: 'kept', from: null, to: MENELAOU, picked: null });
    const ride = { from: ON, at: 5_000, now: clock(AT - 900).now, key: 'bus:1>bus:2', steps: [], state: {}, choice: 'taken' };
    const jobs = tell({ type: 'resume', ride });
    assert.deepEqual(did(jobs), ['from-here', 'following', 'keep', 'new-trip', 'show-live', 'search']);
    assert.deepEqual(asked(jobs).from, mine(ON));
    assert.deepEqual(asked(jobs).now, ride.now);
    assert.equal(trip.plannedAt, 5_000);
    assert.equal(drawn(tell({ type: 'answer', id: asked(jobs).id, options: OPTIONS, trains: true, timing, held: false })).speak, true);
    // A refresh later keeps when it was planned
    tell({ type: 'refresh', held: false }, clock(AT + 60));
    assert.equal(trip.plannedAt, 5_000);
});

test('when the trip was planned: once for its ends, again for new ones', () => {
    const { trip, tell } = withHalf();
    assert.equal(trip.plannedAt, AT * 1000);
    tell({ type: 'refresh', held: false }, clock(AT + 60));
    assert.equal(trip.plannedAt, AT * 1000);
    tell({ type: 'to', place: FIX }, clock(AT + 90));
    assert.equal(trip.plannedAt, (AT + 90) * 1000);
});

test('no searches to be had from the start: drawn at once by metro and tram, for now', () => {
    const { trip, tell } = page({ buses: false });
    tell({ type: 'from', place: SYNTAGMA });
    const jobs = tell({ type: 'to', place: MENELAOU, say: true });
    assert.deepEqual(jobs.slice(1), [{ do: 'draw', now: clock().now, buses: [], speak: true }]);
    assert.equal(trip.stage, 'answered');
    assert.equal(trip.noBuses, true);
    assert.deepEqual(tell({ type: 'redraw', held: false }, clock(AT + 30)), [{ do: 'draw', now: clock(AT + 30).now, buses: [], speak: false }]);
    assert.deepEqual(did(tell({ type: 'refresh', held: false }, clock(AT + 60))), ['keep', 'draw', 'retime']);
});

test('the searches failing: by metro and tram from now on, the live times started over, said when a newer Wayhop waits', () => {
    const { trip, tell, search } = withHalf();
    const way = timedAsk(drawing(tell)).live;
    const jobs = tell({ type: 'failed', updated: true }, clock(AT + 30));
    assert.deepEqual(jobs, [{ do: 'show-live', status: null }, { do: 'keep', from: SYNTAGMA, to: MENELAOU }, { do: 'draw', now: clock(AT + 30).now, buses: [], speak: true }]);
    assert.equal(trip.noBuses, 'updated');
    assert.equal(trip.answer(), null);
    assert.deepEqual(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }), [], 'nothing asked before counts');
    assert.deepEqual(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false }), []);
    assert.deepEqual(did(page().tell({ type: 'failed', updated: false })), ['show-live', 'keep', 'intro'], 'with no trip: the page says what it does');
});

test('no suburban trains today: said, unless the railway is hidden on the Subway page', () => {
    for (const [suburban, said] of [[true, true], [false, false]]) {
        const { trip, tell } = page({ suburban });
        tell({ type: 'from', place: SYNTAGMA });
        const search = asked(tell({ type: 'to', place: MENELAOU }));
        tell({ type: 'answer', id: search.id, options: OPTIONS, trains: false, timing, held: false });
        assert.equal(trip.noTrains, said);
    }
});

test('how long the searches took, for /trip?timing: the city\'s time stays when the next answer made none', () => {
    const { trip, tell } = withHalf();
    assert.deepEqual({ ...trip.timing, half: Boolean(trip.timing.half) }, { city: 120, answer: 30, half: true });
    const minute = asked(tell({ type: 'refresh', held: false }, clock(AT + 60)));
    tell({ type: 'answer', id: minute.id, options: OPTIONS, trains: true, timing: { city: null, answer: 20 }, held: false });
    assert.equal(trip.timing.city, 120);
    assert.equal(trip.timing.answer, 20);
});

// What's drawn (decision 33): the half hour's ways in place of the answer
// for leaving now, as the controller decides what's shown of them

test('drawn: the half hour\'s ways in place of the answer for leaving now, said when it\'s just in; walking quicker, or no half hour yet, the answer for leaving now', () => {
    const { tell } = withHalf();
    const half = rendered(drawing(tell, { sayHalf: true }));
    assert.deepEqual({ now: half.now, answer: half.answer, ways: half.ways.map(way => [way.row.key, way.departure]), speak: half.speak, sayHalf: half.sayHalf, offered: half.offered },
        { now: clock().now, answer: ANSWER, ways: [['bus', 0]], speak: false, sayHalf: true, offered: null });
    assert.deepEqual({ ...half.view, othersTimed: [...half.view.othersTimed] }, { kind: 'clear', live: null, offer: true, taken: null, switching: null, switched: false,
        othersTimed: [], onward: null, take: true, picked: false, lead: false, lost: false, checking: null, gone: false });
    const walk = rendered(drawing(tell, { answer: WALK, speak: true, sayHalf: true }));
    assert.deepEqual({ ways: walk.ways, view: walk.view, speak: walk.speak, sayHalf: walk.sayHalf }, { ways: [], view: null, speak: true, sayHalf: false }, 'nothing of the half hour to say');
    assert.equal(rendered(drawing(answered().tell)).view, null, 'no half hour yet');
});

// The live times (decisions 35, 42, 62 and 63): the way shown and the other
// ways timed by the worker with OASA's answers, each stop asked when it's due

// A trip answered with its half hour, the way shown drawn and timed by the
// worker as asking OASA for `stops` (with `train`); its jobs as it came in
function timedWay(stops, { train = null, options } = {}) {
    const p = withHalf(options);
    const way = timedAsk(drawing(p.tell)).live;
    const jobs = p.tell({ type: 'timed', seq: way.seq, way: liveWay(stops, train), others: null });
    return { ...p, jobs };
}

test('the way shown drawn: timed by the worker for leaving now with the live times there are; the same way again isn\'t, another departure is', () => {
    const { tell, search } = withHalf();
    const ask = timedAsk(drawing(tell));
    assert.deepEqual(ask, { id: search.id, live: { seq: ask.live.seq, row: 0, departure: 0, now: clock().now, stops: {}, taken: false, trains: null, step: null, own: null,
        ahead: false, declined: [], switched: null, switchedWay: null, here: null } });
    assert.equal(timedAsk(drawing(tell)), undefined);
    assert.equal(timedAsk(drawing(tell, { now: clock(AT + 120).now })).live.departure, 1, 'drawn for its next departure');
});

test('its timing in: the live times said, its stops asked at once, the first saying a trip starts; the answer drawn', () => {
    const { trip, jobs } = timedWay(['60002', '60003']);
    assert.deepEqual(did(jobs), ['show-live', 'ask-stop', 'ask-stop', 'draw-answer']);
    assert.deepEqual(stopsAsked(jobs).map(({ code, opening }) => ({ code, opening })), [{ code: '60002', opening: 'start' }, { code: '60003', opening: null }]);
    assert.deepEqual(jobs.at(-1), { do: 'draw-answer' }, 'unless someone is in it');
    assert.deepEqual(trip.times.way.way.asks.map(a => a.stop), ['60002', '60003']);
    assert.ok(trip.times.directions, 'the directions\' timing, for going back to them');
});

test('a stop\'s answer: counted, both ways timed again with it; asked again only once it\'s due, and not while it\'s being asked', () => {
    const { trip, tell, jobs } = timedWay(['60002', '60003']);
    const [first] = stopsAsked(jobs);
    const answered = tell({ type: 'stop', code: '60002', ticket: first.ticket, answer: arrivals() }, clock(AT + 1));
    assert.deepEqual(did(answered), ['show-live', 'time']);
    assert.deepEqual(timedAsk(answered).live.stops, { '60002': arrivals() });
    assert.equal(trip.times.asked.get('60002'), (AT + 1) * 1000);
    assert.deepEqual(tell(SECOND, clock(AT + 2)), [], 'one just answered, the other being asked');
    assert.deepEqual(stopsAsked(tell(SECOND, clock(AT + 200))).map(job => [job.code, job.opening]), [['60002', null]]);
});

test('a stop with no answer: its last one kept, marked older, and said so; none before, unavailable', () => {
    const { trip, tell, jobs } = timedWay(['60002']);
    const [first] = stopsAsked(jobs);
    assert.deepEqual(tell({ type: 'stop', code: '60002', ticket: first.ticket, answer: null })[0], { do: 'show-live', status: 'unavailable' });
    const [again] = stopsAsked(tell(SECOND, clock(AT + 100)));
    tell({ type: 'stop', code: '60002', ticket: again.ticket, answer: arrivals() });
    const [third] = stopsAsked(tell(SECOND, clock(AT + 300)));
    assert.deepEqual(tell({ type: 'stop', code: '60002', ticket: third.ticket, answer: null })[0], { do: 'show-live', status: 'stale' });
    assert.equal(trip.times.answers.get('60002').stale, true);
    assert.equal(trip.times.answers.get('60002').buses.length, 1);
});

test('paused once untouched long enough: said, nothing asked; a touch goes on, both ways timed again', () => {
    const { trip, tell } = timedWay(['60002']);
    assert.deepEqual(tell(SECOND, clock(AT + 600)), [], 'touched 10 minutes ago: not yet');
    assert.deepEqual(tell(SECOND, clock(AT + 601)), [{ do: 'show-live', status: 'paused' }]);
    assert.equal(trip.times.paused, true);
    assert.deepEqual(tell(SECOND, clock(AT + 900)), [], 'nothing asked while paused');
    const touched = tell({ type: 'touch' }, clock(AT + 602));
    assert.deepEqual(did(touched), ['show-live', 'time']);
    assert.equal(touched[0].status, null);
    assert.equal(trip.times.touched, (AT + 602) * 1000);
    assert.deepEqual(tell({ type: 'touch' }, clock(AT + 603)), [], 'not paused: only when it was touched');
    assert.equal(trip.times.touched, (AT + 603) * 1000);
});

test('out of sight: nothing asked; back in sight, what\'s due is asked at once', () => {
    const { tell, jobs } = timedWay(['60002']);
    const [first] = stopsAsked(jobs);
    tell({ type: 'stop', code: '60002', ticket: first.ticket, answer: arrivals() });
    assert.deepEqual(tell(SECOND, clock(AT + 300, true)), []);
    assert.deepEqual(did(tell(VISIBLE, clock(AT + 301))), ['ask-stop']);
});

test('the worker\'s timing coming in out of sight (the phone locked): its stops asked once it\'s back', () => {
    const { tell } = withHalf();
    const way = timedAsk(drawing(tell)).live;
    assert.deepEqual(stopsAsked(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }, clock(AT, true))), []);
    assert.deepEqual(stopsAsked(tell(VISIBLE, clock(AT + 30))).map(job => [job.code, job.opening]), [['60002', 'start']]);
});

test('nothing timed: the second asks nothing', () => {
    const { tell } = withHalf();
    assert.deepEqual(tell(SECOND, clock(AT + 900)), []);
});

test('the way with a train: how late the trains run asked with its stops, once at a time; the answer timed with, or said to be missing', () => {
    const { tell, jobs } = timedWay(['60002'], { train: 1234 });
    assert.deepEqual(did(jobs), ['show-live', 'ask-stop', 'ask-trains', 'draw-answer']);
    assert.equal(did(tell(SECOND, clock(AT + 200))).includes('ask-trains'), false, 'being asked');
    const missing = tell({ type: 'trains', answer: null }, clock(AT + 601));
    assert.deepEqual(missing[0], { do: 'show-live', status: 'trains-unavailable' });
    assert.equal(timedAsk(missing).live.trains, null);
    const late = { at: '2026-11-18T06:30:00Z', trains: { 1234: { late: 3, exact: true } } };
    assert.deepEqual(timedAsk(tell({ type: 'trains', answer: late }, clock(AT + 700))).live.trains, late.trains);
});

test('the way shown with nothing left to time: a timing still to come for the way before doesn\'t count, so its stops aren\'t asked', () => {
    const { trip, tell } = withHalf();
    const way = timedAsk(drawing(tell)).live;
    assert.deepEqual(did(drawing(tell, { answer: WALK })), ['render'], 'walking is quicker now');
    assert.deepEqual(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }), []);
    assert.equal(trip.times.way, null);
});

test('the way shown timed, then nothing left to time: its live times go, said', () => {
    const { trip, tell } = timedWay(['60002']);
    assert.deepEqual(drawing(tell, { answer: WALK }).at(-1), { do: 'show-live', status: null });
    assert.equal(trip.times.way, null);
});

test('the other ways shown: timed, each asking only for its first bus\'s stop, the first saying it\'s another way\'s; none, and the timing before doesn\'t count', () => {
    const { trip, tell } = withHalf(undefined, twoWays());
    const shown = drawing(tell);
    const ask = othersAsk(shown).others;
    assert.deepEqual(ask, { seq: ask.seq, ways: [{ row: 1, departure: 0 }], now: clock().now, stops: {}, trains: null });
    assert.equal(stopsAsked(tell({ type: 'timed', seq: timedAsk(shown).live.seq, way: liveWay(['60002']), others: null }))[0].opening, 'start');
    assert.equal(othersAsk(drawing(tell)), undefined, 'the same ways');
    const timed = tell({ type: 'others-timed', seq: ask.seq, ways: [{ row: 1, departure: 0, option: OTHER, asks: [{ stop: '240003', at: null }] }] });
    assert.deepEqual(did(timed), ['show-live', 'ask-stop', 'draw-answer']);
    assert.deepEqual(stopsAsked(timed).map(job => [job.code, job.opening]), [['240003', 'other']]);
    assert.deepEqual([...rendered(drawing(tell)).view.othersTimed.values()].map(way => way.asks[0].stop), ['240003'], 'drawn with their timing');
    // None to time: dropped, and one still to come doesn't count
    const again = othersAsk(drawing(tell, { now: clock(AT + 120).now })).others;
    drawing(tell, { answer: WALK });
    assert.deepEqual(trip.times.others.ways, []);
    assert.deepEqual(tell({ type: 'others-timed', seq: again.seq, ways: [] }), []);
});

// OASA rank (decision 72): the first card's way and the other ways shown
// compared by the weights on live times, `cost` minutes after AT each
const ranked = (minutes, live = true) => ({ arrives: AT + minutes * 60, cost: AT + minutes * 60, live, waiting: !live });
// The half hour's own way (row 0, 'bus') and the other way (row 1, '550')
// timed with those costs; the jobs as the second came in
function bothTimed(tell, half, other) {
    const shown = drawing(tell);
    const first = timedAsk(shown).live;
    tell({ type: 'timed', seq: first.seq, way: { ...liveWay([]), rank: half === null ? null : ranked(half) }, others: null });
    const ask = othersAsk(shown).others;
    return tell({ type: 'others-timed', seq: ask.seq, ways: [{ row: 1, departure: 0, option: OTHER, asks: [], rank: other === null ? null : ranked(other) }] });
}
const order = jobs => rendered(jobs).ways.map(way => way.row.key);

test('OASA rank: another way a tie or more cheaper on live times leads, said once, the half hour\'s own among the other ways; timed again as such', () => {
    const { tell } = withHalf(undefined, twoWays());
    bothTimed(tell, 40, 30);
    const swapped = drawing(tell);
    assert.deepEqual(order(swapped), ['550', 'bus']);
    assert.equal(rendered(swapped).view.lead, true);
    assert.deepEqual(swapped.filter(job => job.do === 'say'), [{ do: 'say', what: 'lead' }]);
    assert.deepEqual(timedAsk(swapped).live.row, 1, 'the way that leads timed as the first card is');
    assert.deepEqual(othersAsk(swapped).others.ways, [{ row: 0, departure: 0 }], 'the half hour\'s own timed as another way');
    const again = drawing(tell);
    assert.deepEqual(order(again), ['550', 'bus']);
    assert.equal(again.filter(job => job.do === 'say').length, 0, 'said once');
});

test('OASA rank: under a tie cheaper, or with either cost unknown, nothing moves; once it leads it stays till the half hour\'s own is a tie cheaper', () => {
    for (const [half, other] of [[40, 38], [null, 20], [40, null]]) {
        const { tell } = withHalf(undefined, twoWays());
        bothTimed(tell, half, other);
        const jobs = drawing(tell);
        assert.deepEqual(order(jobs), ['bus', '550'], `${half} against ${other}`);
        assert.equal(rendered(jobs).view.lead, false);
    }
    const { tell } = withHalf(undefined, twoWays());
    bothTimed(tell, 40, 30);
    const swapped = drawing(tell);
    // The way that leads timed at 31', the half hour's own at 29': 2' isn't a tie
    tell({ type: 'timed', seq: timedAsk(swapped).live.seq, way: { ...liveWay([]), rank: ranked(31) }, others: null });
    const ask = othersAsk(swapped).others;
    tell({ type: 'others-timed', seq: ask.seq, ways: [{ row: 0, departure: 0, option: BUS, asks: [], rank: ranked(29) }] });
    assert.deepEqual(order(drawing(tell)), ['550', 'bus'], 'stays');
    tell({ type: 'others-timed', seq: ask.seq, ways: [{ row: 0, departure: 0, option: BUS, asks: [], rank: ranked(27) }] });
    const back = drawing(tell);
    assert.deepEqual(order(back), ['bus', '550'], 'back');
    assert.equal(rendered(back).view.lead, false);
});

test('OASA rank: the half hour\'s own not answered by OASA yet stays first; on a decision, the quicker way doesn\'t lead, it\'s offered', () => {
    const { tell } = withHalf(undefined, twoWays());
    const shown = drawing(tell);
    tell({ type: 'timed', seq: timedAsk(shown).live.seq, way: { ...liveWay([]), rank: ranked(40, false) }, others: null });
    tell({ type: 'others-timed', seq: othersAsk(shown).others.seq, ways: [{ row: 1, departure: 0, option: OTHER, asks: [], rank: ranked(30) }] });
    assert.deepEqual(order(drawing(tell)), ['bus', '550'], 'the timetable\'s alone');

    const decided = { ...twoWays(), kind: 'decision' };
    decided.quicker = decided.rows[1];
    const p = withHalf(undefined, decided);
    bothTimed(p.tell, 40, 30);
    assert.deepEqual(order(drawing(p.tell)), ['bus', '550']);
});

test('OASA rank: a way the rider took from the other ways comes first, not the one that leads, and nothing leads after', () => {
    const { tell } = withHalf(undefined, twoWays());
    bothTimed(tell, 40, 30);
    assert.deepEqual(order(drawing(tell)), ['550', 'bus']);
    assert.deepEqual(did(tell({ type: 'take', key: 'bus', keyboard: false, position: null }, clock(AT + 10))), ['keep-picked', 'draw-answer', 'say']);
    const taken = drawing(tell, {}, clock(AT + 11));
    assert.deepEqual({ keys: order(taken), lead: rendered(taken).view.lead }, { keys: ['bus', '550'], lead: false });
});

test('followed along the way: the ways on from where the rider is asked in place of the other ways, with where they are', () => {
    const { trip, tell } = followed();
    const way = timedAsk(tell({ type: 'retime' }, clock(AT + 20))).live;
    assert.deepEqual({ step: way.step, here: way.here, own: way.own },
        { step: { leg: 0, kind: 'walk', stop: 0, at: AT + 20, walk: way.step.walk }, here: { lat: LEFT.lat, lng: LEFT.lng }, own: null });
    assert.ok(way.step.walk > 0, 'what\'s left of the walk to the stop');
    const onward = [{ key: 'b', leg: -1, option: OPTIONS[0], asks: [{ stop: '400100', at: null }] }];
    const jobs = tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: onward });
    assert.deepEqual(stopsAsked(jobs).map(job => [job.code, job.opening]), [['60002', 'start'], ['400100', 'other']]);
    assert.equal(trip.times.onward, onward);
    assert.deepEqual(rendered(drawing(tell, {}, clock(AT + 21))).view.onward, onward, 'drawn in place of the other ways');
});

test('planned again from where the rider moved to: the stops keep their answers, only new ones asked at once, the first saying so', () => {
    const { tell } = followed();
    const way = timedAsk(tell({ type: 'retime' }, clock(AT + 10))).live;
    const [first] = stopsAsked(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }, clock(AT + 10)));
    tell({ type: 'stop', code: '60002', ticket: first.ticket, answer: arrivals() }, clock(AT + 195));
    const moved = offTheWay(tell);
    assert.deepEqual(moved.find(job => job.do === 'show-live'), { do: 'show-live', status: null }, 'nothing timed yet');
    const { id } = asked(moved);
    tell({ type: 'answer', id, options: [BUS], trains: true, timing, held: false });
    tell({ type: 'half', id, view: view(AT + 200), held: false });
    const again = timedAsk(drawing(tell, { now: clock(AT + 200).now }, clock(AT + 200))).live;
    const timed = tell({ type: 'timed', seq: again.seq, way: liveWay(['60002', '70000']), others: null }, clock(AT + 201));
    assert.deepEqual(stopsAsked(timed).map(job => [job.code, job.opening]), [['70000', 'moved']]);
});

// My location and the ride followed (decisions 45, 50, 58 and 63)

test('My location pressed with a position known: From from it, on, the location followed, the answer said', () => {
    const { trip, tell } = page();
    tell({ type: 'to', place: MENELAOU });
    const jobs = tell({ type: 'locate', known: fix(HERE) });
    assert.deepEqual(did(jobs), ['from-here', 'following', 'keep', 'new-trip', 'show-live', 'search', 'start-location']);
    assert.deepEqual(jobs[1], { do: 'following', on: true });
    assert.deepEqual(trip.from, mine(HERE));
    assert.equal(drawn(tell({ type: 'answer', id: asked(jobs).id, options: OPTIONS, trains: true, timing, held: false })).speak, true);
});

test('My location pressed with none yet: said to be found, and the first fix fills From; blocked, said, and off', () => {
    const { trip, tell } = page();
    tell({ type: 'to', place: MENELAOU });
    assert.deepEqual(tell({ type: 'locate', known: null }), [{ do: 'following', on: true }, { do: 'from-status', status: 'finding' }, { do: 'start-location' }]);
    assert.deepEqual(did(tell(located(HERE, AT))).slice(0, 2), ['from-here', 'following']);
    assert.deepEqual(trip.from, mine(HERE));
    // Pressed again elsewhere with none, then blocked: said, off, the ride forgotten
    const other = page();
    other.tell({ type: 'locate', known: null });
    assert.deepEqual(other.tell({ type: 'location-problem', problem: 'denied' }),
        [{ do: 'from-status', status: 'denied' }, { do: 'following', on: false }, { do: 'keep-ride', ride: null }]);
    assert.deepEqual(other.tell(located(HERE, AT)), [], 'off: a fix does nothing');
    // Slow isn't said; unavailable is, and stays on
    const slow = page();
    slow.tell({ type: 'locate', known: null });
    assert.deepEqual(slow.tell({ type: 'location-problem', problem: 'slow' }), []);
    assert.deepEqual(slow.tell({ type: 'location-problem', problem: 'unavailable' }), [{ do: 'from-status', status: 'unavailable' }]);
});

test('a fix with no start fills From, but not while someone is in From', () => {
    const { trip, tell } = page();
    tell({ type: 'permission', permission: 'granted', typed: false });
    assert.deepEqual(tell(located(HERE, AT, { typing: true })), []);
    assert.equal(trip.from, null);
    assert.deepEqual(did(tell(located(HERE, AT + 1))), ['from-here', 'following', 'keep', 'intro']);
});

test('the browser\'s word as the page opens: allowed, followed; blocked, off; a start typed meanwhile wins', () => {
    assert.deepEqual(page().tell({ type: 'permission', permission: 'granted', typed: false }), [{ do: 'following', on: true }, { do: 'start-location' }]);
    assert.deepEqual(page().tell({ type: 'permission', permission: 'denied', typed: false }), [{ do: 'following', on: false }, { do: 'keep-ride', ride: null }]);
    assert.deepEqual(page().tell({ type: 'permission', permission: 'prompt', typed: false }), []);
    assert.deepEqual(page().tell({ type: 'permission', permission: 'granted', typed: true }), [], 'typed, not on');
});

test('a start picked, or the ends swapped, turns My location off and forgets the ride', () => {
    const { trip, tell } = followed();
    const jobs = tell({ type: 'from', place: SYNTAGMA, say: true });
    assert.deepEqual(jobs.slice(0, 2), [{ do: 'following', on: false }, { do: 'keep-ride', ride: null }]);
    assert.equal(trip.riding, false);
    assert.deepEqual(followed().tell({ type: 'swap' }).slice(0, 2), [{ do: 'following', on: false }, { do: 'keep-ride', ride: null }]);
});

test('before there\'s a way to follow: planned again from where the rider is once they\'ve moved 20 m, 2 minutes after the last plan, in sight and not under the keyboard', () => {
    const { trip, tell } = page();
    tell({ type: 'to', place: MENELAOU });
    const { id } = asked(tell({ type: 'use-location', position: fix(HERE), say: true }));
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    const away = north(100, HERE);
    assert.deepEqual(tell(located(away, AT + 60), clock(AT + 60)), [], 'too soon');
    assert.deepEqual(tell(located(away, AT + 120, { held: true }), clock(AT + 120)), [], 'the keyboard in the answer');
    assert.deepEqual(tell(located(away, AT + 120), clock(AT + 120, true)), [], 'out of sight');
    const jobs = tell(located(away, AT + 120), clock(AT + 120));
    assert.deepEqual(did(jobs), ['keep', 'show-live', 'search']);
    assert.deepEqual(asked(jobs).from, mine(away));
    assert.equal(trip.plannedAt, (AT + 120) * 1000);
    // The clock's second does it too, from the last fix there is
    const second = page();
    second.tell({ type: 'to', place: MENELAOU });
    second.tell({ type: 'use-location', position: fix(HERE), say: true });
    assert.deepEqual(did(second.tell({ ...SECOND, position: fix(away, AT + 120) }, clock(AT + 120))), ['keep', 'show-live', 'search']);
});

test('followed: the way drawn is the rider\'s once they\'ve left the start, each fix placing them on it, the ride kept with the trip', () => {
    const p = page();
    p.tell({ type: 'to', place: DOOR });
    const search = asked(p.tell({ type: 'use-location', position: fix(START), say: true }));
    assert.equal(p.trip.followed(), null, 'no way to follow yet: nothing for the trace');
    p.tell({ type: 'answer', id: search.id, options: [BUS], trains: true, timing, held: false });
    p.tell({ type: 'half', id: search.id, view: view(), held: false });
    const kept = jobs => jobs.filter(job => job.do === 'keep-ride');
    assert.deepEqual(kept(drawing(p.tell)), [{ do: 'keep-ride', ride: null }], 'not left yet: nothing kept');
    assert.equal(p.trip.stage, 'followed');
    // The trace (decision 69) has the way followed and the rider's place on it
    const followed = p.trip.followed();
    assert.deepEqual({ kinds: followed?.steps.map(s => s.kind), step: followed?.state.step, left: followed?.left },
        { kinds: ['walk', 'wait', 'ride', 'last'], step: 0, left: false });
    assert.deepEqual(kept(drawing(p.tell)), [], 'the same way: the steps stay');
    assert.deepEqual(p.tell(located(east(10, START), AT + 5), clock(AT + 5)), [], 'within 20 m of the start');
    assert.equal(p.trip.riding, false);
    const jobs = p.tell(located(LEFT, AT + 10), clock(AT + 10));
    assert.equal(p.trip.riding, true);
    assert.equal(p.trip.stage, 'riding');
    assert.deepEqual(p.trip.onStep(), { kind: 'walk', ride: 0, from: mine(START), to: BOARD });
    assert.deepEqual(did(jobs), ['from-status', 'time'], 'on the walk it was on: not drawn again, nothing more kept');
    assert.equal(p.trip.followed()?.left, true, 'left the start, for the trace too');
    assert.deepEqual(jobs[0], { do: 'from-status', status: 'following' });
    assert.equal(timedAsk(jobs).live.ahead, true, 'walking: the ways from where they are searched first');
    // At the stop: waiting, kept, timed from there and drawn; the ways from
    // there searched no more than once a minute
    const atStop = p.tell(located(BOARD, AT + 40), clock(AT + 40));
    assert.equal(p.trip.onStep().kind, 'wait');
    assert.equal(p.trip.followed()?.state.step, 1, 'waiting, for the trace too');
    assert.deepEqual(did(atStop), ['keep-ride', 'time', 'draw']);
    const ride = atStop[0].ride;
    assert.deepEqual({ from: ride.from, at: ride.at, key: ride.key, own: ride.own, choice: ride.choice, switched: ride.switched },
        { from: { lat: START.lat, lng: START.lng }, at: AT * 1000, key: 'bus:60002>bus:60010', own: null, choice: null, switched: null });
    assert.equal(timedAsk(atStop).live.ahead, false);
    // Still waiting a minute after the last search from where they are: searched again
    assert.equal(AHEAD_MS, 60_000);
    const later = AT + 10 + AHEAD_MS / 1000;
    assert.equal(p.tell(located(BOARD, later - 1), clock(later - 1)).length, 0, 'not yet');
    assert.equal(timedAsk(p.tell(located(BOARD, later), clock(later))).live.ahead, true);
    // Nothing kept while out of sight but the ride itself
    assert.deepEqual(did(p.tell({ type: 'hidden' })), ['keep-ride']);
});

test('followed: From says how long ago the last position came once it\'s 2 minutes, said once each minute', () => {
    const { tell } = followed();
    assert.deepEqual(tell(SECOND, clock(AT + 60)), [], 'following, as said');
    assert.deepEqual(tell(SECOND, clock(AT + 10 + 121)).filter(job => job.do === 'from-status'), [{ do: 'from-status', status: 2 }]);
    assert.deepEqual(tell(SECOND, clock(AT + 10 + 150)).filter(job => job.do === 'from-status'), []);
    assert.deepEqual(tell(SECOND, clock(AT + 10 + 181)).filter(job => job.do === 'from-status'), [{ do: 'from-status', status: 3 }]);
});

// Followed to the stop, its stop asked of OASA with the way's timing, and
// answered with `due` (the buses OASA has coming there)
function atTheStop(due) {
    const p = followed();
    const way = timedAsk(p.tell(located(BOARD, AT + 40), clock(AT + 40))).live;
    const [ask] = stopsAsked(p.tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }, clock(AT + 40)));
    p.tell({ type: 'stop', code: '60002', ticket: ask.ticket, answer: due }, clock(AT + 41));
    return p;
}

test('boarding the bus: the rider\'s own is the one of its lines OASA had due nearest then, sent with the way\'s timing and kept with the ride', () => {
    const { tell } = atTheStop({ buses: [{ route: '1', vehicle: '2041', line: '040', to: null, at: AT + 90 }, { route: '2', vehicle: '9999', line: '550', to: null, at: AT + 95 }], asked: AT + 40 });
    const jobs = tell(located(STOPS[1], AT + 200), clock(AT + 200));
    assert.deepEqual(timedAsk(jobs).live.own, { leg: 0, vehicle: '2041' });
    assert.equal(timedAsk(jobs).live.ahead, true, 'at a stop of the ride: the search ahead');
    // Kept with the ride from the fix that boards it, so a ride taken up
    // from that save has its own bus (decision 58), and from then on
    assert.deepEqual(jobs.find(job => job.do === 'keep-ride').ride.own, { leg: 0, vehicle: '2041' });
    assert.deepEqual(tell({ type: 'hidden' })[0].ride.own, { leg: 0, vehicle: '2041' });
});

test('off the way for a minute: planned again from where the rider is, no sooner than 2 minutes after the last plan', () => {
    const { trip, tell } = followed();
    const off = north(500, START);
    const jobs = offTheWay(tell, off);
    assert.deepEqual(did(jobs).slice(-3), ['keep', 'show-live', 'search']);
    assert.deepEqual(asked(jobs).from, mine(off));
    assert.equal(trip.plannedAt, (AT + 200) * 1000);
});

test('followed and standing still 10 minutes, untouched: the live times paused; moving on goes on', () => {
    const { trip, tell } = followed();
    const way = timedAsk(tell({ type: 'retime' }, clock(AT + 10))).live;
    tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }, clock(AT + 10));
    tell({ type: 'touch' }, clock(AT + 10));
    assert.equal(did(tell(SECOND, clock(AT + 10 + 599))).includes('show-live'), false);
    assert.deepEqual(tell(SECOND, clock(AT + 10 + 600)).at(-1), { do: 'show-live', status: 'paused' });
    const moved = tell(located(BOARD, AT + 700), clock(AT + 700));
    assert.equal(trip.times.paused, false, 'moving on: on again');
    assert.ok(moved.some(job => job.do === 'show-live' && job.status === null));
});

test('the ride kept taken up: From is My location, followed, placed where the rider was; on a way switched to, its steps at once, timed as that way', () => {
    const { trip, tell } = page();
    tell({ type: 'kept', from: null, to: DOOR, picked: null });
    const kept = { from: START, at: 5_000, now: clock(AT - 300).now, key: 'other', steps: [{ kind: 'walk', ride: 0, from: START, to: BOARD }], state: { step: 0, stop: 0, at: null, offSince: null, fix: fix(LEFT), anchor: null, moved: false, off: false },
        own: { leg: 0, vehicle: '2041' }, switched: { way: { key: 'other', leg: 0, way: { legs: [] } }, by: 'picked' } };
    const jobs = tell({ type: 'resume', ride: kept });
    assert.deepEqual(did(jobs).slice(0, 2), ['from-here', 'following']);
    assert.equal(trip.riding, true, 'on its steps at once');
    assert.deepEqual(trip.onStep(), kept.steps[0]);
    assert.equal(asked(jobs).now, kept.now);
    // Its own bus and the way switched to as they were
    const { id } = asked(jobs);
    tell({ type: 'answer', id, options: [BUS], trains: true, timing, held: false });
    tell({ type: 'half', id, view: view(AT - 300), held: false });
    const shown = drawing(tell, { now: kept.now });
    assert.equal(rendered(shown).view.switched, 'picked');
    const way = timedAsk(shown).live;
    assert.deepEqual({ own: way.own, switched: way.switched, switchedWay: way.switchedWay }, { own: kept.own, switched: 'other', switchedWay: kept.switched.way });
    assert.deepEqual(trip.onStep(), kept.steps[0], 'not timed yet: still its own steps');
});

test('the ride kept taken up with the decision\'s choice: the quicker way taken, as it was', () => {
    const { trip, tell } = page();
    tell({ type: 'kept', from: null, to: DOOR, picked: null });
    const kept = { from: START, at: 5_000, now: clock(AT - 300).now, key: 'bus:60002>bus:60010', steps: [{ kind: 'walk', ride: 0, from: START, to: BOARD }],
        state: { step: 0, stop: 0, at: null, offSince: null, fix: fix(LEFT), anchor: null, moved: false, off: false }, choice: 'taken' };
    const { id } = asked(tell({ type: 'resume', ride: kept }));
    tell({ type: 'answer', id, options: [BUS], trains: true, timing, held: false });
    tell({ type: 'half', id, view: decision(), held: false });
    const shown = drawing(tell, { now: kept.now });
    assert.equal(rendered(shown).view.taken, trip.halfHour().view.quicker);
    assert.equal(timedAsk(shown).live.taken, true);
});

test('off the way under 2 minutes after the last plan: planned again once the 2 minutes are up, by the clock\'s second', () => {
    const { tell } = followed();
    const off = north(500, START);
    tell(located(off, AT + 15), clock(AT + 15));
    assert.equal(did(tell(located(off, AT + 80), clock(AT + 80))).includes('search'), false, 'a minute off, but planned 80 s ago');
    assert.equal(did(tell(SECOND, clock(AT + 119))).includes('search'), false);
    assert.deepEqual(asked(tell(SECOND, clock(AT + 120))).from, mine(off));
});

test('the fix that answers a press fills From once; the next one plans nothing until the rider has moved far enough', () => {
    const { tell } = page();
    tell({ type: 'to', place: MENELAOU });
    tell({ type: 'locate', known: null });
    assert.equal(did(tell(located(HERE, AT))).includes('search'), true);
    assert.deepEqual(tell(located(north(5, HERE), AT + 1), clock(AT + 1)), []);
});

test('the ride kept, still being taken up: nothing kept over it until its way is drawn', () => {
    const { tell } = page();
    tell({ type: 'kept', from: null, to: DOOR, picked: null });
    const kept = { from: START, at: 5_000, now: clock(AT - 300).now, key: 'bus:60002>bus:60010', steps: [], state: {} };
    const { id } = asked(tell({ type: 'resume', ride: kept }));
    tell({ type: 'answer', id, options: [BUS], trains: true, timing, held: false });
    assert.deepEqual(tell({ type: 'hidden' }), [], 'the ride kept stays as it was');
});

test('planned again from where the rider is: their own bus forgotten', () => {
    const { tell } = atTheStop({ buses: [{ route: '1', vehicle: '2041', line: '040', to: null, at: AT + 90 }], asked: AT + 40 });
    assert.deepEqual(timedAsk(tell(located(STOPS[1], AT + 200), clock(AT + 200))).live.own, { leg: 0, vehicle: '2041' });
    const { id } = asked(offTheWay(tell, east(600, STOPS[1]), AT + 260));
    tell({ type: 'answer', id, options: [BUS], trains: true, timing, held: false });
    tell({ type: 'half', id, view: view(AT + 330), held: false });
    assert.equal(timedAsk(drawing(tell, { now: clock(AT + 330).now }, clock(AT + 331))).live.own, null);
});

test('a way drawn while My location is off isn\'t followed', () => {
    const { trip, tell } = withHalf();
    assert.deepEqual(drawing(tell).filter(job => job.do === 'keep-ride'), []);
    assert.equal(trip.stage, 'answered');
});

// The rider's choices: the quicker way on a decision (decision 36), the
// switch on the way (T14, decision 50), and another way taken from the
// other ways, checked first when OASA had its bus coming (decision 64)

// A decision: the directions first, the quicker way's row beside them
function decision() {
    const quicker = row('quicker', OTHER);
    return { ...view(AT, [row('bus', BUS), quicker], 'decision'), quicker };
}
const OFFER = { sooner: 240 };

test('on a decision: the quicker way the live times have offered under the directions, said once; taken, in their place, timed as the quicker way; back, offered again; kept, gone for the rest of the trip', () => {
    const { trip, tell } = withHalf(undefined, decision());
    const way = timedAsk(drawing(tell)).live;
    tell({ type: 'timed', seq: way.seq, way: { ...liveWay(['60002']), offer: OFFER }, others: null });
    const offered = rendered(drawing(tell));
    assert.deepEqual({ offer: offered.view.offer, live: offered.view.live, offered: offered.offered },
        { offer: true, live: { way: { ...liveWay(['60002']), offer: OFFER } }, offered: { offer: OFFER, seconds: null } });
    assert.equal(rendered(drawing(tell)).offered, null, 'said once');
    // Taken from the keyboard: drawn again at once, the keyboard on the way back
    assert.deepEqual(tell({ type: 'quicker', act: 'take', keyboard: true }), [{ do: 'draw-answer', always: true }, { do: 'focus', on: 'back' }]);
    const taken = drawing(tell);
    assert.deepEqual({ taken: rendered(taken).view.taken, offer: rendered(taken).view.offer }, { taken: trip.halfHour().view.quicker, offer: false });
    assert.equal(timedAsk(taken).live.taken, true, 'timed as the quicker way');
    assert.equal(trip.times.others.wanted, null, 'its row no longer among the other ways timed');
    // Back from the keyboard: the directions, offered again, the keyboard on take
    assert.deepEqual(tell({ type: 'quicker', act: 'back', keyboard: true }), [{ do: 'draw-answer', always: true }, { do: 'focus', on: 'take' }]);
    const back = rendered(drawing(tell));
    assert.deepEqual({ taken: back.view.taken, offer: back.view.offer, offered: Boolean(back.offered) }, { taken: null, offer: true, offered: true });
    // Kept with a tap: not offered again in this trip
    assert.deepEqual(tell({ type: 'quicker', act: 'keep', keyboard: false }), [{ do: 'draw-answer', always: true }]);
    const kept = rendered(drawing(tell));
    assert.deepEqual({ offer: kept.view.offer, offered: kept.offered }, { offer: false, offered: null });
});

// Followed onto the bus and a stop on it: the search ahead's timing in, with
// the way 3' or more sooner it found off the bus, and the ways on from there
const SWITCH = { key: 'ahead', sooner: 240 };
function onTheRide(others = null) {
    const p = followed();
    p.tell(located(BOARD, AT + 40), clock(AT + 40));
    const way = timedAsk(p.tell(located(STOPS[1], AT + 200), clock(AT + 200))).live;
    p.tell({ type: 'timed', seq: way.seq, way: { ...liveWay([]), switchTo: SWITCH }, others }, clock(AT + 200));
    return p;
}
const countdown = jobs => jobs.filter(job => job.do === 'countdown');

test('on the way, a way 3\' or more sooner found ahead: the switch counting down with a buzz, said once with its seconds; a second off while nobody holds it; at none, switched and said, still on the bus', () => {
    const { trip, tell } = onTheRide();
    const second = (seconds, counting = true, hidden = false) => tell({ ...SECOND, counting }, clock(AT + 200 + seconds, hidden));
    const first = drawing(tell, {}, clock(AT + 201));
    assert.ok(did(first).includes('buzz'));
    assert.deepEqual(rendered(first).view.switching, { offer: SWITCH, seconds: SWITCH_SECONDS });
    assert.deepEqual(rendered(first).offered, { offer: SWITCH, seconds: SWITCH_SECONDS });
    const again = drawing(tell, {}, clock(AT + 201));
    assert.deepEqual({ buzz: did(again).includes('buzz'), offered: rendered(again).offered }, { buzz: false, offered: null }, 'once');
    assert.deepEqual(countdown(second(2)), [{ do: 'countdown', seconds: SWITCH_SECONDS - 1 }]);
    assert.deepEqual(countdown(second(3, false)), [], 'held, or the keyboard on it');
    assert.deepEqual(countdown(second(4, true, true)), [], 'out of sight');
    for (let s = 5; s < 4 + SWITCH_SECONDS - 1; s++) second(s);
    assert.equal(rendered(drawing(tell, {}, clock(AT + 212))).view.switching.seconds, 1, 'drawn again as it stands');
    assert.deepEqual(second(13).slice(0, 2), [{ do: 'say', what: 'switched' }, { do: 'draw-answer', always: true }], 'at none: taken by itself');
    const switched = drawing(tell, {}, clock(AT + 214));
    assert.deepEqual({ switched: rendered(switched).view.switched, switching: rendered(switched).view.switching }, { switched: 'quicker', switching: null });
    assert.equal(timedAsk(switched).live.switched, 'ahead', 'timed as the way switched to');
    assert.equal(trip.onStep().kind, 'ride', 'still on the bus');
    assert.deepEqual(countdown(second(15)), []);
});

test('the switch kept from the keyboard: the keyboard on the way shown, never offered again, sent to the worker as kept over', () => {
    const { tell } = onTheRide();
    drawing(tell, {}, clock(AT + 201));
    assert.deepEqual(tell({ type: 'quicker', act: 'keep', keyboard: true }), [{ do: 'draw-answer', always: true }, { do: 'focus', on: 'heading' }]);
    assert.equal(rendered(drawing(tell, {}, clock(AT + 202))).view.switching, null);
    assert.deepEqual(countdown(tell({ ...SECOND, counting: true }, clock(AT + 203))), []);
    assert.deepEqual(timedAsk(tell({ type: 'retime' }, clock(AT + 204))).live.declined, ['ahead']);
});

test('the switch taken from the keyboard: the keyboard on the way back; back, the way before again, that way never offered again', () => {
    const { tell } = onTheRide();
    drawing(tell, {}, clock(AT + 201));
    assert.deepEqual(tell({ type: 'quicker', act: 'take', keyboard: true }), [{ do: 'draw-answer', always: true }, { do: 'focus', on: 'back' }]);
    assert.equal(rendered(drawing(tell, {}, clock(AT + 202))).view.switched, 'quicker');
    assert.deepEqual(tell({ type: 'quicker', act: 'back', keyboard: false }), [{ do: 'draw-answer', always: true }]);
    const back = drawing(tell, {}, clock(AT + 203));
    assert.deepEqual({ switched: rendered(back).view.switched, switching: rendered(back).view.switching }, { switched: false, switching: null });
    assert.deepEqual(timedAsk(back).live.declined, ['ahead']);
});

test('another way off the ride, tapped: taken as the switch\'s is, said; the rider\'s place carried over to it, and kept with the ride as the worker sent it', () => {
    const other = { ...BUS, rides: [{ ...BUS.rides[0], alight: { id: 'bus:70000' }, along: [STOPS[0], STOPS[1], north(400, STOPS[1])].map(({ lat, lng }) => [lat, lng]) }] };
    const { trip, tell } = onTheRide([{ key: 'b', leg: 0, option: other, asks: [] }]);
    assert.equal(trip.onStep().kind, 'ride');
    const offered = rendered(drawing(tell, {}, clock(AT + 201))).view;
    assert.deepEqual({ take: offered.take, onward: offered.onward.map(way => way.key) }, { take: false, onward: ['b'] }, 'the ways on from the ride, not the half hour\'s from the start');
    assert.deepEqual(tell({ type: 'take', key: 'b', keyboard: false, position: null }, clock(AT + 201)), [{ do: 'say', what: 'picked' }, { do: 'draw-answer', always: true }]);
    const switched = drawing(tell, {}, clock(AT + 202));
    assert.equal(rendered(switched).view.switched, 'picked');
    const way = timedAsk(switched).live;
    assert.deepEqual({ switched: way.switched, switchedWay: way.switchedWay }, { switched: 'b', switchedWay: null }, 'not sent by the worker yet');
    const ahead = { key: 'b', leg: 0, way: { legs: [] } };
    tell({ type: 'timed', seq: way.seq, way: { ...liveWay([]), option: other }, others: null, switched: ahead }, clock(AT + 202));
    drawing(tell, {}, clock(AT + 203));
    assert.equal(trip.onStep().kind, 'ride', 'still on the bus, not back at the start');
    const kept = tell({ type: 'hidden' })[0].ride;
    assert.deepEqual({ choice: kept.choice, switched: kept.switched }, { choice: null, switched: { way: ahead, by: 'picked' } });
});

// The half hour's other ways timed, the 550's bus coming (`live`, RideLive)
// as OASA had it at its stop, answered at AT + 1
function otherTimed(live = { at: AT + 240, next: null, vehicle: '77' }) {
    const p = withHalf(undefined, twoWays());
    const others = othersAsk(drawing(p.tell)).others;
    const ways = said => [{ row: 1, departure: 0, option: timedOther(said), asks: [{ stop: '400100', at: AT + 240 }] }];
    const [stop] = stopsAsked(p.tell({ type: 'others-timed', seq: others.seq, ways: ways(live) }));
    p.tell({ type: 'stop', code: '400100', ticket: stop.ticket, answer: arrivals() }, clock(AT + 1));
    return { ...p, ways };
}
const LATER = clock(AT + 1 + FRESH_MS / 1000);
const keys = jobs => rendered(jobs).ways.map(way => way.row.key);

test('another way tapped before the rider has left, its bus\'s stop answered under 30 s ago: taken at once, first among the ways, kept with the trip, said; one taken back from the keyboard, the keyboard on its heading', () => {
    const { tell } = otherTimed();
    assert.deepEqual(tell({ type: 'take', key: '550', keyboard: false, position: null }, clock(AT + 10)),
        [{ do: 'keep-picked', key: '550' }, { do: 'draw-answer', always: true }, { do: 'say', what: 'picked' }]);
    const picked = drawing(tell, {}, clock(AT + 11));
    assert.deepEqual({ keys: keys(picked), picked: rendered(picked).view.picked, take: rendered(picked).view.take }, { keys: ['550', 'bus'], picked: true, take: true });
    assert.deepEqual(tell({ type: 'take', key: 'bus', keyboard: true, position: null }, clock(AT + 12)),
        [{ do: 'keep-picked', key: 'bus' }, { do: 'draw-answer', always: true }, { do: 'focus', on: 'heading' }]);
    const back = drawing(tell, {}, clock(AT + 13));
    assert.deepEqual({ keys: keys(back), picked: rendered(back).view.picked }, { keys: ['bus', '550'], picked: false });
});

test('its bus\'s stop answered 30 s ago or more: asked again saying so, the card said to be checked, nothing else taken meanwhile; its bus still coming once timed with it, taken', () => {
    const { tell, ways } = otherTimed();
    const jobs = tell({ type: 'take', key: '550', keyboard: false, position: null }, LATER);
    assert.deepEqual(did(jobs), ['wait', 'draw-answer', 'say', 'ask-stop']);
    assert.deepEqual({ ms: jobs[0].ms, always: jobs[1].always, said: jobs[2].what }, { ms: CHECK_WAIT_MS, always: true, said: 'checking' });
    const [check] = stopsAsked(jobs);
    assert.deepEqual([check.code, check.opening], ['400100', 'take']);
    assert.equal(rendered(drawing(tell, {}, LATER)).view.checking, '550');
    assert.deepEqual(tell({ type: 'take', key: 'bus', keyboard: false, position: null }, LATER), [], 'nothing else meanwhile');
    // Its answer in, then the other ways timed with it: the same bus coming, taken
    const again = othersAsk(tell({ type: 'stop', code: '400100', ticket: check.ticket, answer: arrivals() }, LATER)).others;
    const settled = tell({ type: 'others-timed', seq: again.seq, ways: ways({ at: AT + 240, next: null, vehicle: '77' }) }, LATER);
    assert.deepEqual(settled.filter(job => ['keep-picked', 'say'].includes(job.do)), [{ do: 'keep-picked', key: '550' }, { do: 'say', what: 'picked' }]);
    assert.deepEqual(keys(drawing(tell, {}, LATER)), ['550', 'bus']);
    assert.deepEqual(tell({ type: 'check-waited', ticket: jobs[0].ticket }, LATER), [], 'its wait, once settled, counts for nothing');
    // Taken back, then again 30 s on: checked again, and the first wait doesn't settle this check
    tell({ type: 'take', key: 'bus', keyboard: false, position: null }, LATER);
    const later = clock(LATER.now.seconds + FRESH_MS / 1000);
    assert.equal(tell({ type: 'take', key: '550', keyboard: false, position: null }, later)[0].do, 'wait');
    assert.deepEqual(tell({ type: 'check-waited', ticket: jobs[0].ticket }, later), []);
    assert.equal(rendered(drawing(tell, {}, later)).view.checking, '550', 'still being checked');
});

test('its bus gone once its stop is answered: not taken, said, the ways searched again at once with their half hour; from the keyboard, the keyboard back on it', () => {
    const { tell, ways } = otherTimed();
    const jobs = tell({ type: 'take', key: '550', keyboard: true, position: null }, LATER);
    assert.deepEqual(jobs[2], { do: 'focus', on: { way: '550' } });
    const [check] = stopsAsked(jobs);
    const again = othersAsk(tell({ type: 'stop', code: '400100', ticket: check.ticket, answer: arrivals() }, LATER)).others;
    const settled = tell({ type: 'others-timed', seq: again.seq, ways: ways({ none: true }) }, LATER);
    assert.deepEqual(settled.filter(job => ['keep-picked', 'say', 'focus'].includes(job.do)), [{ do: 'say', what: 'gone' }, { do: 'focus', on: { way: '550' } }]);
    assert.equal(asked(settled).half, true, 'searched again, its half hour too however young');
    const drawnAfter = rendered(drawing(tell, {}, LATER));
    assert.deepEqual({ keys: drawnAfter.ways.map(way => way.row.key), gone: drawnAfter.view.gone, checking: drawnAfter.view.checking }, { keys: ['bus', '550'], gone: true, checking: null });
});

test('with no answer in 5 s, taken on the answer there is', () => {
    const { tell } = otherTimed();
    const [wait] = tell({ type: 'take', key: '550', keyboard: false, position: null }, LATER);
    assert.deepEqual(tell({ type: 'check-waited', ticket: wait.ticket }, clock(LATER.now.seconds + 5)),
        [{ do: 'keep-picked', key: '550' }, { do: 'draw-answer', always: true }, { do: 'say', what: 'picked' }]);
    assert.deepEqual(tell({ type: 'check-waited', ticket: wait.ticket }, clock(LATER.now.seconds + 6)), [], 'once');
});

test('another way tapped walking or waiting: planned again from where the rider is with that way picked; from the keyboard, its half hour drawn under the keyboard, the keyboard on its heading', () => {
    const { tell } = followed();
    const way = timedAsk(tell({ type: 'retime' }, clock(AT + 20))).live;
    tell({ type: 'timed', seq: way.seq, way: liveWay([]), others: [{ key: '550', leg: -1, option: OTHER, asks: [] }] }, clock(AT + 20));
    const jobs = tell({ type: 'take', key: '550', keyboard: true, position: null }, clock(AT + 21));
    assert.deepEqual(did(jobs), ['keep-picked', 'keep', 'show-live', 'search']);
    assert.deepEqual(asked(jobs).from, mine(LEFT), 'from the last fix');
    const { id } = asked(jobs);
    tell({ type: 'answer', id, options: [BUS], trains: true, timing, held: true });
    const half = tell({ type: 'half', id, view: twoWays(AT + 21), held: true });
    assert.deepEqual(did(half), ['timing', 'draw', 'focus']);
    assert.deepEqual(half[2], { do: 'focus', on: 'heading' });
    assert.deepEqual(keys(drawing(tell, { now: clock(AT + 21).now }, clock(AT + 22))), ['550', 'bus'], 'the way picked first');
});

test('the way picked gone from the half hour: the half hour\'s own first again, said once, kept with the trip as none', () => {
    const { tell } = withHalf(undefined, twoWays());
    drawing(tell);
    tell({ type: 'take', key: '550', keyboard: false, position: null });
    const { id } = asked(tell({ type: 'refresh', held: false }, clock(AT + HALF_REWORK_SECONDS)));
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    tell({ type: 'half', id, view: view(AT + HALF_REWORK_SECONDS), held: false });
    const later = { now: clock(AT + HALF_REWORK_SECONDS).now };
    const lost = drawing(tell, later);
    assert.deepEqual(lost.filter(job => ['keep-picked', 'say'].includes(job.do)), [{ do: 'keep-picked', key: null }, { do: 'say', what: 'lost' }]);
    assert.deepEqual({ keys: keys(lost), lost: rendered(lost).view.lost }, { keys: ['bus'], lost: true });
    assert.deepEqual(drawing(tell, later).filter(job => ['keep-picked', 'say'].includes(job.do)), [], 'said once');
});

test('the way picked kept with the trip: first again in the trip\'s first answer, not in a trip after it', () => {
    const { tell } = page();
    tell({ type: 'kept', from: SYNTAGMA, to: MENELAOU, picked: '550' });
    const answer = id => {
        tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
        tell({ type: 'half', id, view: twoWays(), held: false });
        return keys(drawing(tell));
    };
    assert.deepEqual(answer(asked(tell({ type: 'open' })).id), ['550', 'bus']);
    assert.deepEqual(answer(asked(tell({ type: 'to', place: FIX })).id), ['bus', '550']);
});
