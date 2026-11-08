import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BOARD_DAYS, BOARD_URL, PACE_MS, RETRY_WAITS_MS, boardDates, railwayBoards, railwayFetchFile } from '../server/data/railway.js';
import { readJson } from '../server/files.js';
import { tempDir } from './fixtures/gtfs.js';
import { fakeRailway } from './fixtures/railway.js';

// The suburban railway's boards from railway.gov.gr (server/data/railway.js),
// and how gently they're asked for: the numbers agreed on 2026-11-08 (decision 41)

const T0 = Date.parse('2026-11-08T02:30:00Z');
const WEEK = ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'];

function setup() {
    const rawDir = tempDir();
    const railway = fakeRailway();
    const pauses = [];
    const logs = [];
    const boards = (more = {}) => railwayBoards({
        rawDir, today: '20261108', fetch: railway.fetch, userAgent: 'Wayhop (test)', now: () => T0,
        sleep: async ms => { pauses.push(ms); }, log: m => logs.push(m), ...more,
    });
    return { rawDir, railway, pauses, logs, boards, kept: () => readdirSync(join(rawDir, 'railway', 'boards')).sort() };
}

test('the agreed numbers: yesterday, today and the next 4 days, 10 s apart, tried again after 10, 30 and 60 s', () => {
    assert.deepEqual(BOARD_DAYS, [-1, 0, 1, 2, 3, 4]);
    assert.equal(PACE_MS, 10_000);
    assert.deepEqual(RETRY_WAITS_MS, [10_000, 30_000, 60_000]);
    assert.deepEqual(boardDates('20261108'), WEEK);
    // Across the end of a month and a year
    assert.deepEqual(boardDates('20261231'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
});

test('six boards, one at a time and 10 s apart, as Wayhop: kept, with yesterday\'s lateness and a record of the fetch', async () => {
    const { rawDir, railway, pauses, boards, kept } = setup();
    const got = await boards();
    assert.deepEqual(railway.dates, WEEK);
    assert.deepEqual(railway.calls.map(c => c.url.split('?')[0]), Array(6).fill(BOARD_URL));
    assert.deepEqual(railway.calls[0].headers, { 'User-Agent': 'Wayhop (test)', Accept: 'application/json' });
    assert.deepEqual(pauses, Array(5).fill(PACE_MS));
    assert.deepEqual(Object.keys(got.boards), WEEK);
    assert.equal(got.boards['2026-11-08'].schedules.length, 4);
    assert.equal(got.fetched, '2026-11-08T02:30:00.000Z');
    assert.equal(got.error, undefined);
    assert.deepEqual(kept(), WEEK.map(d => `${d}.json`));
    assert.deepEqual(readJson(railwayFetchFile(rawDir)), {
        at: '2026-11-08T02:30:00.000Z', today: '20261108', ok: true, seconds: 0, boards: { done: 6, total: 6 }, fetched: '2026-11-08T02:30:00.000Z',
    });
    // Yesterday's trains as they ran: each one's lateness, kept for later
    const lateness = readJson(join(rawDir, 'railway', 'lateness', '2026-11-07.json'));
    assert.equal(lateness.length, 4);
    assert.deepEqual(lateness[0], { train: '1200', corridor: 'PIRAIR', departs: '2026-11-07T06:00:00.000Z', status: 'scheduled', delay: 0 });
});

test('once an Athens day: a restart the same day asks nothing; the next day asks again, and boards from before yesterday go', async () => {
    const { rawDir, railway, boards, kept } = setup();
    await boards();
    const again = await boards({ now: () => T0 + 6 * 3_600_000 });
    assert.equal(railway.calls.length, 6);
    assert.deepEqual(Object.keys(again.boards), WEEK);
    assert.equal(again.fetched, '2026-11-08T02:30:00.000Z');

    const tomorrow = await boards({ today: '20261109', now: () => T0 + 86_400_000 });
    assert.equal(railway.calls.length, 12);
    assert.deepEqual(railway.dates.slice(6), ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    assert.deepEqual(Object.keys(tomorrow.boards), ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    assert.ok(!kept().includes('2026-11-07.json'), 'the day before yesterday is gone');
    // Lateness is kept for 91 days
    assert.deepEqual(readdirSync(join(rawDir, 'railway', 'lateness')).sort(), ['2026-11-07.json', '2026-11-08.json']);
});

test('a failed request is tried again after 10 s, then 30 s, and each failure is logged', async () => {
    const { railway, pauses, logs, boards } = setup();
    railway.fail('2026-11-09', { times: 2 });
    const got = await boards();
    assert.deepEqual(Object.keys(got.boards), WEEK);
    assert.equal(railway.dates.filter(d => d === '2026-11-09').length, 3);
    // 10 s before each board, and before the 9th's second and third tries 10 s and 30 s more
    assert.deepEqual(pauses, [PACE_MS, PACE_MS, 10_000, 30_000, PACE_MS, PACE_MS, PACE_MS]);
    assert.deepEqual(logs.slice(0, 2), [
        '[data] railway.gov.gr board for 2026-11-09 failed: HTTP 502 — trying again in 10 s',
        '[data] railway.gov.gr board for 2026-11-09 failed: HTTP 502 — trying again in 30 s',
    ]);
});

test('a board failing 4 times stops the fetch: the boards it got and those from before are kept, and the next try is tomorrow', async () => {
    const { rawDir, railway, pauses, logs, boards } = setup();
    // An earlier fetch left the boards up to the 11th
    mkdirSync(join(rawDir, 'railway', 'boards'), { recursive: true });
    for (const date of WEEK.slice(0, 5)) writeFileSync(join(rawDir, 'railway', 'boards', `${date}.json`), JSON.stringify({ schedules: [], from: 'before' }));
    railway.fail('2026-11-10');
    const got = await boards();
    // Yesterday, today and tomorrow fetched, then the 10th 4 times: none after it
    assert.deepEqual(railway.dates, [...WEEK.slice(0, 3), ...Array(4).fill('2026-11-10')]);
    assert.deepEqual(pauses, [PACE_MS, PACE_MS, PACE_MS, 10_000, 30_000, 60_000]);
    assert.deepEqual(Object.keys(got.boards), WEEK.slice(0, 5));
    assert.equal(got.boards['2026-11-09'].schedules.length, 4, 'fetched now');
    assert.equal(got.boards['2026-11-10'].from, 'before', 'kept from before');
    assert.equal(got.fetched, null);
    assert.equal(got.error, undefined);
    assert.deepEqual(readJson(railwayFetchFile(rawDir)), {
        at: '2026-11-08T02:30:00.000Z', today: '20261108', ok: false, seconds: 0, boards: { done: 3, total: 6 }, fetched: null,
        error: 'the board for 2026-11-10: HTTP 502 (4 tries)',
    });
    assert.equal(logs.at(-1), '[data] Couldn\'t fetch the trains from railway.gov.gr (the board for 2026-11-10: HTTP 502 (4 tries)); 3 of 6 boards fetched, the others kept');
    // A restart the same day doesn't try again
    await boards();
    assert.equal(railway.calls.length, 7);
});

test('a request we got wrong (HTTP 4xx) isn\'t tried again, and an answer that isn\'t a board is a failure', async () => {
    const wrong = setup();
    wrong.railway.fail('2026-11-07', { status: 404 });
    const got = await wrong.boards();
    assert.equal(wrong.railway.calls.length, 1);
    assert.deepEqual(got, { boards: {}, fetched: null, error: 'no boards fetched yet' });

    const odd = setup();
    const railway = fakeRailway({ boardOf: () => ({ message: 'Unauthorized' }) });
    await odd.boards({ fetch: railway.fetch });
    assert.equal(railway.calls.length, 4);
    assert.match(odd.logs[0], /^\[data\] railway\.gov\.gr board for 2026-11-07 failed: answered \{"message":"Unauthorized"\}/);
});

test('offline, or with no way to ask: the kept boards, and nothing asked', async () => {
    const { rawDir, railway, boards } = setup();
    assert.deepEqual(await boards({ offline: true }), { boards: {}, fetched: null, error: 'no boards fetched yet' });
    assert.deepEqual(await boards({ fetch: null }), { boards: {}, fetched: null, error: 'no boards fetched yet' });
    assert.equal(railway.calls.length, 0);
    assert.ok(!existsSync(railwayFetchFile(rawDir)));
    await boards();
    const offline = await boards({ offline: true, today: '20261109' });
    assert.equal(railway.calls.length, 6);
    assert.deepEqual(Object.keys(offline.boards), WEEK.slice(1), 'the 13th was never fetched');
});
