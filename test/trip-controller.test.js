import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The Trip page's trip and its search answers (roadmap Trip · state,
// tools/trip/client/controller.js): given these events, these jobs. Each
// test is a case main.js meets; the page's side: test/browser/trip.spec.js.

const { HALF_REWORK_SECONDS, tripController } = await browserModule('tools/trip/client/controller.js');

// A Wednesday morning in Athens, `seconds` since midnight, the page in sight
const AT = 8.5 * 3600;
const clock = (seconds = AT, hidden = false) => ({ ms: seconds * 1000, now: { weekday: 3, seconds, date: '2026-11-18' }, hidden });

// The ends as main.js makes them: places found, and My location
const SYNTAGMA = { lat: 37.9755, lng: 23.7353, title: 'Syntagma', station: 'syntagma' };
const MENELAOU = { lat: 37.955, lng: 23.707, title: 'Μενελάου 45' };
const FIX = { lat: 37.964, lng: 23.726, title: 'Syggrou-Fix', station: 'syggrou-fix' };
const HERE = { lat: 37.97, lng: 23.73, title: 'My location' };
const ON = { lat: 37.968, lng: 23.729, title: 'My location' };

// The worker's answers: the ways with a bus for leaving now, and a half hour
// from `first` (its first departure)
const OPTIONS = [{ city: true, minutes: 24 }];
const view = (first = AT) => ({ kind: 'clear', departures: [first, first + 120], rows: [], ms: 40 });
const timing = { city: 120, answer: 30 };

// The page: the controller, told events at `clock()` unless said, opened at
// AT; `rider`, what main.js keeps of the ride followed and the switch (not
// followed unless a test says); `did` lists what the last jobs say to do
function page({ buses = true, suburban = true } = {}) {
    const rider = { riding: false, step: null, here: null, own: null, declined: [], switchedWay: null };
    const trip = tripController({ buses, suburban, at: AT * 1000, rider: () => rider });
    const tell = (event, at = clock()) => trip.tell(event, at);
    return { trip, rider, tell };
}
const did = jobs => jobs.map(job => job.do);
const asked = jobs => jobs.find(job => job.do === 'search')?.ask;
const drawn = jobs => jobs.find(job => job.do === 'draw');
const timedAsk = jobs => jobs.find(job => job.do === 'time')?.ask;
const stopsAsked = jobs => jobs.filter(job => job.do === 'ask-stop');

// The way shown in full as drawn: the half hour `id`'s first row; and the
// worker's timing of a way that asks OASA for `stops` (and has `train`)
const want = (id, more = {}) => ({ id, row: 0, departure: AT, taken: false, switched: null, ...more });
const liveWay = (stops, train = null) => ({ asks: stops.map(stop => ({ stop, at: null })), train });
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
function withHalf(options) {
    const p = answered(options);
    p.tell({ type: 'half', id: p.search.id, view: view(), held: false });
    return p;
}

test('one end only: the page says what it does, and keeps the end it has', () => {
    const { trip, tell } = page();
    const jobs = tell({ type: 'from', place: SYNTAGMA, say: true });
    assert.deepEqual(did(jobs), ['keep', 'intro']);
    assert.deepEqual(jobs[0], { do: 'keep', from: SYNTAGMA, to: null });
    assert.equal(trip.stage, 'none');
});

test('both ends: said to be worked out, the live times started over, and searched for leaving now with its half hour', () => {
    const { trip, tell } = page();
    tell({ type: 'from', place: SYNTAGMA });
    const jobs = tell({ type: 'to', place: MENELAOU, say: true });
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'show-live', 'search']);
    assert.deepEqual(jobs[1], { do: 'new-trip', resumed: null });
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
    const { rider, tell } = withHalf();
    rider.riding = true;
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
    const { trip, tell } = withHalf();
    const jobs = tell({ type: 'moved', place: ON }, clock(AT + 120));
    assert.deepEqual(did(jobs), ['keep', 'move-live', 'show-live', 'search'], 'not started over: the stops keep their answers');
    assert.deepEqual(asked(jobs), { id: asked(jobs).id, from: ON, to: MENELAOU, now: clock(AT + 120).now, half: true });
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
    const { trip, tell } = withHalf();
    const { id } = asked(tell({ type: 'moved', place: ON }));
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    const minute = tell({ type: 'refresh', held: false }, clock(AT + 60));
    assert.equal(asked(minute).half, false, 'its half hour is still being worked out');
    assert.deepEqual(tell({ type: 'answer', id: asked(minute).id, options: OPTIONS, trains: true, timing, held: false }), []);
    assert.ok(trip.holding());
    assert.deepEqual(tell({ type: 'half', id, view: view(), held: false })[1].half, { say: false });
});

