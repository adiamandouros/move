import compression from 'compression';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAdmin } from './admin/index.js';
import { BUILD_DIR, OVERLAY_FILE, loadCurated, rebuildSoon } from './data/index.js';
import { runDiagnostics } from './diagnostics.js';
import { createBusApi } from './oasa/index.js';
import { createOasaClient } from './oasa/client.js';
import { VENDOR, staticFiles } from './pages/assets.js';
import { createPages } from './pages/index.js';
import { checkedFacts, loadTools } from './pages/registry.js';
import { canonicalHost } from './canonical-host.js';
import { createAnnouncements } from './info/announcements.js';
import { createHealth } from './health.js';
import { createProcessGuard } from './processes.js';
import { securityHeaders } from './security.js';
import { contentSecurityPolicy, cspHeaders, REPORT_PATH } from './csp.js';
import { createCspReports } from './csp-reports.js';
import { loadConfig } from './config.js';
import { errorHandler } from './errors.js';
import { readJson } from './files.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');

// The whole site as an Express app, without starting it: server.js runs it
// for real, and the browser tests (test/browser/) run it with their own data
// and a fake OASA.
//   config:   the settings (server/config.js): the relays, the admin password,
//             the CSP mode, the public address, AdSense
//   buildDir: rail.json, bus-stops.json, bus-lines.json, meta.json (data/build)
//   cacheDir: OASA's routes, the route status and the announcements (data/cache)
//   fetch:    how OASA, STASY and the relays are reached
//   oasaClient, limiter: stand-ins for OASA and the per-visitor limit (oasa/index.js), for tests
//   logError: where failed requests are logged (server/errors.js)
//   processGuard: the hosting account's processes (server/processes.js);
//             server.js starts it
/**
 * @param {{
 *   config?: import('../types/config.js').Config, buildDir?: string, cacheDir?: string,
 *   fetch?: typeof globalThis.fetch, oasaClient?: ReturnType<typeof createOasaClient>,
 *   limiter?: { take(key: string, stops: number): number }, logError?: (message: string) => void,
 *   processGuard?: ReturnType<typeof createProcessGuard>,
 * }} [options]
 */
export function createApp({
    config = loadConfig(),
    buildDir = BUILD_DIR,
    cacheDir = path.join(DATA_DIR, 'cache'),
    fetch = globalThis.fetch,
    oasaClient = createOasaClient({ relays: config.relays, fetch, userAgent: config.userAgent }),
    limiter = undefined,
    logError = console.error,
    processGuard = createProcessGuard(),
} = {}) {
    const { relays, cspMode } = config;
    // Pages first: the Content-Security-Policy is built from their inline scripts
    const pages = createPages(undefined, { railFile: path.join(buildDir, 'rail.json'), config });
    const csp = contentSecurityPolicy({ scripts: pages.inlineScripts, ads: Boolean(config.adsense.client) });
    const cspReports = createCspReports();

    const app = express();
    // Behind cPanel's Apache proxy: trust its X-Forwarded-* headers for req.ip and req.secure
    app.set('trust proxy', 'loopback');
    // Other addresses (the old move.sonovabitc.win) redirect to SITE_URL
    app.use(canonicalHost(config.siteUrl));
    app.use(securityHeaders({ csp: cspHeaders(csp, cspMode) }));
    app.use(compression());

    // Live bus arrivals from OASA, cached and rate-limited (see oasa/).
    // The relays are fallbacks for when OASA can't be reached directly (proxy/README.md).
    const busApi = createBusApi({
        routesFile: path.join(cacheDir, 'oasa-routes.json'),
        statusFile: path.join(cacheDir, 'oasa-status.json'),
        stopsFile: path.join(buildDir, 'bus-stops.json'),
        relays,
        client: oasaClient,
        limiter,
    });
    // Service announcements for the info page, from the OASA and STASY websites
    const announcements = createAnnouncements({ cacheFile: path.join(cacheDir, 'announcements.json'), relays, fetch, userAgent: config.userAgent });
    app.use('/api/announcements', announcements);
    // Whether the live site works, for the scheduled check (.github/workflows/health.yml)
    app.use('/api/health', createHealth({ busStatus: busApi.status, announcementStatus: announcements.status, buildDir, relays, processes: processGuard.status, fetch }));
    // What the Content-Security-Policy blocked, as browsers report it (server/csp-reports.js).
    // Before the bus API, which answers 404 for any other /api address.
    app.use(REPORT_PATH, cspReports.router);
    app.use('/api', busApi);

    // Pages, and station pages built from rail.json, so they follow its weekly rebuild
    app.use(pages.router);

    // Private station editor — only exists when ADMIN_PASSWORD is set
    const admin = createAdmin({
        password: config.adminPassword,
        overlayFile: OVERLAY_FILE,
        loadCurated,
        loadRail: () => readJson(path.join(buildDir, 'rail.json')),
        rebuild: rebuildSoon,
        render: pages.render,
        // Fetches the announcements first, so their checks show the current state
        diagnose: async () => {
            await announcements.refreshNow();
            return runDiagnostics({
                config, dataDir: DATA_DIR, appStatus: busApi.status(), announcements: announcements.status(),
                csp: { mode: cspMode, ...cspReports.status() }, facts: checkedFacts(loadTools()), account: processGuard.status(),
            });
        },
    });
    if (admin) app.use('/admin', admin);

    // Generated data (rail.json, bus-stops.json, bus-lines.json, meta.json); revalidated on every request via ETag
    app.use('/data', express.static(buildDir, { maxAge: 0 }));

    for (const [url, dir] of Object.entries(VENDOR)) app.use(url, staticFiles(dir));

    app.use(staticFiles(path.join(ROOT, 'public'), { index: false }));

    app.use(pages.notFound);
    // Anything that failed: logged, and answered without its details
    app.use(errorHandler({ page: pages.errorPage, log: logError }));
    return app;
}
