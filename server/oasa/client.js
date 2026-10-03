import { USER_AGENT } from '../data/sources.js';

// The one place that talks to OASA's telematics API. Everything here exists
// to keep our load on it small and predictable:
//   - at most REQUESTS_PER_SECOND requests, evenly spaced (no bursts)
//   - a request that would have to wait longer than MAX_WAIT_MS is dropped
//   - after FAILURES_TO_OPEN failures in a row, a route is rested for a while
// Callers fall back to cached data when a request is refused or fails.
//
// Optionally, a relay (proxy/worker.js on Cloudflare) is used when OASA can't
// be reached directly, e.g. if the shared hosting IP gets blocked. It is a
// fallback only: a failed direct request is retried once through the relay,
// and after repeated direct failures the relay is used alone for
// DIRECT_REST_MS before trying direct again.

const API = 'https://telematics.oasa.gr/api/';
export const REQUESTS_PER_SECOND = 2;
const MAX_WAIT_MS = 8_000;
const TIMEOUT_MS = 8_000;
const FAILURES_TO_OPEN = 5;
const DIRECT_REST_MS = 10 * 60_000;
const RELAY_REST_MS = 60_000;

export class OasaUnavailable extends Error {}

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createOasaClient({ fetch = globalThis.fetch, now = Date.now, sleep = realSleep, log = console.warn, relay = null } = {}) {
    let nextSlot = 0;

    // Per route: consecutive failures, and while resting, the time it may be
    // tried again. After a rest, a single request probes it (`probing`) while
    // the others keep skipping it, so a recovering service gets one try, not a burst.
    const route = (name, restMs, url, headers = {}) => ({ name, restMs, url, headers, failures: 0, restUntil: 0, probing: false });
    const direct = route('direct', relay ? DIRECT_REST_MS : RELAY_REST_MS, API);
    const viaRelay = relay ? route('relay', RELAY_REST_MS, relay.url, { 'X-Relay-Key': relay.key }) : null;
    const routes = [direct, viaRelay].filter(Boolean);
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
            const fallback = r === direct && viaRelay ? ' — using the relay meanwhile' : '';
            log(`[oasa] ${FAILURES_TO_OPEN} ${r.name} failures in a row (last: ${reason}); resting it for ${r.restMs / 1000} s${fallback}`);
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
            r.failures = 0;
            r.restUntil = 0;
            return body;
        } catch (err) {
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
        if (!await waitForSlot()) throw new OasaUnavailable('Request budget exhausted');

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

    return { request };
}
