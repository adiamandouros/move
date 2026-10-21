import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';
import { loadTools, sitePages } from '../server/pages/registry.js';
import { brokenData, down, site } from './support/test-site.js';

// The whole server (server/app.js) as a browser or a search engine meets it,
// over HTTP, without a browser: what every kind of address answers, with
// which headers, and how the APIs say no. It runs the browser tests' site
// (test data, a fake OASA), so it needs no network.

async function serve(overrides) {
    const server = await new Promise(resolve => { const s = site(overrides).listen(0, () => resolve(s)); });
    after(() => server.close());
    const base = `http://localhost:${server.address().port}`;
    const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
    // A browser revalidating its copy: only If-None-Match (fetch() would add
    // Cache-Control: no-cache, which asks for a full answer) → the status
    get.base = base;
    get.revalidate = (path, etag) => new Promise((resolve, reject) => http.get(`${base}${path}`, { headers: { 'if-none-match': etag } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
    return get;
}
const get = await serve();

const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
const greek = path => path === '/' ? '/el' : `/el${path}`;
const PAGES = [...sitePages(loadTools()).map(p => p.path), '/subway/stations', '/subway/stations/syntagma'];
const SECURITY = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'SAMEORIGIN',
    'permissions-policy': 'geolocation=(self), camera=(), microphone=()',
};
const securityProblems = res => Object.entries(SECURITY).filter(([name, value]) => res.headers.get(name) !== value).map(([name]) => name);

test('every page answers in both languages, as HTML that browsers revalidate', async () => {
    for (const path of PAGES) {
        for (const [lang, url] of [['en', path], ['el', greek(path)]]) {
            const res = await get(url);
            assert.equal(res.status, 200, url);
            assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', url);
            assert.equal(res.headers.get('cache-control'), 'no-cache', url);
            assert.match(await res.text(), new RegExp(`<html lang="${lang}"`), url);
        }
    }
});

test('every kind of answer carries the security headers', async () => {
    const answers = {
        'a page': '/subway', 'the 404 page': '/nope', 'a station page': '/el/subway/stations/omonia',
        'an API answer': '/api/arrivals?stops=10157', 'an API refusal': '/api/arrivals', 'announcements': '/api/announcements',
        'the health check': '/api/health', 'data': '/data/rail.json', 'a stylesheet': '/css/style.css', 'a script': '/js/core/html.js',
        'Bootstrap': '/vendor/bootstrap/css/bootstrap.min.css', 'the icons': '/icons.svg', 'the service worker': '/sw.js',
        'robots.txt': '/robots.txt', 'the sitemap': '/sitemap.xml', 'the app manifest': '/el/manifest.webmanifest',
    };
    for (const [what, path] of Object.entries(answers)) {
        assert.deepEqual(securityProblems(await get(path)), [], `${what} (${path})`);
    }
});

test('unknown addresses get the not-found page, in their language', async () => {
    for (const [path, lang, title] of [['/nope', 'en', 'Page not found'], ['/el/nope', 'el', 'Η σελίδα δεν βρέθηκε'], ['/subway/stations/atlantis', 'en', 'Page not found'], ['/css/nope.css', 'en', 'Page not found']]) {
        const res = await get(path);
        assert.equal(res.status, 404, path);
        const html = await res.text();
        assert.match(html, new RegExp(`<html lang="${lang}"`), path);
        assert.match(html, new RegExp(`<h1[^>]*>[^<]*${title}`), path);
    }
});

test('names every object has aren\'t stations: the not-found page, not a crash', async () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        for (const [lang, path] of [['en', `/subway/stations/${id}`], ['el', `/el/subway/stations/${id}`]]) {
            const res = await get(path);
            assert.equal(res.status, 404, path);
            const html = await res.text();
            assert.match(html, new RegExp(`<html lang="${lang}"`), path);
            assert.doesNotMatch(html, /TypeError|node_modules/, path);
        }
    }
});

test('before the first data build, station pages say "try again" (503), not "not found"', async () => {
    const empty = await serve({ buildDir: mkdtempSync(join(tmpdir(), 'wayhop-nodata-')) });
    for (const [lang, path, title] of [['en', '/subway/stations', 'Something went wrong'], ['en', '/subway/stations/syntagma', 'Something went wrong'], ['el', '/el/subway/stations/syntagma', 'Κάτι πήγε στραβά']]) {
        const res = await empty(path);
        assert.equal(res.status, 503, path);
        assert.equal(res.headers.get('retry-after'), '300', path);
        assert.equal(res.headers.get('cache-control'), 'no-store', path);
        const html = await res.text();
        assert.match(html, new RegExp(`<html lang="${lang}"`), path);
        assert.match(html, new RegExp(`<h1[^>]*>[^<]*${title}`), path);
    }
    // Other addresses are still just not found
    assert.equal((await empty('/nope')).status, 404);
});