// Its own search still out: nothing more asked, as the answer is on its way.
// Asked again, the trip started over: the answer kept while planned again
// taken away for "Working out the trip…", every stop's live times asked again
test('the minute\'s refresh before the answer planned again from where the rider moved to: nothing asked again, the answer before kept, the stops keep their answers', () => {
    const { trip, rider, tell } = withHalf();
    const [stop] = stopsAsked(tell({ type: 'check', code: '60002' }));
    const { id } = asked(tell({ type: 'moved', place: ON }, clock(AT + 120)));
    for (const riding of [false, true]) {
        rider.riding = riding;
        assert.deepEqual(did(tell({ type: 'refresh', held: false }, clock(AT + 150))), ['keep', 'retime'], riding ? 'riding' : 'walking');
    }
    rider.riding = false;
    assert.notDeepEqual(tell({ type: 'stop', code: '60002', ticket: stop.ticket, answer: arrivals() }), [], 'not started over: the stop\'s answer still counts');
    assert.equal(trip.stage, 'searching');
    assert.deepEqual(tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false }), [], 'held till its half hour, as before');
    assert.deepEqual(tell({ type: 'half', id, view: view(AT + 120), held: false })[1],
        { do: 'draw', now: clock(AT + 120).now, buses: OPTIONS, speak: false, half: { say: false } });
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
    tell({ type: 'kept', from: null, to: MENELAOU });
    const search = asked(tell({ type: 'from', place: HERE, say: false }));
    assert.deepEqual(did(tell({ type: 'open' })), ['keep']);
    assert.equal(drawn(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false })).speak, false);
});

test('the minute\'s refresh while the ride kept is still being searched: not searched again for now, the ride still passed on once', () => {
    const { rider, tell } = page();
    tell({ type: 'kept', from: null, to: MENELAOU });
    const ride = { at: 5_000, now: clock(AT - 900).now, key: 'bus:1>bus:2' };
    const search = asked(tell({ type: 'resume', place: ON, ride }));
    rider.riding = true;
    assert.deepEqual(did(tell({ type: 'refresh', held: false }, clock(AT + 60))), ['keep', 'retime']);
    assert.deepEqual(drawn(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false })).now, ride.now);
});

test('planned again: the half hour held in the answer, so the next answer after it is drawn', () => {
    const { trip, tell } = withHalf();
    const { id } = asked(tell({ type: 'moved', place: ON }));
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    assert.deepEqual(tell({ type: 'half', id, view: view(), held: true }), [{ do: 'timing' }]);
    assert.equal(trip.holding(), false, 'the half hour is in');
    assert.deepEqual(did(tell({ type: 'redraw', held: false })), ['draw']);
});

test('the answers still to come: planned again drops the way\'s and the other ways\' timing, not the stops\'; a new trip drops all', () => {
    const { trip, tell, search } = withHalf();
    const way = timedAsk(tell({ type: 'shown', want: want(search.id) })).live;
    const others = timedAsk(tell({ type: 'others-shown', want: { id: search.id, ways: [{ row: 1, departure: AT + 120 }] } })).others;
    const [stop, other] = ['60002', '240003'].map(code => stopsAsked(tell({ type: 'check', code }))[0]);
    tell({ type: 'moved', place: ON });
    assert.deepEqual(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }), []);
    assert.deepEqual(tell({ type: 'others-timed', seq: others.seq, ways: [] }), []);
    assert.equal(trip.times.way, null);
    assert.ok(tell({ type: 'stop', code: '60002', ticket: stop.ticket, answer: arrivals() }).length, 'the stop\'s answer counts');
    assert.ok(trip.times.answers.has('60002'));
    tell({ type: 'to', place: FIX });
    assert.deepEqual(tell({ type: 'stop', code: '240003', ticket: other.ticket, answer: arrivals() }), []);
    assert.equal(trip.times.answers.size, 0, 'a new trip asks its stops again');
});

