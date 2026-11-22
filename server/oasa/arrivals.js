import { existsSync, readFileSync } from 'fs';
import { messageOf } from '../errors.js';
import { writeFileAtomic } from '../files.js';

// Live arrivals per stop, shared by every user:
//   - each stop is fetched at most once per ARRIVALS_TTL_MS, or longer while
//     requests are queuing for OASA (BUSY_TTLS): people then see answers up
//     to 90 s old, counted down and marked stale, rather than waiting or
//     getting nothing
//   - someone's first look at a stop (nothing cached, or nothing recent) goes
//     ahead of refreshes in the client's queue
//   - simultaneous requests for the same stop share one upstream call
//   - when OASA can't be reached, the last answer is served (marked stale)
//     for up to STALE_MAX_MS
//   - every fresh answer is shown to `passes` (passes.js), which notes the
//     buses that passed; the collector (collector.js) asks with { collect:
//     true }: last in OASA's queue, and not counted as a visitor's answer
// Arrivals only carry OASA's internal route code, so line numbers and
// destinations come from a route table filled from webRoutesForStop and kept
// on disk; route codes rarely change, so each is looked up about once a week.
// OASA sends its route and vehicle codes as numbers (seen 6 Nov 2026); they
// go on as strings, as every route code of ours is (bus-lines.json,
// buses.json, the passes), so they can be compared.
// Each answer is counted by where it came from (`usage`, server/oasa/usage.js).

export const ARRIVALS_TTL_MS = 30_000;
// [queue wait over, answers fresh for] while OASA's queue is busy (approved
// 2026-10-18, with the bus page's refresh tiers): back to 30 s when it clears
export const BUSY_TTLS = [[5_000, 90_000], [2_000, 60_000]];
// Answers this old are marked stale, so the page says times may be older
const STALE_AFTER_MS = 60_000;
const STALE_MAX_MS = 5 * 60_000;
const ROUTES_TTL_MS = 7 * 86_400_000;
const MAX_CACHED_STOPS = 5000;

/**
 * A bus on its way to a stop, as /api/arrivals sends it: OASA's route and
 * vehicle codes as strings, its line and where it goes from the route table,
 * null while its route isn't known
 * @typedef {{ route: string | null | undefined, vehicle: string | null | undefined, minutes: number,
 *   line: string | null, to: import('../../types/data.js').Names | null }} Arrival
 * @typedef {{ arrivals: Arrival[], updated: number | null, stale: boolean, unavailable?: true }} StopAnswer
 * A route in the table, by OASA's route code: its line and where it goes, and when it was looked up (ms)
 * @typedef {{ line: string, el: string, en: string, at: number }} RouteName
 * What OASA sends: a bus in getStopArrivals, a route in webRoutesForStop
 * @typedef {{ route_code: string | number, veh_code: string | number, btime2: string }} OasaArrival
 * @typedef {{ RouteCode: string, LineID: string, RouteDescr?: string, RouteDescrEng?: string }} OasaRoute
 */

/**
 * @param {{ client: Pick<import('./client.js').OasaClient, 'request'> & { queueWait?: () => number }, routesFile?: string | null,
 *   passes?: ReturnType<typeof import('./passes.js').createPasses> | null, now?: () => number, log?: (message: string) => void,
 *   usage?: Pick<import('./usage.js').Usage, 'answer' | 'horizon'> }} options
 */
