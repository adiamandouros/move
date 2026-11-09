import { dirname, join } from 'path';
import express from 'express';
import { RELAY_VERSION } from '../proxy/worker.js';
import { STALE_AFTER_DAYS } from './places/index.js';
import { BUILD_MAX_MS, THREADS_WARN } from './processes.js';
import { AIRPORT_STALE_DAYS, BUILD_MAX_AGE_MS, dataStatus, STASY_STALE_DAYS, TIMETABLE_WARN_DAYS } from './data/status.js';
import { answerTime, answerTimeText, secondsText, STOPS_KEPT_FRESH, total } from './oasa/usage.js';
import { FAILURES_TO_REST, REST_MS } from './railway/index.js';

// GET /api/health: whether the live site works, for the scheduled check in
// .github/workflows/health.yml (and any uptime monitor). 200 when it's
// healthy, 503 with the problems listed when it isn't:
//   - live arrivals: a route to OASA answered in the past ARRIVALS_FRESH_MS,
//     or nothing needed OASA in that time, as on a quiet night or after a
//     restart (the scheduled check asks for a stop first, so it always needs it)
//   - OASA's use in the past hour (server/oasa/usage.js): answers that failed
//     or came slowly, visitors' requests that didn't fit the budget, and how
//     close the most stops in a minute came to what can be kept fresh
//   - announcements: every source loaded on its last try (or, not tried yet
//     since the server started, has announcements kept from before)
//   - lifts: STASY's lift page loaded on its last try (not tried yet since
//     the server started counts as fine: nobody has needed it)
//   - data, stasy, airport: as server/data/status.js judges them, the same
//     as /admin/diagnostics (the rail checks' notes are only there)
//   - places: the address index is recent (server/places/index.js)
//   - trains: the suburban railway's live times aren't resting after
//     failing while someone wants them (server/railway/index.js)
//   - relays: each one runs the current RELAY_VERSION (proxy/worker.js)
//   - server: the hosting account is well under its thread limit, no app
//     has old copies still running, and no data build has run for over an
//     hour (server/processes.js)
// It's public, so it says what's wrong in plain words but leaves out
// addresses, keys and error details (those are on /admin/diagnostics).
// Nothing here asks OASA: relays are only asked for their version.

const ARRIVALS_FRESH_MS = 10 * 60_000;
// OASA's use in the past hour, agreed on 4 November 2026 (roadmap item 39).
// Failing: this many stop answers older or none, and this share of those that needed OASA
const FAILED_ANSWERS = 10;
const FAILED_SHARE = 0.1;
// Slow: 95% of the busiest route's answers not under this (one of ANSWER_MS), from this many
const SLOW_MS = 4_000;
const SLOW_MIN_ANSWERS = 30;
// The budget full: visitors' requests dropped in this many minutes
const DROP_MINUTES = 5;
// Close to the limit: this many different stops in one minute, of about STOPS_KEPT_FRESH
const PEAK_STOPS = 45;
const RELAY_TIMEOUT_MS = 5_000;
// The relays' versions are kept this long, so the page can't be used to load
// the relays; the rest is local, and worked out on each request
const CACHE_MS = 60_000;

/**
 * @param {{
 *   busStatus: () => { lastAsked?: number | null, routes: { name: string, lastOk: number | null }[], usage?: ReturnType<import('./oasa/usage.js').Usage['status']> },
 *   announcementStatus: () => Record<string, { ok?: boolean, items?: number }>,
 *   liftStatus?: () => { ok?: boolean, updated: string | null },
 *   placesStatus?: () => { ok: boolean, built: string | null },
 *   trainStatus?: () => { ok: boolean, wanted: boolean, resting: boolean },
 *   buildDir: string, rawDir?: string,
 *   relays?: { name: string, url: string, key: string }[],
 *   processes?: () => ReturnType<typeof import('./processes.js').accountStatus> | null,
 *   fetch?: typeof globalThis.fetch,
 *   now?: () => number,
 * }} options
 */
