import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// Live arrivals per stop, shared by every user:
//   - each stop is fetched at most once per ARRIVALS_TTL_MS
//   - simultaneous requests for the same stop share one upstream call
//   - when OASA can't be reached, the last answer is served (marked stale)
//     for up to STALE_MAX_MS
// Arrivals only carry OASA's internal route code, so line numbers and
// destinations come from a route table filled from webRoutesForStop and kept
// on disk; route codes rarely change, so each is looked up about once a week.

export const ARRIVALS_TTL_MS = 30_000;
const STALE_MAX_MS = 5 * 60_000;
const ROUTES_TTL_MS = 7 * 86_400_000;
const MAX_CACHED_STOPS = 5000;

export function createArrivals({ client, routesFile, now = Date.now, log = console.warn }) {
    const cache = new Map();      // stop → { at, arrivals }
    const inflight = new Map();   // stop → Promise
    const routeLookups = new Map();
    const routes = loadRoutes(routesFile, log);

    // ── Route names ─────────────────────────────────────────────────────────

    let saveTimer = null;
    function saveRoutesSoon() {
        if (!routesFile) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                mkdirSync(dirname(routesFile), { recursive: true });
                writeFileSync(`${routesFile}.tmp`, JSON.stringify(routes));
                renameSync(`${routesFile}.tmp`, routesFile);
            } catch (err) {
                log(`[oasa] Couldn't save the route table: ${err.message}`);
            }
        }, 1000);
        saveTimer.unref?.();
    }

    // Look up every route at a stop (one request) and add them to the table
    function lookUpRoutes(stop) {
        if (!routeLookups.has(stop)) {
            routeLookups.set(stop, client.request('webRoutesForStop', stop)
                .then(rows => {
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

    async function describe(stop, raw) {
        const stale = raw.some(a => !routes[a.route_code] || now() - routes[a.route_code].at > ROUTES_TTL_MS);
        if (stale) await lookUpRoutes(stop);
        return raw
            .map(a => {
                const route = routes[a.route_code];
                return {
                    route: a.route_code,
                    vehicle: a.veh_code,
                    minutes: Number(a.btime2),
                    line: route?.line ?? null,
                    to: route ? { el: route.el, en: route.en } : null,
                };
            })
            .sort((a, b) => a.minutes - b.minutes);
    }

    // ── Arrivals ────────────────────────────────────────────────────────────

    function remember(stop, arrivals, at) {
        cache.set(stop, { at, arrivals });
        if (cache.size > MAX_CACHED_STOPS) {
            for (const [key, entry] of cache) if (now() - entry.at > STALE_MAX_MS) cache.delete(key);
        }
    }

    // → { arrivals: [...], updated: ms | null, stale: boolean, unavailable?: true }
    function stopArrivals(stop) {
        const hit = cache.get(stop);
        if (hit && now() - hit.at < ARRIVALS_TTL_MS) return Promise.resolve({ arrivals: hit.arrivals, updated: hit.at, stale: false });
        if (inflight.has(stop)) return inflight.get(stop);

        const pending = (async () => {
            // Age answers from when we asked, so a slow reply (e.g. queued behind
            // the rate limit) doesn't stay "fresh" longer than ARRIVALS_TTL_MS
            const asked = now();
            try {
                const raw = await client.request('getStopArrivals', stop);
                const arrivals = await describe(stop, Array.isArray(raw) ? raw : []);
                remember(stop, arrivals, asked);
                return { arrivals, updated: asked, stale: false };
            } catch {
                if (hit && now() - hit.at < STALE_MAX_MS) return { arrivals: hit.arrivals, updated: hit.at, stale: true };
                return { arrivals: [], updated: null, stale: false, unavailable: true };
            } finally {
                inflight.delete(stop);
            }
        })();
        inflight.set(stop, pending);
        return pending;
    }

    return { stopArrivals };
}

function loadRoutes(path, log) {
    if (!path || !existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (err) { log(`[oasa] Ignoring unreadable route table: ${err.message}`); return {}; }
}
