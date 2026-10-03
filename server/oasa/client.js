import { USER_AGENT } from '../data/sources.js';

// The one place that talks to OASA's telematics API. Everything here exists
// to keep our load on it small and predictable:
//   - at most REQUESTS_PER_SECOND requests, evenly spaced (no bursts)
//   - a request that would have to wait longer than MAX_WAIT_MS is dropped
//   - after FAILURES_TO_OPEN failures in a row, no requests for OPEN_MS
// Callers fall back to cached data when a request is refused or fails.

const API = 'https://telematics.oasa.gr/api/';
export const REQUESTS_PER_SECOND = 2;
const MAX_WAIT_MS = 8_000;
const TIMEOUT_MS = 8_000;
const FAILURES_TO_OPEN = 5;
const OPEN_MS = 60_000;

export class OasaUnavailable extends Error {}

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createOasaClient({ fetch = globalThis.fetch, now = Date.now, sleep = realSleep, log = console.warn } = {}) {
    let nextSlot = 0;
    let failures = 0;
    let openUntil = 0;

    // Reserve the next free slot; resolves when it's our turn, or false if the queue is too long
    async function waitForSlot() {
        const t = now();
        const at = Math.max(t, nextSlot);
        if (at - t > MAX_WAIT_MS) return false;
        nextSlot = at + 1000 / REQUESTS_PER_SECOND;
        if (at > t) await sleep(at - t);
        return true;
    }

    // Call one API action, e.g. request('getStopArrivals', '10361'). Returns
    // the parsed JSON (OASA answers `null` for "nothing"), or throws OasaUnavailable.
    async function request(act, p1) {
        if (now() < openUntil) throw new OasaUnavailable('OASA is failing — paused');
        if (!await waitForSlot()) throw new OasaUnavailable('Request budget exhausted');

        try {
            const url = `${API}?act=${encodeURIComponent(act)}&p1=${encodeURIComponent(p1)}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = JSON.parse(await res.text());
            failures = 0;
            return body;
        } catch (err) {
            if (++failures >= FAILURES_TO_OPEN) {
                failures = 0;
                openUntil = now() + OPEN_MS;
                log(`[oasa] ${FAILURES_TO_OPEN} failures in a row (last: ${err.message}) — pausing requests for ${OPEN_MS / 1000} s`);
            }
            throw new OasaUnavailable(err.message);
        }
    }

    return { request };
}