export function createHealth({ busStatus, announcementStatus, liftStatus = () => ({ updated: null }), placesStatus = () => ({ ok: true, built: null }), trainStatus = () => ({ ok: true, wanted: false, resting: false }), buildDir, rawDir = join(dirname(buildDir), 'raw'), relays = [], processes = () => null, fetch = globalThis.fetch, now = Date.now }) {
    function arrivals() {
        const { routes, lastAsked } = busStatus();
        const working = routes.filter(r => r.lastOk && now() - r.lastOk < ARRIVALS_FRESH_MS);
        const last = Math.max(0, ...routes.map(r => r.lastOk ?? 0));
        const asked = Boolean(lastAsked && now() - lastAsked < ARRIVALS_FRESH_MS);
        return {
            ok: working.length > 0 || !asked,
            asked,
            route: working.sort((a, b) => b.lastOk - a.lastOk)[0]?.name ?? null,
            lastOk: last ? new Date(last).toISOString() : null,
        };
    }

    // What the past hour's counts say; null when there are none
    function oasaUse() {
        const hour = busStatus().usage?.hour;
        if (!hour) return null;
        const failed = hour.answers.old + hour.answers.none;
        const needed = hour.answers.oasa + failed;
        const [route, busiest] = Object.entries(hour.routes).sort(([, a], [, b]) => b.ok - a.ok)[0] ?? [null, null];
        const most = busiest && total(busiest.ms) >= SLOW_MIN_ANSWERS ? answerTime(busiest.ms, 0.95) : null;
        return {
            failed, needed,
            failing: failed >= FAILED_ANSWERS && failed >= FAILED_SHARE * needed,
            route, answers95: most === null ? null : answerTimeText(most),
            slow: most !== null && most > SLOW_MS,
            dropMinutes: hour.dropMinutes,
            peakStops: hour.peaks.stops,
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

    let kept = null;
    function relayVersions() {
        if (!kept || now() - kept.at >= CACHE_MS) kept = { at: now(), versions: askRelays() };
        return kept.versions;
    }

    async function askRelays() {
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
        const stuck = account.apps.reduce((sum, a) => sum + a.builds.filter(b => b.stuck).length, 0);
        return { ok: account.threads < THREADS_WARN && !old && !stuck, threads: account.threads, limit: account.limit, appsWithOldCopies: old, stuckBuilds: stuck };
    }

    async function check() {
        const { build: data, stasy, airport, railway } = dataStatus({ buildDir, rawDir, now });
        const result = { arrivals: arrivals(), oasa: oasaUse(), announcements: announcements(), lifts: lifts(), places: placesStatus(), trains: trainStatus(), data, stasy, airport, railway, relays: await relayVersions(), server: server() };
        const problems = [];
        if (!result.arrivals.ok) problems.push(`Live arrivals: no route to OASA has answered in the past ${ARRIVALS_FRESH_MS / 60_000} minutes`);
        const { oasa } = result;
        if (oasa?.failing) problems.push(`OASA: ${oasa.failed} of ${oasa.needed} stop answers in the past hour were older ones or none, as OASA didn't answer (details on /admin/usage)`);
        if (oasa?.slow) problems.push(`OASA: 95% of its answers through the ${oasa.route} in the past hour took ${secondsText(SLOW_MS)} or more (details on /admin/usage)`);
        if (oasa && oasa.dropMinutes >= DROP_MINUTES) problems.push(`Request budget: visitors' requests to OASA didn't fit it in ${oasa.dropMinutes} minutes of the past hour, so they saw older arrivals (details on /admin/usage)`);
        if (oasa && oasa.peakStops >= PEAK_STOPS) problems.push(`Request budget: ${oasa.peakStops} different stops were asked for in one minute in the past hour, close to the about ${STOPS_KEPT_FRESH} that can be kept fresh (details on /admin/usage)`);
        for (const [name, ok] of Object.entries(result.announcements.sources)) {
            if (!ok) problems.push(`Announcements: ${name} didn't load on its last try`);
        }
        if (!result.lifts.ok) problems.push('Lifts: STASY\'s lift page didn\'t load on its last try (details on /admin/diagnostics)');
        if (!result.trains.ok) problems.push(`Suburban live times: railway.gov.gr's train positions failed ${FAILURES_TO_REST} times in a row, so the Trip page has the timetable's times while they rest ${REST_MS / 60_000} minutes (details on /admin/usage)`);
        if (!result.places.ok) {
            problems.push(result.places.built
                ? `Address search: the index is from ${result.places.built}, over ${STALE_AFTER_DAYS} days old; the weekly build may have stopped`
                : 'Address search: the index couldn\'t be downloaded');
        }
        if (!result.data.built) problems.push('Data: no build yet (data/build/meta.json is missing)');
        else if (!result.data.ok) problems.push(`Data: the last build (${result.data.built}) is over ${BUILD_MAX_AGE_MS / 3_600_000} h old or has failed parts`);
        if (result.data.timetableDaysLeft !== null && result.data.timetableDaysLeft < TIMETABLE_WARN_DAYS) {
            const { timetableEnds: ends, timetableDaysLeft: left } = result.data;
            problems.push(`Timetable: the metro timetable ${left < 0 ? `ended on ${ends}` : `ends on ${ends} (in ${left} days)`} and no newer one has been published yet`);
        }
        if (result.data.problems) problems.push(`Rail data: ${result.data.problems} thing${result.data.problems === 1 ? '' : 's'} the timetable code relies on no longer hold${result.data.problems === 1 ? 's' : ''} (details on /admin/diagnostics)`);
        if (result.stasy.unreadable) problems.push('STASY timetables: STASY\'s pages changed and couldn\'t be read on the last try; the last copy is used');
        else if (!result.stasy.ok) problems.push(`STASY timetables: the copy in use is from ${result.stasy.fetched}, over ${STASY_STALE_DAYS} days old`);
        if (result.airport.changed) problems.push('Airport timetable: STASY\'s has changed since data/curated/airport.json was written (details on /admin/diagnostics); its trains are still added');
        else if (!result.airport.ok) problems.push(`Airport timetable: STASY's was last checked on ${result.airport.checked.slice(0, 10)}, over ${AIRPORT_STALE_DAYS} days ago`);
        if (railway && !railway.today) problems.push(`Suburban railway: no trains for today, so the Trip page leaves it out; railway.gov.gr's boards ${railway.fetched ? `were last fetched on ${railway.fetched.slice(0, 10)}` : 'have never been fetched'} (details on /admin/diagnostics)`);
        else if (railway?.lastFetch && !railway.lastFetch.ok) problems.push(`Suburban railway: railway.gov.gr's boards couldn't be fetched on the last try; ${railway.days} day${railway.days === 1 ? '' : 's'} of trains from today on are kept (details on /admin/diagnostics)`);
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
        if (account?.stuckBuilds) {
            problems.push(`Server: ${account.stuckBuilds} data build${account.stuckBuilds === 1 ? ' has' : 's have'} been running for over ${BUILD_MAX_MS / 60_000} minutes (details on /admin/diagnostics)`);
        }
        return { ok: problems.length === 0, checked: new Date(now()).toISOString(), problems, ...result };
    }

    const router = express.Router();
    router.get('/', async (_req, res) => {
        const result = await check();
        res.status(result.ok ? 200 : 503).set('Cache-Control', 'no-store').json(result);
    });
    return Object.assign(router, { check });
}
