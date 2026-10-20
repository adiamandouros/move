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
// A failed request stops the fetch: the build keeps the last network (and the
// files built from it) until the next night.
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

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const list = (body, what) => {
    if (!Array.isArray(body)) throw new Error(`OASA answered ${JSON.stringify(body)?.slice(0, 80)} for ${what}`);
    return body;
};

/**
 * Fetch the network, reusing `previous` route stops that are fresh enough.
 * request(act, p1): one call to OASA's API (server/oasa/client.js) → parsed JSON
 * @returns {Promise<{ network: any, requests: number }>}
 */
export async function fetchNetwork({ request, previous = null, now = Date.now, sleep = realSleep }) {
    let requests = 0;
    const ask = async (act, p1 = '') => {
        if (requests++) await sleep(PACE_MS);
        return request(act, p1);
    };

    const lines = list(await ask('webGetLines'), 'the lines').map(l => ({
        code: text(l.LineCode), line: text(l.LineID), name: { el: text(l.LineDescr), en: text(l.LineDescrEng) },
    })).filter(l => l.code && l.line);

    const routes = {};
    for (const l of lines) {
        // null: a line with no routes today
        routes[l.code] = list(await ask('webGetRoutes', l.code) ?? [], `line ${l.line}`).map(r => ({
            code: text(r.RouteCode), type: text(r.RouteType), name: { el: text(r.RouteDescr), en: text(r.RouteDescrEng) },
        })).filter(r => r.code);
    }

    // New routes first, then the oldest copies over a week old, a seventh of all routes at most
    const codes = [...new Set(Object.values(routes).flat().map(r => r.code))];
    const kept = previous?.stops ?? {};
    const age = code => now() - Date.parse(kept[code].at);
    const missing = codes.filter(code => !kept[code]);
    const old = codes.filter(code => kept[code] && age(code) > ROUTE_STOPS_MAX_AGE_MS).sort((a, b) => age(b) - age(a));
    const refresh = new Set([...missing, ...old.slice(0, Math.max(0, Math.ceil(codes.length / 7) - missing.length))]);

    const stops = {};
    for (const code of codes) {
        if (!refresh.has(code)) {
            stops[code] = kept[code];
            continue;
        }
        stops[code] = {
            at: new Date(now()).toISOString(),
            stops: list(await ask('webGetStops', code) ?? [], `route ${code}`)
                .map(s => ({ order: Number(s.RouteStopOrder), code: text(s.StopCode), el: text(s.StopDescr), en: text(s.StopDescrEng), lat: Number(s.StopLat), lng: Number(s.StopLng) }))
                .sort((a, b) => a.order - b.order)
                .map(({ order, ...stop }) => stop),
        };
    }

    return { network: { fetched: new Date(now()).toISOString(), lines, routes, stops }, requests };
}

/**
 * The network for this build: the kept one if it's from the last
 * NETWORK_MAX_AGE_MS (or the build is offline, or has no way to ask OASA),
 * otherwise fetched now and kept. A failed fetch falls back on the kept one.
 * → { network (or null: never fetched), error? }
 */
export async function liveNetwork({ rawDir, request, offline = false, now = Date.now, sleep = realSleep, log = console.log }) {
    const file = join(rawDir, 'oasa', 'network.json');
    const previous = readJson(file);
    const fresh = previous && now() - Date.parse(previous.fetched) < NETWORK_MAX_AGE_MS;
    if (fresh || offline || !request) return previous ? { network: previous } : { network: null, error: 'not fetched yet' };
    const started = now();
    try {
        const { network, requests } = await fetchNetwork({ request, previous, now, sleep });
        writeFileAtomic(file, JSON.stringify(network));
        log(`[data] Fetched the bus network from OASA: ${network.lines.length} lines, ${requests} requests in ${Math.round((now() - started) / 1000)} s`);
        return { network };
    } catch (err) {
        log(`[data] Couldn't fetch the bus network from OASA (${err.message})${previous ? ` — using the one from ${previous.fetched}` : ''}`);
        return previous ? { network: previous } : { network: null, error: err.message };
    }
}
