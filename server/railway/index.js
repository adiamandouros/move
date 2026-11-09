import express from 'express';
import { statSync } from 'fs';
import { join } from 'path';
import { addDays, athensToday, isoDate } from '../data/calendar.js';
import { readJson } from '../files.js';
import { boardTrains, createTracker } from './lateness.js';
import { look as lookAtStream } from './stream.js';

// The suburban railway's live times for the Trip page (decision 42): how
// late each running train is, worked out from railway.gov.gr's live stream
// (lateness.js), served at /api/trains. Looked at as agreed on 8 November
// 2026, as OSE sees each look:
//   - only while someone wants them: a visitor's request starts the looks,
//     which go on once a minute (LOOK_EVERY_MS) until no one has asked for
//     WANTED_MS, so an idle app sends nothing
//   - one look serves every visitor; the first request with no answer yet
//     waits for it (at most its 10-second timeout, stream.js)
//   - after FAILURES_TO_REST failures in a row, a rest of REST_MS
// Each train's timetable comes from the boards the data build keeps
// (railway.js), today's and yesterday's, for a train still running after
// midnight; read again when the build replaces them.

export const LOOK_EVERY_MS = 60_000;
export const WANTED_MS = 3 * 60_000;
export const FAILURES_TO_REST = 3;
export const REST_MS = 10 * 60_000;
// A lateness from longer ago isn't served
export const FRESH_MS = 3 * 60_000;

const NO_USAGE = { trainAsk() {}, trainLook() {} };

/**
 * → an Express router for /api/trains: { at, trains: { [train number]: { late: seconds, exact } } },
 * or { unavailable: true } when there's no lateness from the past FRESH_MS;
 * with status() for /api/health
 * @param {{ boardsDir: string, corridors: Set<string>, fetch?: typeof globalThis.fetch, userAgent?: string,
 *   usage?: { trainAsk(): void, trainLook(ok: boolean, bytes: number): void }, now?: () => number,
 *   later?: (run: () => void, ms: number) => void, look?: typeof lookAtStream, log?: (message: string) => void }} options
 *   later: runs something in `ms` (tests run it themselves); look: one look at the stream (stream.js)
 */
export function createTrainTimes({
    boardsDir, corridors, fetch = globalThis.fetch, userAgent = 'Wayhop', usage = NO_USAGE, now = Date.now,
    later = (run, ms) => { setTimeout(run, ms).unref(); }, look = lookAtStream, log = console.warn,
}) {
    const tracker = createTracker();
    // Each date's board as its trains, until the build replaces it (its file's time changes)
    /** @type {Map<string, { changed: number, trains: ReturnType<typeof boardTrains> }>} */
    const boards = new Map();
    let wantedAt = -Infinity;
    let lookedAt = -Infinity;
    let restUntil = -Infinity;
    let failures = 0;
    /** @type {{ at: number, trains: Record<string, { late: number, exact: boolean }> } | null} */
    let latest = null;
    /** @type {{ at: number, ok: boolean, error?: string } | null} */
    let last = null;
    /** @type {Promise<void> | null} */
    let looking = null;
    let waiting = false;

    const wanted = () => now() - wantedAt < WANTED_MS;
    const resting = () => now() < restUntil;
    const due = () => !resting() && now() - lookedAt >= LOOK_EVERY_MS;

    // The trains of today's board and yesterday's
    function schedules() {
        const today = athensToday(new Date(now()));
        const dates = [isoDate(addDays(today, -1)), isoDate(today)];
        for (const date of boards.keys()) if (!dates.includes(date)) boards.delete(date);
        return new Map(dates.flatMap(date => {
            const file = join(boardsDir, `${date}.json`);
            let changed = null;
            try { changed = statSync(file).mtimeMs; } catch { /* not fetched */ }
            if (boards.get(date)?.changed !== changed) boards.set(date, { changed, trains: changed === null ? new Map() : boardTrains(readJson(file), corridors) });
            return [...boards.get(date).trains];
        }));
    }

    const lookNow = () => looking ??= (async () => {
        lookedAt = now();
        try {
            const { positions, bytes } = await look({ fetch, userAgent });
            usage.trainLook(true, bytes);
            latest = { at: lookedAt, trains: tracker.update(positions, schedules()) };
            last = { at: lookedAt, ok: true };
            failures = 0;
        } catch (err) {
            usage.trainLook(false, err.bytes ?? 0);
            last = { at: lookedAt, ok: false, error: err.message };
            if (++failures < FAILURES_TO_REST) return;
            failures = 0;
            restUntil = now() + REST_MS;
            log(`[railway] railway.gov.gr's train positions failed ${FAILURES_TO_REST} times in a row (${err.message}): resting ${REST_MS / 60_000} minutes`);
        }
    })().finally(() => { looking = null; });

    // The next look, while someone wants them
    function keepLooking() {
        if (waiting) return;
        waiting = true;
        later(async () => {
            waiting = false;
            if (!wanted()) return;
            if (due()) await lookNow();
            keepLooking();
        }, resting() ? restUntil - now() : Math.max(0, lookedAt + LOOK_EVERY_MS - now()));
    }

    // A visitor wants the trains' lateness: a look now if one is due, waited
    // for when there's no answer yet
    async function want() {
        wantedAt = now();
        if (due()) await lookNow();
        else if (looking && !latest) await looking;
        keepLooking();
    }

    const answer = () => latest && now() - latest.at < FRESH_MS
        ? { at: new Date(latest.at).toISOString(), trains: latest.trains }
        : { unavailable: true };

    // → { ok, wanted, resting, last }, for /api/health: not ok while it rests and someone wants it
    const status = () => ({ ok: !(wanted() && resting()), wanted: wanted(), resting: resting(), last });

    const router = express.Router();
    router.get('/', async (_req, res) => {
        usage.trainAsk();
        await want();
        res.set('Cache-Control', 'no-store').json(answer());
    });

    return Object.assign(router, { want, answer, status });
}
