import { USER_AGENT } from '../data/sources.js';
import { hourCounter } from './limits.js';

// The one place that talks to OASA's telematics API. Everything here exists
// to keep our load on it small and predictable:
//   - at most REQUESTS_PER_SECOND requests, evenly spaced (no bursts)
//   - a request that would have to wait longer than MAX_WAIT_MS is dropped
//   - after FAILURES_TO_OPEN failures in a row, a route is rested for a while
// Callers fall back to cached data when a request is refused or fails.
//
// Optionally, relays (proxy/) are used when OASA can't be reached directly:
// its live API only accepts Greek IPs and the server is in Germany. Routes are
// tried in order (direct, then each relay in RELAYS), and a failed request
// moves on to the next one. A route that keeps failing rests for
// FALLBACK_REST_MS (a day: the geo-block isn't expected to change quickly)
// while the routes after it carry the traffic, so in the steady state requests
// go straight to the first working route; the last route only rests for
// LAST_REST_MS, as nothing comes after it.

const API = 'https://telematics.oasa.gr/api/';
export const REQUESTS_PER_SECOND = 2;
const MAX_WAIT_MS = 8_000;
const TIMEOUT_MS = 8_000;
const FAILURES_TO_OPEN = 5;
const FALLBACK_REST_MS = 24 * 3_600_000;
const LAST_REST_MS = 60_000;

// The relays, in the order they're tried after direct access, and the .env
// settings (<env>_URL and <env>_KEY) that turn each one on. See proxy/README.md.
export const RELAYS = [
    { name: 'relay', env: 'OASA_RELAY' },           // Cloudflare Worker
    { name: 'home relay', env: 'OASA_HOME_RELAY' }, // e.g. a Raspberry Pi at home
];

// → [{ name, env, url, key }] for each relay whose URL and key are both set
export const relaysFromEnv = env => RELAYS
    .filter(r => env[`${r.env}_URL`] && env[`${r.env}_KEY`])
    .map(r => ({ ...r, url: env[`${r.env}_URL`], key: env[`${r.env}_KEY`] }));

export class OasaUnavailable extends Error {}

const duration = ms => ms >= 3_600_000 ? `${ms / 3_600_000} h` : `${ms / 1000} s`;

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createOasaClient({ fetch = globalThis.fetch, now = Date.now, sleep = realSleep, log = console.warn, relays = [] } = {}) {
    let nextSlot = 0;
    // Requests dropped because the queue was too long: people saw older arrivals
    const dropped = hourCounter(now);

    // Per route: consecutive failures, and while resting, the time it may be
    // tried again. After a rest, a single request probes it (`probing`) while
    // the others keep skipping it, so a recovering service gets one try, not a burst.
    const route = (name, url, headers = {}) => ({
        name, url, headers, failures: 0, restUntil: 0, probing: false,
        lastOk: null, lastError: null, // for diagnostics
    });
    const routes = [route('direct', API), ...relays.map(r => route(r.name, r.url, { 'X-Relay-Key': r.key }))];
    routes.forEach((r, i) => {
        r.next = routes[i + 1] ?? null;
        r.restMs = r.next ? FALLBACK_REST_MS : LAST_REST_MS;
    });
    const usable = r => !r.probing && now() >= r.restUntil;

    // Reserve the next free slot; resolves when it's our turn, or false if the queue is too long
    async function waitForSlot() {
        const t = now();
        const at = Math.max(t, nextSlot);
        if (at - t > MAX_WAIT_MS) return false;
        nextSlot = at + 1000 / REQUESTS_PER_SECOND;
        if (at > t) await sleep(at - t);
        return true;
    }

    function rest(r, reason) {
        r.failures = 0;
        r.restUntil = now() + r.restMs;
        if (reason) {
            const fallback = r.next ? ` — using the ${r.next.name} meanwhile` : '';
            log(`[oasa] ${FAILURES_TO_OPEN} ${r.name} failures in a row (last: ${reason}); resting it for ${duration(r.restMs)}${fallback}`);
        }
    }

    async function attempt(r, act, p1) {
        // A route whose rest is over gets exactly one probe
        const probe = r.restUntil > 0;
        if (probe) r.probing = true;
        try {
            const url = `${r.url}?act=${encodeURIComponent(act)}&p1=${encodeURIComponent(p1)}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...r.headers },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = JSON.parse(await res.text());
            if (r.restUntil) log(`[oasa] ${r.name} access is working again`);
            r.lastOk = now();
            r.failures = 0;
            r.restUntil = 0;
            return body;
        } catch (err) {
            r.lastError = { at: now(), message: err.message };
            if (probe) rest(r);  // still failing: rest again, quietly
            // Failures of requests that were already in flight when the route
            // was put to rest don't count (and don't restart the rest)
            else if (now() >= r.restUntil && ++r.failures >= FAILURES_TO_OPEN) rest(r, err.message);
            throw err;
        } finally {
            if (probe) r.probing = false;
        }
    }

    // Call one API action, e.g. request('getStopArrivals', '10361'). Returns
    // the parsed JSON (OASA answers `null` for "nothing"), or throws OasaUnavailable.
    async function request(act, p1) {
        if (!routes.some(usable)) throw new OasaUnavailable('OASA is failing — paused');
        if (!await waitForSlot()) {
            dropped.add();
            throw new OasaUnavailable('Request budget exhausted');
        }

        let lastError = new Error('OASA is failing — paused');
        // Decided only now, after waiting: a route may have been rested meanwhile
        for (const r of routes) {
            if (!usable(r)) continue;
            try {
                return await attempt(r, act, p1);
            } catch (err) {
                lastError = err;
            }
        }
        throw new OasaUnavailable(lastError.message);
    }

    // What each route is doing right now, for the diagnostics page and `npm run diagnose`
    function status() {
        return {
            at: now(),
            droppedLastHour: dropped.count(),
            routes: routes.map(r => ({
                name: r.name,
                resting: now() < r.restUntil,
                restUntil: r.restUntil || null,
                failuresInARow: r.failures,
                lastOk: r.lastOk,
                lastError: r.lastError,
            })),
        };
    }

    return { request, status };
}
