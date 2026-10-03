import { mkdirSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import express from 'express';
import { createArrivals } from './arrivals.js';
import { createOasaClient } from './client.js';

// Most stops one request may ask for (the bus page shows 6 at a time)
const MAX_STOPS = 12;
const STOP_CODE = /^\d{1,8}$/;

// /api routes for the bus page.
//   GET /api/arrivals?stops=10361,10341
//   → { stops: { "10361": { arrivals: [{ line, to: { el, en }, minutes, route, vehicle }], updated, stale, unavailable? } } }
//
// `relay` ({ url, key }) is the optional fallback route described in client.js.
//
// `statusFile`: where the live route status is written about once a minute,
// so `npm run diagnose` (a separate process) can show what the app sees.
export function createBusApi({ routesFile, statusFile, relay = null, client = createOasaClient({ relay }), now } = {}) {
    const arrivals = createArrivals({ client, routesFile, now });
    const router = express.Router();

    if (statusFile) {
        // Written every minute even when nothing changed, so its timestamp also
        // shows whether the app is running
        const write = () => {
            try {
                mkdirSync(dirname(statusFile), { recursive: true });
                writeFileSync(`${statusFile}.tmp`, JSON.stringify(client.status()));
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
        const results = await Promise.all(stops.map(s => arrivals.stopArrivals(s)));
        res.set('Cache-Control', 'no-store').json({ stops: Object.fromEntries(stops.map((s, i) => [s, results[i]])) });
    });

    router.use((_req, res) => res.status(404).json({ error: 'Not found' }));

    return Object.assign(router, { status: () => client.status() });
}