test('a way whose bus had gone: searched again at once, its half hour too however young', () => {
    const { tell } = withHalf();
    const jobs = tell({ type: 'gone' }, clock(AT + 30));
    assert.deepEqual(did(jobs), ['keep', 'search']);
    assert.equal(asked(jobs).half, true);
});

test('the ends swapped: a new trip the other way', () => {
    const { trip, tell } = withHalf();
    const jobs = tell({ type: 'swap' });
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'show-live', 'search']);
    assert.equal(asked(jobs).from, MENELAOU);
    assert.equal(asked(jobs).to, SYNTAGMA);
    assert.equal(trip.halfHour(), null, 'the half hour was the other way\'s');
    assert.equal(trip.timing.half, null);
});

test('From following the rider before there\'s a To: nothing asked, and the trip starts from there', () => {
    const { trip, tell } = page();
    tell({ type: 'from', place: HERE, say: true });
    assert.deepEqual(tell({ type: 'here', place: ON }), []);
    assert.equal(trip.from, ON);
    assert.equal(asked(tell({ type: 'to', place: MENELAOU })).from, ON);
});

test('the trip kept: set as the page opens, asked once it\'s ready', () => {
    const { trip, tell } = page();
    assert.deepEqual(tell({ type: 'kept', from: SYNTAGMA, to: MENELAOU }), []);
    assert.equal(trip.stage, 'searching', 'not asked yet');
    const jobs = tell({ type: 'open' });
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'show-live', 'search']);
    assert.equal(asked(jobs).speak, undefined);
    assert.equal(drawn(tell({ type: 'answer', id: asked(jobs).id, options: OPTIONS, trains: true, timing, held: false })).speak, false, 'nothing picked: not said');
});

test('the ride kept taken up: searched for when it was, planned as of then, and passed on with the new trip', () => {
    const { trip, rider, tell } = page();
    tell({ type: 'kept', from: null, to: MENELAOU });
    const ride = { at: 5_000, now: clock(AT - 900).now, key: 'bus:1>bus:2', choice: 'taken' };
    const jobs = tell({ type: 'resume', place: ON, ride });
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'show-live', 'search']);
    assert.equal(jobs[1].resumed, ride);
    assert.deepEqual(asked(jobs).now, ride.now);
    assert.equal(trip.plannedAt, 5_000);
    assert.equal(drawn(tell({ type: 'answer', id: asked(jobs).id, options: OPTIONS, trains: true, timing, held: false })).speak, true);
    // A refresh later keeps when it was planned
    rider.riding = true;
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
    const { trip, tell, search } = answered();
    const way = timedAsk(tell({ type: 'shown', want: want(search.id) })).live;
    const jobs = tell({ type: 'failed', updated: true }, clock(AT + 30));
    assert.deepEqual(jobs, [{ do: 'reset-live' }, { do: 'show-live', status: null }, { do: 'keep', from: SYNTAGMA, to: MENELAOU }, { do: 'draw', now: clock(AT + 30).now, buses: [], speak: true }]);
    assert.equal(trip.noBuses, 'updated');
    assert.equal(trip.answer(), null);
    assert.deepEqual(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }), [], 'nothing asked before counts');
    assert.deepEqual(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false }), []);
    assert.deepEqual(did(page().tell({ type: 'failed', updated: false })), ['reset-live', 'show-live', 'keep', 'intro'], 'with no trip: the page says what it does');
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

// The live times (decisions 35, 42, 62 and 63): the way shown and the other
// ways timed by the worker with OASA's answers, each stop asked when it's due

