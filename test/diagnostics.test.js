import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { classifyError, formatReport, runDiagnostics } from '../server/diagnostics.js';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const RELAY = 'https://relay.example/';
const ENV = { CONTACT_EMAIL: 'me@example.com', OASA_RELAY_URL: RELAY, OASA_RELAY_KEY: 'k' };

const netError = code => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

// A fake internet. Each service answers normally unless overridden.
function world(overrides = {}) {
    const services = {
        internet: () => new Response('ip=203.0.113.7\nloc=GR\n'),
        oasa: () => json([{ route_code: '1', veh_code: '2', btime2: '3' }]),
        relay: (headers, url) => headers['X-Relay-Key'] !== 'k' ? new Response('Unauthorized', { status: 401 })
            : url.includes('act=whereami') ? json({ colo: 'ATH', loc: 'GR' })
                : json([]),
        portal: () => json({ success: true }),
        ...overrides,
    };
    const fetch = async (url, init = {}) => {
        const headers = init.headers ?? {};
        const pick = url.startsWith('https://www.cloudflare.com') ? 'internet'
            : url.startsWith('https://telematics.oasa.gr') ? 'oasa'
                : url.startsWith(RELAY) ? 'relay' : 'portal';
        const answer = await services[pick](headers, url);
        if (answer instanceof Error) throw answer;
        return answer;
    };
    return fetch;
}

function dataDir({ hoursAgo = 2, failed = null } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'move-diag-'));
    mkdirSync(join(dir, 'build'));
    writeFileSync(join(dir, 'build', 'meta.json'), JSON.stringify({
        generated: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
        outputs: { 'rail.json': failed ? { ok: false, error: failed, keptPrevious: true } : { ok: true, warnings: [] } },
    }));
    return dir;
}

const run = (fetch, extra = {}) => runDiagnostics({
    env: ENV, dataDir: dataDir(), fetch, dnsLookup: async () => ({ address: '192.0.2.1' }), now: () => NOW, nodeVersion: 'v20.20.2', ...extra,
});

