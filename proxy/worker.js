// Cloudflare Worker that relays OASA telematics requests for Wayhop's server.
// The server only uses it when it can't reach OASA directly (e.g. its shared
// hosting IP is blocked). It is deliberately narrow so it can't be used as an
// open proxy: a shared secret is required, and only the API calls the app
// needs, with numeric codes, are passed on: a stop's arrivals and routes for
// the live times, and the lines, a line's routes and a route's stops for the
// nightly data build (webGetLines takes no code).
//
// Request:  GET https://<worker>/?act=getStopArrivals&p1=10361
//           X-Relay-Key: <RELAY_KEY>
// Response: OASA's response body and status, unchanged.
//
// GET /?act=whereami (with the key) reports where the Worker's own outgoing
// requests come from. OASA's live API only accepts connections from Greece,
// so this should say loc=GR; the diagnostics page shows it.
//
// GET /?act=version (with the key) answers { version: RELAY_VERSION }, so the
// server's health check can tell a relay that runs older code (a relay from
// before versions answers 400).
//
// GET /?act=stasyPage&path=<one path segment> relays a page of www.stasy.gr
// (its news page and its posts, for the announcements): STASY refuses the
// server's data-centre address too. Only single-segment paths on that one
// site are allowed.
//
// GET /?act=stasyTimetable&line=<1, 2 or 3> relays STASY's timetable page for
// that metro line, in Greek (its first and last trains, for the nightly data
// build). Only those three pages.

// Bump with every change a deployed relay needs (proxy/README.md): the
// server's health check reports relays that answer an older version
export const RELAY_VERSION = 4;

const OASA_API = 'https://telematics.oasa.gr/api/';
// Each action the relay passes on, and whether it takes a numeric code (p1)
const ALLOWED_ACTIONS = new Map([
    ['getStopArrivals', true], ['webRoutesForStop', true],
    ['webGetLines', false], ['webGetRoutes', true], ['webGetStops', true],
]);
const STASY = 'https://www.stasy.gr/';
// One path segment, as STASY's links have it (percent-encoded Greek allowed)
const STASY_PATH = /^[A-Za-z0-9%_-][A-Za-z0-9%_.-]{0,299}$/;
// STASY's timetable page for metro line N: /δρομολόγια/γραμμή-N/
export const stasyTimetablePath = line => `%ce%b4%cf%81%ce%bf%ce%bc%ce%bf%ce%bb%cf%8c%ce%b3%ce%b9%ce%b1/%ce%b3%cf%81%ce%b1%ce%bc%ce%bc%ce%ae-${line}/`;
// STASY's news page is large and slow; the server waits longer for it (25 s)
const STASY_TIMEOUT_MS = 20_000;
// Shorter than the server's 8 s timeout, so a failure to reach OASA is
// reported back as a 502 before the server gives up on the relay
const TIMEOUT_MS = 6000;

export default {
    async fetch(request, env) {
        if (request.method !== 'GET') return text(405, 'Method not allowed');
        if (!env.RELAY_KEY || !(await sameSecret(request.headers.get('X-Relay-Key') ?? '', env.RELAY_KEY))) {
            return text(401, 'Unauthorized');
        }

        const params = new URL(request.url).searchParams;
        const act = params.get('act') ?? '';
        const p1 = params.get('p1') ?? '';
        if (act === 'version') {
            return new Response(JSON.stringify({ version: RELAY_VERSION }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }
        if (act === 'whereami') return whereAmI(request);
        if (act === 'stasyPage') return stasyPage(request, params.get('path') ?? '');
        if (act === 'stasyTimetable') return stasyTimetable(request, params.get('line') ?? '');
        if (!ALLOWED_ACTIONS.has(act) || (ALLOWED_ACTIONS.get(act) ? !/^\d{1,8}$/.test(p1) : p1 !== '')) return text(400, 'Bad request');

        try {
            const upstream = await fetch(`${OASA_API}?act=${act}${p1 ? `&p1=${p1}` : ''}`, {
                headers: {
                    'User-Agent': request.headers.get('User-Agent') ?? 'Wayhop relay',
                    Accept: 'application/json',
                },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            return new Response(upstream.body, {
                status: upstream.status,
                headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
            });
        } catch (err) {
            return text(502, `Upstream error: ${err.message}`);
        }
    },
};

async function stasyPage(request, path) {
    if (!STASY_PATH.test(path) || path.includes('..')) return text(400, 'Bad request');
    return stasyFetch(request, `${STASY}${path}/`);
}

async function stasyTimetable(request, line) {
    if (!['1', '2', '3'].includes(line)) return text(400, 'Bad request');
    return stasyFetch(request, `${STASY}${stasyTimetablePath(line)}`);
}

async function stasyFetch(request, url) {
    try {
        const upstream = await fetch(url, {
            headers: { 'User-Agent': request.headers.get('User-Agent') ?? 'Wayhop relay', Accept: 'text/html' },
            signal: AbortSignal.timeout(STASY_TIMEOUT_MS),
        });
        return new Response(upstream.body, {
            status: upstream.status,
            headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'text/html', 'Cache-Control': 'no-store' },
        });
    } catch (err) {
        return text(502, `Upstream error: ${err.message}`);
    }
}

function text(status, body) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

// Where requests leave Cloudflare from when this Worker fetches something:
// Cloudflare's trace endpoint reports the data centre (colo) and country (loc)
async function whereAmI(request) {
    const out = { receivedAt: request.cf?.colo ?? null };
    try {
        const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(TIMEOUT_MS) })).text();
        const fields = Object.fromEntries(trace.trim().split('\n').map(l => l.split('=')));
        Object.assign(out, { colo: fields.colo ?? null, loc: fields.loc ?? null, ip: fields.ip ?? null });
    } catch (err) {
        out.error = err.message;
    }
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// Compare secrets without leaking their length or contents through timing
async function sameSecret(a, b) {
    const enc = new TextEncoder();
    const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
    const x = new Uint8Array(ha);
    const y = new Uint8Array(hb);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}
