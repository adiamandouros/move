import { lookup } from 'dns/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { USER_AGENT } from './data/sources.js';

// Health checks for when something goes wrong on the server: can it reach the
// internet, OASA, the relay and the open-data portal, is the timetable data
// fresh, and what does the running app see. Every failure comes with what it
// most likely means and what to do. Used by /admin/diagnostics and
// `npm run diagnose` (scripts/diagnose.js).

const OASA_API = 'https://telematics.oasa.gr/api/';
const PORTAL = 'https://catalog.growthfund.gr/api/3/action/package_show?id=dromologia-statheron-sygkinonion';
const INTERNET = 'https://www.cloudflare.com/cdn-cgi/trace';
// Syntagma: a busy stop, so a working API answers with real data
const TEST_STOP = '10361';
const TIMEOUT_MS = 8_000;
// Longer than the Worker's own 6 s limit on OASA, so its "can't reach OASA" answer arrives
const RELAY_TIMEOUT_MS = 12_000;
const MIN_NODE = 20;

// ── Probing ─────────────────────────────────────────────────────────────────

// Why a request failed, in a word: dns | refused | timeout | reset | tls | network
export function classifyError(err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
    const code = err?.cause?.code ?? err?.code ?? '';
    if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME'].includes(code)) return 'dns';
    if (code === 'ECONNREFUSED') return 'refused';
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code)) return 'timeout';
    if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return 'reset';
    if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return 'tls';
    return 'network';
}

const WHY = {
    dns: 'the server could not look up the address (DNS)',
    refused: 'the connection was refused',
    timeout: `no answer within ${TIMEOUT_MS / 1000} s, often a firewall silently dropping traffic, or the service being down`,
    reset: 'the connection was cut off, often a sign of blocking',
    tls: 'the secure (HTTPS) connection failed: a certificate problem, something intercepting traffic, or a wrong server clock',
    network: 'a network error',
};

function describeHttp(status) {
    if (status === 401) return 'HTTP 401 (not authorised)';
    if (status === 403) return 'HTTP 403 (forbidden), typical when an IP address is blocked';
    if (status === 404) return 'HTTP 404 (not found), wrong address';
    if (status === 429) return 'HTTP 429 (too many requests), rate-limited';
    if (status >= 500) return `HTTP ${status}, the service itself has a problem`;
    return `HTTP ${status}`;
}

// → { ok, status, ms, text, json, kind, reason }
async function probe(fetch, url, headers = {}, timeoutMs = TIMEOUT_MS) {
    const started = Date.now();
    try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        return { ok: res.ok, status: res.status, ms: Date.now() - started, text, json };
    } catch (err) {
        const kind = classifyError(err);
        return { ok: false, status: null, ms: Date.now() - started, kind, reason: `${WHY[kind]} (${err.cause?.code ?? err.message})` };
    }
}

const isApiAnswer = p => p.ok && (Array.isArray(p.json) || p.json === null);
const failureText = p => p.status === null ? p.reason
    : p.ok ? `answered, but not with API data. Got: ${p.text.slice(0, 80).replace(/\s+/g, ' ')}… (maybe a block or maintenance page)`
    : describeHttp(p.status);

// ── Checks ──────────────────────────────────────────────────────────────────

const check = (group, title, status, detail, hint) => ({ group, title, status, detail, ...(hint ? { hint } : {}) });

function configChecks(env, nodeVersion) {
    const major = Number(nodeVersion.replace(/^v/, '').split('.')[0]);
    const relayUrl = env.OASA_RELAY_URL;
    const relayKey = env.OASA_RELAY_KEY;
    return [
        major >= MIN_NODE
            ? check('Configuration', 'Node.js version', 'ok', nodeVersion)
            : check('Configuration', 'Node.js version', 'fail', `${nodeVersion} is too old`, `Select Node.js ${MIN_NODE} or newer in cPanel → Setup Node.js App.`),
        env.CONTACT_EMAIL
            ? check('Configuration', 'Contact email', 'ok', `Sent to OASA as ${env.CONTACT_EMAIL}`)
            : check('Configuration', 'Contact email', 'warn', 'CONTACT_EMAIL is not set', 'Set it in .env so OASA can contact you instead of blocking the server.'),
        relayUrl && relayKey
            ? check('Configuration', 'Relay fallback', 'ok', `Configured: ${safeHost(relayUrl)}`)
            : relayUrl || relayKey
                ? check('Configuration', 'Relay fallback', 'fail', `Only ${relayUrl ? 'OASA_RELAY_URL' : 'OASA_RELAY_KEY'} is set, so the relay is disabled`, 'Set both OASA_RELAY_URL and OASA_RELAY_KEY in .env, then restart the app.')
                : check('Configuration', 'Relay fallback', 'warn', 'Not configured: if OASA blocks this server, live times stop', 'See proxy/README.md to set up the Cloudflare Worker.'),
    ];
}

