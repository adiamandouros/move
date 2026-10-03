import 'dotenv/config';
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { athensToday } from './calendar.js';
import { buildBus } from './build-bus.js';
import { buildRail } from './build-rail.js';
import { applyOverlay, pruneOverlay, readOverlay, writeOverlay } from './overlay.js';
import { fetchSources } from './sources.js';
import { validateCurated } from './validate.js';

const DATA_DIR    = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
export const CURATED_DIR = join(DATA_DIR, 'curated');
// Uncommitted station edits from the admin editor (gitignored)
export const OVERLAY_FILE = join(DATA_DIR, 'local', 'positions.json');
const RAW_DIR     = join(DATA_DIR, 'raw');
export const BUILD_DIR = join(DATA_DIR, 'build');
const NEXT_DIR    = join(DATA_DIR, 'build.next');
const PREV_DIR    = join(DATA_DIR, 'build.prev');
const LOCK_FILE   = join(DATA_DIR, '.build.lock');

// Bump when the output format or build logic changes, to force a rebuild.
const BUILDER_VERSION = 1;
const LOCK_STALE_MS = 30 * 60_000;

const OUTPUTS = {
    'rail.json': {
        sources: ['rail'],
        build: (src, curated, today) => buildRail({ dir: src.rail.dir, curated, today }),
    },
    'bus-stops.json': {
        sources: ['bus'],
        build: (src, curated, today) => buildBus({ dir: src.bus.dir, stopTablePath: src.stopTable.files?.['stops_all.csv'], today }),
    },
};

const log = msg => console.log(msg);

// Fetch any changed feeds and rebuild data/build. Outputs are rebuilt when a
// feed or a curated file changed, the builder changed, or the day changed
// (the weekly timetable is chosen relative to today). An output that fails to
// build keeps its previous version; the failure is recorded in meta.json.
export async function runBuild({ force = false, offline = false } = {}) {
    if (!acquireLock()) {
        log('[data] Another build is running — skipping');
        return null;
    }
    try {
        const curated = loadCurated();
        const check = validateCurated(curated.data);
        for (const w of check.warnings) log(`[data] warning: ${w}`);
        if (check.errors.length) throw new Error(`Curated data has errors:\n  ${check.errors.join('\n  ')}`);

        const sources = await fetchSources({ rawDir: RAW_DIR, offline, log });
        const today = athensToday();
        const fingerprint = {
            builder: BUILDER_VERSION,
            curated: curated.hash,
            today,
            sources: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.modified ?? null])),
        };

        const previous = readJson(join(BUILD_DIR, 'meta.json'));
        const allOk = previous && Object.keys(OUTPUTS).every(name => previous.outputs?.[name]?.ok);
        if (!force && allOk && JSON.stringify(previous.fingerprint) === JSON.stringify(fingerprint)) {
            log('[data] Build is up to date');
            return previous;
        }

        rmSync(NEXT_DIR, { recursive: true, force: true });
        mkdirSync(NEXT_DIR, { recursive: true });
        const meta = { generated: new Date().toISOString(), fingerprint, warnings: check.warnings, outputs: {} };

        for (const [name, output] of Object.entries(OUTPUTS)) {
            const started = Date.now();
            try {
                const missing = output.sources.filter(s => sources[s].error);
                if (missing.length) throw new Error(`source unavailable: ${missing.map(s => `${s} (${sources[s].error})`).join(', ')}`);
                const { data, warnings } = await output.build(sources, curated.data, today);
                writeFileSync(join(NEXT_DIR, name), JSON.stringify(data));
                meta.outputs[name] = { ok: true, warnings };
                log(`[data] Built ${name} in ${Date.now() - started} ms${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`);
                for (const w of warnings) log(`[data]   ${w}`);
            } catch (err) {
                const kept = existsSync(join(BUILD_DIR, name));
                if (kept) copyFileSync(join(BUILD_DIR, name), join(NEXT_DIR, name));
                meta.outputs[name] = { ok: false, error: err.message, keptPrevious: kept };
                log(`[data] FAILED ${name}: ${err.message}${kept ? ' — keeping the previous version' : ''}`);
            }
        }

        writeFileSync(join(NEXT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
        publish();
        return meta;
    } finally {
        rmSync(LOCK_FILE, { force: true });
    }
}

