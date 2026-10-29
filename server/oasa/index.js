import { readFileSync, statSync } from 'fs';
import express from 'express';
import { writeFileAtomic } from '../files.js';
import { createArrivals } from './arrivals.js';
import { createOasaClient } from './client.js';
import { clientKey, createClientLimiter } from './limits.js';
import { createUsage } from './usage.js';
import { STOP_CODE } from '../data/check-output.js';

// Most stops one request may ask for (the bus page shows 6 at a time)
const MAX_STOPS = 12;
// What the trip finder says it asks for (see below)
const TRIP = new Set(['trip', 'trip-start']);

// /api routes for the bus page.
//   GET /api/arrivals?stops=10361,10341
//   → { stops: { "10361": { arrivals: [{ line, to: { el, en }, minutes, route, vehicle }], updated, stale, unavailable? } } }
//
// The trip finder adds &for=trip (&for=trip-start on the first request of a
// new search), so its searches and its answers are counted apart (usage.js).
//
// Only stops in `stopsFile` (bus-stops.json, which the bus page picks from)
// are accepted, and each visitor may ask for NEW_STOPS_PER_MINUTE stops that
// aren't cached (limits.js); over that, the answer is 429 with Retry-After.
//
// `relays` ([{ name, url, key }]) are the optional fallback routes described in client.js.
//
// `statusFile`: where the live route status and the past hour's and today's
// usage are written about once a minute, so `npm run diagnose` (a separate
// process) can show what the app sees.
//
// `usage` counts what is asked of OASA and how it answers (usage.js); the
// client is given the same one. Its days are saved once a minute.
/**
 * @param {{
 *   routesFile?: string, statusFile?: string, stopsFile?: string,
 *   relays?: { name: string, url: string, key: string }[],
 *   usage?: ReturnType<typeof createUsage>,
 *   client?: ReturnType<typeof createOasaClient>,
 *   limiter?: { take(key: string, stops: number): number },
 *   now?: () => number,
 * }} [options]
 */
export function createBusApi({ routesFile, statusFile, stopsFile, relays = [], now = Date.now, usage = createUsage({ now }), client = createOasaClient({ relays, usage }), limiter } = {}) {
    const arrivals = createArrivals({ client, routesFile, now, usage });
    limiter ??= createClientLimiter({ now });
    const isKnown = knownStops(stopsFile, now);
    const status = () => ({ ...client.status(), usage: usage.status() });
    const router = express.Router();

    // Written every minute even when nothing changed, so the status file's
    // timestamp also shows whether the app is running
    const write = () => {
        usage.save();
        if (statusFile) {
            try { writeFileAtomic(statusFile, JSON.stringify(status())); } catch { /* diagnostics only */ }
        }
    };
    write();
    setInterval(write, 60_000).unref();

    router.get('/arrivals', async (req, res) => {
        const stops = [...new Set(String(req.query.stops ?? '').split(',').filter(Boolean))];
        if (!stops.length || stops.length > MAX_STOPS || !stops.every(s => STOP_CODE.test(s))) {
            return res.status(400).json({ error: `Pass 1–${MAX_STOPS} numeric stop codes as ?stops=a,b,c` });
        }
        const unknown = stops.filter(s => !isKnown(s));
        if (unknown.length) return res.status(400).json({ error: `Unknown stop code: ${unknown.join(', ')}` });

        const cached = stops.map(s => arrivals.isCached(s));
        const wait = limiter.take(clientKey(req.ip), cached.filter(c => !c).length);
        if (wait) {
            usage.limited();
            return res.status(429).set('Retry-After', String(Math.ceil(wait / 1000))).json({ error: 'Too many new stops; try again shortly' });
        }

        const results = await Promise.all(stops.map(s => arrivals.stopArrivals(s)));
        if (TRIP.has(String(req.query.for))) {
            if (req.query.for === 'trip-start') usage.tripSearch();
            results.forEach((r, i) => usage.tripAnswer(cached[i] ? 'cache' : r.unavailable ? 'none' : r.stale ? 'old' : 'oasa'));
        }
        res.set('Cache-Control', 'no-store').json({ stops: Object.fromEntries(stops.map((s, i) => [s, results[i]])) });
    });

    router.use((_req, res) => res.status(404).json({ error: 'Not found' }));

    return Object.assign(router, { status, usage });
}

// code → whether it's a stop in bus-stops.json. The file is checked for
// changes at most once a minute (it's rebuilt weekly). Until it exists (the
// first build still running) every code is accepted.
function knownStops(file, now) {
    let codes = null;
    let mtime = 0;
    let checked = -Infinity;
    return code => {
        if (!file) return true;
        if (now() - checked >= 60_000) {
            checked = now();
            try {
                const changed = statSync(file).mtimeMs;
                if (changed !== mtime) {
                    const { fields, stops } = JSON.parse(readFileSync(file, 'utf8'));
                    const i = fields.indexOf('code');
                    codes = new Set(stops.map(s => String(s[i])));
                    mtime = changed;
                }
            } catch { /* keep the codes we had */ }
        }
        return !codes || codes.has(code);
    };
}
