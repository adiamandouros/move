// The site as the browser tests see it: the real app (server/app.js) with the
// data in test/browser/data/, a fake OASA and fake announcement sources, so
// nothing reaches the network; and copies of it where things go wrong
// (SCENARIOS, below). Playwright starts it (playwright.config.js);
// to look around by hand: node test/browser/server.js, then localhost:3457
// (BROWSER_TEST_PORT changes the port).
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createApp } from '../../server/app.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(HERE, 'data');
const PORT = Number(process.env.BROWSER_TEST_PORT) || 3457;

// Fixed settings, whatever .env says
Object.assign(process.env, { SITE_URL: '', CONTACT_EMAIL: 'hello@wayhop.example' });
for (const key of Object.keys(process.env)) if (key.startsWith('ADSENSE_')) delete process.env[key];

// ── A fake OASA ─────────────────────────────────────────────────────────────
// Every stop has three buses, the first 1–19 minutes away depending on its
// code, so some stops are refreshed often and some rarely (see the bus page's
// refresh tiers). The lines are the stop's own, from bus-stops.json.
const { fields, stops } = JSON.parse(readFileSync(join(DATA, 'bus-stops.json'), 'utf8'));
const linesOf = new Map(stops.map(s => [s[fields.indexOf('code')], s[fields.indexOf('lines')]]));

export function arrivalsAt(code) {
    const first = (Number(code) % 7) * 3 + 1;
    const lines = linesOf.get(code) ?? [];
    return lines.length ? [first, first + 8, first + 17].map((minutes, i) => ({ route: `${code}${i % lines.length}`, minutes })) : [];
}

const oasaClient = {
    async request(act, code) {
        if (act === 'getStopArrivals') return arrivalsAt(code).map((a, i) => ({ route_code: a.route, veh_code: `${i}`, btime2: `${a.minutes}` }));
        if (act === 'webRoutesForStop') {
            return (linesOf.get(code) ?? []).map((line, i) => ({
                RouteCode: `${code}${i}`, LineID: line, RouteDescr: 'ΣΥΝΤΑΓΜΑ - ΚΗΦΙΣΙΑ', RouteDescrEng: 'SYNTAGMA - KIFISIA',
            }));
        }
        throw new Error(`fake OASA: no ${act}`);
    },
    status: () => ({ at: Date.now(), droppedLastHour: 0, queueWaitMs: 0, routes: [{ name: 'direct', resting: false, restUntil: null, lastOk: Date.now() }] }),
    queueWait: () => 0,
};

// ── Fake announcement sources ───────────────────────────────────────────────
const day = n => new Date(Date.now() - n * 86_400_000);
const rss = items => `<?xml version="1.0"?><rss><channel>${items.map(([title, n]) => `<item><title>${title}</title>
    <link>https://www.oasa.gr/news/${n}/</link><pubDate>${day(n).toUTCString()}</pubDate><category>ΑΝΑΚΟΙΝΩΣΕΙΣ</category><category>ANNOUNCEMENTS</category></item>`).join('')}</channel></rss>`;
const SOURCES = {
    'https://www.oasa.gr/feed/': rss([['Αλλαγές στη γραμμή 040', 1], ['Έργα στην οδό Πανεπιστημίου', 3]]),
    'https://www.oasa.gr/en/feed/': rss([['Changes to line 040', 1], ['Works on Panepistimiou street', 3]]),
};
async function fetch(url) {
    const href = String(url);
    let body = SOURCES[href];
    if (!body && href.startsWith('https://www.stasy.gr/news-')) {
        body = `<meta property="article:published_time" content="${day(2).toISOString()}">`;
    } else if (!body && href.startsWith('https://www.stasy.gr/')) {
        body = `<article id="post-1" class="clearfix">\n<a href="https://www.stasy.gr/news-1/"><h5><span class="light">Κλειστός ο σταθμός Πανεπιστήμιο</span></h5></a></article>`;
    }
    if (!body) throw new Error(`fake network: nothing at ${href}`);
    return new Response(body, { status: 200 });
}

// ── Scenarios ───────────────────────────────────────────────────────────────
// Each is its own copy of the app (with its own caches), and a test picks one
// with a "scenario" cookie (fixtures.js: test.use({ scenario })), so tests
// running side by side don't affect each other.
const site = (overrides = {}) => createApp({
    buildDir: DATA,
    cacheDir: mkdtempSync(join(tmpdir(), 'wayhop-browser-')),
    relays: [],
    fetch,
    oasaClient,
    // Every test comes from 127.0.0.1, so the per-visitor limit would be shared
    limiter: { take: () => 0 },
    adminPassword: '',
    ...overrides,
});
// The site with /api/arrivals answered by `handler` instead
const withArrivals = handler => express().get('/api/arrivals', handler).use(site());
const codesOf = req => String(req.query.stops ?? '').split(',');
const down = async () => { throw new Error('fake OASA: down'); };

const SCENARIOS = {
    normal: site(),
    // OASA doesn't answer (and nothing is cached): every stop is unavailable
    'oasa-down': site({ oasaClient: { ...oasaClient, request: down } }),
    // OASA stopped answering a while ago: the last answers, marked stale
    'oasa-stale': withArrivals((req, res) => res.json({ stops: Object.fromEntries(codesOf(req).map(code => [code, {
        arrivals: arrivalsAt(code).map(a => ({ route: a.route, vehicle: '1', minutes: a.minutes, line: linesOf.get(code)?.[0] ?? null, to: { el: 'ΣΥΝΤΑΓΜΑ', en: 'SYNTAGMA' } })),
        updated: Date.now() - 2 * 60_000,
        stale: true,
    }])) })),
    // Over the per-visitor limit (server/oasa/limits.js)
    'oasa-limited': withArrivals((_req, res) => res.status(429).set('Retry-After', '30').json({ error: 'Too many new stops; try again shortly' })),
    // Neither OASA's nor STASY's website answers
    'announcements-down': site({ fetch: down }),
    // Before the first data build: no rail.json or bus-stops.json
    'no-data': site({ buildDir: mkdtempSync(join(tmpdir(), 'wayhop-nodata-')) }),
};

const app = express();
app.use((req, res, next) => {
    const scenario = req.headers.cookie?.match(/(?:^|;\s*)scenario=([\w-]+)/)?.[1] ?? 'normal';
    (SCENARIOS[scenario] ?? SCENARIOS.normal)(req, res, next);
});
app.listen(PORT, () => console.log(`Wayhop (browser tests) at http://localhost:${PORT}`));
