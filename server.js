import 'dotenv/config';
import compression from 'compression';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { startScheduler } from './server/scheduler.js';
import { readFileSync } from 'fs';
import { createAdmin } from './server/admin/index.js';
import { BUILD_DIR, OVERLAY_FILE, loadCurated, rebuildSoon } from './server/data/index.js';
import { createPages, VENDOR } from './server/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Behind cPanel's Apache proxy: trust its X-Forwarded-* headers for req.ip and req.secure
app.set('trust proxy', 'loopback');
app.use(compression());
const PORT = process.env.PORT || 3000;

// Only the current bus page uses this; everything else works without it
const OASA_API_URL = process.env.OASA_API_URL;
if (!OASA_API_URL) console.warn('[api] OASA_API_URL is not set — the bus page will show a server error');

// Forward /api/* requests to the OASA API
const UPSTREAM_TIMEOUT_MS = 15000;
app.use('/api', async (req, res) => {
    if (!OASA_API_URL) return res.status(503).json({ error: 'OASA_API_URL is not configured' });
    const target = OASA_API_URL.replace(/\/$/, '') + req.url;
    try {
        const apiRes = await fetch(target, {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        const data = await apiRes.text();
        res.status(apiRes.status)
           .set('Content-Type', apiRes.headers.get('content-type') || 'application/json')
           .send(data);
    } catch (err) {
        const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
        const status = timedOut ? 504 : 502;
        console.error('Proxy error:', err.message);
        res.status(status).json({
            error: timedOut ? 'Upstream timeout' : 'Failed to reach API',
            details: err.message,
        });
    }
});

const pages = createPages();
app.use(pages.router);

// Private station editor — only exists when ADMIN_PASSWORD is set
const admin = createAdmin({
    password: process.env.ADMIN_PASSWORD,
    overlayFile: OVERLAY_FILE,
    loadCurated,
    loadRail: () => { try { return JSON.parse(readFileSync(path.join(BUILD_DIR, 'rail.json'), 'utf8')); } catch { return null; } },
    rebuild: rebuildSoon,
    render: pages.render,
});
if (admin) app.use('/admin', admin);

// Generated data (rail.json, bus-stops.json, meta.json); revalidated on every request via ETag
app.use('/data', express.static(BUILD_DIR, { maxAge: 0 }));

for (const [url, dir] of Object.entries(VENDOR)) app.use(url, express.static(dir));

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(pages.notFound);

app.listen(PORT, () => {
    console.log(`Move app running at http://localhost:${PORT}`);
    if (OASA_API_URL) console.log(`Proxying /api/* to ${OASA_API_URL}`);
    startScheduler();
});