test('a page that can\'t be drawn: the error page in its language, the details only in the log', async () => {
    const logged = [];
    const broken = await serve({ buildDir: brokenData(), logError: message => logged.push(message) });
    for (const [lang, path, title] of [['en', '/subway/stations/omonia', 'Something went wrong'], ['el', '/el/subway/stations/omonia', 'Κάτι πήγε στραβά']]) {
        const res = await broken(path);
        assert.equal(res.status, 500, path);
        assert.equal(res.headers.get('cache-control'), 'no-store', path);
        const html = await res.text();
        assert.match(html, new RegExp(`<html lang="${lang}"`), path);
        assert.match(html, new RegExp(`<h1[^>]*>[^<]*${title}`), path);
        assert.doesNotMatch(html, /TypeError|\bat \w+ \(|node_modules|\/home\//, path);
    }
    assert.equal(logged.length, 2);
    assert.match(logged[0], /^\[server\] GET \/subway\/stations\/omonia failed: TypeError/);
    // The rest of the site still works
    assert.equal((await broken('/subway/stations/syntagma')).status, 200);
});

test('an API answer that fails: a JSON error without details', async () => {
    const logged = [];
    const failing = await serve({ limiter: { take() { throw new Error('limiter broke'); } }, logError: message => logged.push(message) });
    const res = await failing('/api/arrivals?stops=10157');
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal Server Error' });
    assert.equal(logged.length, 1);
});

test('a request the server refuses (a login form that\'s too big) keeps its status, without details', async () => {
    const logged = [];
    const admin = await serve({ env: { ADMIN_PASSWORD: 'secret' }, logError: message => logged.push(message) });
    const res = await admin('/admin/login', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${'x'.repeat(5000)}`,
    });
    assert.equal(res.status, 413);
    assert.doesNotMatch(await res.text(), /PayloadTooLargeError|node_modules/);
    assert.deepEqual(logged, []);
});

test('data files are revalidated every time, and unchanged ones cost a 304', async () => {
    for (const name of ['rail.json', 'bus-stops.json', 'bus-lines.json', 'meta.json']) {
        const res = await get(`/data/${name}`);
        assert.equal(res.status, 200, name);
        assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
        assert.equal(res.headers.get('cache-control'), 'public, max-age=0');
        assert.equal(await get.revalidate(`/data/${name}`, res.headers.get('etag')), 304, `${name} unchanged`);
    }
    assert.equal((await (await get('/data/rail.json')).json()).feed.validTo, rail.feed.validTo);
});

test('pages, data and scripts are compressed for browsers that take it', async () => {
    for (const path of ['/', '/data/rail.json', '/js/core/html.js', '/sitemap.xml']) {
        const res = await get(path, { headers: { 'accept-encoding': 'gzip' } });
        assert.equal(res.headers.get('content-encoding'), 'gzip', path);
        assert.match(res.headers.get('vary'), /Accept-Encoding/, path);
    }
});

test('the service worker, robots.txt, the sitemap and the manifests', async () => {
    const sw = await get('/sw.js');
    assert.equal(sw.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(sw.headers.get('cache-control'), 'no-cache', 'a new version is picked up at once');
    assert.match(await sw.text(), /const VERSION = '[0-9a-f]{12}'/);
    assert.match(await (await get('/robots.txt')).text(), /Sitemap: .*\/sitemap\.xml/);
    const sitemap = await (await get('/sitemap.xml')).text();
    for (const id of Object.keys(rail.stations)) assert.ok(sitemap.includes(`/subway/stations/${id}<`), `station ${id} in the sitemap`);
    assert.equal(JSON.parse(await (await get('/el/manifest.webmanifest')).text()).start_url, '/el');
});

test('the bus API: an answer for each stop asked for, once each', async () => {
    const res = await get('/api/arrivals?stops=10157,10157');
    assert.equal(res.status, 200);
    const { stops } = await res.json();
    assert.deepEqual(Object.keys(stops), ['10157']);
    const [first] = stops['10157'].arrivals;
    assert.deepEqual(Object.keys(first).sort(), ['line', 'minutes', 'route', 'to', 'vehicle']);
    assert.deepEqual(Object.keys(first.to).sort(), ['el', 'en']);
    assert.equal(stops['10157'].stale, false);
});

test('the bus API says no, clearly, to what it can\'t answer', async () => {
    const refusals = {
        '/api/arrivals': /Pass 1–12 numeric stop codes/,
        '/api/arrivals?stops=': /Pass 1–12 numeric stop codes/,
        '/api/arrivals?stops=abc': /Pass 1–12 numeric stop codes/,
        '/api/arrivals?stops=-2': /Pass 1–12 numeric stop codes/,
        [`/api/arrivals?stops=${Array.from({ length: 13 }, (_, i) => 10100 + i).join(',')}`]: /Pass 1–12 numeric stop codes/,
        '/api/arrivals?stops=99999999': /Unknown stop code: 99999999/,
    };
    for (const [path, message] of Object.entries(refusals)) {
        const res = await get(path);
        assert.equal(res.status, 400, path);
        assert.match((await res.json()).error, message, path);
    }
});

test('over the per-visitor limit: 429, with when to try again', async () => {
    const limited = await serve({ limiter: { take: () => 4_200 } });
    const res = await limited('/api/arrivals?stops=10157');
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '5');
    assert.match((await res.json()).error, /Too many new stops/);
});

test('OASA down: the API still answers, saying each stop is unavailable', async () => {
    const oasaDown = await serve({ oasaClient: { request: down, status: () => ({ routes: [] }), queueWait: () => 0 } });
    const { stops } = await (await oasaDown('/api/arrivals?stops=10157')).json();
    assert.deepEqual(stops['10157'], { arrivals: [], updated: null, stale: false, unavailable: true });
});

test('announcements: never cached, and 503 when every source is down', async () => {
    const res = await get('/api/announcements');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['available', 'bus', 'rail']);
    assert.ok(body.bus.en.length && body.bus.el.length && body.rail.length);

    const sourcesDown = await serve({ fetch: down });
    const refused = await sourcesDown('/api/announcements');
    assert.equal(refused.status, 503);
    assert.match((await refused.json()).error, /unavailable/);
});

test('the health check answers JSON that is never cached', async () => {
    const res = await get('/api/health');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    for (const part of ['ok', 'checked', 'problems', 'arrivals', 'announcements', 'data']) assert.ok(part in body, part);
    // The test data was built long ago, so it's (rightly) not healthy
    assert.equal(res.status, body.ok ? 200 : 503);
});

test('the admin pages exist only with a password, and only after logging in', async () => {
    assert.equal((await get('/admin/login')).status, 404, 'no password: no admin');
    const admin = await serve({ env: { ADMIN_PASSWORD: 'secret' } });
    const login = await admin('/admin/login');
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('cache-control'), 'no-store');
    for (const path of ['/admin', '/admin/stations', '/admin/diagnostics']) {
        const res = await admin(path);
        assert.equal(res.status, 303, path);
        assert.equal(res.headers.get('location'), '/admin/login', path);
    }
});

test('the Content-Security-Policy comes with every answer, and reports are taken', async () => {
    for (const path of ['/', '/el/subway/stations/omonia', '/nope', '/api/arrivals?stops=10157']) {
        const res = await get(path);
        assert.match(res.headers.get('content-security-policy') ?? '', /^default-src 'self'; script-src 'self' 'sha256-/, path);
        assert.equal(res.headers.get('reporting-endpoints'), 'csp="/api/csp-report"', path);
    }
    const report = await get('/api/csp-report', {
        method: 'POST', headers: { 'content-type': 'application/csp-report' },
        body: JSON.stringify({ 'csp-report': { 'document-uri': 'https://wayhop.gr/', 'effective-directive': 'img-src', 'blocked-uri': 'https://x.example/a.gif' } }),
    });
    assert.equal(report.status, 204);
});

test('while it\'s tried out, the policy is only reported', async () => {
    const trying = await serve({ env: { CSP_MODE: 'report-only' } });
    const res = await trying('/');
    assert.equal(res.headers.get('content-security-policy'), null);
    assert.match(res.headers.get('content-security-policy-report-only') ?? '', /^default-src 'self'/);
});

test('the settings reach every part: the public address, ads and the contact address', async () => {
    const live = await serve({ env: { SITE_URL: 'https://wayhop.example', ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_HOME: '1111111111' } });
    const home = await (await live('/')).text();
    assert.match(home, /<link rel="canonical" href="https:\/\/wayhop\.example\/">/);
    assert.match(home, /data-ad-slot="1111111111"/);
    assert.match(await (await live('/robots.txt')).text(), /^Sitemap: https:\/\/wayhop\.example\/sitemap\.xml$/m);
    assert.equal((await live('/ads.txt')).status, 200);
    assert.match(await (await live('/contact')).text(), /mailto:hello@wayhop\.example/);
    // Another address redirects to it
    const moved = await new Promise((resolve, reject) => http.get(live.base + '/subway', { headers: { host: 'old.example' } }, res => { res.resume(); resolve(res); }).on('error', reject));
    assert.equal(moved.statusCode, 301);
    assert.equal(moved.headers.location, 'https://wayhop.example/subway');
});
