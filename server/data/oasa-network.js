import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { readJson, writeFileAtomic } from '../files.js';

// Today's bus network from OASA's live API, for bus-stops.json and
// bus-lines.json (build-bus.js). OASA's open-data timetable falls behind
// (diversions, new routes), the live API doesn't. Fetched by the nightly data
// build, gently (approved 2026-10-20):
//   - at most once a day (NETWORK_MAX_AGE_MS): a build at startup reuses it
//   - one request at a time, a second apart (PACE_MS)
//   - every night the lines (1 request) and each line's routes (~470)
//   - a route's stops only when the route is new, or its copy is over a
//     week old; at most a seventh of the routes are refreshed a night, oldest
//     first, so the weekly refresh is spread out
//   - a failed request is tried again up to 3 times, after 10 s, 30 s and
//     60 s (RETRY_WAITS_MS, approved 2026-10-20); one still failing then stops
//     the fetch: the build keeps the last network (and the files built from
//     it) until the next try
//   - each route's stops are saved as they arrive (rawDir/oasa/progress.jsonl),
//     so the next try asks only for the routes still missing
// Every failure is logged with the request it was, so the server's log shows
// where and why a fetch stopped, and each fetch leaves a short record of how
// far it got (rawDir/oasa/last-fetch.json, shown by /admin/diagnostics).
//
// The network, kept in rawDir/oasa/network.json:
// {
//   fetched: ISO time,
//   lines:  [{ code: '938', line: '040', name: { el, en } }, …],
//   routes: { '938': [{ code: '3922', type: '1', name: { el, en } }, …] },
//   stops:  { '3922': { at: ISO time, stops: [{ code, el, en, lat, lng }, …] } }  (in route order)
// }

export const NETWORK_MAX_AGE_MS = 20 * 3_600_000;
export const ROUTE_STOPS_MAX_AGE_MS = 7 * 86_400_000;
export const PACE_MS = 1000;
export const RETRY_WAITS_MS = [10_000, 30_000, 60_000];

// The record of the last fetch, for the diagnostics:
// { at, ok, seconds, error?, lines?: { done, total }, stops?: { done, total } }
// lines: lines whose routes were asked for; stops: routes whose stops were
// (only the ones this fetch needed: new, over a week old, or still missing)
export const lastFetchFile = rawDir => join(rawDir, 'oasa', 'last-fetch.json');

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const list = (body, what) => {
    if (!Array.isArray(body)) throw new Error(`OASA answered ${JSON.stringify(body)?.slice(0, 80)} for ${what}`);
    return body;
};

/**
 * Fetch the network, reusing `previous` route stops that are fresh enough.
 * request(act, p1): one call to OASA's API (server/oasa/client.js) → parsed JSON
 * saved(code, entry): called with each route's stops as they arrive
 * progress: filled in as it goes, so a caller sees how far a failed fetch got:
 * { lines: { done, total }, stops: { done, total }, requests } (requests: for
 * the usage of OASA, server/oasa/usage.js)
 * @returns {Promise<{ network: any, requests: number }>}
 */
