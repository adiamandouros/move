import { existsSync, readFileSync } from 'fs';
import { writeFileAtomic } from '../files.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { ARRIVALS_TTL_MS, BUSY_TTLS } from './arrivals.js';
import { REQUESTS_PER_SECOND } from './client.js';

// How much Wayhop asks of OASA, and how OASA answers (roadmap item 39):
// counted each minute, added up per day (Athens time) and kept for KEEP_DAYS,
// so the limits of decision 7 can be judged by numbers. Counts only: stop
// codes and route names, nothing about who asked. Nothing here sends a request.
//
// What is counted (the OASA client, the arrivals cache and the bus API report it):
//   requests  per kind (KINDS), one per slot of the request budget
//   routes    per route (direct, the relays): answers, failures, and answer
//             times in ANSWER_MS buckets; minutes it was asked and never answered
//   dropped   requests that didn't fit the budget, per kind; paused: refused
//             while every route rested; limited: visitors over their share (429)
//   answers   stop answers by where they came from (SOURCES)
//   stops     different stops asked for; the most in one minute is the number
//             to hold against STOPS_KEPT_FRESH
//   waits     the longest wait for a slot; minutes waiting over BUSY_WAITS_MS
//   network   the nightly bus-network fetch's requests (it runs in the data
//             build's own process, which records them in `networkFile`)
//
// The file: { days: { "2026-10-30": summary, … }, today: { date, stops: [codes] } }.
// Today's stop codes are kept so a restart doesn't count a stop twice.

export const KINDS = ['arrivals-new', 'arrivals-refresh', 'route-names', 'route-test'];
// oasa: a request was made for it; cache: none was needed (cached, or already
// being asked); old: OASA failed and an older answer was served; none: nothing
export const SOURCES = ['oasa', 'cache', 'old', 'none'];
// Answer times are counted under these (ms); the last bucket is anything longer, timeouts too
export const ANSWER_MS = [250, 500, 1000, 2000, 4000, 8000];
// The queue waits after which arrivals stay fresh longer (arrivals.js)
export const BUSY_WAITS_MS = BUSY_TTLS.map(([over]) => over).sort((a, b) => a - b);
// Each watched stop is asked for once per ARRIVALS_TTL_MS: about 60 at 2 requests a second
export const STOPS_KEPT_FRESH = REQUESTS_PER_SECOND * ARRIVALS_TTL_MS / 1000;
export const KEEP_DAYS = 120;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const counts = keys => Object.fromEntries(keys.map(k => [k, 0]));
const emptyRoute = () => ({ ok: 0, failed: 0, ms: Array(ANSWER_MS.length + 1).fill(0), downMinutes: 0 });

// An empty summary, of a day or of the past hour
const emptySummary = () => ({
    requests: counts(KINDS),
    routes: {},
    dropped: counts(KINDS),
    paused: 0,
    limited: 0,
    answers: counts(SOURCES),
    stops: 0,
    peaks: { requests: 0, stops: 0, waitMs: 0 },
    busyMinutes: Object.fromEntries(BUSY_WAITS_MS.map(ms => [ms, 0])),
    dropMinutes: 0,
    network: null,
});

const newMinute = at => ({ at, ...emptySummary(), stopCodes: new Set() });

// Add one minute's counts to a summary (its different stops are counted by the caller)
function addMinute(summary, minute) {
    const requests = Object.values(minute.requests).reduce((a, b) => a + b, 0);
    for (const k of KINDS) {
        summary.requests[k] += minute.requests[k];
        summary.dropped[k] += minute.dropped[k];
    }
    for (const s of SOURCES) summary.answers[s] += minute.answers[s];
    for (const [name, r] of Object.entries(minute.routes)) {
        const into = summary.routes[name] ??= emptyRoute();
        into.ok += r.ok;
        into.failed += r.failed;
        r.ms.forEach((n, i) => { into.ms[i] += n; });
        if (r.failed && !r.ok) into.downMinutes++;
    }
    summary.paused += minute.paused;
    summary.limited += minute.limited;
    summary.peaks.requests = Math.max(summary.peaks.requests, requests);
    summary.peaks.stops = Math.max(summary.peaks.stops, minute.stopCodes.size);
    summary.peaks.waitMs = Math.max(summary.peaks.waitMs, minute.peaks.waitMs);
    for (const ms of BUSY_WAITS_MS) if (minute.peaks.waitMs > ms) summary.busyMinutes[ms]++;
    if (Object.values(minute.dropped).some(Boolean)) summary.dropMinutes++;
    return summary;
}

// ── In words, for /admin/diagnostics and /admin/usage ────────────────────────

// All of a summary's counts of one thing (its requests, its answers…)
export const total = counts => Object.values(counts).reduce((a, b) => a + b, 0);
export const secondsText = ms => `${Math.round(ms / 100) / 10} s`;
// An answer time from answerTime: "under 500 ms", "over 8 s"; null: no answers
export const answerTimeText = ms => ms === null ? '–'
    : ms === Infinity ? `over ${secondsText(ANSWER_MS.at(-1))}`
        : `under ${ms < 1000 ? `${ms} ms` : secondsText(ms)}`;

