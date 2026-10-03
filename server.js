import 'dotenv/config';
import compression from 'compression';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { startScheduler } from './server/scheduler.js';
import { readFileSync } from 'fs';
import { createAdmin } from './server/admin/index.js';
import { BUILD_DIR, OVERLAY_FILE, loadCurated, rebuildSoon } from './server/data/index.js';
import { createBusApi } from './server/oasa/index.js';
import { createPages, VENDOR } from './server/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Behind cPanel's Apache proxy: trust its X-Forwarded-* headers for req.ip and req.secure
app.set('trust proxy', 'loopback');
app.use(compression());
const PORT = process.env.PORT || 3000;

// Live bus arrivals from OASA, cached and rate-limited (see server/oasa/)
app.use('/api', createBusApi({ routesFile: path.join(__dirname, 'data', 'cache', 'oasa-routes.json') }));

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
    startScheduler();
});
