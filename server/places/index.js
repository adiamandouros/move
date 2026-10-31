import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import { readJson, writeFileAtomic } from '../files.js';
import { clientKey, createClientLimiter } from '../oasa/limits.js';
import { countsOf, lostSince, PUBLISHED, unpack } from './published.js';
import { load, search } from './search.js';

// Address search on our own server (decision 22).
//
// POST /api/places with { q }: what someone is typing goes in the body, so
// that addresses stay out of the host's request logs, and nothing here keeps
// it. It takes a letter at a time, hence the limit, which only guards the
// server: OASA isn't asked.
//
// The index is built on GitHub and downloaded when it's a week old. It's
// about 95 MB in memory, so it's only loaded for the first search, and a new
// one replaces the old by dropping it: the two are never in memory together.

const SEARCHES_PER_MINUTE = 120;
const MAX_QUERY = 120;
const REFRESH_AFTER_DAYS = 7;
const DOWNLOAD_TIMEOUT_MS = 120_000;
// A few missed weeks do no harm; more means the weekly build has stopped
export const STALE_AFTER_DAYS = 21;
const DAY_MS = 86_400_000;

/**
 * @param {{
 *   dir: string, fetch?: typeof globalThis.fetch, now?: () => number,
 *   limiter?: { take(key: string, cost: number): number }, log?: (message: string) => void,
 * }} options
 */
export function createPlaces({ dir, fetch = globalThis.fetch, now = Date.now, limiter = createClientLimiter({ perMinute: SEARCHES_PER_MINUTE }), log = console.error }) {
    const indexFile = join(dir, 'places-index.json.gz');
    const metaFile = join(dir, 'places-index.meta.json');
    /** @type {{ built: string, counts: Record<string, number> } | null} */
    let meta = readJson(metaFile);
    let db = null;
    let failed = false;

    const ageDays = () => (now() - Date.parse(meta.built)) / DAY_MS;

    function database() {
        if (meta) db ??= load(unpack(readFileSync(indexFile)));
        return db;
    }

    async function download() {
        const response = await fetch(PUBLISHED, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const file = Buffer.from(await response.arrayBuffer());
        const index = unpack(file);
        const counts = countsOf(index);
        const lost = lostSince(counts, meta?.counts);
        if (lost.length) throw new Error(lost.join('; '));
        if (index.built === meta?.built) return;
        writeFileAtomic(indexFile, file);
        writeFileAtomic(metaFile, JSON.stringify({ built: index.built, counts }));
        meta = { built: index.built, counts };
        db = null;
    }

    // Never throws: whatever goes wrong, the index in use stays
    async function refresh() {
        try {
            await download();
            failed = false;
        } catch (err) {
            failed = true;
            log(`[places] The index wasn't updated: ${err.message}`);
        }
    }

    const router = express.Router();
    router.post('/', express.json({ limit: '1kb' }), (req, res) => {
        const q = req.body?.q;
        if (typeof q !== 'string' || !q.trim() || q.length > MAX_QUERY) {
            return res.status(400).json({ error: `Pass q, up to ${MAX_QUERY} characters` });
        }
        const wait = limiter.take(clientKey(req.ip), 1);
        if (wait) return res.status(429).set('Retry-After', String(Math.ceil(wait / 1000))).json({ error: 'Too many searches; try again shortly' });
        const places = database();
        if (!places) return res.status(503).json({ error: 'Address search is unavailable' });
        const { results, notInTown, noSuchTown = false, corrected } = search(places, q);
        res.set('Cache-Control', 'no-store').json({ results, notInTown, noSuchTown, corrected });
    });

    return Object.assign(router, {
        refresh,
        refreshIfDue: async () => { if (!meta || ageDays() >= REFRESH_AFTER_DAYS) await refresh(); },
        // Not tried yet counts as fine, as a fresh start hasn't had the chance
        status: () => ({ ok: meta ? ageDays() < STALE_AFTER_DAYS : !failed, built: meta?.built ?? null }),
    });
}
