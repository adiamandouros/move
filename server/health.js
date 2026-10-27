import { dirname, join } from 'path';
import express from 'express';
import { RELAY_VERSION } from '../proxy/worker.js';
import { THREADS_WARN } from './processes.js';
import { AIRPORT_STALE_DAYS, BUILD_MAX_AGE_MS, dataStatus, STASY_STALE_DAYS, TIMETABLE_WARN_DAYS } from './data/status.js';

// GET /api/health: whether the live site works, for the scheduled check in
// .github/workflows/health.yml (and any uptime monitor). 200 when it's
// healthy, 503 with the problems listed when it isn't:
//   - live arrivals: a route to OASA answered in the past ARRIVALS_FRESH_MS
//     (the scheduled check asks for a stop first, so this is current)
//   - announcements: every source loaded on its last try (or, not tried yet
//     since the server started, has announcements kept from before)
//   - lifts: STASY's lift page loaded on its last try (not tried yet since
//     the server started counts as fine: nobody has needed it)
//   - data, stasy, airport: as server/data/status.js judges them, the same
//     as /admin/diagnostics (the rail checks' notes are only there)
//   - relays: each one runs the current RELAY_VERSION (proxy/worker.js)
//   - server: the hosting account is well under its thread limit, and no
//     app has old copies still running (server/processes.js)
// It's public, so it says what's wrong in plain words but leaves out
// addresses, keys and error details (those are on /admin/diagnostics).
// Nothing here asks OASA: relays are only asked for their version.

const ARRIVALS_FRESH_MS = 10 * 60_000;
const RELAY_TIMEOUT_MS = 5_000;
// Answers are kept this long, so the page can't be used to load the relays
const CACHE_MS = 60_000;

/**
 * @param {{
 *   busStatus: () => { routes: { name: string, lastOk: number | null }[] },
 *   announcementStatus: () => Record<string, { ok?: boolean, items?: number }>,
 *   liftStatus?: () => { ok?: boolean, updated: string | null },
 *   buildDir: string, rawDir?: string,
 *   relays?: { name: string, url: string, key: string }[],
 *   processes?: () => ReturnType<typeof import('./processes.js').accountStatus> | null,
 *   fetch?: typeof globalThis.fetch,
 *   now?: () => number,
 * }} options
 */
export function createHealth({ busStatus, announcementStatus, liftStatus = () => ({ updated: null }), buildDir, rawDir = join(dirname(buildDir), 'raw'), relays = [], processes = () => null, fetch = globalThis.fetch, now = Date.now }) {
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

    function lifts() {
        const s = liftStatus();
        return { ok: s.ok ?? true, updated: s.updated };
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

    // null off the host; app folders stay on /admin/diagnostics
    function server() {
        const account = processes();
        if (!account) return null;
        const old = account.apps.filter(a => a.copies.some(c => c.stale)).length;
        return { ok: account.threads < THREADS_WARN && !old, threads: account.threads, limit: account.limit, appsWithOldCopies: old };
    }

    async function check() {
        const { build: data, stasy, airport } = dataStatus({ buildDir, rawDir, now });
        const result = { arrivals: arrivals(), announcements: announcements(), lifts: lifts(), data, stasy, airport, relays: await relayVersions(), server: server() };
        const problems = [];
        if (!result.arrivals.ok) problems.push(`Live arrivals: no route to OASA has answered in the past ${ARRIVALS_FRESH_MS / 60_000} minutes`);
        for (const [name, ok] of Object.entries(result.announcements.sources)) {
            if (!ok) problems.push(`Announcements: ${name} didn't load on its last try`);
        }
        if (!result.lifts.ok) problems.push('Lifts: STASY\'s lift page didn\'t load on its last try (details on /admin/diagnostics)');
        if (!result.data.built) problems.push('Data: no build yet (data/build/meta.json is missing)');
        else if (!result.data.ok) problems.push(`Data: the last build (${result.data.built}) is over ${BUILD_MAX_AGE_MS / 3_600_000} h old or has failed parts`);
        if (result.data.timetableDaysLeft !== null && result.data.timetableDaysLeft < TIMETABLE_WARN_DAYS) {
            problems.push(`Timetable: the metro timetable ends on ${result.data.timetableEnds} (in ${result.data.timetableDaysLeft} days) and no newer one has been published yet`);
        }
        if (result.data.problems) problems.push(`Rail data: ${result.data.problems} thing${result.data.problems === 1 ? '' : 's'} the timetable code relies on no longer hold${result.data.problems === 1 ? 's' : ''} (details on /admin/diagnostics)`);
        if (result.stasy.unreadable) problems.push('STASY timetables: STASY\'s pages changed and couldn\'t be read on the last try; the last copy is used');
        else if (!result.stasy.ok) problems.push(`STASY timetables: the copy in use is from ${result.stasy.fetched}, over ${STASY_STALE_DAYS} days old`);
        if (result.airport.changed) problems.push('Airport timetable: STASY\'s has changed since data/curated/airport.json was written (details on /admin/diagnostics); its trains are still added');
        else if (!result.airport.ok) problems.push(`Airport timetable: STASY's was last checked on ${result.airport.checked.slice(0, 10)}, over ${AIRPORT_STALE_DAYS} days ago`);
        for (const [name, r] of Object.entries(result.relays)) {
            if (!r.ok) problems.push(`Relay: the ${name} runs ${r.version === null ? 'an older version or is unreachable' : `version ${r.version}`}, not ${RELAY_VERSION}; update it (proxy/README.md)`);
        }
        const { server: account } = result;
        if (account && account.threads >= THREADS_WARN) {
            problems.push(`Server: the hosting account runs ${account.threads} of its ${account.limit} threads; at ${account.limit}, nothing new can start (cPanel's Node.js page, deploys). Details on /admin/diagnostics`);
        }
        if (account?.appsWithOldCopies) {
            problems.push(`Server: ${account.appsWithOldCopies} app${account.appsWithOldCopies === 1 ? ' has' : 's have'} old copies still running from before a restart (details on /admin/diagnostics)`);
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
