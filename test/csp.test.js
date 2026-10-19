import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { contentSecurityPolicy, cspHeaders, hashOf, inlineScripts } from '../server/csp.js';
import { cspChecks } from '../server/diagnostics.js';
import { createPages, renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { renderStationPage } from '../server/pages/stations.js';
import { rail } from './fixtures/rail.js';

// The Content-Security-Policy (server/csp.js) against every page the server
// can render: anything a page runs inline must be allowed by the policy, and
// nothing the policy can't allow (onclick="…", javascript: links) may be in a
// page. A new inline script fails here, not in a visitor's browser.

const directive = (policy, name) => policy.split('; ').find(d => d.startsWith(`${name} `))?.split(' ').slice(1) ?? [];

// Every page: the registry's in both languages, the 404s, the station pages,
// a page rendered for the admin, and the pages with every ad setting on
function everyPage() {
    const tools = loadTools();
    const { pages, notFound, render } = renderPages(tools);
    const all = { ...pages, '(404)': notFound('/nope'), '(404, Greek)': notFound('/el/nope'), '(admin)': render({ title: 'Admin', content: '<p>x</p>' }) };
    for (const lang of ['en', 'el']) for (const id of [null, 'x', 'a']) all[`(station ${id ?? 'index'}, ${lang})`] = renderStationPage(rail, id, lang, { render, tools });
    const keys = ['ADSENSE_CLIENT', 'ADSENSE_SLOT_HOME', 'ADSENSE_SLOT_INFO', 'ADSENSE_SLOT_STATION'];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    Object.assign(process.env, { ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_HOME: '1111111111', ADSENSE_SLOT_INFO: '2222222222', ADSENSE_SLOT_STATION: '3333333333' });
    try {
        const withAds = renderPages(tools);
        all['/ (with ads)'] = withAds.pages['/'];
        all['/el/privacy (with ads)'] = withAds.pages['/el/privacy'];
    } finally {
        for (const k of keys) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k];
    }
    return all;
}

test('inline scripts are the ones the browser runs: not files, not data blocks', () => {
    const html = `<script>a()</script><script type="module">b()</script><script type="importmap">{"imports":{}}</script>
        <script src="/x.js"></script><script type="application/json" id="strings">{}</script><script type="application/ld+json">{}</script>`;
    assert.deepEqual(inlineScripts(html), ['a()', 'b()', '{"imports":{}}']);
});

test('a hash is the base64 SHA-256 of the script\'s exact text', () => {
    assert.equal(hashOf('a()'), `'sha256-${createHash('sha256').update('a()').digest('base64')}'`);
});

test('every inline script on every page is allowed by the policy', () => {
    const policy = contentSecurityPolicy({ scripts: createPages(undefined, {}).inlineScripts });
    const allowed = directive(policy, 'script-src');
    for (const [page, html] of Object.entries(everyPage())) {
        for (const script of inlineScripts(html)) assert.ok(allowed.includes(hashOf(script)), `${page}: an inline script the policy doesn't allow:\n${script.slice(0, 200)}`);
    }
    // Two today: the language redirect and the import map
    assert.equal(allowed.filter(v => v.startsWith("'sha256-")).length, 2);
});

test('no page has what the policy can\'t allow: event handler attributes or javascript: links', () => {
    for (const [page, html] of Object.entries(everyPage())) {
        assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+=/i, `${page}: an onclick-style attribute`);
        assert.doesNotMatch(html, /\s(?:href|src|action)="javascript:/i, `${page}: a javascript: link`);
    }
});

test('without ads: only our own files, nothing in frames, no plugins, no <base>', () => {
    const policy = contentSecurityPolicy({ scripts: ['a()'] });
    assert.deepEqual(directive(policy, 'default-src'), ["'self'"]);
    assert.deepEqual(directive(policy, 'script-src'), ["'self'", hashOf('a()')]);
    assert.deepEqual(directive(policy, 'style-src'), ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(directive(policy, 'img-src'), ["'self'", 'data:']);
    assert.deepEqual(directive(policy, 'connect-src'), ["'self'"]);
    assert.deepEqual(directive(policy, 'frame-src'), ["'none'"]);
    for (const [name, value] of [['object-src', "'none'"], ['base-uri', "'none'"], ['form-action', "'self'"], ['frame-ancestors', "'self'"], ['worker-src', "'self'"]]) {
        assert.deepEqual(directive(policy, name), [value], name);
    }
    assert.deepEqual(directive(policy, 'report-uri'), ['/api/csp-report']);
    assert.doesNotMatch(policy, /unsafe-eval|google/);
});

test('with ads: Google\'s ad and consent hosts are added, and nothing else changes', () => {
    const policy = contentSecurityPolicy({ scripts: ['a()'], ads: true });
    assert.ok(directive(policy, 'script-src').includes('https://pagead2.googlesyndication.com'));
    assert.ok(directive(policy, 'script-src').includes('https://fundingchoicesmessages.google.com'));
    assert.ok(directive(policy, 'frame-src').includes('https://*.doubleclick.net'));
    assert.ok(directive(policy, 'img-src').includes('https:'));
    assert.deepEqual(directive(policy, 'object-src'), ["'none'"]);
    assert.doesNotMatch(policy, /unsafe-eval/);
});

test('enforced, or only reported while it\'s tried out', () => {
    assert.deepEqual(Object.keys(cspHeaders('p', 'enforce')), ['Content-Security-Policy', 'Reporting-Endpoints']);
    assert.deepEqual(Object.keys(cspHeaders('p', 'report-only')), ['Content-Security-Policy-Report-Only', 'Reporting-Endpoints']);
    assert.equal(cspHeaders('p', 'enforce')['Reporting-Endpoints'], 'csp="/api/csp-report"');
});

test('the diagnostics say the mode and list what was reported', () => {
    const now = () => Date.parse('2026-10-20T12:00:00Z');
    const quiet = cspChecks({ mode: 'report-only', kinds: [], dropped: 0 }, now);
    assert.deepEqual(quiet.map(c => [c.title, c.status]), [['Mode', 'info'], ['Reports', 'ok']]);
    assert.match(quiet[0].hint, /CSP_MODE=enforce/);

    const reported = cspChecks({ mode: 'enforce', dropped: 3, kinds: [
        { directive: 'script-src-elem', blocked: 'https://evil.example/x.js', count: 4, page: 'https://wayhop.gr/subway', source: '', last: '2026-10-20T11:50:00Z' },
        { directive: 'script-src', blocked: 'chrome-extension', count: 1, page: 'https://wayhop.gr/', source: '', last: '2026-10-20T11:00:00Z' },
    ] }, now);
    assert.equal(reported[0].status, 'ok');
    assert.equal(reported[1].title, 'script-src-elem: https://evil.example/x.js');
    assert.equal(reported[1].detail, '4× since the app started, last 10 min ago on https://wayhop.gr/subway');
    assert.match(reported[2].hint, /browser extension/);
    assert.match(reported.at(-1).detail, /3 reports not kept/);
    assert.deepEqual(cspChecks(null), []);
});
