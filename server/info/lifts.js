import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { userAgentFor } from '../config.js';
import { stasyNameKey, stationNames } from '../data/stasy.js';
import { readJson, writeFileAtomic } from '../files.js';
import { createStasyClient } from '../stasy.js';
import { decode } from './announcements.js';

// Which metro lifts are out of service, from STASY's lift page: its control
// rooms keep it current, for every lift of every M1, M2 and M3 station. The
// subway planner and the station pages warn with it (public/js/core/lifts.js).
// Fetched only when someone asks and the copy is older than REFRESH_MS
// (at most 144 a day, agreed 2026-10-27), so an idle app sends nothing; a
// failure keeps the last good copy, but one older than MAX_AGE_MS isn't
// served: an outage that long ago may be fixed. The copy is kept in
// `cacheFile`, so a restart doesn't fetch again at once. STASY's pages come
// directly or through the relays (server/stasy.js).

const REFRESH_MS = 10 * 60_000;
const MAX_AGE_MS = 2 * 3_600_000;
// Fewer stations than this on the page: it has changed, not the lifts
const MIN_STATIONS = 50;

export const LIFTS_PAGE = 'https://www.stasy.gr/elevators/';
const STATIONS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'curated', 'stations.json');

// ── Parsing ─────────────────────────────────────────────────────────────────

// A station's class on STASY's page (the stasy-elevators-map plugin):
// every lift works, some don't but the others still reach the street, or
// it can't be reached step-free. 'Unknown' (stations STASY has no lifts
// listed for: Nerantziotissa and the airport branch) is left out.
const STATUSES = { Ok: 'ok', Warning: 'partial', Error: 'closed' };
const WORST = ['ok', 'partial', 'closed'];

// → { stations: { <id>: { status, out } }, checked, unknown }: the stations
// whose lifts aren't all working, with the lifts out of service by STASY's
// (Greek) names; how many stations the page had; the names on it that aren't
// one of ours (a new station: left out, and shown on /admin/diagnostics).
// A station on several lines (Omonia, Attiki…) is listed under each: its
// worst status counts. `names`: stationNames() of stations.json.
/** @param {string} html @param {Map<string, string>} names */
export function parseLifts(html, names) {
    /** @type {Record<string, { status: string, out: string[] }>} */
    const stations = {};
    const seen = new Set();
    const unknown = new Set();
    for (const block of html.split(/<li class="jw_line_station /).slice(1)) {
        const status = STATUSES[block.match(/^[^"]*\bjw_status(\w+)/)?.[1]];
        const name = decode(block.match(/class="jw_station__name">([^<]*)</)?.[1] ?? '');
        if (!status || !name) continue;
        const id = names.get(stasyNameKey(name));
        if (!id) { unknown.add(name); continue; }
        seen.add(id);
        const out = [...block.matchAll(/<li class=['"]jw_elevatorStatusError['"]>([^<]*)</g)].map(m => decode(m[1])).filter(Boolean);
        if (status === 'ok' && !out.length) continue;
        const was = stations[id] ?? { status: 'ok', out: [] };
        stations[id] = {
            status: WORST[Math.max(WORST.indexOf(was.status), WORST.indexOf(status))],
            out: [...new Set([...was.out, ...out])],
        };
    }
    if (seen.size < MIN_STATIONS) throw new Error(`STASY's lift page lists ${seen.size} of our stations, not ${MIN_STATIONS} or more: has it changed?`);
    return { stations, checked: seen.size, unknown: [...unknown] };
}

// ── Fetching ────────────────────────────────────────────────────────────────

// `relays`: [{ name, url, key }] and `userAgent`, as for the OASA client (config.relays, config.userAgent)
/**
 * @param {{
 *   fetch?: typeof globalThis.fetch, now?: () => number, log?: (message: string) => void,
 *   cacheFile?: string, stationsFile?: string,
 *   relays?: readonly { name: string, url: string, key: string }[], userAgent?: string,
 * }} [options]
 */
export function createLifts({ fetch = globalThis.fetch, now = Date.now, log = console.warn, cacheFile, stationsFile = STATIONS_FILE, relays = [], userAgent = userAgentFor(null) } = {}) {
    // The last good copy: { fetched, stations, checked, unknown }
    let state = cacheFile ? readJson(cacheFile) : null;
    let checkedAt = state?.fetched ? Date.parse(state.fetched) : 0;
    let refreshing = null;
    // For the diagnostics: { ok, at, error, route }
    let health = {};
    const stasy = createStasyClient({ fetch, now, relays, userAgent });

    async function refresh() {
        try {
            const names = stationNames(readJson(stationsFile).stations);
            state = { fetched: new Date(now()).toISOString(), ...parseLifts(await stasy.page(LIFTS_PAGE), names) };
            health = { ok: true, at: now(), route: stasy.route };
            if (cacheFile) {
                try { writeFileAtomic(cacheFile, JSON.stringify(state)); } catch { /* the cache is only an optimisation */ }
            }
        } catch (err) {
            health = { ok: false, at: now(), error: err.message };
            log(`[lifts] ${err.message}`);
        }
        checkedAt = now();
    }

    // Fetch now (sharing a refresh already under way), for the diagnostics
    const refreshNow = () => (refreshing ??= refresh().finally(() => { refreshing = null; }));

    const fresh = () => state && now() - Date.parse(state.fetched) < MAX_AGE_MS;

    // → { fetched, stations } or null (no copy recent enough)
    async function current() {
        if (now() - checkedAt > REFRESH_MS) {
            refreshNow();
            // Answer from the last copy and refresh behind it; only wait
            // when there's nothing to show
            if (!fresh()) await refreshNow();
        }
        return fresh() ? { fetched: state.fetched, stations: state.stations } : null;
    }

    // → { ok?, at?, error?, route?, stations, unknown, updated }, for the diagnostics and /api/health
    const status = () => ({
        ...health,
        stations: state?.checked ?? 0,
        unknown: state?.unknown ?? [],
        updated: state?.fetched ?? null,
    });

    const router = express.Router();
    router.get('/', async (_req, res) => {
        const body = await current();
        if (!body) return res.status(503).json({ error: 'The lift status is unavailable' });
        res.set('Cache-Control', 'no-store').json(body);
    });

    return Object.assign(router, { current, refresh, refreshNow, status });
}
