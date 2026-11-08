import { mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { readJson, writeFileAtomic } from '../files.js';
import { addDays, isoDate } from './calendar.js';

// The suburban railway's timetable from railway.gov.gr, OSE's train site
// (decision 41): every train of a day, with each stop's times, from the
// schedule board its /schedules page reads. No terms, license or API are
// published; Wayhop uses it as public data while OSE is asked to publish it
// as open data. For trains.json (build-suburban.js). Fetched by the nightly
// data build, gently (agreed 2026-11-08):
//   - at most once an Athens day: a build at startup the same day reuses it
//   - the boards of yesterday, today and the next 4 days (BOARD_DAYS), one at
//     a time, PACE_MS apart: 6 requests, about 4.5 MB
//   - a failed request is tried again after 10 s, 30 s and 60 s
//     (RETRY_WAITS_MS); one still failing stops the fetch, keeping the
//     boards it got and those from before
// So the railway stays on the Trip page through 4 nights of failures, and
// only leaves it, with a note and a health warning, when there's no board
// for today. Yesterday's board has each train's real arrival: its lateness is
// kept (lateness/), a few KB a day, for a train's usual lateness later.
//
// Kept in rawDir/railway/: boards/YYYY-MM-DD.json, each board as it came
// ({ schedules: [...] }), and the record of the last fetch, last-fetch.json
// (shown by /admin/diagnostics and /api/health).

export const BOARD_URL = 'https://railway.gov.gr/api/public/schedule-board';
// Days from today: yesterday, today and the next 4
export const BOARD_DAYS = [-1, 0, 1, 2, 3, 4];
export const PACE_MS = 10_000;
export const RETRY_WAITS_MS = [10_000, 30_000, 60_000];
// A board is about 0.9 MB and answers in under a second
const TIMEOUT_MS = 30_000;
// Lateness kept, as long as the buses' passes (build-rides.js)
const LATENESS_DAYS = 91;

// The last fetch: { at, today, ok, seconds, boards: { done, total }, error? }
export const railwayFetchFile = rawDir => join(rawDir, 'railway', 'last-fetch.json');
const boardsDir = rawDir => join(rawDir, 'railway', 'boards');
const latenessDir = rawDir => join(rawDir, 'railway', 'lateness');

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The boards' dates, 'YYYY-MM-DD', for `today` ('YYYYMMDD') @param {string} today */
export const boardDates = today => BOARD_DAYS.map(days => isoDate(addDays(today, days)));

/**
 * One day's board → { schedules }. Tried again after each of RETRY_WAITS_MS;
 * a request we got wrong (HTTP 4xx) isn't
 * @param {string} date 'YYYY-MM-DD'
 */
async function fetchBoard(date, { fetch, userAgent, sleep, log }) {
    for (let tries = 1; ; tries++) {
        try {
            const response = await fetch(`${BOARD_URL}?date=${date}`, {
                headers: { 'User-Agent': userAgent, Accept: 'application/json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const board = await response.json();
            if (!Array.isArray(board?.schedules)) throw new Error(`answered ${JSON.stringify(board)?.slice(0, 80)}`);
            return board;
        } catch (err) {
            const wait = RETRY_WAITS_MS[tries - 1];
            const final = wait === undefined || /^HTTP 4\d\d\b/.test(err.message);
            log(`[data] railway.gov.gr board for ${date} failed: ${err.message}${final ? '' : ` — trying again in ${wait / 1000} s`}`);
            if (final) throw new Error(`the board for ${date}: ${err.message}${tries > 1 ? ` (${tries} tries)` : ''}`, { cause: err });
            await sleep(wait);
        }
    }
}

// Each train's lateness on a day that's over, from its board: the train, its
// line, when it was to leave, its status and minutes late at the end
const latenessOf = board => board.schedules.map(s => ({
    train: s.trainNumber, corridor: s.corridor, departs: s.scheduledDeparture, status: s.status, delay: s.delay ?? null,
}));

/**
 * The boards for this build, by date: today's and the next 4 days', with
 * yesterday's for its trains still running after midnight. Fetched now unless
 * they were already today (or the build is offline, or has no fetch); a
 * failed fetch keeps what there is. Boards from before yesterday are removed.
 * → { boards: { 'YYYY-MM-DD': board }, fetched: ISO time of the last good fetch | null, error? }
 * (error: there are no boards at all)
 * @param {{ rawDir: string, today: string, fetch?: typeof globalThis.fetch | null, userAgent?: string, offline?: boolean,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>, log?: (message: string) => void }} options
 */
export async function railwayBoards({ rawDir, today, fetch = globalThis.fetch, userAgent = 'Wayhop', offline = false, now = Date.now, sleep = realSleep, log = console.log }) {
    const dates = boardDates(today);
    const last = readJson(railwayFetchFile(rawDir));
    let fetched = last?.fetched ?? null;
    if (!offline && fetch && last?.today !== today) {
        mkdirSync(boardsDir(rawDir), { recursive: true });
        mkdirSync(latenessDir(rawDir), { recursive: true });
        const started = now();
        const boards = { done: 0, total: dates.length };
        const record = (ok, error) => writeFileAtomic(railwayFetchFile(rawDir), JSON.stringify({
            at: new Date(started).toISOString(), today, ok, seconds: Math.round((now() - started) / 1000), boards,
            fetched: ok ? new Date(started).toISOString() : fetched, ...(error ? { error } : {}),
        }));
        try {
            for (const [i, date] of dates.entries()) {
                if (i) await sleep(PACE_MS);
                const board = await fetchBoard(date, { fetch, userAgent, sleep, log });
                writeFileAtomic(join(boardsDir(rawDir), `${date}.json`), JSON.stringify(board));
                if (i === 0) writeFileAtomic(join(latenessDir(rawDir), `${date}.json`), JSON.stringify(latenessOf(board)));
                boards.done++;
            }
            fetched = new Date(started).toISOString();
            record(true);
            log(`[data] Fetched ${dates.length} days of trains from railway.gov.gr in ${Math.round((now() - started) / 1000)} s`);
        } catch (err) {
            record(false, err.message);
            log(`[data] Couldn't fetch the trains from railway.gov.gr (${err.message}); ${boards.done} of ${dates.length} boards fetched, the others kept`);
        }
    }
    prune(boardsDir(rawDir), dates[0]);
    prune(latenessDir(rawDir), isoDate(addDays(today, -LATENESS_DAYS)));
    const boards = {};
    for (const date of dates) {
        const board = readJson(join(boardsDir(rawDir), `${date}.json`));
        if (board) boards[date] = board;
    }
    return Object.keys(boards).length ? { boards, fetched } : { boards, fetched, error: 'no boards fetched yet' };
}

// Remove the days in `dir` before `first` ('YYYY-MM-DD')
function prune(dir, first) {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) if (/^\d{4}-\d\d-\d\d\.json$/.test(name) && name.slice(0, 10) < first) rmSync(join(dir, name), { force: true });
}
