import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../server/config.js';
import { classifyError, formatReport, runDiagnostics } from '../server/diagnostics.js';
import { browserModule } from './support/browser-modules.js';

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

// lastFetch: data/raw/oasa/last-fetch.json (server/data/oasa-network.js)
// stasy: STASY's last fetch (server/data/stasy.js) and the date of the copy rail.json uses
const STASY_OK = { last: { at: '2026-10-01T02:30:00.000Z', ok: true, route: 'home relay' }, fetched: '2026-10-01', warnings: [] };

function dataDir({ hoursAgo = 2, failed = null, lastFetch = null, stasy = STASY_OK } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'move-diag-'));
    mkdirSync(join(dir, 'build'));
    if (lastFetch) {
        mkdirSync(join(dir, 'raw', 'oasa'), { recursive: true });
        writeFileSync(join(dir, 'raw', 'oasa', 'last-fetch.json'), JSON.stringify(lastFetch));
    }
    if (stasy.last) {
        mkdirSync(join(dir, 'raw', 'stasy'), { recursive: true });
        writeFileSync(join(dir, 'raw', 'stasy', 'last-fetch.json'), JSON.stringify(stasy.last));
    }
    writeFileSync(join(dir, 'build', 'rail.json'), JSON.stringify(stasy.fetched ? { hours: { fetched: stasy.fetched } } : {}));
    writeFileSync(join(dir, 'build', 'meta.json'), JSON.stringify({
        generated: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
        outputs: { 'rail.json': failed ? { ok: false, error: failed, keptPrevious: true } : { ok: true, warnings: stasy.warnings ?? [] } },
    }));
    return dir;
}

// extra.env: the settings, as in .env (ENV unless given)
const run = (fetch, { env = ENV, ...extra } = {}) => runDiagnostics({
    config: loadConfig(env), dataDir: dataDir(), fetch, dnsLookup: async () => ({ address: '192.0.2.1' }), now: () => NOW, nodeVersion: 'v20.20.2', ...extra,
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
    assert.match(r.summary.text, /relay is misconfigured: The relay rejects the key/);
});

test('no relay configured and OASA unreachable', async () => {
    const r = await run(world({ oasa: () => netError('ECONNRESET') }), { env: { CONTACT_EMAIL: 'me@example.com' } });
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
    assert.match(find('Route: direct').detail, /Resting until 2026-10-03 12:05 UTC.*HTTP 403/);
    // OASA answers now, but the app hasn't noticed yet
    assert.match(r.summary.text, /reachable again.*within a day/);
});

test('requests over the OASA budget or over a visitor\'s limit are reported', async () => {
    const find = (r, t) => r.checks.find(c => c.title === t);
    const quiet = await run(world(), { appStatus: { at: NOW, droppedLastHour: 0, limitedLastHour: 0, routes: [] } });
    assert.equal(find(quiet, 'Request budget').status, 'ok');
    assert.equal(find(quiet, 'Visitor limit'), undefined);

    const busy = await run(world(), { appStatus: { at: NOW, droppedLastHour: 4, limitedLastHour: 2, routes: [] } });
    assert.match(find(busy, 'Request budget').detail, /^4 requests .* 2\/s budget/);
    assert.equal(find(busy, 'Request budget').status, 'warn');
    assert.match(find(busy, 'Visitor limit').detail, /^2 requests .* more than 30 new stops/);
});

