import { stasyTimetablePath } from '../proxy/worker.js';
import { userAgentFor } from './config.js';

// STASY's website (www.stasy.gr): its news page and posts, for the
// announcements (server/info/announcements.js), and its timetable pages, for
// the data build's first and last trains (server/data/stasy.js). STASY
// refuses the live server's data-centre address (403), so its pages can also
// come through the relays (proxy/worker.js), like OASA's live API. After a
// refusal, direct access rests for a day.

export const STASY_SITE = 'https://www.stasy.gr/';
const TIMEOUT_MS = 15_000;
const DIRECT_REST_MS = 24 * 3_600_000;
// Longer than the relay's own 20 s limit for STASY, so it reports a failure first
const RELAY_TIMEOUT_MS = 25_000;

// `relays`: [{ name, url, key }] and `userAgent`, as for the OASA client (config.relays, config.userAgent)
/**
 * @param {{
 *   fetch?: typeof globalThis.fetch, now?: () => number,
 *   relays?: readonly { name: string, url: string, key: string }[], userAgent?: string,
 * }} [options]
 */
export function createStasyClient({ fetch = globalThis.fetch, now = Date.now, relays = [], userAgent = userAgentFor(null) } = {}) {
    let directRestUntil = 0;
    let route = /** @type {string | null} */ (null);

    // A page (or with `read`, a file): directly, or through each relay with
    // `relayQuery` (none: the relays can't fetch it)
    async function get(url, relayQuery, read = res => res.text()) {
        const errors = [];
        if (now() >= directRestUntil) {
            try {
                const res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = await read(res);
                route = 'direct';
                return body;
            } catch (err) {
                errors.push(`direct: ${err.message}`);
                if (relays.length) directRestUntil = now() + DIRECT_REST_MS;
            }
        }
        for (const relay of relayQuery ? relays : []) {
            try {
                const res = await fetch(`${relay.url}?${relayQuery}`, {
                    headers: { 'X-Relay-Key': relay.key, 'User-Agent': userAgent },
                    signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = await read(res);
                route = relay.name;
                return body;
            } catch (err) {
                errors.push(`${relay.name}: ${err.message}`);
            }
        }
        throw new Error(errors.join('; ') || 'direct access is resting and there are no relays');
    }

    return {
        // A page of the site, e.g. a news post (the relays take one path segment)
        /** @param {string} url @returns {Promise<string>} */
        page(url) {
            const path = new URL(url).pathname.replace(/^\/|\/$/g, '');
            return get(url, path && !path.includes('/') ? `act=stasyPage&path=${encodeURIComponent(path)}` : null);
        },
        // The timetable page of metro line 1, 2 or 3, in Greek
        /** @param {1 | 2 | 3} line @returns {Promise<string>} */
        timetable(line) {
            return get(`${STASY_SITE}${stasyTimetablePath(line)}`, `act=stasyTimetable&line=${line}`);
        },
        // A PDF STASY has uploaded (its airport timetable), as bytes
        /** @param {string} url @returns {Promise<Buffer>} */
        file(url) {
            const path = new URL(url).pathname.replace(/^\//, '');
            return get(url, `act=stasyFile&path=${encodeURIComponent(path)}`, async res => Buffer.from(await res.arrayBuffer()));
        },
        // How the last page came: 'direct' or a relay's name
        get route() { return route; },
    };
}