export function createArrivals({ client, routesFile, passes = null, now = Date.now, log = console.warn, usage = { answer() {}, horizon() {} } }) {
    /** @type {Map<string, { at: number, arrivals: Arrival[] }>} */
    const cache = new Map();      // stop → { at, arrivals }
    /** @type {Map<string, Promise<StopAnswer>>} */
    const inflight = new Map();   // stop → Promise
    /** @type {Map<string, Promise<void>>} */
    const routeLookups = new Map();
    const routes = loadRoutes(routesFile, log);

    // ── Route names ─────────────────────────────────────────────────────────

    let saveTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
    function saveRoutesSoon() {
        if (!routesFile) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                writeFileAtomic(routesFile, JSON.stringify(routes));
            } catch (err) {
                log(`[oasa] Couldn't save the route table: ${messageOf(err)}`);
            }
        }, 1000);
        saveTimer.unref?.();
    }

    // Look up every route at a stop (one request) and add them to the table
    /** @param {string} stop */
    function lookUpRoutes(stop) {
        if (!routeLookups.has(stop)) {
            // A new stop's names, which its first look waits for
            routeLookups.set(stop, client.request('webRoutesForStop', stop, { lane: 'high' })
                .then(/** @param {OasaRoute[] | null} rows */ rows => {
                    for (const r of rows ?? []) {
                        routes[r.RouteCode] = {
                            line: r.LineID,
                            el: r.RouteDescr?.trim() ?? '',
                            en: r.RouteDescrEng?.trim() ?? '',
                            at: now(),
                        };
                    }
                    saveRoutesSoon();
                })
                .catch(() => {}) // names are optional; arrivals still show
                .finally(() => routeLookups.delete(stop)));
        }
        return routeLookups.get(stop);
    }

    /** @param {string} stop @param {OasaArrival[]} raw @returns {Promise<Arrival[]>} */
    async function describe(stop, raw) {
        const stale = raw.some(a => !routes[a.route_code] || now() - routes[a.route_code].at > ROUTES_TTL_MS);
        if (stale) await lookUpRoutes(stop);
        return raw
            .map(a => {
                const route = routes[a.route_code];
                return {
                    route: code(a.route_code),
                    vehicle: code(a.veh_code),
                    minutes: Number(a.btime2),
                    line: route?.line ?? null,
                    to: route ? { el: route.el, en: route.en } : null,
                };
            })
            .sort((a, b) => a.minutes - b.minutes);
    }

    // ── Arrivals ────────────────────────────────────────────────────────────

    /** @param {string} stop @param {Arrival[]} arrivals @param {number} at */
    function remember(stop, arrivals, at) {
        cache.set(stop, { at, arrivals });
        if (cache.size > MAX_CACHED_STOPS) {
            for (const [key, entry] of cache) if (now() - entry.at > STALE_MAX_MS) cache.delete(key);
        }
    }

    // How long answers are fresh for, given how busy OASA's queue is
    function freshFor() {
        const wait = client.queueWait?.() ?? 0;
        return BUSY_TTLS.find(([over]) => wait > over)?.[1] ?? ARRIVALS_TTL_MS;
    }

    // A cached answer, counted down to now
    /** @param {{ at: number, arrivals: Arrival[] }} hit */
    const served = hit => {
        const age = now() - hit.at;
        return { arrivals: countDown(hit.arrivals, age), updated: hit.at, stale: age >= STALE_AFTER_MS };
    };

    // → { arrivals: [...], updated: ms | null, stale: boolean, unavailable?: true }
    /** @param {string} stop @param {{ collect?: boolean }} [options] @returns {Promise<StopAnswer>} */
    function stopArrivals(stop, { collect = false } = {}) {
        // A visitor's answer, by where it came from (the collector's aren't counted)
        /** @param {string} source */
        const answer = source => { if (!collect) usage.answer(stop, source); };
        const hit = cache.get(stop);
        if (hit && now() - hit.at < freshFor()) {
            answer('cache');
            return Promise.resolve(served(hit));
        }
        // Already being asked for: this answer shares that request
        const asking = inflight.get(stop);
        if (asking) {
            answer('cache');
            return asking;
        }
        // Nobody has looked at this stop lately: a newcomer, who goes first
        const lane = collect ? 'low' : hit && now() - hit.at < STALE_MAX_MS ? 'normal' : 'high';

        const pending = (/** @returns {Promise<StopAnswer>} */ async () => {
            // Age answers from when we asked, so a slow reply (e.g. queued behind
            // the rate limit) doesn't stay "fresh" longer than ARRIVALS_TTL_MS
            const asked = now();
            try {
                const raw = await client.request('getStopArrivals', stop, { lane });
                const arrivals = await describe(stop, Array.isArray(raw) ? raw : []);
                remember(stop, arrivals, asked);
                passes?.seen(stop, arrivals, asked);
                answer('oasa');
                // How far ahead OASA predicts, per line (its fresh answers only)
                for (const a of arrivals) if (a.line && Number.isFinite(a.minutes)) usage.horizon(a.line, a.minutes);
                return { arrivals, updated: asked, stale: false };
            } catch {
                if (hit && now() - hit.at < STALE_MAX_MS) {
                    answer('old');
                    return { arrivals: countDown(hit.arrivals, now() - hit.at), updated: hit.at, stale: true };
                }
                answer('none');
                return { arrivals: [], updated: null, stale: false, unavailable: true };
            } finally {
                inflight.delete(stop);
            }
        })();
        inflight.set(stop, pending);
        return pending;
    }

    // Whether asking for this stop now costs no new request to OASA
    /** @param {string} stop */
    const isCached = stop => inflight.has(stop) || now() - (cache.get(stop)?.at ?? -Infinity) < freshFor();

    return { stopArrivals, isCached };
}

// One of OASA's codes as a string, whether it came as a number or not
/** @param {string | number | null | undefined} value */
const code = value => value === null || value === undefined ? value : String(value);

// Bring an old answer up to date: subtract the minutes that have passed since
// it was fetched, and drop buses that should already have arrived
/** @param {Arrival[]} arrivals @param {number} elapsedMs */
export function countDown(arrivals, elapsedMs) {
    const elapsed = Math.floor(elapsedMs / 60_000);
    return arrivals
        .map(a => ({ ...a, minutes: a.minutes - elapsed }))
        .filter(a => a.minutes >= 0);
}

/** @param {string | null | undefined} path @param {(message: string) => void} log @returns {Record<string, RouteName>} */
function loadRoutes(path, log) {
    if (!path || !existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (err) { log(`[oasa] Ignoring unreadable route table: ${messageOf(err)}`); return {}; }
}
