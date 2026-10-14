import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import express from 'express';
import { USER_AGENT } from '../data/sources.js';

// Service announcements for the info page, from the operators' own websites:
//   - OASA (buses, trolleys and general notices): its RSS feeds, in Greek and English
//   - STASY (metro and tram): no feed and a closed API, so its news page is
//     read and each new post's page is fetched once for its date
// Fetched only when someone asks and the copy is older than REFRESH_MS, so an
// idle app sends nothing; a failing source keeps serving its last good copy.
// The copy is kept in `cacheFile`, so a restart doesn't start from nothing.

const REFRESH_MS = 15 * 60_000;
const TIMEOUT_MS = 15_000;
const MAX_AGE_MS = 30 * 86_400_000;   // older announcements are dropped
const MAX_ITEMS = 8;                  // per source and language
const DISRUPTION_AGE_MS = 7 * 86_400_000;

const SOURCES = {
    oasaEl: 'https://www.oasa.gr/feed/',
    oasaEn: 'https://www.oasa.gr/en/feed/',
    stasy: 'https://www.stasy.gr/%ce%bd%ce%ad%ce%b1-%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/',
};

// ── Parsing ─────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(text) {
    return text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m)
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Upper case without accents, for matching Greek and English keywords
const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

// Strikes, work stoppages and closures: shown as a banner while recent
const DISRUPTION = /ΣΤΑΣ(Η|ΕΙΣ) ΕΡΓΑΣΙΑΣ|ΑΠΕΡΓΙ|ΚΛΕΙΣΤ|ΚΛΕΙΝΟΥΝ|ΔΙΑΚΟΠΗ ΛΕΙΤΟΥΡΓΙΑΣ|STRIKE|WORK STOPPAGE|CLOSED|CLOSURE/;
export const isDisruption = title => DISRUPTION.test(fold(title));

// OASA's feeds also carry tenders and corporate news; keep the passenger notices
const OASA_CATEGORIES = /ΑΝΑΚΟΙΝΩΣΕΙΣ|ANNOUNCEMENTS|ALERTS/;

// → [{ title, link, date }]
export function parseOasaFeed(xml) {
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
        const field = name => item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
        const categories = [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map(m => fold(decode(m[1])));
        const date = new Date(field('pubDate'));
        if (!categories.some(c => OASA_CATEGORIES.test(c)) || Number.isNaN(date.getTime())) return [];
        return [{ title: decode(field('title') ?? ''), link: decode(field('link') ?? ''), date: date.toISOString() }];
    });
}

// STASY's news page also lists job ads, tenders and shareholder notices
const STASY_SKIP = /ΠΡΟΚΗΡΥΞ|ΠΡΟΣΚΛΗΣ|ΔΙΑΓΩΝΙΣ|ΣΥΝΕΝΤΕΥΞ|ΠΙΝΑΚ|ΣΥΝΕΛΕΥΣ|ΑΠΟΤΕΛΕΣΜΑΤ|ΠΡΟΣΛΗΨ|ΘΕΣΗΣ|ΘΕΣΕΩΝ|ΔΙΑΒΟΥΛΕΥΣ|ΟΙΚΟΝΟΜΙΚ/;

// → [{ title, link }], in page order (newest first)
export function parseStasyList(html) {
    const seen = new Set();
    return [...html.matchAll(/<article id="post-\d+" class="clearfix">\s*<a href="([^"]+)"[\s\S]*?<span class="light">([\s\S]*?)<\/span>/g)]
        .map(([, link, title]) => ({ title: decode(title), link: decode(link) }))
        .filter(({ title, link }) => title && !STASY_SKIP.test(fold(title)) && !seen.has(link) && seen.add(link));
}

// → ISO date or null
export function parseStasyDate(html) {
    const date = new Date(html.match(/article:published_time" content="([^"]+)"/)?.[1]);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── Fetching ────────────────────────────────────────────────────────────────

export function createAnnouncements({ fetch = globalThis.fetch, now = Date.now, log = console.warn, cacheFile } = {}) {
    // Last good result per source, and STASY post dates by link (posts don't move)
    let state = { oasaEl: null, oasaEn: null, stasy: null, dates: {} };
    if (cacheFile) {
        try { state = { ...state, ...JSON.parse(readFileSync(cacheFile, 'utf8')) }; } catch { /* first run */ }
    }
    let checkedAt = 0;
    let refreshing = null;

    async function get(url) {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    }

    async function loadStasy() {
        const posts = parseStasyList(await get(SOURCES.stasy));
        // Only the newest few are shown, so only they need a date
        const recent = posts.slice(0, MAX_ITEMS);
        for (const post of recent) {
            if (!(post.link in state.dates)) state.dates[post.link] = parseStasyDate(await get(post.link));
        }
        // Forget dates of posts that have left the list
        state.dates = Object.fromEntries(recent.map(p => [p.link, state.dates[p.link]]));
        return recent.filter(p => state.dates[p.link]).map(p => ({ ...p, date: state.dates[p.link] }));
    }

    const loaders = {
        oasaEl: async () => parseOasaFeed(await get(SOURCES.oasaEl)),
        oasaEn: async () => parseOasaFeed(await get(SOURCES.oasaEn)),
        stasy: loadStasy,
    };

    async function refresh() {
        await Promise.all(Object.entries(loaders).map(async ([name, load]) => {
            try {
                state[name] = { items: await load(), updated: new Date(now()).toISOString() };
            } catch (err) {
                log(`[announcements] ${name}: ${err.message}`);
            }
        }));
        checkedAt = now();
        if (cacheFile) {
            try {
                mkdirSync(dirname(cacheFile), { recursive: true });
                writeFileSync(`${cacheFile}.tmp`, JSON.stringify(state));
                renameSync(`${cacheFile}.tmp`, cacheFile);
            } catch { /* the cache is only an optimisation */ }
        }
    }

    // → { rail, bus: { el, en }, available }; each list is [{ title, link, date, disruption }].
    // STASY only writes its announcements in Greek, so `rail` has one list.
    async function current() {
        if (now() - checkedAt > REFRESH_MS) {
            refreshing ??= refresh().finally(() => { refreshing = null; });
            // STASY is slow, so answer from the last copy and refresh behind it;
            // only wait when there's nothing to show yet
            if (!Object.keys(loaders).some(name => state[name])) await refreshing;
        }
        const items = source => (state[source]?.items ?? [])
            .filter(item => now() - Date.parse(item.date) < MAX_AGE_MS)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, MAX_ITEMS)
            .map(item => ({ ...item, disruption: isDisruption(item.title) && now() - Date.parse(item.date) < DISRUPTION_AGE_MS }));
        return {
            rail: items('stasy'),
            bus: { el: items('oasaEl'), en: items('oasaEn') },
            available: Object.keys(loaders).filter(name => state[name]),
        };
    }

    const router = express.Router();
    router.get('/', async (_req, res) => {
        const body = await current();
        if (!body.available.length) return res.status(503).json({ error: 'Announcements are unavailable' });
        res.set('Cache-Control', 'no-store').json(body);
    });

    return Object.assign(router, { current, refresh });
}
