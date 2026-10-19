import { sendFresh } from './http.js';

// Once SITE_URL is set, every other address the app answers on (the old
// move.sonovabitc.win, www., aliases) redirects there permanently, so search
// engines and people end up at one address. Exceptions:
//   - /sw.js gets RETIRED_WORKER, so copies of the app installed at an old
//     address stop serving their cached pages and move to the new one
//   - /api and /data keep working, so pages still open at an old address
//     (fetches can't follow a redirect to another origin) work until they reload
//   - localhost, for trying out a production .env locally
const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);
const KEPT = /^\/(api|data)\//;

export const RETIRED_WORKER = `// This address has moved: clear what the app cached here, remove this
// service worker and reload, which redirects to the new address.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
})()));
`;

// siteUrl: SITE_URL (server/config.js), '' to redirect nothing
/** @param {string} siteUrl */
export function canonicalHost(siteUrl) {
    const host = siteUrl ? new URL(siteUrl).hostname : null;
    return (req, res, next) => {
        if (!host || LOCAL.has(req.hostname) || req.hostname === host) return next();
        if (req.path === '/sw.js') return sendFresh(res, 'js', RETIRED_WORKER);
        if (KEPT.test(req.path)) return next();
        // 308 keeps the method (e.g. the admin login form's POST)
        res.redirect(['GET', 'HEAD'].includes(req.method) ? 301 : 308, siteUrl + req.originalUrl);
    };
}
