import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import express from 'express';
import { createArrivals } from './arrivals.js';
import { createOasaClient } from './client.js';
import { clientKey, createClientLimiter, hourCounter } from './limits.js';
import { STOP_CODE } from '../data/check-output.js';

// Most stops one request may ask for (the bus page shows 6 at a time)
const MAX_STOPS = 12;

// /api routes for the bus page.
//   GET /api/arrivals?stops=10361,10341
//   → { stops: { "10361": { arrivals: [{ line, to: { el, en }, minutes, route, vehicle }], updated, stale, unavailable? } } }
//
// Only stops in `stopsFile` (bus-stops.json, which the bus page picks from)
// are accepted, and each visitor may ask for NEW_STOPS_PER_MINUTE stops that
// aren't cached (limits.js); over that, the answer is 429 with Retry-After.
//
// `relays` ([{ name, url, key }]) are the optional fallback routes described in client.js.
//
// `statusFile`: where the live route status is written about once a minute,
// so `npm run diagnose` (a separate process) can show what the app sees.
export function createBusApi({ routesFile, statusFile, stopsFile, relays = [], client = createOasaClient({ relays }), limiter, now = Date.now } = {}) {
    const arrivals = createArrivals({ client, routesFile, now });
    limiter ??= createClientLimiter({ now });
    const limited = hourCounter(now);
    const isKnown = knownStops(stopsFile, now);
    const status = () => ({ ...client.status(), limitedLastHour: limited.count() });
    const router = express.Router();

    if (statusFile) {
        // Written every minute even when nothing changed, so its timestamp also
        // shows whether the app is running
        const write = () => {
            try {
                mkdirSync(dirname(statusFile), { recursive: true });
                writeFileSync(`${statusFile}.tmp`, JSON.stringify(status()));
                renameSync(`${statusFile}.tmp`, statusFile);
            } catch { /* diagnostics only */ }
        };
        write();
        setInterval(write, 60_000).unref();
    }

    router.get('/arrivals', async (req, res) => {
        const stops = [...new Set(String(req.query.stops ?? '').split(',').filter(Boolean))];
        if (!stops.length || stops.length > MAX_STOPS || !stops.every(s => STOP_CODE.test(s))) {
            return res.status(400).json({ error: `Pass 1–${MAX_STOPS} numeric stop codes as ?stops=a,b,c` });
        }
        const unknown = stops.filter(s => !isKnown(s));
        if (unknown.length) return res.status(400).json({ error: `Unknown stop code: ${unknown.join(', ')}` });

        const wait = limiter.take(clientKey(req.ip), stops.filter(s => !arrivals.isCached(s)).length);
        if (wait) {
            limited.add();
            return res.status(429).set('Retry-After', String(Math.ceil(wait / 1000))).json({ error: 'Too many new stops; try again shortly' });
        }

        const results = await Promise.all(stops.map(s => arrivals.stopArrivals(s)));
        res.set('Cache-Control', 'no-store').json({ stops: Object.fromEntries(stops.map((s, i) => [s, results[i]])) });
    });

    router.use((_req, res) => res.status(404).json({ error: 'Not found' }));

    return Object.assign(router, { status });
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
