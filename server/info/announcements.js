import express from 'express';
import { safeUrl } from '../../public/js/core/html.js';
import { userAgentFor } from '../config.js';
import { messageOf } from '../errors.js';
import { readJson, writeFileAtomic } from '../files.js';
import { createStasyClient } from '../stasy.js';

// Service announcements for the info page, from the operators' own websites:
//   - OASA (buses, trolleys and general notices): its RSS feeds, in Greek and English
//   - STASY (metro and tram): no feed and a closed API, so its news page is
//     read and each new post's page is fetched once for its date
//   - apergia.gr (strikes, decision 71): the JSON its own pages read; only
//     strikes on the networks Wayhop covers, their titles as written there,
//     shown until each strike ends
// Fetched only when someone asks and the copy is older than the source's
// EVERY_MS, so an idle app sends nothing; a failing source keeps serving its
// last good copy.
// The copy is kept in `cacheFile`, so a restart doesn't start from nothing.
// STASY's pages come directly or through the relays (server/stasy.js).

const REFRESH_MS = 15 * 60_000;
// apergia.gr twice a day: strikes are announced days ahead (decision 71)
const APERGIA_MS = 12 * 3_600_000;
const TIMEOUT_MS = 15_000;
const MAX_AGE_MS = 30 * 86_400_000;   // older announcements are dropped
const MAX_ITEMS = 8;                  // per source and language
const DISRUPTION_AGE_MS = 7 * 86_400_000;

/** @typedef {keyof typeof SOURCES} Source */
/** @typedef {{ title: string, link: string, date: string, until?: string }} Item an announcement, `date` ISO; a strike's `until`: when it ends, ISO */
/**
 * How a source's last fetch went (none since the app started: no `ok`), its
 * announcements and when they were fetched (ISO)
 * @typedef {{ ok?: boolean, at?: number, error?: string, route?: string | null, leftOut?: number, items: number, updated: string | null }} SourceStatus
 */
const SOURCES = {
    oasaEl: 'https://www.oasa.gr/feed/',
    oasaEn: 'https://www.oasa.gr/en/feed/',
    stasy: 'https://www.stasy.gr/%ce%bd%ce%ad%ce%b1-%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/',
    apergia: 'https://api.apergia.gr/api/v1/events/summary',
};
/** @type {Record<Source, number>} */
const EVERY_MS = { oasaEl: REFRESH_MS, oasaEn: REFRESH_MS, stasy: REFRESH_MS, apergia: APERGIA_MS };

// ── Parsing ─────────────────────────────────────────────────────────────────

/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** @param {string} text */
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
/** @param {string} text */
const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

// Strikes, work stoppages and closures: shown as a banner while recent
const DISRUPTION = /ΣΤΑΣ(Η|ΕΙΣ) ΕΡΓΑΣΙΑΣ|ΑΠΕΡΓΙ|ΚΛΕΙΣΤ|ΚΛΕΙΝΟΥΝ|ΔΙΑΚΟΠΗ ΛΕΙΤΟΥΡΓΙΑΣ|STRIKE|WORK STOPPAGE|CLOSED|CLOSURE/;
/** @param {string} title */
export const isDisruption = title => DISRUPTION.test(fold(title));

// OASA's feeds also carry tenders and corporate news; keep the passenger notices
const OASA_CATEGORIES = /ΑΝΑΚΟΙΝΩΣΕΙΣ|ANNOUNCEMENTS|ALERTS/;

// → [{ title, link, date }]. Only items that link to a web address are kept:
// the pages link to them, and a javascript: link would run there.
/** @param {string} xml */
export function parseOasaFeed(xml) {
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
        /** @param {string} name */
        const field = name => item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
        const categories = [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map(m => fold(decode(m[1])));
        const date = new Date(field('pubDate') ?? '');
        const link = safeUrl(decode(field('link') ?? ''));
        if (!categories.some(c => OASA_CATEGORIES.test(c)) || Number.isNaN(date.getTime()) || !link) return [];
        return [{ title: decode(field('title') ?? ''), link, date: date.toISOString() }];
    });
}

// STASY's news page also lists job ads, tenders and shareholder notices
const STASY_SKIP = /ΠΡΟΚΗΡΥΞ|ΠΡΟΣΚΛΗΣ|ΔΙΑΓΩΝΙΣ|ΣΥΝΕΝΤΕΥΞ|ΠΙΝΑΚ|ΣΥΝΕΛΕΥΣ|ΑΠΟΤΕΛΕΣΜΑΤ|ΠΡΟΣΛΗΨ|ΘΕΣΗΣ|ΘΕΣΕΩΝ|ΔΙΑΒΟΥΛΕΥΣ|ΟΙΚΟΝΟΜΙΚ/;

