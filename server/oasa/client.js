import { USER_AGENT } from '../data/sources.js';
import { hourCounter } from './limits.js';

// The one place that talks to OASA's telematics API. Everything here exists
// to keep our load on it small and predictable:
//   - at most REQUESTS_PER_SECOND requests, evenly spaced (no bursts)
//   - a request that would have to wait longer than MAX_WAIT_MS is dropped
//   - two lanes: 'high' (someone's first look at a stop) goes ahead of
//     'normal' (refreshes), so newcomers get times quickly at busy times;
//     queueWait() tells the cache how busy it is (arrivals.js)
//   - after FAILURES_TO_OPEN failures in a row, a route is rested for a while
// Callers fall back to cached data when a request is refused or fails.
//
// Optionally, relays (proxy/) are used when OASA can't be reached directly:
// its live API only accepts Greek IPs and the server is in Germany. Routes are
// tried in order (direct, then each relay in RELAYS), and a failed request
// moves on to the next one.
//
// A route with another route behind it is only used once it's known to work:
// it's tested in the background with one request of our own (at startup, and
// again when a rest ends), and until the test answers, visitors' requests go
// to the routes behind it. So nobody waits on a blocked route (OASA drops
// connections from abroad without answering, which costs a whole timeout),
// and those routes get FALLBACK_TIMEOUT_MS instead of TIMEOUT_MS. A route
// that fails its test, or FAILURES_TO_OPEN requests in a row, rests for
// FALLBACK_REST_MS (a day: the geo-block isn't expected to change quickly).
// The last route has nothing behind it: it's always tried, and after
// repeated failures only rests for LAST_REST_MS.

const API = 'https://telematics.oasa.gr/api/';
export const REQUESTS_PER_SECOND = 2;
const MAX_WAIT_MS = 8_000;
const TIMEOUT_MS = 8_000;
// OASA answers in well under a second when it can be reached
const FALLBACK_TIMEOUT_MS = 3_000;
const FAILURES_TO_OPEN = 5;
const FALLBACK_REST_MS = 24 * 3_600_000;
const LAST_REST_MS = 60_000;
// What the background test asks for (a central stop, as the diagnostics do)
export const TEST_STOP = '10361';

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

const INTERVAL_MS = 1000 / REQUESTS_PER_SECOND;

