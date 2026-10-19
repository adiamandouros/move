import express from 'express';

// Where browsers report what the Content-Security-Policy blocked (or would
// block, in report-only mode): POST /api/csp-report. Both formats browsers
// send are read: the older { "csp-report": { … } } and the Reporting API's
// [{ type: "csp-violation", body: { … } }]. Reports are kept in memory as a
// summary for /admin/diagnostics: each kind (directive and what it blocked)
// with a count, the last page it happened on (without its query string,
// which can hold people's stations) and when. Bounded: at most MAX_KINDS
// kinds and MAX_PER_MINUTE reports a minute, so nobody can fill memory or
// flood the log.
const MAX_KINDS = 50;
const MAX_PER_MINUTE = 120;
const MAX_BODY = '16kb';

const withoutQuery = url => {
    if (!url || typeof url !== 'string') return '';
    try {
        const u = new URL(url);
        return u.protocol.startsWith('http') ? `${u.origin}${u.pathname}` : u.protocol.replace(/:$/, '');
    } catch {
        // "inline", "eval", "data" and the like
        return url.slice(0, 100);
    }
};

// One report, from either format → { directive, blocked, page, source } or null
function normalise(report) {
    const legacy = report?.['csp-report'];
    const body = legacy ?? (report?.type === 'csp-violation' ? report.body : null);
    if (!body || typeof body !== 'object') return null;
    const directive = String(body['effective-directive'] ?? body.effectiveDirective ?? body['violated-directive'] ?? body.violatedDirective ?? '').split(' ')[0];
    if (!directive) return null;
    return {
        directive: directive.slice(0, 40),
        blocked: withoutQuery(body['blocked-uri'] ?? body.blockedURL ?? '') || 'inline',
        page: withoutQuery(body['document-uri'] ?? body.documentURL ?? ''),
        source: withoutQuery(body['source-file'] ?? body.sourceFile ?? ''),
    };
}

export function createCspReports({ now = Date.now } = {}) {
    const kinds = new Map();
    let minute = { start: 0, count: 0 };
    let dropped = 0;

    const router = express.Router();
    router.post('/', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: MAX_BODY }), (req, res) => {
        const reports = Array.isArray(req.body) ? req.body : [req.body];
        for (const report of reports) {
            const r = normalise(report);
            if (!r) continue;
            if (now() - minute.start >= 60_000) minute = { start: now(), count: 0 };
            const key = `${r.directive} ${r.blocked}`;
            if (++minute.count > MAX_PER_MINUTE || (!kinds.has(key) && kinds.size >= MAX_KINDS)) { dropped++; continue; }
            const kind = kinds.get(key) ?? { directive: r.directive, blocked: r.blocked, count: 0 };
            kinds.set(key, { ...kind, count: kind.count + 1, page: r.page, source: r.source, last: new Date(now()).toISOString() });
        }
        res.status(204).end();
    });
    // A body that isn't JSON, or too big: still "thanks", nothing kept
    router.use((err, _req, res, _next) => res.status(204).end());

    // → { kinds: [{ directive, blocked, count, page, source, last }] (most frequent first), dropped }
    const status = () => ({ kinds: [...kinds.values()].sort((a, b) => b.count - a.count), dropped });
    return { router, status };
}
