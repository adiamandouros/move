import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { boardTrains, createTracker } from '../server/railway/lateness.js';
import { createTrainTimes, FAILURES_TO_REST, FRESH_MS, LOOK_EVERY_MS, REST_MS, WANTED_MS } from '../server/railway/index.js';
import { eventReader, look, STREAM_URL } from '../server/railway/stream.js';
import { athensIso, board, train } from './fixtures/railway.js';
import { listen } from './support/listen.js';

// The suburban railway's live times (server/railway/, decision 42): a look
// at railway.gov.gr's live stream, how late each running train is from one
// look to the next, and the looks only while someone wants them

const DATE = '2026-11-09';
const ATHENS = new Set(['PIRAIR', 'KIATO', 'CHALKIDA']);
const MINUTE = 60_000;
const at = hhmm => athensIso(DATE, hhmm);

// ── A look at the stream ────────────────────────────────────────────────────

// Server-sent events as railway.gov.gr sends them
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const POSITIONS = [{ trainNumber: '1200', scheduleNumber: '1200-20261109-0000', nextStationId: 'o2', timestamp: at('08:10') }];
const STREAM = event('trainHistory', { history: { x: Array(2000).fill({ lat: 37.9, lng: 23.7 }) } })
    + event('trainPositionsUx', { positions: POSITIONS })
    + event('scheduleCards', { ghosts: [] });

// The stream in pieces of `size` bytes; `asked` has each request's headers,
// `cancelled` says whether the reader hung up. `then`: what comes after the
// pieces ('end', or 'wait' for ever)
function streamFetch(text, { size = 1000, status = 200, then = 'wait' } = {}) {
    const bytes = new TextEncoder().encode(text);
    const fake = { asked: [], cancelled: false };
    fake.fetch = async (url, init) => {
        fake.asked.push({ url, headers: init.headers });
        let sent = 0;
        const body = new ReadableStream({
            pull(controller) {
                if (sent < bytes.length) {
                    controller.enqueue(bytes.slice(sent, sent + size));
                    sent += size;
                } else if (then === 'end') controller.close();
                else return new Promise(() => {});
            },
            cancel() { fake.cancelled = true; },
        });
        init.signal.addEventListener('abort', () => { fake.cancelled = true; });
        return new Response(status === 200 ? body : 'busy', { status });
    };
    return fake;
}

test('a look reads the stream until the first positions, skipping the history, and hangs up', async () => {
    for (const size of [7, 1000, 1_000_000]) {
        const fake = streamFetch(STREAM, { size });
        const { positions, bytes } = await look({ fetch: fake.fetch, userAgent: 'Wayhop (test)' });
        assert.deepEqual(positions, POSITIONS, `pieces of ${size}`);
        assert.ok(bytes > 0 && bytes <= new TextEncoder().encode(STREAM).length);
        assert.equal(fake.cancelled, true, 'hung up');
        assert.deepEqual(fake.asked, [{ url: STREAM_URL, headers: { 'User-Agent': 'Wayhop (test)', Accept: 'text/event-stream' } }]);
    }
});

test('a look fails on an HTTP error, a stream that ends first, or no positions within its time', async () => {
    await assert.rejects(look({ fetch: streamFetch(STREAM, { status: 503 }).fetch }), /HTTP 503/);
    await assert.rejects(look({ fetch: streamFetch(event('trainHistory', {}), { then: 'end' }).fetch }), /ended before any positions/);
    const slow = streamFetch(event('trainHistory', { history: {} }));
    await assert.rejects(look({ fetch: slow.fetch, timeoutMs: 50 }), err => /no positions within 0.05 s/.test(err.message) && err.bytes > 0);
    assert.equal(slow.cancelled, true);
    await assert.rejects(look({ fetch: streamFetch(event('trainPositionsUx', { other: 1 })).fetch }), /no positions/);
});

test('reading events: another event\'s data dropped as it comes, the wanted one\'s lines joined, CRLF too', () => {
    const read = eventReader('wanted');
    assert.equal(read(': a comment\nevent: other\ndata: {"long'), null);
    assert.equal(read('"x".repeat}\n\nevent: wanted\r\ndata: one\r\n'), null);
    assert.equal(read('data: two\r\n\r\nevent: wanted\ndata: three\n\n'), 'one\ntwo');
    // Another event's data, however long, isn't held as it comes
    const reading = eventReader('wanted');
    reading('event: trainHistory\ndata: {"history":');
    for (let i = 0; i < 100; i++) reading('x'.repeat(10_000));
    assert.ok(reading.held() < 100, `holds ${reading.held()} characters`);
    reading('}\n\nevent: wanted\ndata: 1\n');
    assert.equal(reading.held(), 1);
});

// ── How late each train is ──────────────────────────────────────────────────

// Today's board: 1200 Piraeus 08:00, Athens 08:15, Airport 09:05; one on
// another line, one cancelled and a freight train, all left out
const today = () => ({ schedules: [
    ...board(DATE).schedules,
    train(DATE, '1300', [['o1', '08:00'], ['o2', '08:20']], { corridor: 'THESLAR' }),
    train(DATE, '1204', [['o1', '10:00'], ['o3', '11:00']], { status: 'cancelled' }),
] });
const seen = (number, next, hhmm) => ({ scheduleNumber: `${number}-20261109-0000`, nextStationId: next, timestamp: at(hhmm) });

