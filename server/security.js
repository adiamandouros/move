
// Security headers on everything the app sends (pages, the API, files it
// serves itself):
//   - Strict-Transport-Security: browsers only use https for a year (sent
//     over https only, so local development on http isn't affected)
//   - X-Content-Type-Options: files are only used as their declared type
//   - Referrer-Policy: other sites see where a visitor came from, not the
//     page's address and query (e.g. the stations of a route)
//   - Permissions-Policy: location only for the site itself (not ads or
//     other frames); no camera or microphone
//   - X-Frame-Options: other sites can't show Wayhop in a frame (also
//     frame-ancestors in the policy, for browsers that only read that)
//   - Content-Security-Policy, or -Report-Only while it's tried out, and
//     where browsers report to (`csp`, from server/csp.js via app.js)
const HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
    'X-Frame-Options': 'SAMEORIGIN',
};

/** @param {{ csp?: Record<string, string> }} [options] @returns {import('express').RequestHandler} */
export function securityHeaders({ csp = {} } = {}) {
    const headers = { ...HEADERS, ...csp };
    return (req, res, next) => {
        res.set(headers);
        if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
        next();
    };
}