function safeHost(url) {
    try { return new URL(url).host; } catch { return `invalid URL "${url}"`; }
}

async function dnsCheck(dnsLookup, host) {
    try {
        const { address } = await dnsLookup(host);
        return check('DNS', host, 'ok', address);
    } catch (err) {
        return check('DNS', host, 'fail', `Can't look up ${host} (${err.code ?? err.message})`);
    }
}

async function internetCheck(fetch) {
    const p = await probe(fetch, INTERNET);
    if (!p.ok) return { result: check('Network', 'Internet access', 'fail', `Can't reach cloudflare.com: ${failureText(p)}`), ip: null, loc: null };
    const fields = Object.fromEntries(p.text.split('\n').map(l => l.split('=')));
    return { result: check('Network', 'Internet access', 'ok', `Public IP ${fields.ip ?? '?'}${fields.loc ? ` (${fields.loc})` : ''}, ${p.ms} ms`), ip: fields.ip ?? null, loc: fields.loc ?? null };
}

// OASA's live API silently drops connections from outside Greece (checked
// from 8 countries in October 2026), so a timeout from abroad means the geo-block
const GEO_BLOCK = 'OASA\'s live API only accepts connections from Greece';

const probeOasa = fetch => probe(fetch, `${OASA_API}?act=getStopArrivals&p1=${TEST_STOP}`);

// Interpreted once the server's country is known (from the internet check)
function oasaCheck(p, serverCountry) {
    if (isApiAnswer(p)) return { result: check('Services', 'OASA live API (direct)', 'ok', `${describeArrivals(p.json)}, ${p.ms} ms`), probe: p };
    const geo = p.kind === 'timeout' && Boolean(serverCountry) && serverCountry !== 'GR';
    return {
        result: check('Services', 'OASA live API (direct)', 'fail', geo ? `${failureText(p)}. ${GEO_BLOCK}, and this server is in ${serverCountry}` : failureText(p)),
        probe: p,
        geo,
    };
}

const describeArrivals = json => Array.isArray(json) ? `${json.length} arrivals at the test stop` : 'answered (no buses due at the test stop)';

async function relayChecks(fetch, env) {
    if (!env.OASA_RELAY_URL || !env.OASA_RELAY_KEY) return { results: [], keyed: null, info: null };
    const url = `${env.OASA_RELAY_URL}?act=getStopArrivals&p1=${TEST_STOP}`;
    const key = { 'X-Relay-Key': env.OASA_RELAY_KEY };
    const [anon, keyed, where] = await Promise.all([
        probe(fetch, url),
        probe(fetch, url, key, RELAY_TIMEOUT_MS),
        probe(fetch, `${env.OASA_RELAY_URL}?act=whereami`, key),
    ]);
    const location = where.ok && where.json?.loc ? where.json : null;

    let info = null;
    let result;
    if (isApiAnswer(keyed)) {
        result = check('Services', 'Relay with your key', 'ok', `${describeArrivals(keyed.json)}, ${keyed.ms} ms`);
    } else if (keyed.status === 401) {
        info = 'key';
        result = check('Services', 'Relay with your key', 'fail', 'The Worker rejects the key',
            'OASA_RELAY_KEY in .env must equal the Worker\'s RELAY_KEY secret. Set them to the same value (proxy/README.md, "Changing the key") and restart the app.');
    } else if (keyed.status === 400) {
        info = 'old-worker';
        result = check('Services', 'Relay with your key', 'fail', 'The Worker refused the request as invalid', 'The deployed Worker may be outdated. Redeploy proxy/worker.js.');
    } else if (keyed.status === 404 || anon.status === 404) {
        info = 'url';
        result = check('Services', 'Relay with your key', 'fail', describeHttp(404), 'Check OASA_RELAY_URL in .env against the Worker\'s address in the Cloudflare dashboard.');
    } else if (keyed.status === 502 || (keyed.status >= 400 && /Upstream error/.test(keyed.text ?? ''))) {
        info = 'oasa-from-cloudflare';
        result = check('Services', 'Relay with your key', 'fail', `The Worker is fine but can't reach OASA either: ${keyed.text?.slice(0, 120)}`);
    } else if (keyed.ok) {
        result = check('Services', 'Relay with your key', 'fail', `Relayed, but OASA's answer isn't API data: ${failureText(keyed)}`);
        info = 'oasa-from-cloudflare';
    } else {
        result = check('Services', 'Relay with your key', 'fail', failureText(keyed));
    }

    const place = location
        ? (location.loc === 'GR'
            ? check('Services', 'Relay location', 'ok', `Its requests leave Cloudflare from ${location.colo} (GR)`)
            : check('Services', 'Relay location', 'warn', `Its requests leave Cloudflare from ${location.colo} (${location.loc}), outside Greece, where OASA's live API blocks connections`,
                'The Worker needs to run in Greece (Cloudflare\'s ATH or SKG). See proxy/README.md, "If OASA blocks the relay too".'))
        : where.status === 400
            ? check('Services', 'Relay location', 'info', 'Unknown: the deployed Worker is older than this check', 'Redeploy proxy/worker.js to see where it runs.')
            : null;

    const guard = anon.status === 401
        ? check('Services', 'Relay without a key', 'ok', 'Refused (401), so strangers can\'t use it')
        : anon.status === null
            ? check('Services', 'Relay without a key', 'fail', failureText(anon))
            : check('Services', 'Relay without a key', 'warn', `Expected 401, got ${describeHttp(anon.status)}`, 'If this isn\'t your Worker, check OASA_RELAY_URL.');
    return { results: [guard, result, ...(place ? [place] : [])], keyed, anon, info, location };
}