test('a board\'s suburban trains on Athens\'s lines, by schedule number: each stop\'s timetabled arrival and departure', () => {
    const trains = boardTrains(today(), ATHENS);
    assert.deepEqual([...trains.keys()], ['1200-20261109-0000', '1202-20261109-0000', '1201-20261109-0000']);
    assert.deepEqual(trains.get('1200-20261109-0000'), {
        train: '1200',
        stops: [['o1', null, Date.parse(at('08:00'))], ['o2', Date.parse(at('08:15')), Date.parse(at('08:15'))], ['o3', Date.parse(at('09:05')), null]],
    });
    assert.equal(boardTrains(null, ATHENS).size, 0);
});

test('lateness: at least how late on the way to a station, measured when the next station changes, the larger counting', () => {
    const trains = boardTrains(today(), ATHENS);
    const tracker = createTracker();
    const look = (...positions) => tracker.update(positions, trains);
    // On its way to Athens (08:15) at 08:10, then at 08:18: at least 3′
    assert.deepEqual(look(seen('1200', 'o2', '08:10')), { 1200: { late: 0, exact: false } });
    assert.deepEqual(look(seen('1200', 'o2', '08:18')), { 1200: { late: 180, exact: false } });
    // At 08:19 it's left Athens (due 08:15): between the two looks, 3½′ late, measured
    assert.deepEqual(look(seen('1200', 'o3', '08:19')), { 1200: { late: 210, exact: true } });
    // Still measured on its way to the airport, until it's past due there by more
    assert.deepEqual(look(seen('1200', 'o3', '09:08')), { 1200: { late: 210, exact: true } });
    assert.deepEqual(look(seen('1200', 'o3', '09:12')), { 1200: { late: 420, exact: false } });
});

test('lateness: still at its first station after its departure; never below 0; trains the boards don\'t have left out', () => {
    const tracker = createTracker();
    const trains = boardTrains(today(), ATHENS);
    assert.deepEqual(tracker.update([
        // Waiting at Piraeus at 08:03, due out at 08:00
        seen('1200', 'o1', '08:03'),
        // The airport train back, left Athens a minute early: on time, not early
        seen('1201', 'o2', '09:00'),
        // Another line, a schedule no board has, a station the train doesn't call at, no time
        seen('1300', 'o2', '08:10'), seen('9999', 'o2', '08:10'), seen('1202', 'o5', '09:10'), { ...seen('1202', 'o2', '09:10'), timestamp: undefined },
    ], trains), { 1200: { late: 180, exact: false }, 1201: { late: 0, exact: false } });
    assert.deepEqual(tracker.update([seen('1201', 'o1', '09:20')], trains), { 1201: { late: 0, exact: true } });
});

test('lateness: a station passed between looks counts the last one passed; a train back at an earlier station is no measure', () => {
    const date = DATE;
    const trains = boardTrains({ schedules: [train(date, '1500', [['o1', '08:00'], ['o2', '08:05'], ['o4', '08:10'], ['o3', '08:30']])] }, ATHENS);
    const tracker = createTracker();
    tracker.update([seen('1500', 'o2', '08:03')], trains);
    // Two stations on in one minute: it left o4 (08:10) between 08:03 and 08:13
    assert.deepEqual(tracker.update([seen('1500', 'o3', '08:13')], trains), { 1500: { late: 0, exact: true } });
    assert.deepEqual(tracker.update([seen('1500', 'o4', '08:14')], trains), { 1500: { late: 0, exact: true } });
});

// ── The looks, only while someone wants them ────────────────────────────────

// The server's clock, its timers (run by the test), and a stream whose looks
// see `positions` or fail
// slow: each look takes a few milliseconds, as a real one takes a second or two
function trainTimes({ boards = { [DATE]: today() }, fail = () => false, slow = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'wayhop-boards-'));
    for (const [date, b] of Object.entries(boards)) writeFileSync(join(dir, `${date}.json`), JSON.stringify(b));
    const clock = { t: Date.parse(at('08:18')) };
    const timers = [];
    const looks = [];
    const counted = { asked: 0, looks: [] };
    const logged = [];
    let positions = [seen('1200', 'o2', '08:18')];
    const times = createTrainTimes({
        boardsDir: dir, corridors: ATHENS, now: () => clock.t,
        later: (run, ms) => { timers.push({ run, at: clock.t + ms }); },
        look: async () => {
            looks.push(clock.t);
            if (slow) await new Promise(resolve => setTimeout(resolve, 5));
            if (fail(looks.length)) throw Object.assign(new Error('HTTP 502'), { bytes: 10 });
            return { positions, bytes: 250_000 };
        },
        usage: { trainAsk: () => { counted.asked++; }, trainLook: (ok, bytes) => counted.looks.push([ok, bytes]) },
        log: message => logged.push(message),
    });
    // Moves the clock on, running the timers due on the way
    const pass = async ms => {
        const end = clock.t + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            if (!timers.length || timers[0].at > end) break;
            const timer = timers.shift();
            clock.t = timer.at;
            await timer.run();
        }
        clock.t = end;
    };
    return { times, clock, timers, looks, counted, logged, pass, see: next => { positions = next; } };
}