test('classifyError names the usual network failures', () => {
    assert.equal(classifyError(netError('ENOTFOUND')), 'dns');
    assert.equal(classifyError(netError('ECONNREFUSED')), 'refused');
    assert.equal(classifyError(netError('ECONNRESET')), 'reset');
    assert.equal(classifyError(netError('UND_ERR_CONNECT_TIMEOUT')), 'timeout');
    assert.equal(classifyError(netError('CERT_HAS_EXPIRED')), 'tls');
    assert.equal(classifyError(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
});

test('all healthy', async () => {
    const r = await run(world());
    assert.equal(r.summary.status, 'ok');
    assert.ok(r.checks.find(c => c.title === 'Internet access').detail.includes('203.0.113.7'));
    assert.ok(r.checks.filter(c => c.group !== 'Running app').every(c => c.status === 'ok'));
});

test('OASA blocks this server but the relay works', async () => {
    const r = await run(world({ oasa: () => new Response('<html>Forbidden</html>', { status: 403 }) }));
    assert.equal(r.summary.status, 'warn');
    assert.match(r.summary.text, /relay works.*blocked the server \(this server's public IP is 203\.0\.113\.7\)/);
    assert.match(r.checks.find(c => c.title.startsWith('OASA live API')).detail, /403.*blocked/);
});

test('OASA answers with a non-API page', async () => {
    const r = await run(world({ oasa: () => new Response('<html>Maintenance</html>') }));
    assert.match(r.checks.find(c => c.title.startsWith('OASA live API')).detail, /not with API data.*Maintenance/);
});

test('OASA is down for everyone', async () => {
    const r = await run(world({
        oasa: () => netError('UND_ERR_CONNECT_TIMEOUT'),
        relay: h => (h['X-Relay-Key'] ? new Response('Upstream error: timeout', { status: 502 }) : new Response('Unauthorized', { status: 401 })),
    }));
    assert.equal(r.summary.status, 'fail');
    assert.match(r.summary.text, /OASA itself is most likely down/);
});

test('wrong relay key', async () => {
    const r = await run(world({ oasa: () => netError('ECONNRESET') }), { env: { ...ENV, OASA_RELAY_KEY: 'wrong' } });
    assert.match(r.summary.text, /relay is misconfigured: The Worker rejects the key/);
});

test('no relay configured and OASA unreachable', async () => {
    const r = await run(world({ oasa: () => netError('ECONNRESET') }), { env: { CONTACT_EMAIL: 'x' } });
    assert.equal(r.summary.status, 'fail');
    assert.match(r.summary.text, /no relay, so live times are down/);
    assert.equal(r.checks.find(c => c.title === 'Relay fallback').status, 'warn');
});

test('no internet at all', async () => {
    const r = await run(world({ internet: () => netError('ENETUNREACH'), oasa: () => netError('ENETUNREACH'), relay: () => netError('ENETUNREACH'), portal: () => netError('ENETUNREACH') }),
        { dnsLookup: async () => { throw Object.assign(new Error('x'), { code: 'EAI_AGAIN' }); } });
    assert.match(r.summary.text, /can't reach the internet at all.*contact Mediahost/);
});

test('data and running-app problems are reported', async () => {
    const appStatus = {
        at: NOW - 30_000,
        routes: [{ name: 'direct', resting: true, restUntil: NOW + 300_000, failuresInARow: 0, lastOk: NOW - 900_000, lastError: { at: NOW - 60_000, message: 'HTTP 403' } }],
    };
    const r = await run(world(), { dataDir: dataDir({ hoursAgo: 72, failed: 'feed changed' }), appStatus });
    const find = t => r.checks.find(c => c.title.startsWith(t));
    assert.equal(find('Last data build').status, 'warn');
    assert.match(find('rail.json').detail, /feed changed.*previous version is still served/);
    assert.match(find('Route: direct').detail, /Resting until 12:05 UTC.*HTTP 403/);
    // OASA answers now, but the app hasn't noticed yet
    assert.match(r.summary.text, /reachable again.*within 10 minutes/);
});

test('formatReport lists the summary, every check and its hint', async () => {
    const text = formatReport(await run(world(), { env: {} }));
    assert.match(text, /^Move diagnostics, 2026-10-03T12:00:00\.000Z\n\n\[ OK \]/);
    assert.match(text, /\[WARN\] Contact email: CONTACT_EMAIL is not set\n {9}→ Set it in \.env/);
});

// What actually happened on the German server in October 2026
test('server abroad and relay running abroad: the geo-block is named', async () => {
    const r = await run(world({
        internet: () => new Response('ip=157.90.210.32\nloc=DE\n'),
        oasa: () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
        relay: (h, url) => h['X-Relay-Key'] !== 'k' ? new Response('Unauthorized', { status: 401 })
            : url.includes('act=whereami') ? json({ colo: 'FRA', loc: 'DE' })
                : new Response('Upstream error: The operation was aborted due to timeout', { status: 502 }),
    }));
    assert.equal(r.summary.status, 'fail');
    assert.match(r.summary.text, /only accepts connections from Greece\. This server is in DE and the relay runs in FRA \(DE\)/);
    assert.match(r.checks.find(c => c.title.startsWith('OASA live API')).detail, /only accepts connections from Greece, and this server is in DE/);
    assert.equal(r.checks.find(c => c.title === 'Relay location').status, 'warn');
});

test('server abroad but relay in Greece: working as intended', async () => {
    const r = await run(world({
        internet: () => new Response('ip=157.90.210.32\nloc=DE\n'),
        oasa: () => Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    }));
    assert.equal(r.summary.status, 'ok');
    assert.match(r.summary.text, /through the relay \(ATH, GR\)\. Working as intended/);
    assert.equal(r.checks.find(c => c.title === 'Relay location').detail, 'Its requests leave Cloudflare from ATH (GR)');
});

test('an older Worker without whereami is reported, not treated as a failure', async () => {
    const r = await run(world({
        relay: (h, url) => h['X-Relay-Key'] !== 'k' ? new Response('Unauthorized', { status: 401 })
            : url.includes('act=whereami') ? new Response('Bad request', { status: 400 }) : json([]),
    }));
    assert.equal(r.summary.status, 'ok');
    assert.equal(r.checks.find(c => c.title === 'Relay location').status, 'info');
});
