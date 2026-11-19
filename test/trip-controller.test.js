import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The Trip page's trip and its search answers (roadmap Trip · state,
// tools/trip/client/controller.js): given these events, these jobs. Each
// test is a case main.js meets; the page's side: test/browser/trip.spec.js.

const { HALF_REWORK_SECONDS, tripController } = await browserModule('tools/trip/client/controller.js');
const { tickets } = await browserModule('tools/trip/client/tickets.js');

// A Wednesday morning in Athens, `seconds` since midnight
const AT = 8.5 * 3600;
const clock = (seconds = AT) => ({ ms: seconds * 1000, now: { weekday: 3, seconds, date: '2026-11-18' } });

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

// The page: the controller and its tickets, told events at `clock()` unless
// said; `did` lists what the last jobs say to do
function page({ buses = true, suburban = true } = {}) {
    const latest = tickets();
    const trip = tripController({ latest, buses, suburban });
    const tell = (event, at = clock()) => trip.tell(event, at);
    return { trip, latest, tell };
}
const did = jobs => jobs.map(job => job.do);
const asked = jobs => jobs.find(job => job.do === 'search')?.ask;
const drawn = jobs => jobs.find(job => job.do === 'draw');

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
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'search']);
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
    assert.deepEqual(tell({ type: 'refresh', riding: false, held: true }), []);
    assert.deepEqual(did(tell({ type: 'redraw', held: false })), ['draw']);
});

test('the minute\'s refresh: searched again for now, the half hour too only once it\'s 10 minutes old', () => {
    const { trip, tell } = withHalf();
    const minute = tell({ type: 'refresh', riding: false, held: false }, clock(AT + 60));
    assert.deepEqual(did(minute), ['keep', 'search', 'retime'], 'the same trip: not started over');
    assert.equal(asked(minute).half, false);
    assert.equal(asked(minute).now.seconds, AT + 60);
    assert.equal(trip.stage, 'answered', 'the answer before stays till the new one');
    assert.equal(asked(tell({ type: 'refresh', riding: false, held: false }, clock(AT + HALF_REWORK_SECONDS - 1))).half, false);
    assert.equal(asked(tell({ type: 'refresh', riding: false, held: false }, clock(AT + HALF_REWORK_SECONDS))).half, true);
});

test('a refresh\'s answer is drawn for its own time; the half hour asked before it still counts', () => {
    const { tell, search } = answered();
    const minute = asked(tell({ type: 'refresh', riding: false, held: false }, clock(AT + 60)));
    assert.equal(drawn(tell({ type: 'answer', id: minute.id, options: OPTIONS, trains: true, timing, held: false })).now.seconds, AT + 60);
    assert.deepEqual(did(tell({ type: 'half', id: search.id, view: view(), held: false })), ['timing', 'draw']);
    assert.deepEqual(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false }), [], 'the first search, overtaken');
});

test('past midnight the half hour is worked out again', () => {
    const p = answered();
    p.tell({ type: 'half', id: p.search.id, view: view(86_000), held: false });
    assert.equal(asked(p.tell({ type: 'refresh', riding: false, held: false }, clock(100))).half, true);
});

test('a refresh while the rider is followed along the way: drawn as it is, not searched for leaving the start now', () => {
    const { tell } = withHalf();
    const jobs = tell({ type: 'refresh', riding: true, held: false }, clock(AT + 60));
    assert.deepEqual(did(jobs), ['keep', 'draw', 'retime']);
    assert.equal(drawn(jobs).now.seconds, AT);
});

test('a refresh with no trip: nothing', () => {
    const { tell } = page();
    tell({ type: 'to', place: MENELAOU });
    assert.deepEqual(tell({ type: 'refresh', riding: false, held: false }), []);
});

test('planned again from where the rider moved to: the answer before stays till the new half hour, which isn\'t said', () => {
    const { trip, tell } = withHalf();
    const jobs = tell({ type: 'moved', place: ON }, clock(AT + 120));
    assert.deepEqual(did(jobs), ['keep', 'move-live', 'search'], 'not started over: the stops keep their answers');
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
    const minute = tell({ type: 'refresh', riding: false, held: false }, clock(AT + 60));
    assert.equal(asked(minute).half, false, 'its half hour is still being worked out');
    assert.deepEqual(tell({ type: 'answer', id: asked(minute).id, options: OPTIONS, trains: true, timing, held: false }), []);
    assert.ok(trip.holding());
    assert.deepEqual(tell({ type: 'half', id, view: view(), held: false })[1].half, { say: false });
});