// The answer time under which a share p (0–1) of `ms`'s answers came, from its
// buckets: one of ANSWER_MS, Infinity when longer, null when there were none
export function answerTime(ms, p) {
    const total = ms.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let seen = 0;
    for (const [i, n] of ms.entries()) {
        seen += n;
        if (seen >= p * total) return ANSWER_MS[i] ?? Infinity;
    }
    return Infinity;
}

/** @typedef {ReturnType<typeof createUsage>} Usage */

/**
 * file: where the days are kept (none: in memory only, as in tests);
 * networkFile: the nightly fetch's record (server/data/oasa-network.js lastFetchFile)
 * @param {{ file?: string | null, networkFile?: string | null, now?: () => number, keepDays?: number, log?: (message: string) => void }} [options]
 */
export function createUsage({ file = null, networkFile = null, now = Date.now, keepDays = KEEP_DAYS, log = console.warn } = {}) {
    const saved = load(file, log);
    /** @type {Record<string, ReturnType<typeof emptySummary>>} */
    const days = saved.days ?? {};
    let today = athensDate(new Date(now()));
    const dayStops = new Set(saved.today?.date === today ? saved.today.stops : []);
    let minute = newMinute(Math.floor(now() / MINUTE_MS) * MINUTE_MS);
    // The minutes of the past hour, oldest first
    let hour = [];

    // Close the current minute once it's over: into its day, and the past hour
    function roll() {
        const start = Math.floor(now() / MINUTE_MS) * MINUTE_MS;
        if (start === minute.at) return;
        const date = athensDate(new Date(minute.at));
        if (date !== today) {
            today = date;
            dayStops.clear();
        }
        for (const code of minute.stopCodes) dayStops.add(code);
        const day = addMinute(days[date] ??= emptySummary(), minute);
        day.stops = dayStops.size;
        hour = [...hour, minute].filter(m => m.at > now() - HOUR_MS);
        minute = newMinute(start);
        // A day that began while nothing happened
        const nowDate = athensDate(new Date(now()));
        if (nowDate !== today) {
            today = nowDate;
            dayStops.clear();
        }
    }
    const current = () => { roll(); return minute; };
    const route = name => current().routes[name] ??= emptyRoute();

    // The past hour, this minute included
    function pastHour() {
        roll();
        const summary = [...hour, minute].reduce(addMinute, emptySummary());
        summary.stops = new Set([...hour, minute].flatMap(m => [...m.stopCodes])).size;
        return summary;
    }

    // Today so far, this minute included
    function soFar() {
        roll();
        const summary = addMinute(structuredClone(days[today] ?? emptySummary()), minute);
        summary.stops = new Set([...dayStops, ...minute.stopCodes]).size;
        return summary;
    }

    // Keep the days in `file`: once a minute (server/oasa/index.js), and the
    // nightly fetch's requests under the day it ran
    function save() {
        roll();
        const fetch = networkFile && existsSync(networkFile) ? load(networkFile, log) : null;
        if (fetch?.at && Number.isInteger(fetch.requests)) {
            const date = athensDate(new Date(fetch.at));
            if (days[date]) days[date].network = fetch.requests;
        }
        // Today and the keepDays - 1 before it
        const oldest = athensDate(new Date(now() - (keepDays - 1) * 86_400_000));
        for (const date of Object.keys(days)) if (date < oldest) delete days[date];
        if (!file) return;
        try {
            writeFileAtomic(file, JSON.stringify({ days, today: { date: today, stops: [...dayStops] } }));
        } catch (err) {
            log(`[oasa] Couldn't save the usage: ${err.message}`);
        }
    }

    return {
        // One slot of the request budget taken, for a request of this kind
        request(kind) { current().requests[kind]++; },
        // One call to OASA over a route, answered (ok) or not, after `ms`
        call(name, ok, ms) {
            const r = route(name);
            if (ok) r.ok++; else r.failed++;
            const bucket = ANSWER_MS.findIndex(limit => ms < limit);
            r.ms[bucket === -1 ? ANSWER_MS.length : bucket]++;
        },
        // How long a request waited for its slot
        waited(ms) { const m = current(); m.peaks.waitMs = Math.max(m.peaks.waitMs, ms); },
        dropped(kind) { current().dropped[kind]++; },
        paused() { current().paused++; },
        limited() { current().limited++; },
        // A stop's answer to a visitor, and where it came from
        answer(stop, source) { const m = current(); m.answers[source]++; m.stopCodes.add(stop); },
        // → { hour, today } for the status file and the diagnostics
        status: () => ({ hour: pastHour(), today: soFar() }),
        // Every day kept, today so far, for /admin/usage
        days: () => {
            const sofar = soFar();
            return { ...days, [today]: sofar };
        },
        save,
    };
}

function load(file, log) {
    if (!file || !existsSync(file)) return {};
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
        log(`[oasa] Ignoring an unreadable ${file}: ${err.message}`);
        return {};
    }
}
