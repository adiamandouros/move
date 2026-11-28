import { statSync } from 'fs';
import express from 'express';
import { messageOf } from '../errors.js';
import { readJson, writeFileAtomic } from '../files.js';
import { clientKey, createClientLimiter } from '../oasa/limits.js';
import { withTram } from '../../tools/subway/client/network.js';
import { checkReport } from './check.js';
import { addReport, linesSummary, recent } from './totals.js';

// Times measured by riders on the metro and the tram (decision 84).
//
// POST /api/rider-times with a ride's report (tools/trip/client/measure.js),
// sent by a phone whose rider said yes. It's checked (check.js), added to the
// totals (totals.js) and forgotten: no report, address or time is kept. The
// totals are a JSON file in data/local, written at most every SAVE_MS, with
// no database (decision 4). Each visitor may send REPORTS_PER_HOUR, their
// address kept in memory for the hour (limits.js).
//
// Answers: 204 counted; 400 it can't count (the phone drops it); 429 too
// many this hour, 503 the network isn't loaded (the phone tries later).

export const REPORTS_PER_HOUR = 6;
const HOUR_MS = 60 * 60_000;
export const SAVE_MS = 5 * 60_000;

/**
 * file: where the totals are kept (null: in memory only, as in tests);
 * railFile: rail.json, the network a report is checked against, read again
 * when it changes; `later`: how the save waits (setTimeout; tests give their own)
 * @param {{ file: string | null, railFile: string, now?: () => number, log?: (message: string) => void,
 *   limiter?: { take(key: string, cost: number): number }, later?: (fn: () => void, ms: number) => unknown }} options
 */
export function createRiderTimes({ file, railFile, now = Date.now, log = console.error, limiter = createClientLimiter({ perMinute: REPORTS_PER_HOUR, windowMs: HOUR_MS, now }), later = laterOn }) {
    /** @type {import('./totals.js').Totals} */
    let totals = { weeks: readJson(file ?? '')?.weeks ?? {} };
    let savedAt = 0;
    let waiting = false;
    let counted = 0;
    let refused = 0;

    // The network, made again once rail.json changes
    /** @type {{ mtime: number, net: import('../../tools/subway/client/network.js').Rail } | null} */
    let network = null;
    const net = () => {
        try {
            const mtime = statSync(railFile).mtimeMs;
            if (network?.mtime !== mtime) {
                const rail = readJson(railFile);
                network = rail ? { mtime, net: withTram(rail) } : network;
            }
        } catch { /* the last one there was */ }
        return network?.net ?? null;
    };

    function save() {
        waiting = false;
        savedAt = now();
        totals = recent(totals, savedAt);
        if (!file) return;
        try {
            writeFileAtomic(file, JSON.stringify(totals));
        } catch (err) {
            log(`[riders] Couldn't save the totals: ${messageOf(err)}`);
        }
    }
    const saveSoon = () => {
        if (waiting) return;
        waiting = true;
        later(save, Math.max(0, savedAt + SAVE_MS - now()));
    };

    const router = express.Router();
    router.post('/', express.json({ limit: '16kb' }), (req, res) => {
        const network = net();
        if (!network) { res.status(503).end(); return; }
        const checked = checkReport(req.body, network);
        if ('problem' in checked) {
            refused++;
            res.status(400).json({ error: checked.problem });
            return;
        }
        // Counted against the visitor only once it's a report that counts
        const wait = limiter.take(clientKey(req.ip), 1);
        if (wait) {
            res.set('Retry-After', String(Math.ceil(wait / 1000))).status(429).end();
            return;
        }
        addReport(totals, checked.report, now());
        counted++;
        saveSoon();
        res.status(204).end();
    });
    // A request that isn't JSON, or too big
    router.use(/** @type {import('express').ErrorRequestHandler} */ ((err, req, res, next) => {
        if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
            refused++;
            res.status(400).json({ error: 'not a report' });
            return;
        }
        next(err);
    }));

    return {
        router,
        // For /admin/diagnostics: reports counted and refused since the
        // server started, and per line, phase 3's test (totals.js)
        status: () => ({ counted, refused, lines: linesSummary(totals, now()) }),
        // Kept now (tests)
        save,
        totals: () => totals,
    };
}

/** @param {() => void} fn @param {number} ms */
function laterOn(fn, ms) {
    setTimeout(fn, ms).unref?.();
}
