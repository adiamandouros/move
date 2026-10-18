// @ts-check

// Security headers on everything the app sends (pages, the API, files it
// serves itself):
//   - Strict-Transport-Security: browsers only use https for a year (sent
//     over https only, so local development on http isn't affected)
//   - X-Content-Type-Options: files are only used as their declared type
//   - Referrer-Policy: other sites see where a visitor came from, not the
//     page's address and query (e.g. the stations of a route)
//   - Permissions-Policy: location only for the site itself (not ads or
//     other frames); no camera or microphone
//   - X-Frame-Options: other sites can't show Wayhop in a frame
// No Content-Security-Policy yet: pages have small inline scripts (the
// language redirect) and AdSense needs its own allowances.
const HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
    'X-Frame-Options': 'SAMEORIGIN',
};

/** @returns {import('express').RequestHandler} */
export function securityHeaders() {
    return (req, res, next) => {
        res.set(HEADERS);
        if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
        next();
    };
}