test('no look until someone wants them; then one a minute, until no one has asked for 3 minutes', async () => {
    const { times, looks, timers, pass, clock } = trainTimes();
    assert.deepEqual(times.status(), { ok: true, wanted: false, resting: false, last: null });
    assert.deepEqual(times.answer(), { unavailable: true });
    await pass(10 * MINUTE);
    assert.equal(looks.length, 0, 'an idle app sends nothing');

    const start = clock.t;
    await times.want();
    assert.deepEqual(times.answer(), { at: new Date(start).toISOString(), trains: { 1200: { late: 180, exact: false } } });
    // Asked again within the minute: the same look
    await pass(30_000);
    await times.want();
    assert.equal(looks.length, 1);
    // Served for FRESH_MS after its look, no longer, when the looks after it fail
    const failing = trainTimes({ fail: n => n > 1 });
    await failing.times.want();
    await failing.pass(FRESH_MS - 1);
    assert.ok(failing.times.answer().trains);
    await failing.pass(1);
    assert.deepEqual(failing.times.answer(), { unavailable: true });
    await pass(WANTED_MS + 30_000);
    // A look a minute while wanted (the last ask at 0:30), then none
    assert.deepEqual(looks.map(t => (t - start) / 1000), [0, 60, 120, 180]);
    await pass(10 * MINUTE);
    assert.equal(looks.length, 4);
    assert.equal(timers.length, 0);
    assert.equal(times.status().wanted, false);
    // Its lateness isn't served for long after the last look
    assert.deepEqual(times.answer(), { unavailable: true });
});

test('every visitor at once shares one look; the first waits for it', async () => {
    const { times, looks } = trainTimes({ slow: true });
    const answers = await Promise.all([times.want(), times.want(), times.want()].map(async wanted => { await wanted; return times.answer(); }));
    assert.equal(looks.length, 1);
    assert.ok(answers.every(answer => answer.trains?.[1200]));
});

test('after 3 failures in a row, a 10-minute rest, said on the health page while someone wants it', async () => {
    const { times, looks, pass, logged, counted, clock } = trainTimes({ fail: n => n <= FAILURES_TO_REST });
    const start = clock.t;
    await times.want();
    await pass(2 * LOOK_EVERY_MS);
    assert.equal(looks.length, FAILURES_TO_REST);
    assert.deepEqual(counted.looks, [[false, 10], [false, 10], [false, 10]]);
    assert.deepEqual(logged, ['[railway] railway.gov.gr\'s train positions failed 3 times in a row (HTTP 502): resting 10 minutes']);
    assert.deepEqual(times.answer(), { unavailable: true });
    const status = times.status();
    assert.deepEqual([status.ok, status.wanted, status.resting, status.last.ok, status.last.error], [false, true, true, false, 'HTTP 502']);
    // Kept wanted: the next look once the rest is over, and it works
    for (let i = 0; i < 12; i++) { await times.want(); await pass(MINUTE); }
    assert.deepEqual(looks.map(t => (t - start) / MINUTE), [0, 1, 2, 2 + REST_MS / MINUTE, 3 + REST_MS / MINUTE, 4 + REST_MS / MINUTE]);
    assert.equal(times.status().ok, true);
    assert.ok(times.answer().trains);
    // Resting with no one wanting them is no problem
    const idle = trainTimes({ fail: () => true });
    for (let i = 0; i < FAILURES_TO_REST; i++) { await idle.times.want(); await idle.pass(MINUTE); }
    await idle.pass(WANTED_MS);
    assert.deepEqual([idle.times.status().resting, idle.times.status().ok], [true, true]);
});

test('each train\'s timetable from today\'s board, and yesterday\'s for a train still running after midnight; a board read again when replaced', async () => {
    const yesterday = { schedules: [train('2026-11-08', '1290', [['o1', '23:40'], ['o2', '23:55'], ['o3', '24:45']])] };
    const site = trainTimes({ boards: { '2026-11-08': yesterday, [DATE]: today() } });
    site.clock.t = Date.parse(at('00:47'));
    site.see([{ scheduleNumber: '1290-20261108-0000', nextStationId: 'o3', timestamp: at('00:47') }]);
    await site.times.want();
    assert.deepEqual(site.times.answer().trains, { 1290: { late: 120, exact: false } });
});

test('/api/trains: the lateness, never cached, each request counted', async () => {
    const { times, counted } = trainTimes();
    const server = await listen(express().use('/api/trains', times));
    try {
        const res = await fetch(`${server.url}/api/trains`);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual((await res.json()).trains, { 1200: { late: 180, exact: false } });
        assert.equal(counted.asked, 1);
        assert.deepEqual(counted.looks, [[true, 250_000]]);
    } finally {
        server.close();
    }
});
