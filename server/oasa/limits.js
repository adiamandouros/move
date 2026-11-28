// Fair use of the shared request budget to OASA (client.js): one visitor can't
// fill the queue and leave everyone else with old arrivals. Only stops that
// aren't already cached count, as only those cost a request to OASA. A normal
// visitor needs at most about 12 a minute (6 stops, refreshed every ~30 s).
export const NEW_STOPS_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
// A client's address is forgotten within a tenth of its span after the
// span is over: the privacy page says how long it's kept
const FORGET_SHARE = 0.1;

// → { take(key, cost), clients() }: take returns 0 when allowed, or the ms
// until the client's minute is over. `windowMs`: another span than a
// minute, with `perMinute` that span's (riders' times: 6 an hour, decision
// 84). clients(): how many addresses it holds now. `every`: how the past
// spans are looked for (setInterval; tests give their own)
export function createClientLimiter({ perMinute = NEW_STOPS_PER_MINUTE, now = Date.now, windowMs = WINDOW_MS, every = defaultEvery } = {}) {
    /** @type {Map<string, { start: number, used: number }>} */
    const windows = new Map();   // client → { start, used }
    const forget = () => {
        const t = now();
        for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
    };
    every(forget, windowMs * FORGET_SHARE);
    return {
        /** @param {string} key @param {number} cost */
        take(key, cost) {
            if (!cost) return 0;
            const t = now();
            let w = windows.get(key);
            if (!w || t - w.start >= windowMs) {
                w = { start: t, used: 0 };
                windows.set(key, w);
            }
            if (w.used + cost > perMinute) return w.start + windowMs - t;
            w.used += cost;
            return 0;
        },
        clients: () => { forget(); return windows.size; },
    };
}

/** @param {() => void} fn @param {number} ms */
function defaultEvery(fn, ms) {
    setInterval(fn, ms).unref?.();
}

// Who a request counts against: its IPv4 address, or for IPv6 its /64, since
// a phone or household usually gets a whole /64
export function clientKey(ip = '') {
    const v4 = ip.replace(/^::ffff:(?=\d+\.)/, '');
    if (!v4.includes(':')) return v4;
    const [head, tail = ''] = ip.toLowerCase().split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