// Rebuild shortly after the curated data changes (e.g. an editor save),
// without re-downloading feeds. Saves in quick succession share one build, and
// a save during a running build triggers another one afterwards.
const REBUILD_DELAY_MS = 2000;
let rebuildTimer = null;
let rebuildRunning = false;
let rebuildAgain = false;

export function rebuildSoon() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
        if (rebuildRunning) { rebuildAgain = true; return; }
        rebuildRunning = true;
        try {
            // null means another build holds the lock; try again once it's done
            if (await runBuild({ offline: true }) === null) rebuildAgain = true;
        } catch (err) {
            log(`[data] Rebuild failed: ${err.message}`);
        } finally {
            rebuildRunning = false;
            if (rebuildAgain) { rebuildAgain = false; rebuildSoon(); }
        }
    }, REBUILD_DELAY_MS);
}

// Move each file from build.next into build with an atomic rename, so the
// server never serves a half-written file. The replaced files go to build.prev.
function publish() {
    mkdirSync(BUILD_DIR, { recursive: true });
    rmSync(PREV_DIR, { recursive: true, force: true });
    mkdirSync(PREV_DIR);
    for (const name of [...Object.keys(OUTPUTS), 'meta.json']) {
        const next = join(NEXT_DIR, name);
        if (!existsSync(next)) continue;
        if (existsSync(join(BUILD_DIR, name))) copyFileSync(join(BUILD_DIR, name), join(PREV_DIR, name));
        renameSync(next, join(BUILD_DIR, name));
    }
    rmSync(NEXT_DIR, { recursive: true, force: true });
}

// Read the curated files and apply the editor's overlay on top of positions.
// Overlay entries that the committed positions.json now matches are pruned.
export function loadCurated({ curatedDir = CURATED_DIR, overlayFile = OVERLAY_FILE } = {}) {
    const hash = createHash('sha256');
    const data = {};
    for (const name of ['stations', 'lines', 'positions', 'overrides']) {
        const raw = readFileSync(join(curatedDir, `${name}.json`), 'utf8');
        hash.update(raw);
        try { data[name] = JSON.parse(raw); }
        catch (err) { throw new Error(`data/curated/${name}.json is not valid JSON: ${err.message}`); }
    }

    const { overlay, pruned } = pruneOverlay(data.positions, readOverlay(overlayFile));
    if (pruned.length) {
        writeOverlay(overlayFile, overlay);
        log(`[data] Committed data now includes editor changes for ${pruned.join(', ')} — removed from the overlay`);
    }
    hash.update(JSON.stringify(overlay));
    const committed = data.positions;
    data.positions = applyOverlay(committed, overlay);
    return { data, committed, overlay, hash: hash.digest('hex') };
}

function acquireLock() {
    mkdirSync(DATA_DIR, { recursive: true });
    try {
        writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
        return true;
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        // A lock left behind by a crashed or killed process doesn't count
        const holder = Number(readFileSync(LOCK_FILE, 'utf8'));
        const fresh = Date.now() - statSync(LOCK_FILE).mtimeMs < LOCK_STALE_MS;
        if (fresh && isRunning(holder)) return false;
        rmSync(LOCK_FILE, { force: true });
        return acquireLock();
    }
}

function isRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0); // signal 0 only checks that the process exists
        return true;
    } catch (err) {
        return err.code === 'EPERM'; // exists, but belongs to another user
    }
}

function readJson(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// CLI: npm run build:data [-- --force] [-- --offline]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = new Set(process.argv.slice(2));
    runBuild({ force: args.has('--force'), offline: args.has('--offline') })
        .then(meta => {
            const failed = meta && Object.values(meta.outputs).some(o => !o.ok);
            process.exitCode = failed ? 1 : 0;
        })
        .catch(err => {
            console.error(`[data] Build failed: ${err.message}`);
            process.exitCode = 1;
        });
}
