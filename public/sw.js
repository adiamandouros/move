const CACHE = 'move-v6';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/location.js',
    '/js/data/subway.js',
    '/js/tools/nearbyBuses.js',
    '/js/tools/subwayPosition.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
];

// Pre-cache all static assets on install
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Remove old caches on activate
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Never cache API calls — always go to network
    if (url.pathname.startsWith('/api/')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // Network-first for the schedule file so server-side rebuilds reach clients
    if (url.pathname === '/data/metro-schedule.json') {
        e.respondWith(
            fetch(e.request)
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE).then(cache => cache.put(e.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Cache-first for everything else (static files + CDN)
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(response => {
                // Only cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE).then(cache => cache.put(e.request, clone));
                }
                return response;
            });
        })
    );
});