async function portalCheck(fetch) {
    const p = await probe(fetch, PORTAL);
    return p.ok && p.json?.success
        ? check('Services', 'OASA open-data portal (timetables)', 'ok', `${p.ms} ms`)
        : check('Services', 'OASA open-data portal (timetables)', 'warn', `${failureText(p)}. Timetable updates can't be downloaded; the last downloaded data keeps being used.`);
}

function dataChecks(dataDir, now) {
    const out = [];
    const meta = readJson(join(dataDir, 'build', 'meta.json'));
    if (!meta) {
        out.push(check('Data', 'Timetable data', 'fail', 'Never built (data/build/meta.json is missing)', 'It builds automatically on app start. Check the app log for "[data]" errors, or run "npm run build:data".'));
    } else {
        const hours = Math.round((now() - Date.parse(meta.generated)) / 3_600_000);
        out.push(check('Data', 'Last data build', hours > 48 ? 'warn' : 'ok', `${meta.generated.slice(0, 16).replace('T', ' ')} UTC (${hours} h ago)`,
            hours > 48 ? 'Builds run daily at 04:30 and on app start. Is the app running? Check the log for "[data]" lines.' : undefined));
        for (const [name, o] of Object.entries(meta.outputs ?? {})) {
            if (!o.ok) out.push(check('Data', name, 'fail', `Last build failed: ${o.error}${o.keptPrevious ? ' (the previous version is still served)' : ''}`));
            for (const w of (o.warnings ?? []).filter(w => /expired/i.test(w))) out.push(check('Data', name, 'info', w));
        }
    }
    const lock = join(dataDir, '.build.lock');
    if (existsSync(lock)) out.push(check('Data', 'Build lock', 'info', `A build is running or was interrupted (process ${readFileSync(lock, 'utf8').trim()})`));
    return out;
}

function appChecks(appStatus, now) {
    if (!appStatus) {
        return [check('Running app', 'Live status', 'warn', 'No status from the running app', 'The app writes data/cache/oasa-status.json every minute. If it\'s missing, the app may not be running. Check cPanel → Setup Node.js App.')];
    }
    const age = Math.round((now() - appStatus.at) / 1000);
    const out = [];
    if (age > 180) out.push(check('Running app', 'Live status', 'warn', `Last reported ${Math.round(age / 60)} min ago`, 'The app may have stopped. Restart it in cPanel → Setup Node.js App.'));
    const ago = t => t ? `${Math.round((now() - t) / 60_000)} min ago` : 'never';
    for (const r of appStatus.routes) {
        const parts = [`last success ${ago(r.lastOk)}`];
        if (r.lastError) parts.push(`last error ${ago(r.lastError.at)}: ${r.lastError.message}`);
        out.push(r.resting
            ? check('Running app', `Route: ${r.name}`, 'warn', `Resting until ${new Date(r.restUntil).toISOString().slice(11, 16)} UTC after repeated failures; ${parts.join('; ')}`)
            : check('Running app', `Route: ${r.name}`, r.lastError && (!r.lastOk || r.lastError.at > r.lastOk) ? 'warn' : 'ok', parts.join('; ')));
    }
    return out;
}

// ── Verdict ─────────────────────────────────────────────────────────────────