// → [{ title, link }], in page order (newest first). Only posts that link to
// a web address are kept (each one's page is fetched for its date, and the
// pages link to it).
/** @param {string} html */
export function parseStasyList(html) {
    /** @type {Set<string>} */
    const seen = new Set();
    return [...html.matchAll(/<article id="post-\d+" class="clearfix">\s*<a href="([^"]+)"[\s\S]*?<span class="light">([\s\S]*?)<\/span>/g)]
        .flatMap(([, link, title]) => {
            const url = safeUrl(decode(link));
            return url ? [{ title: decode(title), link: url }] : [];
        })
        .filter(({ title, link }) => title && !STASY_SKIP.test(fold(title)) && !seen.has(link) && seen.add(link));
}

// → ISO date or null
/** @param {string} html */
export function parseStasyDate(html) {
    const date = new Date(html.match(/article:published_time" content="([^"]+)"/)?.[1] ?? '');
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// apergia.gr's transport strikes on the networks Wayhop covers: metro, M1
// (isap), tram, buses, trolleys and the suburban railway (ose); not ships,
// planes or taxis
const APERGIA_NETWORKS = new Set(['mmm.metro', 'mmm.isap', 'mmm.tram', 'mmm.bus', 'mmm.trolei', 'mmm.ose']);

// → [{ title, link, date, until }] from apergia.gr's events/summary, the
// title as written there (decision 71). Each links to its page on
// apergia.gr, by an id that can only make a link there.
/** @param {unknown} body */
export function parseApergia(body) {
    const events = typeof body === 'object' && body !== null && 'listEvents' in body && Array.isArray(body.listEvents) ? body.listEvents : [];
    return events.flatMap(/** @returns {Item[]} */ event => {
        if (typeof event !== 'object' || event === null) return [];
        const { category, categorySub, title, idSource, dateFromMs, dateToMs } = /** @type {Record<string, unknown>} */ (event);
        const networks = typeof categorySub === 'string' ? categorySub.split(/[\s,]+/) : [];
        if (category !== 'strikeTransportation' || !networks.some(n => APERGIA_NETWORKS.has(n))) return [];
        if (typeof title !== 'string' || typeof dateFromMs !== 'number' || typeof dateToMs !== 'number') return [];
        const text = decode(title);
        const from = new Date(dateFromMs);
        const to = new Date(dateToMs);
        if (!text || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
        const link = typeof idSource === 'string' && /^[A-Za-z0-9_-]+$/.test(idSource) ? `https://apergia.gr/#/event/${idSource}` : 'https://apergia.gr/';
        return [{ title: text, link, date: from.toISOString(), until: to.toISOString() }];
    });
}

// ── Fetching ────────────────────────────────────────────────────────────────

// `relays`: [{ name, url, key }] and `userAgent`, as for the OASA client (config.relays, config.userAgent)
/**
 * @param {{
 *   fetch?: typeof globalThis.fetch, now?: () => number, log?: (message: string) => void,
 *   cacheFile?: string, relays?: readonly { name: string, url: string, key: string }[], userAgent?: string,
 * }} [options]
 */
export function createAnnouncements({ fetch = globalThis.fetch, now = Date.now, log = console.warn, cacheFile, relays = [], userAgent = userAgentFor(null) } = {}) {
    // Last good result per source, and STASY post dates by link (posts don't move)
    /** @type {Record<Source, { items: Item[], updated: string } | null> & { dates: Record<string, string | null> }} */
    let state = { oasaEl: null, oasaEn: null, stasy: null, apergia: null, dates: {} };
    if (cacheFile) {
        state = { ...state, ...readJson(cacheFile) };
    }
    // When each source was last tried since the app started
    /** @type {Partial<Record<Source, number>>} */
    const tried = {};
    let refreshing = /** @type {Promise<void> | null} */ (null);
    // Per source, for the diagnostics: { ok, at, error, route, leftOut? }
    /** @type {Partial<Record<Source, { ok: boolean, at: number, error?: string, route?: string | null, leftOut?: number }>>} */
    const health = {};
    const stasy = createStasyClient({ fetch, now, relays, userAgent });
    // How many of STASY's newest posts the last load left out
    let stasyLeftOut = 0;

    /** @param {string} url */
    async function get(url) {
        const res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    }

    async function loadStasy() {
        const posts = parseStasyList(await stasy.page(SOURCES.stasy));
        // Only the newest few are shown, so only they need a date
        const recent = posts.slice(0, MAX_ITEMS);
        // A post whose page doesn't load (STASY has listed a link its own
        // site answers 404) is left out for now and tried again next refresh
        let leftOut = 0;
        for (const post of recent) {
            if (post.link in state.dates) continue;
            try {
                state.dates[post.link] = parseStasyDate(await stasy.page(post.link));
            } catch (err) {
                leftOut++;
                log(`[announcements] stasy: left out ${post.link} for now: ${messageOf(err)}`);
            }
        }
        // Forget dates of posts that have left the list
        state.dates = Object.fromEntries(recent.filter(p => p.link in state.dates).map(p => [p.link, state.dates[p.link]]));
        stasyLeftOut = leftOut;
        return recent.flatMap(p => {
            const date = state.dates[p.link];
            return date ? [{ ...p, date }] : [];
        });
    }

    /** @type {Record<Source, () => Promise<Item[]>>} */
    const loaders = {
        oasaEl: async () => parseOasaFeed(await get(SOURCES.oasaEl)),
        oasaEn: async () => parseOasaFeed(await get(SOURCES.oasaEn)),
        stasy: loadStasy,
        apergia: async () => parseApergia(JSON.parse(await get(SOURCES.apergia))),
    };
    const names = /** @type {Source[]} */ (Object.keys(loaders));

    // Each of `which` (all by default) fetched again
    /** @param {Source[]} [which] */
    async function refresh(which = names) {
        await Promise.all(which.map(async name => {
            tried[name] = now();
            const load = loaders[name];
            try {
                state[name] = { items: await load(), updated: new Date(now()).toISOString() };
                health[name] = { ok: true, at: now(), route: name === 'stasy' ? stasy.route : 'direct', ...(name === 'stasy' && stasyLeftOut && { leftOut: stasyLeftOut }) };
            } catch (err) {
                health[name] = { ok: false, at: now(), error: messageOf(err) };
                log(`[announcements] ${name}: ${messageOf(err)}`);
            }
        }));
        if (cacheFile) {
            try { writeFileAtomic(cacheFile, JSON.stringify(state)); } catch { /* the cache is only an optimisation */ }
        }
    }

    // A source is due once its copy, or its last try since the app started,
    // is older than its EVERY_MS: a restart doesn't ask again sooner
    /** @param {Source} name */
    const due = name => now() - Math.max(tried[name] ?? 0, Date.parse(state[name]?.updated ?? '') || 0) > EVERY_MS[name];

    // → { rail, bus: { el, en }, strikes, available }; each list is [{ title, link, date, disruption }],
    // a strike's with `until`. STASY only writes its announcements in Greek,
    // and apergia.gr its strikes, so `rail` and `strikes` have one list each.
    async function current() {
        const stale = names.filter(due);
        if (stale.length) {
            // STASY is slow, so answer from the last copy and refresh behind it;
            // only wait when there's nothing to show yet
            const refreshed = refreshNow(stale);
            if (!names.some(name => state[name])) await refreshed;
        }
        /** @param {Source} source */
        const items = source => (state[source]?.items ?? [])
            .filter(item => now() - Date.parse(item.date) < MAX_AGE_MS)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, MAX_ITEMS)
            .map(item => ({ ...item, disruption: isDisruption(item.title) && now() - Date.parse(item.date) < DISRUPTION_AGE_MS }));
        // A strike is shown from when apergia.gr lists it until it ends, soonest first
        const strikes = (state.apergia?.items ?? [])
            .filter(item => item.until && now() < Date.parse(item.until))
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, MAX_ITEMS)
            .map(item => ({ ...item, disruption: true }));
        return {
            rail: items('stasy'),
            bus: { el: items('oasaEl'), en: items('oasaEn') },
            strikes,
            available: names.filter(name => state[name]),
        };
    }

    // Fetch now (sharing a refresh already under way): the sources due, or
    // every one for the diagnostics
    /** @param {Source[]} [which] */
    const refreshNow = which => (refreshing ??= refresh(which).finally(() => { refreshing = null; }));

    // → { <source>: { ok, at, error?, route?, items, updated } }, for the diagnostics
    const status = () => Object.fromEntries(names.map(/** @returns {[Source, SourceStatus]} */ name => [name, {
        ...health[name],
        items: state[name]?.items.length ?? 0,
        updated: state[name]?.updated ?? null,
    }]));

    const router = express.Router();
    router.get('/', async (_req, res) => {
        const body = await current();
        if (!body.available.length) return res.status(503).json({ error: 'Announcements are unavailable' });
        res.set('Cache-Control', 'no-store').json(body);
    });

    return Object.assign(router, { current, refresh, refreshNow, status });
}