// A trip answered with its half hour, the way shown drawn and timed by the
// worker as asking OASA for `stops` (with `train`); its jobs as it came in
function timedWay(stops, { train = null, options } = {}) {
    const p = withHalf(options);
    const way = timedAsk(p.tell({ type: 'shown', want: want(p.search.id) })).live;
    const jobs = p.tell({ type: 'timed', seq: way.seq, way: liveWay(stops, train), others: null });
    return { ...p, jobs };
}

test('the way shown drawn: timed by the worker for leaving now with the live times there are; the same way again isn\'t, another departure is', () => {
    const { tell, search } = withHalf();
    const ask = timedAsk(tell({ type: 'shown', want: want(search.id) }));
    assert.deepEqual(ask, { id: search.id, live: { seq: ask.live.seq, row: 0, departure: AT, now: clock().now, stops: {}, taken: false, trains: null, step: null, own: null,
        ahead: false, declined: [], switched: null, switchedWay: null, here: null } });
    assert.deepEqual(tell({ type: 'shown', want: want(search.id) }), []);
    assert.equal(timedAsk(tell({ type: 'shown', want: want(search.id, { departure: AT + 120 }) })).live.departure, AT + 120);
    assert.equal(timedAsk(tell({ type: 'shown', want: want(search.id, { taken: true }) })).live.taken, true, 'the quicker way taken in its place');
});

test('its timing in: the live times said, its stops asked at once, the first saying a trip starts; the way tapped told, the answer drawn', () => {
    const { trip, jobs } = timedWay(['60002', '60003']);
    assert.deepEqual(did(jobs), ['show-live', 'ask-stop', 'ask-stop', 'checked', 'draw-answer']);
    assert.deepEqual(stopsAsked(jobs).map(({ code, opening }) => ({ code, opening })), [{ code: '60002', opening: 'start' }, { code: '60003', opening: null }]);
    assert.deepEqual(jobs.find(job => job.do === 'checked'), { do: 'checked', onward: true });
    assert.deepEqual(trip.times.way.way.asks.map(a => a.stop), ['60002', '60003']);
    assert.ok(trip.times.directions, 'the directions\' timing, for going back to them');
});

test('a stop\'s answer: counted, the way tapped told, both ways timed again with it; asked again only once it\'s due, and not while it\'s being asked', () => {
    const { trip, tell, jobs } = timedWay(['60002', '60003']);
    const [first] = stopsAsked(jobs);
    const answered = tell({ type: 'stop', code: '60002', ticket: first.ticket, answer: arrivals() }, clock(AT + 1));
    assert.deepEqual(did(answered), ['stop-in', 'show-live', 'time']);
    assert.deepEqual(answered[0], { do: 'stop-in', code: '60002' });
    assert.deepEqual(timedAsk(answered).live.stops, { '60002': arrivals() });
    assert.equal(trip.times.asked.get('60002'), (AT + 1) * 1000);
    assert.deepEqual(tell({ type: 'second', idle: false }, clock(AT + 2)), [], 'one just answered, the other being asked');
    assert.deepEqual(stopsAsked(tell({ type: 'second', idle: false }, clock(AT + 600))).map(job => [job.code, job.opening]), [['60002', null]]);
});

test('a stop with no answer: its last one kept, marked older, and said so; none before, unavailable', () => {
    const { trip, tell, jobs } = timedWay(['60002']);
    const [first] = stopsAsked(jobs);
    assert.deepEqual(tell({ type: 'stop', code: '60002', ticket: first.ticket, answer: null })[1], { do: 'show-live', status: 'unavailable' });
    const [again] = stopsAsked(tell({ type: 'second', idle: false }, clock(AT + 600)));
    tell({ type: 'stop', code: '60002', ticket: again.ticket, answer: arrivals() });
    const [third] = stopsAsked(tell({ type: 'second', idle: false }, clock(AT + 1200)));
    assert.deepEqual(tell({ type: 'stop', code: '60002', ticket: third.ticket, answer: null })[1], { do: 'show-live', status: 'stale' });
    assert.equal(trip.times.answers.get('60002').stale, true);
    assert.equal(trip.times.answers.get('60002').buses.length, 1);
});