function verdict({ internet, ip, loc, dns, oasa, relay, relayConfigured, appStatus }) {
    const ipText = ip ? ` (this server's public IP is ${ip})` : '';
    const abroad = relay.location && relay.location.loc !== 'GR';
    const directResting = appStatus?.routes.find(r => r.name === 'direct')?.resting;

    if (internet.status === 'fail' && oasa.probe.status === null && (!relayConfigured || relay.keyed?.status === null)) {
        return { status: 'fail', text: 'The server can\'t reach the internet at all. Nothing in the app can fix this: contact Mediahost support and send them this report.' };
    }
    if (dns.every(d => d.status === 'fail')) {
        return { status: 'fail', text: 'DNS isn\'t working on the server: it can\'t look up any address. Contact Mediahost support.' };
    }
    if (oasa.result.status === 'ok') {
        if (directResting) return { status: 'warn', text: 'OASA is reachable again. The app is still resting direct access after earlier failures and will try it again on its own within 10 minutes (or restart the app to try now).' };
        return { status: 'ok', text: 'Everything needed for live bus times is working.' };
    }
    if (!relayConfigured) {
        if (oasa.geo) return { status: 'fail', text: `${GEO_BLOCK}, and this server is in ${loc}, so live times are down. Set up the relay (proxy/README.md) so requests reach OASA from Greece.` };
        return { status: 'fail', text: `OASA can't be reached from this server and there is no relay, so live times are down. Reason: ${oasa.result.detail}. If OASA blocked the server${ipText}, set up the relay (proxy/README.md) and contact OASA.` };
    }
    if (relay.result?.status === 'ok' && oasa.geo) {
        return { status: 'ok', text: `${GEO_BLOCK} and this server is in ${loc}, so live times go through the relay${relay.location ? ` (${relay.location.colo}, GR)` : ''}. Working as intended.` };
    }
    if (relay.result?.status === 'ok') {
        return { status: 'warn', text: `OASA can't be reached directly from this server (${oasa.result.detail}), but the relay works, so the site keeps working. If this lasts, OASA has probably blocked the server${ipText}: contact OASA, or Mediahost if they block outgoing traffic.` };
    }
    if (relay.info === 'oasa-from-cloudflare' && abroad) {
        return { status: 'fail', text: `${GEO_BLOCK}. This server is in ${loc ?? 'another country'} and the relay runs in ${relay.location.colo} (${relay.location.loc}), so OASA blocks both and live times are down. The relay has to reach OASA from Greece: see proxy/README.md, "If OASA blocks the relay too".` };
    }
    if (relay.info === 'oasa-from-cloudflare') {
        return { status: 'fail', text: 'OASA is unreachable both from this server and from Cloudflare, so OASA itself is most likely down. Nothing to fix on our side; live times return when it does.' };
    }
    if (relay.info === 'key' || relay.info === 'url' || relay.info === 'old-worker') {
        return { status: 'fail', text: `OASA can't be reached directly (${oasa.result.detail}), and the relay is misconfigured: ${relay.result.detail}. ${relay.result.hint}` };
    }
    return { status: 'fail', text: `Neither OASA (${oasa.result.detail}) nor the relay (${relay.result?.detail}) can be reached from this server. If the internet check passed, outgoing traffic to them may be blocked: contact Mediahost with this report.` };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runDiagnostics({
    env = process.env,
    dataDir,
    appStatus = null,
    fetch = globalThis.fetch,
    dnsLookup = lookup,
    now = Date.now,
    nodeVersion = process.version,
} = {}) {
    const hosts = ['telematics.oasa.gr', 'catalog.growthfund.gr'];
    if (env.OASA_RELAY_URL) { try { hosts.push(new URL(env.OASA_RELAY_URL).hostname); } catch { /* reported by the config check */ } }

    const [internet, dns, oasaProbe, relay, portal] = await Promise.all([
        internetCheck(fetch),
        Promise.all(hosts.map(h => dnsCheck(dnsLookup, h))),
        probeOasa(fetch),
        relayChecks(fetch, env),
        portalCheck(fetch),
    ]);
    const oasa = oasaCheck(oasaProbe, internet.loc);

    const checks = [
        ...configChecks(env, nodeVersion),
        internet.result,
        ...dns,
        oasa.result,
        ...relay.results,
        portal,
        ...dataChecks(dataDir, now),
        ...appChecks(appStatus, now),
    ];
    const summary = verdict({
        internet: internet.result,
        ip: internet.ip,
        loc: internet.loc,
        dns,
        oasa,
        relay: { ...relay, result: relay.results[1] },
        relayConfigured: Boolean(env.OASA_RELAY_URL && env.OASA_RELAY_KEY),
        appStatus,
    });
    return { ranAt: new Date(now()).toISOString(), summary, checks };
}

// Plain-text report, for the terminal and for copying from the admin page
export function formatReport({ ranAt, summary, checks }) {
    const mark = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[INFO]' };
    const lines = [`Move diagnostics, ${ranAt}`, '', `${mark[summary.status]} ${summary.text}`];
    let group = '';
    for (const c of checks) {
        if (c.group !== group) { group = c.group; lines.push('', `${group}:`); }
        lines.push(`  ${mark[c.status]} ${c.title}: ${c.detail}`);
        if (c.hint) lines.push(`         → ${c.hint}`);
    }
    return lines.join('\n');
}

function readJson(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
