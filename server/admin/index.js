import { createHash } from 'crypto';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { formatJson } from '../data/format.js';
import { EDITED, applyOverlay, entryAt, removeEntry, sameEntry, setEntry, writeOverlay } from '../data/overlay.js';
import { ATHENS, EXIT_WAYS, POSITIONS, validateCurated } from '../data/validate.js';
import { formatReport } from '../diagnostics.js';
import { sendFresh } from '../http.js';
import { listFiles, shellFiles, shellUrls, urlPath } from '../pages/assets.js';
import { fill, view } from '../pages/templates.js';
import { createAuth, createLimiter, readCookie, sameSecret } from './auth.js';
import { usageView } from './usage.js';

const ADMIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin');
const CLIENT_DIR = join(ADMIN_DIR, 'client');
const COOKIE = 'move_admin';
const require = createRequire(import.meta.url);

// The private station editor, mounted at /admin. Returns null when no
// password is configured, so every /admin URL is a plain 404.
//
//   loadCurated()  → { data, edits }   (see server/data/index.js)
//   loadRail()     → the current rail.json, for station order and names
//   rebuild()      → called after every change
//   diagnose()     → runs the server health checks (server/diagnostics.js)
//   usageDays()    → the days of OASA's usage (server/oasa/usage.js), for /admin/usage
//   liftNames()    → STASY's names for each station's lifts (server/info/lifts.js)
//   exportKey      → reads the export without a session (Authorization: Bearer <key>),
//                    for the nightly pull request of station edits; '' for none
export function createAdmin({ password, exportKey = '', loadCurated, loadRail, rebuild, render, diagnose, usageDays = () => ({}), liftNames = () => ({}) }) {
    if (!password) return null;

    const auth = createAuth(password);
    const limiter = createLimiter();
    const router = express.Router();
    // The admin pages' views (admin/<name>.hbs), in English only
    const views = { login: view('admin/login.hbs'), stations: view('admin/stations.hbs'), diagnostics: view('admin/diagnostics.hbs'), usage: view('admin/usage.hbs') };
    const english = { lang: 'en', strings: {} };
    const styles = ['/admin/assets/admin.css'];
    const serviceWorker = renderServiceWorker();

    router.use((_req, res, next) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        next();
    });

    // Stylesheet and script only — the data and the API stay behind the session check
    router.use('/assets', express.static(CLIENT_DIR));

    // ── Login ───────────────────────────────────────────────────────────────

    const loginPage = (error = '') => render({
        title: 'Log in',
        styles,
        content: views.login({ error }, english),
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

    // ── The export: with a session, or with the export key ───────────────────

    const hasKey = req => Boolean(exportKey) && sameSecret(req.get('Authorization') ?? '', `Bearer ${exportKey}`);

    // A committed file the editor edits, with every edit applied, ready to
    // commit: /api/export/positions.json or /api/export/street.json, and
    // /api/export the first (what the nightly workflow read before there
    // was a second)
    router.get(['/api/export', '/api/export/:file'], (req, res) => {
        if (limiter.blocked(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
        if (!auth.verify(readCookie(req, COOKIE)) && !hasKey(req)) {
            // A wrong key counts like a wrong password
            if (req.get('Authorization')) limiter.fail(req.ip);
            return res.status(401).json({ error: 'Not logged in' });
        }
        const file = req.params.file ?? 'positions.json';
        const kind = Object.values(EDITED).find(k => `${k.name}.json` === file);
        if (!kind) return res.status(404).json({ error: `The editor doesn't edit ${file}` });
        const { data } = loadCurated();
        res.set('Cache-Control', 'no-store')
            .set('Content-Disposition', `attachment; filename="${file}"`)
            .type('json')
            .send(formatJson(data[kind.name], 3) + '\n');
    });

    // ── Everything below needs a session ────────────────────────────────────

    router.use((req, res, next) => {
        if (auth.verify(readCookie(req, COOKIE))) return next();
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
        res.redirect(303, '/admin/login');
    });

    router.get('/', (_req, res) => res.redirect(303, '/admin/stations'));

    router.get('/stations', (_req, res) => {
        sendFresh(res, 'html', render({
            title: 'Station editor',
            styles,
            content: views.stations({}, english),
            scripts: ['/admin/assets/editor.js'],
        }));
    });

    router.get('/diagnostics', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(render({
            title: 'Diagnostics',
            styles,
            content: views.diagnostics({}, english),
            scripts: ['/admin/assets/diagnostics.js', '/admin/assets/accessibility.js'],
        }));
    });

    // What Wayhop asked of OASA each day, and how OASA answered
    router.get('/usage', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(render({
            title: 'Use of OASA',
            styles,
            content: views.usage(usageView(usageDays()), english),
        }));
    });

    router.get('/api/diagnostics', async (_req, res) => {
        if (!diagnose) return res.status(501).json({ error: 'Diagnostics are not available' });
        const result = await diagnose();
        res.set('Cache-Control', 'no-store').json({ ...result, report: formatReport(result) });
    });

    // axe-core, for the accessibility check on the diagnostics page
    // Looked up per request, so a missing package only breaks this check, not the app
    router.get('/vendor/axe.min.js', (_req, res) => {
        let file;
        try {
            file = require.resolve('axe-core/axe.min.js');
        } catch {
            return res.status(503).type('text').send('axe-core is not installed. Run "Run NPM Install" in cPanel → Setup Node.js App, then restart.');
        }
        res.set('Cache-Control', 'no-cache').sendFile(file);
    });

    // Scoped to /admin/, separate from the public service worker, so the
    // editor opens offline on this device without ever entering the public cache
    router.get('/sw.js', (_req, res) => sendFresh(res, 'js', serviceWorker));


    // ── API ─────────────────────────────────────────────────────────────────

    router.get('/api/state', (_req, res) => {
        const rail = loadRail();
        if (!rail) return res.status(503).json({ error: 'rail.json has not been built yet' });
        const { edits } = loadCurated();
        res.set('Cache-Control', 'no-cache').json({
            positions: POSITIONS,
            // What the editor offers and checks before a save, as the server does
            exitWays: EXIT_WAYS,
            bounds: ATHENS,
            stations: Object.fromEntries(Object.entries(rail.stations).map(([id, s]) => [id, { name: s.name, coords: s.coords, lines: s.lines }])),
            lines: Object.fromEntries(Object.entries(rail.lines).map(([id, line]) => [id, {
                name: line.name,
                color: line.color,
                directions: Object.fromEntries(Object.entries(line.directions).map(([dir, d]) => [dir, {
                    toward: d.toward,
                    stations: d.stops.map(s => s.station),
                }])),
            }])),
            committed: edits.positions.committed,
            overlay: edits.positions.overlay,
            street: { committed: edits.street.committed, overlay: edits.street.overlay },
            stasyLifts: liftNames(),
        });
    });

    // object[key] when it's the object's own (so "constructor" in the address finds nothing)
    const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
    // The platform or station in the address, or a 404
    const platform = (req, res) => {
        const { line, dir, station } = req.params;
        const served = own(own(loadRail()?.lines, line)?.directions, dir)?.stops.some(s => s.station === station);
        if (!served) { res.status(404).json({ error: `${line}/${dir} does not serve ${station}` }); return null; }
        return { line, dir, station };
    };
    const station = (req, res) => {
        if (own(loadRail()?.stations, req.params.station)) return { station: req.params.station };
        res.status(404).json({ error: `There's no station ${req.params.station}` });
        return null;
    };

    // Saving an entry (PUT) or going back to the committed one (DELETE), in
    // the file `kind` edits, for the place in the address
    function editing(kind, path, place) {
        router.put(path, express.json({ limit: '20kb' }), (req, res) => {
            const ref = place(req, res);
            if (!ref) return;
            const entry = kind.tidy(req.body?.entry ?? {});
            const curated = loadCurated();
            const { committed, overlay: before, file } = curated.edits[kind.name];

            // Saving what's already committed just removes the edit
            const overlay = sameEntry(entryAt(committed, ref, kind), entry, kind) ? removeEntry(before, ref, kind) : setEntry(before, ref, entry, kind);
            const { errors } = validateCurated({ ...curated.data, [kind.name]: applyOverlay(committed, overlay, kind) });
            if (errors.length) return res.status(400).json({ error: 'Invalid entry', details: errors });

            writeOverlay(file, overlay);
            rebuild();
            res.json({ entry, edited: entryAt(overlay, ref, kind) !== undefined });
        });

        router.delete(path, (req, res) => {
            const ref = place(req, res);
            if (!ref) return;
            const { committed, overlay, file } = loadCurated().edits[kind.name];
            writeOverlay(file, removeEntry(overlay, ref, kind));
            rebuild();
            res.json({ entry: entryAt(committed, ref, kind) ?? null, edited: false });
        });
    }

    editing(EDITED.positions, '/api/positions/:line/:dir/:station', platform);
    editing(EDITED.street, '/api/street/:station', station);

    return router;
}

function renderServiceWorker() {
    const template = readFileSync(join(ADMIN_DIR, 'sw.js'), 'utf8');
    const assets = listFiles(CLIENT_DIR).map(f => urlPath('/admin/assets', CLIENT_DIR, f));
    const hash = createHash('sha256').update(template);
    for (const file of [...listFiles(ADMIN_DIR), ...shellFiles()]) hash.update(readFileSync(file));
    return fill(template, {
        version: hash.digest('hex').slice(0, 12),
        precache: JSON.stringify(['/admin/stations', ...assets, ...shellUrls()], null, 4),
    });
}