export async function fetchNetwork({ request, previous = null, now = Date.now, sleep = realSleep, log = console.log, saved = /** @type {(code: string, entry: any) => void} */ (() => {}), progress = /** @type {any} */ ({}) }) {
    let requests = 0;
    // One request → its list. `none`: OASA's null is an empty list. Tried
    // again after each of RETRY_WAITS_MS; a request we got wrong (HTTP 4xx) isn't.
    const ask = async (act, p1, what, { none = false } = {}) => {
        for (let tries = 1; ; tries++) {
            if (requests++) await sleep(PACE_MS);
            progress.requests = requests;
            try {
                const body = await request(act, p1);
                return list(none ? body ?? [] : body, what);
            } catch (err) {
                const wait = RETRY_WAITS_MS[tries - 1];
                const final = wait === undefined || /^HTTP 4\d\d\b/.test(err.message);
                log(`[data] OASA ${act}${p1 ? ` ${p1}` : ''} (${what}) failed: ${err.message}${final ? '' : ` — trying again in ${wait / 1000} s`}`);
                if (final) throw new Error(`${what}: ${err.message}${tries > 1 ? ` (${tries} tries)` : ''}`, { cause: err });
                await sleep(wait);
            }
        }
    };

    const lines = (await ask('webGetLines', '', 'the lines')).map(l => ({
        code: text(l.LineCode), line: text(l.LineID), name: { el: text(l.LineDescr), en: text(l.LineDescrEng) },
    })).filter(l => l.code && l.line);

    const routes = {};
    progress.lines = { done: 0, total: lines.length };
    for (const l of lines) {
        // null: a line with no routes today
        routes[l.code] = (await ask('webGetRoutes', l.code, `line ${l.line}`, { none: true })).map(r => ({
            code: text(r.RouteCode), type: text(r.RouteType), name: { el: text(r.RouteDescr), en: text(r.RouteDescrEng) },
        })).filter(r => r.code);
        progress.lines.done++;
    }

    // New routes first, then the oldest copies over a week old, a seventh of all routes at most
    const codes = [...new Set(Object.values(routes).flat().map(r => r.code))];
    const kept = previous?.stops ?? {};
    const age = code => now() - Date.parse(kept[code].at);
    const missing = codes.filter(code => !kept[code]);
    const old = codes.filter(code => kept[code] && age(code) > ROUTE_STOPS_MAX_AGE_MS).sort((a, b) => age(b) - age(a));
    const refresh = new Set([...missing, ...old.slice(0, Math.max(0, Math.ceil(codes.length / 7) - missing.length))]);

    const stops = {};
    progress.stops = { done: 0, total: refresh.size };
    for (const code of codes) {
        if (!refresh.has(code)) {
            stops[code] = kept[code];
            continue;
        }
        stops[code] = {
            at: new Date(now()).toISOString(),
            stops: (await ask('webGetStops', code, `route ${code}`, { none: true }))
                .map(s => ({ order: Number(s.RouteStopOrder), code: text(s.StopCode), el: text(s.StopDescr), en: text(s.StopDescrEng), lat: Number(s.StopLat), lng: Number(s.StopLng) }))
                .sort((a, b) => a.order - b.order)
                .map(({ order, ...stop }) => stop),
        };
        saved(code, stops[code]);
        progress.stops.done++;
    }

    return { network: { fetched: new Date(now()).toISOString(), lines, routes, stops }, requests };
}

// The route stops saved by a fetch that didn't finish: { code: entry }. A
// line cut short (the process stopped mid-write) is skipped.
function readProgress(file) {
    let lines;
    try { lines = readFileSync(file, 'utf8').split('\n'); } catch { return {}; }
    const stops = {};
    for (const line of lines) {
        try {
            const { code, ...entry } = JSON.parse(line);
            if (code && Array.isArray(entry.stops)) stops[code] = entry;
        } catch { /* empty or cut short */ }
    }
    return stops;
}

/**
 * The network for this build: the kept one if it's from the last
 * NETWORK_MAX_AGE_MS (or the build is offline, or has no way to ask OASA),
 * otherwise fetched now and kept. A failed fetch falls back on the kept one,
 * and the route stops it got are used by the next fetch.
 * → { network (or null: never fetched), error? }
 */
export async function liveNetwork({ rawDir, request, offline = false, now = Date.now, sleep = realSleep, log = console.log }) {
    const file = join(rawDir, 'oasa', 'network.json');
    const progressFile = join(rawDir, 'oasa', 'progress.jsonl');
    const previous = readJson(file);
    const fresh = previous && now() - Date.parse(previous.fetched) < NETWORK_MAX_AGE_MS;
    if (fresh || offline || !request) return previous ? { network: previous } : { network: null, error: 'not fetched yet' };
    const started = now();
    // What the last fetch got before it stopped counts as kept, being newer
    const savedStops = readProgress(progressFile);
    const resumed = Object.keys(savedStops).length;
    if (resumed) log(`[data] Fetching the bus network from OASA, with ${resumed} route(s) saved by the last try`);
    const kept = { ...previous, stops: { ...previous?.stops, ...savedStops } };
    mkdirSync(join(rawDir, 'oasa'), { recursive: true });
    const progress = {};
    const seconds = () => Math.round((now() - started) / 1000);
    const record = (ok, error) => writeFileAtomic(lastFetchFile(rawDir), JSON.stringify({ at: new Date(started).toISOString(), ok, seconds: seconds(), ...(error ? { error } : {}), ...progress }));
    try {
        const { network, requests } = await fetchNetwork({
            request, previous: kept, now, sleep, log, progress,
            saved: (code, entry) => appendFileSync(progressFile, `${JSON.stringify({ code, ...entry })}\n`),
        });
        writeFileAtomic(file, JSON.stringify(network));
        rmSync(progressFile, { force: true });
        record(true);
        log(`[data] Fetched the bus network from OASA: ${network.lines.length} lines, ${requests} requests in ${seconds()} s`);
        return { network };
    } catch (err) {
        record(false, err.message);
        log(`[data] Couldn't fetch the bus network from OASA (${err.message}) after ${seconds()} s; ${progress.stops?.done ?? 0} route(s) saved for the next try${previous ? ` — using the network from ${previous.fetched}` : ''}`);
        return previous ? { network: previous } : { network: null, error: err.message };
    }
}
