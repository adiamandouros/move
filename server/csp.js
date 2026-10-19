import { createHash } from 'crypto';

// The Content-Security-Policy: which scripts, styles, images and connections
// a page may use, so anything injected into a page (a missed escape, a bad
// value from OASA or STASY) isn't run. Built from the inline scripts the
// pages really have, so it can't fall behind them:
//   inlineScripts(html)                 → the text of each inline script the browser would run
//   contentSecurityPolicy({ scripts, ads }) → the header's value
//
// - Scripts: our own files, and the inline ones by hash (the language
//   redirect and the import map; pages are rendered once, so hashes fit
//   better than per-request nonces).
// - Styles: our own files and inline style="" attributes. The line colours
//   come from the data that way; every value is escaped, and style injection
//   is a minor risk next to scripts. Tighten when the colours become classes.
// - Images: our own and data: (Bootstrap's accordion arrows).
// - Nothing in frames, no plugins, no <base>, forms only to us, and only we
//   may show the site in a frame.
// With AdSense on (ADSENSE_CLIENT), Google's ad and consent hosts are added;
// check the reports in report-only mode when turning ads on.

// The hosts AdSense and its consent message use (Google's CSP guidance for
// AdSense, without strict-dynamic)
const GOOGLE_ADS = {
    script: ['https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.google.com', 'https://*.googleadservices.com',
        'https://*.doubleclick.net', 'https://*.gstatic.com', 'https://*.adtrafficquality.google', 'https://fundingchoicesmessages.google.com'],
    frame: ['https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com', 'https://*.adtrafficquality.google'],
    connect: ['https://*.googlesyndication.com', 'https://*.google.com', 'https://*.doubleclick.net', 'https://*.adtrafficquality.google'],
    // Ads show images from anywhere their advertisers keep them
    img: ['https:'],
};

export const REPORT_PATH = '/api/csp-report';

// 'sha256-…' for an inline script's exact text
export const hashOf = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

// Inline <script> elements the browser runs: not ones with src, and not data
// blocks (JSON strings, structured data). Import maps count: browsers check
// them against script-src too.
export function inlineScripts(html) {
    return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .filter(([, attrs]) => !/\ssrc=/i.test(attrs) && !/\stype="application\/(ld\+)?json"/i.test(attrs))
        .map(([, , text]) => text);
}

/** @param {{ scripts: Iterable<string>, ads?: boolean }} options */
export function contentSecurityPolicy({ scripts, ads = false }) {
    const hashes = [...new Set([...scripts].map(hashOf))].sort();
    const extra = kind => ads ? GOOGLE_ADS[kind] : [];
    const directives = {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...hashes, ...extra('script')],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', ...extra('img')],
        'connect-src': ["'self'", ...extra('connect')],
        'frame-src': ads ? GOOGLE_ADS.frame : ["'none'"],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
        'report-uri': [REPORT_PATH],
        'report-to': ['csp'],
    };
    return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

// The headers for a policy: enforced, or only reported while it's tried out
/** @param {string} policy @param {string} mode 'enforce', or anything else for report-only */
export function cspHeaders(policy, mode) {
    return {
        [mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only']: policy,
        'Reporting-Endpoints': `csp="${REPORT_PATH}"`,
    };
}
