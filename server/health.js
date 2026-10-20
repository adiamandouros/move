import { dirname, join } from 'path';
import express from 'express';
import { RELAY_VERSION } from '../proxy/worker.js';
import { airportCheckFile } from './data/airport-check.js';
import { stasyFetchFile } from './data/stasy.js';
import { readJson } from './files.js';
import { athensDate } from '../tools/subway/client/network.js';

// GET /api/health: whether the live site works, for the scheduled check in
// .github/workflows/health.yml (and any uptime monitor). 200 when it's
// healthy, 503 with the problems listed when it isn't:
//   - live arrivals: a route to OASA answered in the past ARRIVALS_FRESH_MS
//     (the scheduled check asks for a stop first, so this is current)
//   - announcements: every source loaded on its last try (or, not tried yet
//     since the server started, has announcements kept from before)
//   - data: last night's build worked, and the metro timetable doesn't end
//     within TIMETABLE_WARN_DAYS
//   - stasy: STASY's timetable pages could be read on the last try, and the
//     copy of them in use is at most STASY_STALE_DAYS old (server/data/stasy.js)
//   - airport: STASY's airport timetable is still as data/curated/airport.json
//     has it, checked within AIRPORT_STALE_DAYS (server/data/airport-check.js)
//   - relays: each one runs the current RELAY_VERSION (proxy/worker.js)
// It's public, so it says what's wrong in plain words but leaves out
// addresses, keys and error details (those are on /admin/diagnostics).
// Nothing here asks OASA: relays are only asked for their version.

const ARRIVALS_FRESH_MS = 10 * 60_000;
const BUILD_MAX_AGE_MS = 36 * 3_600_000;
const TIMETABLE_WARN_DAYS = 7;
// Three fetches missed (one every 14 days)
const STASY_STALE_DAYS = 45;
// Three weekly checks missed
const AIRPORT_STALE_DAYS = 21;
const RELAY_TIMEOUT_MS = 5_000;
// Answers are kept this long, so the page can't be used to load the relays
const CACHE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * @param {{
 *   busStatus: () => { routes: { name: string, lastOk: number | null }[] },
 *   announcementStatus: () => Record<string, { ok?: boolean, items?: number }>,
 *   buildDir: string, rawDir?: string,
 *   relays?: { name: string, url: string, key: string }[],
 *   fetch?: typeof globalThis.fetch,
 *   now?: () => number,
 * }} options
 */