test('paused once untouched long enough: said, nothing asked; a touch goes on, both ways timed again', () => {
    const { trip, tell } = timedWay(['60002']);
    assert.deepEqual(tell({ type: 'second', idle: true }, clock(AT + 600)), [{ do: 'show-live', status: 'paused' }]);
    assert.equal(trip.times.paused, true);
    assert.deepEqual(tell({ type: 'second', idle: false }, clock(AT + 601)), [], 'nothing asked while paused');
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
    assert.deepEqual(tell({ type: 'second', idle: false }, clock(AT + 600, true)), []);
    assert.deepEqual(did(tell({ type: 'visible' }, clock(AT + 601))), ['ask-stop']);
});

test('the worker\'s timing coming in out of sight (the phone locked): its stops asked once it\'s back', () => {
    const { tell, search } = withHalf();
    const way = timedAsk(tell({ type: 'shown', want: want(search.id) })).live;
    assert.deepEqual(stopsAsked(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }, clock(AT, true))), []);
    assert.deepEqual(stopsAsked(tell({ type: 'visible' }, clock(AT + 30))).map(job => [job.code, job.opening]), [['60002', 'start']]);
});

test('nothing timed: the second asks nothing', () => {
    const { tell } = withHalf();
    assert.deepEqual(tell({ type: 'second', idle: true }), []);
});

test('the way with a train: how late the trains run asked with its stops, once at a time; the answer timed with, or said to be missing', () => {
    const { tell, jobs } = timedWay(['60002'], { train: 1234 });
    assert.deepEqual(did(jobs), ['show-live', 'ask-stop', 'ask-trains', 'checked', 'draw-answer']);
    assert.equal(did(tell({ type: 'second', idle: false }, clock(AT + 600))).includes('ask-trains'), false, 'being asked');
    const missing = tell({ type: 'trains', answer: null }, clock(AT + 601));
    assert.deepEqual(missing[0], { do: 'show-live', status: 'trains-unavailable' });
    assert.equal(timedAsk(missing).live.trains, null);
    const late = { at: '2026-11-18T06:30:00Z', trains: { 1234: { late: 3, exact: true } } };
    assert.deepEqual(timedAsk(tell({ type: 'trains', answer: late }, clock(AT + 700))).live.trains, late.trains);
});

test('the way shown with nothing left to time: a timing still to come for the way before doesn\'t count, so its stops aren\'t asked', () => {
    const { trip, tell, search } = withHalf();
    const way = timedAsk(tell({ type: 'shown', want: want(search.id) })).live;
    assert.deepEqual(tell({ type: 'shown', want: null }), []);
    assert.deepEqual(tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: null }), []);
    assert.equal(trip.times.way, null);
});

test('the way shown timed, then nothing left to time: its live times go, said', () => {
    const { trip, tell } = timedWay(['60002']);
    assert.deepEqual(tell({ type: 'shown', want: null }), [{ do: 'show-live', status: null }]);
    assert.equal(trip.times.way, null);
});

test('the other ways shown: timed, each asking only for its first bus\'s stop, the first saying it\'s another way\'s; none, or another half hour\'s, and the timing before doesn\'t count', () => {
    const { trip, tell, jobs, search } = timedWay(['60002']);
    assert.equal(stopsAsked(jobs)[0].opening, 'start');
    const others = { id: search.id, ways: [{ row: 1, departure: AT + 120 }] };
    const ask = timedAsk(tell({ type: 'others-shown', want: others })).others;
    assert.deepEqual(ask, { seq: ask.seq, ways: others.ways, now: clock().now, stops: {}, trains: null });
    assert.deepEqual(tell({ type: 'others-shown', want: { ...others } }), [], 'the same ways');
    const timed = tell({ type: 'others-timed', seq: ask.seq, ways: [{ row: 1, departure: AT + 120, option: OPTIONS[0], asks: [{ stop: '240003', at: null }] }] });
    assert.deepEqual(did(timed), ['show-live', 'ask-stop', 'checked', 'draw-answer']);
    assert.deepEqual(stopsAsked(timed).map(job => [job.code, job.opening]), [['240003', 'other']]);
    assert.equal(timed.find(job => job.do === 'checked').onward, false);
    // None to time: dropped, and one still to come doesn't count
    const again = timedAsk(tell({ type: 'others-shown', want: { ...others, ways: [{ row: 2, departure: AT + 240 }] } })).others;
    assert.deepEqual(tell({ type: 'others-shown', want: null }), []);
    assert.deepEqual(trip.times.others.ways, []);
    assert.deepEqual(tell({ type: 'others-timed', seq: again.seq, ways: [] }), []);
});