test('the bus network\'s last fetch: how far a stopped one got, as a bar; a finished one, in a line', async () => {
    const network = async lastFetch => (await run(world(), { dataDir: dataDir({ lastFetch }) })).checks.find(c => c.title === 'Bus network from OASA');
    const at = '2026-10-20T08:20:00.000Z';
    const error = 'route 3923: HTTP 502: Upstream error: The operation was aborted due to timeout (4 tries)';

    const stopped = await network({ at, ok: false, seconds: 1580, error, lines: { done: 470, total: 470 }, stops: { done: 812, total: 1203 } });
    assert.equal(stopped.status, 'warn');
    assert.equal(stopped.detail, `The fetch at 2026-10-20 08:20 UTC stopped after 26 min, with 812 of 1203 routes' stops: ${error}. They're saved: the next build asks only for the other 391. Meanwhile the last network is used.`);
    assert.deepEqual(stopped.progress, { done: 812, total: 1203, label: 'Routes\' stops fetched' });
    assert.match(stopped.hint, /Restart the app.*"\[data\] OASA" lines/);

    const early = await network({ at, ok: false, seconds: 130, error: 'line Α10: HTTP 502 (4 tries)', lines: { done: 120, total: 470 } });
    assert.match(early.detail, /with the routes of 120 of 470 lines, before any route's stops: line Α10: HTTP 502 \(4 tries\)\. The next build starts again/);
    assert.deepEqual(early.progress, { done: 120, total: 470, label: 'Lines\' routes fetched' });

    const start = await network({ at, ok: false, seconds: 100, error: 'the lines: HTTP 502 (4 tries)' });
    assert.equal(start.detail, 'The fetch at 2026-10-20 08:20 UTC stopped at the start: the lines: HTTP 502 (4 tries). Meanwhile the last network is used.');
    assert.equal(start.progress, undefined);

    const done = await network({ at, ok: true, seconds: 700, lines: { done: 470, total: 470 }, stops: { done: 170, total: 170 } });
    assert.equal(done.status, 'ok');
    assert.equal(done.detail, 'Fetched 2026-10-20 08:20 UTC in 12 min: 470 lines, 170 routes\' stops asked for (the rest were less than a week old)');
    assert.equal(done.progress, undefined);

    // Never fetched: nothing to say (the bus files' own rows say if they're missing)
    assert.equal(await network(null), undefined);
});

test('STASY\'s timetables: the copy the pages use, and what went wrong with the last fetch', async () => {
    const row = async stasy => (await run(world(), { dataDir: dataDir({ stasy }) })).checks.find(c => c.title === 'STASY timetables');
    const at = '2026-10-15T02:30:00.000Z';

    const fine = await row(STASY_OK);
    assert.equal(fine.status, 'ok');
    assert.equal(fine.detail, 'The station pages use STASY\'s first and last trains from 2026-10-01, fetched 2026-10-01 02:30 UTC (home relay). Next fetch from 2026-10-15.');

    const changed = await row({ last: { at, ok: false, unreadable: true, error: 'M3: unknown column "ΤΕΛΕΥΤΑΙΟ (ΚΑΘΗΜΕΡΙΝΕΣ)"' }, fetched: '2026-10-01' });
    assert.equal(changed.status, 'fail');
    assert.match(changed.detail, /^STASY's pages changed: the fetch at 2026-10-15 02:30 UTC couldn't read them \(M3: unknown column .*\)\. The station pages use STASY's first and last trains from 2026-10-01\.$/);
    assert.match(changed.hint, /server\/data\/stasy\.js.*"stasy" names/);

    const failed = await row({ last: { at, ok: false, error: 'direct: HTTP 403; home relay: HTTP 400' }, fetched: null });
    assert.equal(failed.status, 'warn');
    assert.match(failed.detail, /^The fetch at 2026-10-15 02:30 UTC failed: direct: HTTP 403; home relay: HTTP 400\. The station pages use the GTFS's first and last trains/);
    assert.match(failed.hint, /relay rows above/);

    assert.match((await row({ fetched: null })).detail, /^Not fetched yet\./);

    const partly = await row({ ...STASY_OK, warnings: ['positions.json: no exits for M1/kifisia/moschato', 'STASY M3: unknown station "ΝΕΟΣ ΣΤΑΘΜΟΣ"; its first and last trains come from the GTFS'] });
    assert.equal(partly.status, 'warn');
    assert.match(partly.detail, /from 2026-10-01, except: STASY M3: unknown station "ΝΕΟΣ ΣΤΑΘΜΟΣ"; its first and last trains come from the GTFS$/);
});

test('the diagnostics page draws a check\'s progress as a labelled bar with its numbers', async () => {
    const { progressBar } = await browserModule('admin/client/progress.js');
    assert.equal(String(progressBar({ done: 812, total: 1203, label: 'Routes\' stops fetched' })),
        '<div class="diag-progress"><progress max="1203" value="812" aria-label="Routes&#39; stops fetched"></progress><span>812 / 1203</span></div>');
});

test('formatReport lists the summary, every check and its hint', async () => {
    const text = formatReport(await run(world(), { env: {} }));
    assert.match(text, /^Wayhop diagnostics, 2026-10-03T12:00:00\.000Z\n\n\[ OK \]/);
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
    assert.equal(r.checks.find(c => c.title === 'Relay location').detail, 'Its requests come from GR (nearest Cloudflare data centre: ATH)');
});

test('an older relay without whereami is reported, not treated as a failure', async () => {
    const r = await run(world({
        relay: (h, url) => h['X-Relay-Key'] !== 'k' ? new Response('Unauthorized', { status: 401 })
            : url.includes('act=whereami') ? new Response('Bad request', { status: 400 }) : json([]),
    }));
    assert.equal(r.summary.status, 'ok');
    assert.equal(r.checks.find(c => c.title === 'Relay location').status, 'info');
});

// ── Two relays: the Cloudflare Worker, then the home relay ──────────────────

const HOME = 'https://home.example/';
const BOTH = { ...ENV, OASA_HOME_RELAY_URL: HOME, OASA_HOME_RELAY_KEY: 'h' };

// The world above, plus a home relay; requests to it are answered by `home`
function withHome(home, overrides = {}) {
    const base = world(overrides);
    return async (url, init = {}) => {
        if (!url.startsWith(HOME)) return base(url, init);
        const answer = await home(init.headers ?? {}, url);
        if (answer instanceof Error) throw answer;
        return answer;
    };
}
const homeUp = (h, url) => h['X-Relay-Key'] !== 'h' ? new Response('Unauthorized', { status: 401 })
    : url.includes('act=whereami') ? json({ colo: 'ATH', loc: 'GR' }) : json([]);
// Production today: the server and the Worker are outside Greece
const abroad = {
    internet: () => new Response('ip=157.90.210.32\nloc=DE\n'),
    oasa: () => Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    relay: (h, url) => h['X-Relay-Key'] !== 'k' ? new Response('Unauthorized', { status: 401 })
        : url.includes('act=whereami') ? json({ colo: 'FRA', loc: 'DE' })
            : new Response('Upstream error: The operation was aborted due to timeout', { status: 502 }),
};

test('both relays are configured and checked, each under its own name', async () => {
    const r = await run(withHome(homeUp), { env: BOTH });
    for (const title of ['Relay fallback', 'Home relay fallback', 'Relay with your key', 'Home relay with your key', 'Home relay location']) {
        assert.equal(r.checks.find(c => c.title === title)?.status, 'ok', title);
    }
});

test('server and Worker blocked, home relay working: as intended, and the Worker is only information', async () => {
    const r = await run(withHome(homeUp, abroad), { env: BOTH });
    assert.equal(r.summary.status, 'ok');
    assert.match(r.summary.text, /go through the home relay \(ATH, GR\)\. Working as intended/);
    const worker = r.checks.find(c => c.title === 'Relay with your key');
    assert.equal(worker.status, 'info');
    assert.match(worker.hint, /the home relay carries the traffic/);
    assert.equal(r.checks.find(c => c.title === 'Relay location').status, 'info');
});

test('server and Worker blocked, home relay down: live times are down and the hint points at home', async () => {
    const r = await run(withHome(() => netError('UND_ERR_CONNECT_TIMEOUT'), abroad), { env: BOTH });
    assert.equal(r.summary.status, 'fail');
    assert.match(r.summary.text, /nor the home relay \(no answer.*\) can be reached.*DDNS name/);
    assert.equal(r.checks.find(c => c.title === 'Relay with your key').status, 'fail');
});

test('home relay in Greece can\'t reach OASA either: OASA is down', async () => {
    const r = await run(withHome((h, url) => url.includes('act=whereami') ? json({ colo: 'ATH', loc: 'GR' })
        : new Response('Upstream error: timeout', { status: 502 }), abroad), { env: BOTH });
    assert.match(r.summary.text, /through the home relay, so OASA itself is most likely down/);
});

test('a wrong home relay key is named', async () => {
    const r = await run(withHome(homeUp, abroad), { env: { ...BOTH, OASA_HOME_RELAY_KEY: 'wrong' } });
    assert.match(r.summary.text, /home relay is misconfigured: The home relay rejects the key\. OASA_HOME_RELAY_KEY in \.env/);
});

test('a home relay without its key is reported, and the Worker still works', async () => {
    const r = await run(world(), { env: { ...ENV, OASA_HOME_RELAY_URL: HOME } });
    assert.equal(r.checks.find(c => c.title === 'Home relay fallback').status, 'fail');
    assert.match(r.checks.find(c => c.title === 'Home relay fallback').detail, /Only OASA_HOME_RELAY_URL is set/);
    assert.equal(r.checks.find(c => c.title === 'Relay fallback').status, 'ok');
});
