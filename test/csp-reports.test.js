import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCspReports } from '../server/csp-reports.js';
import { listen } from './support/listen.js';

// Where browsers report what the Content-Security-Policy blocked
// (server/csp-reports.js): both report formats, a summary without people's
// query strings, and limits so nobody can fill memory with reports.

async function receiver({ now } = {}) {
    const reports = createCspReports({ now });
    const app = express().use('/api/csp-report', reports.router);
    const server = await listen(app);
    after(() => server.close());
    const post = (body, type = 'application/csp-report') => fetch(`${server.url}/api/csp-report`, {
        method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { post, status: reports.status };
}
const legacy = (blocked, page = 'https://wayhop.gr/subway?from=syntagma&to=airport') => ({ 'csp-report': {
    'document-uri': page, 'violated-directive': 'script-src-elem', 'effective-directive': 'script-src-elem',
    'blocked-uri': blocked, 'source-file': 'https://wayhop.gr/js/core/shell.js?v=abc', 'line-number': 3,
} });

test('the older format: kept by kind, without query strings', async () => {
    const { post, status } = await receiver();
    const res = await post(legacy('https://evil.example/x.js?token=1'));
    assert.equal(res.status, 204);
    await post(legacy('https://evil.example/x.js?token=2'));
    const [kind] = status().kinds;
    assert.equal(kind.count, 2);
    assert.equal(kind.directive, 'script-src-elem');
    assert.equal(kind.blocked, 'https://evil.example/x.js');
    assert.equal(kind.page, 'https://wayhop.gr/subway', 'the stations in the query are dropped');
    assert.equal(kind.source, 'https://wayhop.gr/js/core/shell.js');
});

test('the Reporting API format: several reports in one request', async () => {
    const { post, status } = await receiver();
    await post([
        { type: 'csp-violation', url: 'https://wayhop.gr/', body: { documentURL: 'https://wayhop.gr/', effectiveDirective: 'img-src', blockedURL: 'https://tracker.example/p.gif', disposition: 'report' } },
        { type: 'csp-violation', body: { documentURL: 'https://wayhop.gr/el', effectiveDirective: 'script-src-elem', blockedURL: 'inline' } },
        { type: 'deprecation', body: { id: 'x' } },
    ], 'application/reports+json');
    assert.deepEqual(status().kinds.map(k => `${k.directive} ${k.blocked}`).sort(), ['img-src https://tracker.example/p.gif', 'script-src-elem inline']);
});

test('junk, other reports and oversized bodies are thanked and ignored', async () => {
    const { post, status } = await receiver();
    for (const body of ['not json', '{}', '[]', JSON.stringify({ 'csp-report': {} }), JSON.stringify({ 'csp-report': 'x' }), 'x'.repeat(20_000)]) {
        assert.equal((await post(body)).status, 204);
    }
    assert.deepEqual(status(), { kinds: [], dropped: 0 });
});

test('bounded: at most 50 kinds and 120 reports a minute', async () => {
    let t = 0;
    const { post, status } = await receiver({ now: () => t });
    await post(Array.from({ length: 60 }, (_, i) => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: `https://x${i}.example/` } })), 'application/reports+json');
    assert.equal(status().kinds.length, 50);
    assert.equal(status().dropped, 10);

    await post(Array.from({ length: 100 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://x0.example/' } })), 'application/reports+json');
    assert.equal(status().kinds.find(k => k.blocked === 'https://x0.example/').count, 61, '120 a minute, 60 used before');
    assert.equal(status().dropped, 10 + 40);
    // A minute later, reports are kept again; a new kind still isn't (all 50 taken)
    t += 60_000;
    await post([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://x0.example/' } }], 'application/reports+json');
    assert.equal(status().kinds.find(k => k.blocked === 'https://x0.example/').count, 62);
    await post(legacy('https://new.example/'));
    assert.equal(status().dropped, 10 + 40 + 1);
    assert.equal(status().kinds[0].blocked, 'https://x0.example/', 'most frequent first');
});