export function createOasaClient({ fetch = globalThis.fetch, now = Date.now, sleep = realSleep, log = console.warn, relays = [] } = {}) {
    let nextSlot = 0;
    // Requests waiting for a slot, per lane: { go(ok), since }
    const lanes = { high: [], normal: [] };
    let pumping = false;
    // Requests dropped because the queue was too long: people saw older arrivals
    const dropped = hourCounter(now);

    // Per route: consecutive failures, and while resting, the time it may be
    // tried again. `working`: a route with a fallback has passed its test.
    // `probing`: a test (or, for the last route, the one request after a rest)
    // is under way, so other requests skip the route: one try, not a burst.
    const route = (name, url, headers = {}) => ({
        name, url, headers, failures: 0, restUntil: 0, probing: false, working: false,
        lastOk: null, lastError: null, // for diagnostics
    });
    const routes = [route('direct', API), ...relays.map(r => route(r.name, r.url, { 'X-Relay-Key': r.key }))];
    routes.forEach((r, i) => {
        r.next = routes[i + 1] ?? null;
        r.restMs = r.next ? FALLBACK_REST_MS : LAST_REST_MS;
        r.timeoutMs = r.next ? FALLBACK_TIMEOUT_MS : TIMEOUT_MS;
    });
    const usable = r => r.next ? r.working : !r.probing && now() >= r.restUntil;

    // How long a refresh asked for now would wait for its slot
    const queueWait = () => Math.max(0, nextSlot - now()) + (lanes.high.length + lanes.normal.length) * INTERVAL_MS;

    // Wait for a slot; resolves true when it's our turn, or false if the queue is too long
    function waitForSlot(lane = 'normal') {
        const ahead = lanes.high.length + (lane === 'normal' ? lanes.normal.length : 0);
        if (Math.max(0, nextSlot - now()) + ahead * INTERVAL_MS > MAX_WAIT_MS) return Promise.resolve(false);
        return new Promise(go => {
            lanes[lane].push({ go, since: now() });
            pump();
        });
    }

    // Hand out the slots, one every INTERVAL_MS, the high lane first. A
    // refresh that newcomers kept pushing back past MAX_WAIT_MS is dropped
    // (without using a slot), as it would have been if it had arrived then.
    async function pump() {
        if (pumping) return;
        pumping = true;
        while (lanes.high.length || lanes.normal.length) {
            const wait = nextSlot - now();
            if (wait > 0) await sleep(wait);
            const next = lanes.high.shift() ?? lanes.normal.shift();
            if (now() - next.since > MAX_WAIT_MS + INTERVAL_MS) {
                next.go(false);
                continue;
            }
            nextSlot = Math.max(now(), nextSlot) + INTERVAL_MS;
            next.go(true);
        }
        pumping = false;
    }

    function rest(r, reason) {
        r.failures = 0;
        r.working = false;
        r.restUntil = now() + r.restMs;
        if (reason) {
            const fallback = r.next ? ` — using the ${r.next.name} meanwhile` : '';
            log(`[oasa] ${FAILURES_TO_OPEN} ${r.name} failures in a row (last: ${reason}); resting it for ${duration(r.restMs)}${fallback}`);
        }
    }

    // One call over one route → the parsed JSON, or throws
    async function call(r, act, p1) {
        const url = `${r.url}?act=${encodeURIComponent(act)}&p1=${encodeURIComponent(p1)}`;
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...r.headers },
                signal: AbortSignal.timeout(r.timeoutMs),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = JSON.parse(await res.text());
            r.lastOk = now();
            return body;
        } catch (err) {
            r.lastError = { at: now(), message: err.message };
            throw err;
        }
    }

    // Test a route that has a fallback, in the background. Visitors' requests
    // use the routes behind it meanwhile. The test counts against the rate limit.
    async function test(r) {
        r.probing = true;
        try {
            if (!await waitForSlot()) return; // busy: tried again with a later request
            await call(r, 'getStopArrivals', TEST_STOP);
            if (r.restUntil) log(`[oasa] ${r.name} access is working again`);
            r.working = true;
            r.failures = 0;
            r.restUntil = 0;
        } catch (err) {
            // Said once (at startup); later tests fail quietly
            if (!r.restUntil) log(`[oasa] ${r.name} can't reach OASA (${err.message}); using the ${r.next.name} — testing it again in ${duration(r.restMs)}`);
            r.restUntil = now() + r.restMs;
        } finally {
            r.probing = false;
        }
    }
    const testDue = () => {
        for (const r of routes) {
            if (r.next && !r.working && !r.probing && now() >= r.restUntil) test(r);
        }
    };

    async function attempt(r, act, p1) {
        // The last route, when its rest is over, gets exactly one probe
        const probe = !r.next && r.restUntil > 0;
        if (probe) r.probing = true;
        try {
            const body = await call(r, act, p1);
            if (r.restUntil) log(`[oasa] ${r.name} access is working again`);
            r.failures = 0;
            r.restUntil = 0;
            return body;
        } catch (err) {
            if (probe) rest(r);  // still failing: rest again, quietly
            // Failures of requests that were already in flight when the route
            // was put to rest don't count (and don't restart the rest)
            else if (usable(r) && ++r.failures >= FAILURES_TO_OPEN) rest(r, err.message);
            throw err;
        } finally {
            if (probe) r.probing = false;
        }
    }

    // Call one API action, e.g. request('getStopArrivals', '10361'). Returns
    // the parsed JSON (OASA answers `null` for "nothing"), or throws OasaUnavailable.
    // lane: 'high' for someone's first look at a stop, 'normal' for refreshes.
    async function request(act, p1, { lane = 'normal' } = {}) {
        testDue();
        if (!routes.some(usable)) throw new OasaUnavailable('OASA is failing — paused');
        if (!await waitForSlot(lane)) {
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
            queueWaitMs: queueWait(),
            routes: routes.map(r => ({
                name: r.name,
                resting: now() < r.restUntil,
                restUntil: r.restUntil || null,
                // A route with a fallback that hasn't passed its test yet
                testing: Boolean(r.next && !r.working && now() >= r.restUntil),
                failuresInARow: r.failures,
                lastOk: r.lastOk,
                lastError: r.lastError,
            })),
        };
    }

    // Find out at once which routes work, before the first visitor asks
    testDue();

    return { request, status, queueWait };
}