test('planned again: the half hour held in the answer, so the next answer after it is drawn', () => {
    const { trip, tell } = withHalf();
    const { id } = asked(tell({ type: 'moved', place: ON }));
    tell({ type: 'answer', id, options: OPTIONS, trains: true, timing, held: false });
    assert.deepEqual(tell({ type: 'half', id, view: view(), held: true }), [{ do: 'timing' }]);
    assert.equal(trip.holding(), false, 'the half hour is in');
    assert.deepEqual(did(tell({ type: 'redraw', held: false })), ['draw']);
});

test('the tickets: planned again drops the way\'s and the other ways\' timing, not the stops\'; a new trip drops all', () => {
    const { latest, tell } = withHalf();
    const way = latest.take('way');
    const others = latest.take('others');
    const stop = latest.take('stop 60002');
    tell({ type: 'moved', place: ON });
    assert.equal(latest.counts('way', way), false);
    assert.equal(latest.counts('others', others), false);
    assert.equal(latest.counts('stop 60002', stop), true);
    tell({ type: 'to', place: FIX });
    assert.equal(latest.counts('stop 60002', stop), false);
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
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'search']);
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
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'search']);
    assert.equal(asked(jobs).speak, undefined);
    assert.equal(drawn(tell({ type: 'answer', id: asked(jobs).id, options: OPTIONS, trains: true, timing, held: false })).speak, false, 'nothing picked: not said');
});

test('the ride kept taken up: searched for when it was, planned as of then, and passed on with the new trip', () => {
    const { trip, tell } = page();
    tell({ type: 'kept', from: null, to: MENELAOU });
    const ride = { at: 5_000, now: clock(AT - 900).now, key: 'bus:1>bus:2', choice: 'taken' };
    const jobs = tell({ type: 'resume', place: ON, ride });
    assert.deepEqual(did(jobs), ['keep', 'new-trip', 'search']);
    assert.equal(jobs[1].resumed, ride);
    assert.deepEqual(asked(jobs).now, ride.now);
    assert.equal(trip.plannedAt, 5_000);
    assert.equal(drawn(tell({ type: 'answer', id: asked(jobs).id, options: OPTIONS, trains: true, timing, held: false })).speak, true);
    // A refresh later keeps when it was planned
    tell({ type: 'refresh', riding: true, held: false }, clock(AT + 60));
    assert.equal(trip.plannedAt, 5_000);
});

test('when the trip was planned: once for its ends, again for new ones', () => {
    const { trip, tell } = withHalf();
    assert.equal(trip.plannedAt, AT * 1000);
    tell({ type: 'refresh', riding: false, held: false }, clock(AT + 60));
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
    assert.deepEqual(did(tell({ type: 'refresh', riding: false, held: false }, clock(AT + 60))), ['keep', 'draw', 'retime']);
});

test('the searches failing: by metro and tram from now on, the live times started over, said when a newer Wayhop waits', () => {
    const { trip, latest, tell, search } = answered();
    const way = latest.take('way');
    const jobs = tell({ type: 'failed', updated: true }, clock(AT + 30));
    assert.deepEqual(jobs, [{ do: 'reset-live' }, { do: 'keep', from: SYNTAGMA, to: MENELAOU }, { do: 'draw', now: clock(AT + 30).now, buses: [], speak: true }]);
    assert.equal(trip.noBuses, 'updated');
    assert.equal(trip.answer(), null);
    assert.equal(latest.counts('way', way), false, 'nothing asked before counts');
    assert.deepEqual(tell({ type: 'answer', id: search.id, options: OPTIONS, trains: true, timing, held: false }), []);
    assert.deepEqual(did(page().tell({ type: 'failed', updated: false })), ['reset-live', 'keep', 'intro'], 'with no trip: the page says what it does');
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
    const minute = asked(tell({ type: 'refresh', riding: false, held: false }, clock(AT + 60)));
    tell({ type: 'answer', id: minute.id, options: OPTIONS, trains: true, timing: { city: null, answer: 20 }, held: false });
    assert.equal(trip.timing.city, 120);
    assert.equal(trip.timing.answer, 20);
});