export function createHealth({ busStatus, announcementStatus, buildDir, rawDir = join(dirname(buildDir), 'raw'), relays = [], fetch = globalThis.fetch, now = Date.now }) {
    const buildFile = name => readJson(join(buildDir, name));

    function arrivals() {
        const working = busStatus().routes.filter(r => r.lastOk && now() - r.lastOk < ARRIVALS_FRESH_MS);
        const last = Math.max(0, ...busStatus().routes.map(r => r.lastOk ?? 0));
        return {
            ok: working.length > 0,
            route: working.sort((a, b) => b.lastOk - a.lastOk)[0]?.name ?? null,
            lastOk: last ? new Date(last).toISOString() : null,
        };
    }

    function announcements() {
        const sources = Object.fromEntries(Object.entries(announcementStatus()).map(([name, s]) => [name, s.ok ?? (s.items ?? 0) > 0]));
        return { ok: Object.values(sources).every(Boolean), sources };
    }

    function data() {
        const meta = buildFile('meta.json');
        const validTo = buildFile('rail.json')?.feed?.validTo ?? null;
        const built = meta?.generated ? Date.parse(meta.generated) : null;
        const outputs = Object.fromEntries(Object.entries(meta?.outputs ?? {}).map(([name, o]) => [name, Boolean(o.ok)]));
        // Whole days from today (Athens) to the timetable's last day
        const daysLeft = validTo ? Math.round((Date.parse(validTo) - Date.parse(athensDate(new Date(now())))) / DAY_MS) : null;
        return {
            ok: Boolean(built && now() - built < BUILD_MAX_AGE_MS && Object.keys(outputs).length && Object.values(outputs).every(Boolean)),
            built: built ? new Date(built).toISOString() : null,
            outputs,
            timetableEnds: validTo,
            timetableDaysLeft: daysLeft,
        };
    }

    function stasy() {
        const unreadable = Boolean(readJson(stasyFetchFile(rawDir))?.unreadable);
        const fetched = buildFile('rail.json')?.hours?.fetched ?? null;
        const daysOld = fetched ? Math.round((Date.parse(athensDate(new Date(now()))) - Date.parse(fetched)) / DAY_MS) : null;
        return { ok: !unreadable && !(daysOld > STASY_STALE_DAYS), fetched, daysOld, unreadable };
    }

    // Not checked yet (no airport.json, or before the first try) counts as fine
    function airport() {
        const last = readJson(airportCheckFile(rawDir));
        const checked = last?.checked ?? null;
        const daysOld = checked ? Math.floor((now() - Date.parse(checked)) / DAY_MS) : null;
        const changed = Boolean(last?.changes?.length);
        return { ok: !changed && !(daysOld > AIRPORT_STALE_DAYS), checked, daysOld, changed };
    }

    async function relayVersions() {
        return Object.fromEntries(await Promise.all(relays.map(async relay => {
            let version = null;
            try {
                const res = await fetch(`${relay.url}?act=version`, { headers: { 'X-Relay-Key': relay.key }, signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
                version = res.ok ? (await res.json()).version ?? null : null;
            } catch { /* unreachable: reported as no version */ }
            return [relay.name, { version, ok: version === RELAY_VERSION }];
        })));
    }

    async function check() {
        const result = { arrivals: arrivals(), announcements: announcements(), data: data(), stasy: stasy(), airport: airport(), relays: await relayVersions() };
        const problems = [];
        if (!result.arrivals.ok) problems.push(`Live arrivals: no route to OASA has answered in the past ${ARRIVALS_FRESH_MS / 60_000} minutes`);
        for (const [name, ok] of Object.entries(result.announcements.sources)) {
            if (!ok) problems.push(`Announcements: ${name} didn't load on its last try`);
        }
        if (!result.data.built) problems.push('Data: no build yet (data/build/meta.json is missing)');
        else if (!result.data.ok) problems.push(`Data: the last build (${result.data.built}) is over ${BUILD_MAX_AGE_MS / 3_600_000} h old or has failed parts`);
        if (result.data.timetableDaysLeft !== null && result.data.timetableDaysLeft < TIMETABLE_WARN_DAYS) {
            problems.push(`Timetable: the metro timetable ends on ${result.data.timetableEnds} (in ${result.data.timetableDaysLeft} days) and no newer one has been published yet`);
        }
        if (result.stasy.unreadable) problems.push('STASY timetables: STASY\'s pages changed and couldn\'t be read on the last try; the last copy is used');
        else if (!result.stasy.ok) problems.push(`STASY timetables: the copy in use is from ${result.stasy.fetched}, over ${STASY_STALE_DAYS} days old`);
        if (result.airport.changed) problems.push('Airport timetable: STASY\'s has changed since data/curated/airport.json was written (details on /admin/diagnostics); its trains are still added');
        else if (!result.airport.ok) problems.push(`Airport timetable: STASY's was last checked on ${result.airport.checked.slice(0, 10)}, over ${AIRPORT_STALE_DAYS} days ago`);
        for (const [name, r] of Object.entries(result.relays)) {
            if (!r.ok) problems.push(`Relay: the ${name} runs ${r.version === null ? 'an older version or is unreachable' : `version ${r.version}`}, not ${RELAY_VERSION}; update it (proxy/README.md)`);
        }
        return { ok: problems.length === 0, checked: new Date(now()).toISOString(), problems, ...result };
    }

    let cached = null;
    const router = express.Router();
    router.get('/', async (_req, res) => {
        if (!cached || now() - cached.at >= CACHE_MS) cached = { at: now(), result: check() };
        const result = await cached.result;
        res.status(result.ok ? 200 : 503).set('Cache-Control', 'no-store').json(result);
    });
    return Object.assign(router, { check });
}