test('followed along the way: the ways on from where the rider is asked in place of the other ways, with where they are', () => {
    const { trip, rider, tell, search } = withHalf();
    Object.assign(rider, { riding: true, step: { leg: 0, kind: 'walk', stop: 0, at: AT, walk: 120 }, here: { lat: 37.96, lng: 23.72 }, own: { leg: 0, vehicle: '2041' }, declined: ['a'] });
    const way = timedAsk(tell({ type: 'shown', want: want(search.id) })).live;
    assert.deepEqual({ step: way.step, here: way.here, own: way.own, declined: way.declined }, { step: rider.step, here: rider.here, own: rider.own, declined: ['a'] });
    const onward = [{ key: 'b', leg: -1, option: OPTIONS[0], asks: [{ stop: '400100', at: null }] }];
    const jobs = tell({ type: 'timed', seq: way.seq, way: liveWay(['60002']), others: onward });
    assert.deepEqual(stopsAsked(jobs).map(job => [job.code, job.opening]), [['60002', 'start'], ['400100', 'other']]);
    assert.equal(trip.times.onward, onward);
    assert.equal(timedAsk(tell({ type: 'retime', ahead: true })).live.ahead, true, 'the search ahead first');
});

test('a way switched to on the ride: timed in place of the row\'s, the way itself with it, and passed on as the worker timed it', () => {
    const { rider, tell, search } = withHalf();
    const ahead = { key: 'c', leg: 0, way: { legs: [] } };
    rider.switchedWay = ahead;
    const way = timedAsk(tell({ type: 'shown', want: want(search.id, { switched: 'c' }) })).live;
    assert.equal(way.switched, 'c');
    assert.equal(way.switchedWay, ahead);
    assert.deepEqual(tell({ type: 'timed', seq: way.seq, way: liveWay([]), others: null, switched: ahead })[0], { do: 'switched-way', way: ahead });
});

test('the stop of a way tapped: asked saying so, unless it\'s being asked already', () => {
    const { tell } = withHalf();
    assert.deepEqual(tell({ type: 'check', code: '60002' }).map(({ code, opening }) => ({ code, opening })), [{ code: '60002', opening: 'take' }]);
    assert.deepEqual(tell({ type: 'check', code: '60002' }), []);
});

test('planned again from where the rider moved to: the stops keep their answers, only new ones asked at once, the first saying so', () => {
    const { tell, jobs } = timedWay(['60002']);
    const [first] = stopsAsked(jobs);
    tell({ type: 'stop', code: '60002', ticket: first.ticket, answer: arrivals() });
    const moved = tell({ type: 'moved', place: ON }, clock(AT + 10));
    assert.deepEqual(moved.find(job => job.do === 'show-live'), { do: 'show-live', status: null }, 'nothing timed yet');
    const { id } = asked(moved);
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    tell({ type: 'half', id, view: view(AT + 10), held: false });
    const way = timedAsk(tell({ type: 'shown', want: want(id) }, clock(AT + 10))).live;
    const timed = tell({ type: 'timed', seq: way.seq, way: liveWay(['60002', '70000']), others: null }, clock(AT + 11));
    assert.deepEqual(stopsAsked(timed).map(job => [job.code, job.opening]), [['70000', 'moved']]);
});
