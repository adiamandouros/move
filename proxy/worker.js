// Cloudflare Worker that relays OASA telematics requests for Move's server.
// The server only uses it when it can't reach OASA directly (e.g. its shared
// hosting IP is blocked). It is deliberately narrow so it can't be used as an
// open proxy: a shared secret is required, and only the API calls the app
// needs, with numeric stop codes, are passed on.
//
// Request:  GET https://<worker>/?act=getStopArrivals&p1=10361
//           X-Relay-Key: <RELAY_KEY>
// Response: OASA's response body and status, unchanged.

const OASA_API = 'https://telematics.oasa.gr/api/';
const ALLOWED_ACTIONS = new Set(['getStopArrivals', 'webRoutesForStop']);
const TIMEOUT_MS = 8000;

export default {
    async fetch(request, env) {
        if (request.method !== 'GET') return text(405, 'Method not allowed');
        if (!env.RELAY_KEY || !(await sameSecret(request.headers.get('X-Relay-Key') ?? '', env.RELAY_KEY))) {
            return text(401, 'Unauthorized');
        }

        const params = new URL(request.url).searchParams;
        const act = params.get('act') ?? '';
        const p1 = params.get('p1') ?? '';
        if (!ALLOWED_ACTIONS.has(act) || !/^\d{1,8}$/.test(p1)) return text(400, 'Bad request');

        try {
            const upstream = await fetch(`${OASA_API}?act=${act}&p1=${p1}`, {
                headers: {
                    'User-Agent': request.headers.get('User-Agent') ?? 'Move relay',
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

function text(status, body) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
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
