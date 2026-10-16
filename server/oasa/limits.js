// Fair use of the shared request budget to OASA (client.js): one visitor can't
// fill the queue and leave everyone else with old arrivals. Only stops that
// aren't already cached count, as only those cost a request to OASA. A normal
// visitor needs at most about 12 a minute (6 stops, refreshed every ~30 s).
export const NEW_STOPS_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const MAX_CLIENTS = 50_000;

// → { take(key, cost) }: take returns 0 when allowed, or the ms until the
// client's minute is over
export function createClientLimiter({ perMinute = NEW_STOPS_PER_MINUTE, now = Date.now } = {}) {
    const windows = new Map();   // client → { start, used }
    return {
        take(key, cost) {
            if (!cost) return 0;
            const t = now();
            let w = windows.get(key);
            if (!w || t - w.start >= WINDOW_MS) {
                w = { start: t, used: 0 };
                windows.set(key, w);
                if (windows.size > MAX_CLIENTS) {
                    for (const [k, v] of windows) if (t - v.start >= WINDOW_MS) windows.delete(k);
                }
            }
            if (w.used + cost > perMinute) return w.start + WINDOW_MS - t;
            w.used += cost;
            return 0;
        },
    };
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

// How many times something happened in the past hour, for diagnostics
export function hourCounter(now = Date.now) {
    const times = [];
    const prune = () => { while (times.length && now() - times[0] >= 3_600_000) times.shift(); };
    return {
        add() { times.push(now()); prune(); },
        count() { prune(); return times.length; },
    };
}
