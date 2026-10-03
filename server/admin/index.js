import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { formatJson } from '../data/format.js';
import { applyOverlay, removeEntry, sameEntry, setEntry, tidyEntry, writeOverlay } from '../data/overlay.js';
import { POSITIONS, validateCurated } from '../data/validate.js';
import { formatReport } from '../diagnostics.js';
import { listFiles, shellFiles, shellUrls, urlPath } from '../pages.js';
import { createAuth, createLimiter, readCookie } from './auth.js';

const ADMIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin');
const CLIENT_DIR = join(ADMIN_DIR, 'client');
const COOKIE = 'move_admin';

// The private station editor, mounted at /admin. Returns null when no
// password is configured, so every /admin URL is a plain 404.
//
//   loadCurated()  → { data, committed, overlay }   (see server/data/index.js)
//   loadRail()     → the current rail.json, for station order and names
//   rebuild()      → called after every change
//   diagnose()     → runs the server health checks (server/diagnostics.js)
export function createAdmin({ password, overlayFile, loadCurated, loadRail, rebuild, render, diagnose }) {
    if (!password) return null;

    const auth = createAuth(password);
    const limiter = createLimiter();
    const router = express.Router();
    const page = name => readFileSync(join(ADMIN_DIR, `${name}.html`), 'utf8');
    const head = '    <link rel="stylesheet" href="/admin/assets/admin.css">';
    const serviceWorker = renderServiceWorker();

    router.use((req, res, next) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        next();
    });

    // Stylesheet and script only — the data and the API stay behind the session check
    router.use('/assets', express.static(CLIENT_DIR));

    // ── Login ───────────────────────────────────────────────────────────────

    const loginPage = (error = '') => render({
        title: 'Log in',
        head,
        content: page('login').replace('{{error}}', error ? `<p class="text-danger small" role="alert">${error}</p>` : ''),
    });

    router.get('/login', (_req, res) => res.set('Cache-Control', 'no-store').type('html').send(loginPage()));

    router.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
        const client = req.ip;
        if (limiter.blocked(client)) {
            return res.status(429).type('html').send(loginPage('Too many attempts. Try again in 15 minutes.'));
        }
        if (!auth.checkPassword(req.body?.password ?? '')) {
            limiter.fail(client);
            return res.status(401).type('html').send(loginPage('Wrong password.'));
        }
        limiter.reset(client);
        res.cookie(COOKIE, auth.issue(), {
            path: '/admin',
            httpOnly: true,
            sameSite: 'strict',
            secure: req.secure,
            maxAge: auth.sessionMs,
        });
        res.redirect(303, '/admin/stations');
    });

    router.post('/logout', (_req, res) => {
        res.clearCookie(COOKIE, { path: '/admin' });
        res.redirect(303, '/admin/login');
    });

    // ── Everything below needs a session ────────────────────────────────────

    router.use((req, res, next) => {
        if (auth.verify(readCookie(req, COOKIE))) return next();
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
        res.redirect(303, '/admin/login');
    });

    router.get('/', (_req, res) => res.redirect(303, '/admin/stations'));

    router.get('/stations', (_req, res) => {
        res.set('Cache-Control', 'no-cache').type('html').send(render({
            title: 'Station editor',
            head,
            content: page('stations'),
            scripts: ['/admin/assets/editor.js'],
        }));
    });

    router.get('/diagnostics', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(render({
            title: 'Diagnostics',
            head,
            content: page('diagnostics'),
            scripts: ['/admin/assets/diagnostics.js'],
        }));
    });

    router.get('/api/diagnostics', async (_req, res) => {
        if (!diagnose) return res.status(501).json({ error: 'Diagnostics are not available' });
        const result = await diagnose();
        res.set('Cache-Control', 'no-store').json({ ...result, report: formatReport(result) });
    });

    // Scoped to /admin/, separate from the public service worker, so the
    // editor opens offline on this device without ever entering the public cache
    router.get('/sw.js', (_req, res) => res.set('Cache-Control', 'no-cache').type('js').send(serviceWorker));


    // ── API ─────────────────────────────────────────────────────────────────

    router.get('/api/state', (_req, res) => {
        const rail = loadRail();
        if (!rail) return res.status(503).json({ error: 'rail.json has not been built yet' });
        const { committed, overlay } = loadCurated();
        res.set('Cache-Control', 'no-cache').json({
            positions: POSITIONS,
            stations: Object.fromEntries(Object.entries(rail.stations).map(([id, s]) => [id, { name: s.name, coords: s.coords, lines: s.lines }])),
            lines: Object.fromEntries(Object.entries(rail.lines).map(([id, line]) => [id, {
                name: line.name,
                color: line.color,
                directions: Object.fromEntries(Object.entries(line.directions).map(([dir, d]) => [dir, {
                    toward: d.toward,
                    stations: d.stops.map(s => s.station),
                }])),
            }])),
            committed,
            overlay,
        });
    });

    const target = (req, res) => {
        const { line, dir, station } = req.params;
        const served = loadRail()?.lines[line]?.directions[dir]?.stops.some(s => s.station === station);
        if (!served) { res.status(404).json({ error: `${line}/${dir} does not serve ${station}` }); return null; }
        return { line, dir, station };
    };

    router.put('/api/positions/:line/:dir/:station', express.json({ limit: '20kb' }), (req, res) => {
        const ref = target(req, res);
        if (!ref) return;
        const entry = tidyEntry(req.body?.entry ?? {});
        const curated = loadCurated();
        const committedEntry = curated.committed[ref.line]?.[ref.dir]?.[ref.station];

        // Saving what's already committed just removes the edit
        const overlay = sameEntry(committedEntry, entry) ? removeEntry(curated.overlay, ref) : setEntry(curated.overlay, ref, entry);
        const { errors } = validateCurated({ ...curated.data, positions: applyOverlay(curated.committed, overlay) });
        if (errors.length) return res.status(400).json({ error: 'Invalid entry', details: errors });

        writeOverlay(overlayFile, overlay);
        rebuild();
        res.json({ entry, edited: Boolean(overlay[ref.line]?.[ref.dir]?.[ref.station]) });
    });

    router.delete('/api/positions/:line/:dir/:station', (req, res) => {
        const ref = target(req, res);
        if (!ref) return;
        const curated = loadCurated();
        writeOverlay(overlayFile, removeEntry(curated.overlay, ref));
        rebuild();
        res.json({ entry: curated.committed[ref.line]?.[ref.dir]?.[ref.station] ?? null, edited: false });
    });

    // The committed positions.json with every edit applied, ready to commit
    router.get('/api/export', (_req, res) => {
        const { data } = loadCurated();
        res.set('Content-Disposition', 'attachment; filename="positions.json"')
            .type('json')
            .send(formatJson(data.positions, 3) + '\n');
    });

    return router;
}

function renderServiceWorker() {
    const template = readFileSync(join(ADMIN_DIR, 'sw.js'), 'utf8');
    const assets = listFiles(CLIENT_DIR).map(f => urlPath('/admin/assets', CLIENT_DIR, f));
    const hash = createHash('sha256').update(template);
    for (const file of [...listFiles(ADMIN_DIR), ...shellFiles()]) hash.update(readFileSync(file));
    return template
        .replace('{{version}}', hash.digest('hex').slice(0, 12))
        .replace('{{precache}}', JSON.stringify(['/admin/stations', ...assets, ...shellUrls()], null, 4));
}
