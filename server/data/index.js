import { fork } from 'child_process';
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { getPriority, setPriority } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { loadConfig, userAgentFor } from '../config.js';
import { readJson } from '../files.js';
import { athensToday } from './calendar.js';
import { buildBusLines, buildBusStops } from './build-bus.js';
import { buildRail } from './build-rail.js';
import { buildTram } from './build-tram.js';
import { checkOutput, shrinkage } from './check-output.js';
import { createOasaClient } from '../oasa/client.js';
import { EDITED, applyOverlay, pruneOverlay, readOverlay, writeOverlay } from './overlay.js';
import { liveNetwork } from './oasa-network.js';
import { fetchSources } from './sources.js';
import { checkAirport } from './airport-check.js';
import { checkRail } from './rail-checks.js';
import { stasyTables } from './stasy.js';
import { createStasyClient } from '../stasy.js';
import { validateCurated } from './validate.js';

const DATA_DIR    = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const CURATED_DIR = join(DATA_DIR, 'curated');
// Uncommitted station edits from the admin editor (gitignored), a file named
// like each one it edits (positions.json, street.json)
const OVERLAY_DIR = join(DATA_DIR, 'local');
export const BUILD_DIR = join(DATA_DIR, 'build');

// Where a build keeps its files, under a data folder (data/, or a test's own)
const foldersIn = dataDir => ({
    data: dataDir,
    raw: join(dataDir, 'raw'),
    build: join(dataDir, 'build'),
    next: join(dataDir, 'build.next'),
    prev: join(dataDir, 'build.prev'),
    lock: join(dataDir, '.build.lock'),
});

// The build's own code, as a short hash of every file in this folder: when
// it changes (a deploy with a fix to the build), the next build rebuilds
// everything, even with the same feeds on the same day. Before, a version
// number had to be bumped by hand, and forgetting it delayed a fix by a day.
export function builderFingerprint(dir = dirname(fileURLToPath(import.meta.url))) {
    const hash = createHash('sha256');
    for (const name of readdirSync(dir).filter(n => n.endsWith('.js')).sort()) hash.update(name).update(readFileSync(join(dir, name)));
    return hash.digest('hex').slice(0, 12);
}
const LOCK_STALE_MS = 30 * 60_000;
// Exit code of the CLI (below) when another build holds the lock
const BUSY_EXIT_CODE = 3;

const OUTPUTS = {
    'rail.json': {
        sources: ['rail'],
        // STASY's first and last trains when there's a copy (stasy.js); without one, the GTFS's
        // and the nightly checks of what it built against STASY's tables (rail-checks.js)
        build: async (src, curated, today) => {
            const { data, warnings, notes } = await buildRail({ dir: src.rail.dir, curated, today, stasy: src.stasy.data });
            // The tram, for its map on the Info page, from the same feed (build-tram.js)
            if (curated.tram) {
                try {
                    const tram = await buildTram({ dir: src.rail.dir, tram: curated.tram, metroStations: data.stations });
                    data.tram = tram.data;
                    warnings.push(...tram.warnings);
                } catch (err) {
                    warnings.push(`Tram map left out: ${err.message}`);
                }
            }
            return { data, warnings, checks: checkRail(data, { frequencies: src.stasy.data?.frequencies ?? null, notes }) };
        },
    },
    // From OASA's live API (oasa-network.js), not its open-data timetable, which falls behind
    'bus-stops.json': {
        sources: ['network'],
        build: src => buildBusStops(src.network.data),
    },
    'bus-lines.json': {
        sources: ['network'],
        build: src => buildBusLines(src.network.data),
    },
};

// Fetch any changed feeds and rebuild data/build. Outputs are rebuilt when a
// feed or a curated file changed, the builder changed, or the day changed
// (the weekly timetable is chosen relative to today). An output that fails to
// build keeps its previous version; the failure is recorded in meta.json.
// `userAgent` is what the portal sees us as (config.userAgent). `oasa` asks
// OASA's live API for the bus network (request(act, p1), server/oasa/client.js;
// without it the kept network is used), and `stasy` STASY's site for its
// timetables and the weekly check of its airport timetable (server/stasy.js;
// without it, the kept copy and no check). The other options are for tests:
// their own data folder and curated files, a fake portal (`fetch`), a fixed
// day (`today`, 'YYYYMMDD'), the clock and pause between OASA requests
// (`now`, `sleep`) and the builder's fingerprint.
export async function runBuild({
    force = false,
    offline = false,
    dataDir = DATA_DIR,
    curatedDir = CURATED_DIR,
    overlayDir = OVERLAY_DIR,
    fetch = globalThis.fetch,
    userAgent = userAgentFor(null),
    oasa = null,
    stasy = null,
    today = athensToday(),
    now = Date.now,
    sleep = undefined,
    log = console.log,
    builder = builderFingerprint(),
} = {}) {
    const dirs = foldersIn(dataDir);
    if (!acquireLock(dirs)) {
        log('[data] Another build is running — skipping');
        return null;
    }
    try {
        const curated = loadCurated({ curatedDir, overlayDir, log });
        const check = validateCurated(curated.data);
        for (const w of check.warnings) log(`[data] warning: ${w}`);
        if (check.errors.length) throw new Error(`Curated data has errors:\n  ${check.errors.join('\n  ')}`);

        const sources = await fetchSources({ rawDir: dirs.raw, offline, log, fetch, userAgent });
        const network = await liveNetwork({ rawDir: dirs.raw, request: oasa, offline, now, sleep, log });
        sources.network = { data: network.network, modified: network.network?.fetched ?? null, error: network.error };
        const timetables = await stasyTables({ rawDir: dirs.raw, client: stasy, stations: curated.data.stations.stations, offline, now, sleep, log });
        sources.stasy = { data: timetables.copy, modified: timetables.copy?.fetched ?? null, error: timetables.error };
        // Weekly: has STASY's airport timetable changed since airport.json? (only reported)
        await checkAirport({ rawDir: dirs.raw, client: stasy, airport: curated.data.airport, offline, now, sleep, log });
        const fingerprint = {
            builder,
            curated: curated.hash,
            today,
            sources: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.modified ?? null])),
        };

        const previous = readJson(join(dirs.build, 'meta.json'));
        const allOk = previous && Object.keys(OUTPUTS).every(name => previous.outputs?.[name]?.ok);
        if (!force && allOk && JSON.stringify(previous.fingerprint) === JSON.stringify(fingerprint)) {
            log('[data] Build is up to date');
            return previous;
        }

        rmSync(dirs.next, { recursive: true, force: true });
        mkdirSync(dirs.next, { recursive: true });
        const meta = { generated: new Date().toISOString(), fingerprint, warnings: check.warnings, outputs: {} };

        for (const [name, output] of Object.entries(OUTPUTS)) {
            const started = Date.now();
            try {
                const missing = output.sources.filter(s => sources[s].error);
                if (missing.length) throw new Error(`source unavailable: ${missing.map(s => `${s} (${sources[s].error})`).join(', ')}`);
                const built = await output.build(sources, curated.data, today);
                const { data, warnings } = built;
                // Only rail.json has checks of its own
                const checks = 'checks' in built ? built.checks : undefined;
                // Never replace a good file with a broken or much smaller one (--force accepts a smaller one)
                const problems = [...checkOutput(name, data), ...(force ? [] : shrinkage(name, data, readJson(join(dirs.build, name))))];
                if (problems.length) throw new Error(`failed its checks: ${problems.join('; ')}`);
                writeFileSync(join(dirs.next, name), JSON.stringify(data));
                meta.outputs[name] = { ok: true, warnings, ...(checks && { checks }) };
                log(`[data] Built ${name} in ${Date.now() - started} ms${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`);
                for (const w of warnings) log(`[data]   ${w}`);
                for (const p of checks?.problems ?? []) log(`[data]   PROBLEM: ${p}`);
                for (const n of checks?.notes ?? []) log(`[data]   note: ${n}`);
            } catch (err) {
                const kept = existsSync(join(dirs.build, name));
                if (kept) copyFileSync(join(dirs.build, name), join(dirs.next, name));
                meta.outputs[name] = { ok: false, error: err.message, keptPrevious: kept };
                log(`[data] FAILED ${name}: ${err.message}${kept ? ' — keeping the previous version' : ''}`);
            }
        }

        writeFileSync(join(dirs.next, 'meta.json'), JSON.stringify(meta, null, 2));
        publish(dirs);
        return meta;
    } finally {
        rmSync(dirs.lock, { force: true });
    }
}

// The server runs its builds through this: a child process running this
// file's CLI, so a build doesn't share the server's memory or event loop. A
// build parses the 62 MB metro timetable (and used to parse OASA's 220 MB bus
// one, which in the server grew it by over 100 MB, kept afterwards, and
// paused it for up to 140 ms); running out of memory would have stopped the
// site, not just the build.
// → 'built' (or already up to date), 'failed' or 'busy' (another build is running)
export function runBuildInChild({ force = false, offline = false } = {}) {
    const args = [...(force ? ['--force'] : []), ...(offline ? ['--offline'] : [])];
    return new Promise(resolve => {
        // Without the server's own flags: `node --watch-path` (npm run dev) would keep the build running
        const child = fork(fileURLToPath(import.meta.url), args, { execArgv: [] });
        // Lower priority than the server (19 is the lowest), so visitors come first
        try { setPriority(child.pid, Math.min(19, getPriority() + 10)); } catch { /* not allowed here: same priority, still a separate process */ }
        child.on('error', err => {
            console.log(`[data] Couldn't start the build: ${err.message}`);
            resolve('failed');
        });
        child.on('exit', code => resolve(code === 0 ? 'built' : code === BUSY_EXIT_CODE ? 'busy' : 'failed'));
    });
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
            // Another build holds the lock: try again once it's done
            if (await runBuildInChild({ offline: true }) === 'busy') rebuildAgain = true;
        } finally {
            rebuildRunning = false;
            if (rebuildAgain) { rebuildAgain = false; rebuildSoon(); }
        }
    }, REBUILD_DELAY_MS);
}

// Move each file from build.next into build with an atomic rename, so the
// server never serves a half-written file. The replaced files go to build.prev.
// A file that came out the same as the one served is left as it was: its
// time, and so its ETag, don't change, so browsers keep their copy and the
// server doesn't read it again (most nights, for the bus files).
function publish(dirs) {
    mkdirSync(dirs.build, { recursive: true });
    rmSync(dirs.prev, { recursive: true, force: true });
    mkdirSync(dirs.prev);
    for (const name of [...Object.keys(OUTPUTS), 'meta.json']) {
        const next = join(dirs.next, name);
        const served = join(dirs.build, name);
        if (!existsSync(next)) continue;
        if (existsSync(served)) {
            if (readFileSync(served).equals(readFileSync(next))) continue;
            copyFileSync(served, join(dirs.prev, name));
        }
        renameSync(next, served);
    }
    rmSync(dirs.next, { recursive: true, force: true });
}

// airport.json (STASY's airport trains), tram.json (the tram map's stops) and
// street.json (the stations' exits and lifts on the street) can be missing
const OPTIONAL_CURATED = ['airport', 'tram', 'street'];

// Read the curated files and apply the editor's overlays on top of the ones
// it edits (positions.json, street.json): `data` as the site uses it, and
// `edits`, each edited file's { committed, overlay }. Overlay entries a
// committed file now matches are pruned.
export function loadCurated({ curatedDir = CURATED_DIR, overlayDir = OVERLAY_DIR, log = console.log } = {}) {
    const hash = createHash('sha256');
    const data = /** @type {{ stations: any, lines: any, positions: any, airport?: any, tram?: any, street?: any }} */ ({});
    for (const name of ['stations', 'lines', 'positions', 'airport', 'tram', 'street']) {
        if (OPTIONAL_CURATED.includes(name) && !existsSync(join(curatedDir, `${name}.json`))) continue;
        const raw = readFileSync(join(curatedDir, `${name}.json`), 'utf8');
        hash.update(raw);
        try { data[name] = JSON.parse(raw); }
        catch (err) { throw new Error(`data/curated/${name}.json is not valid JSON: ${err.message}`, { cause: err }); }
    }

    const edits = {};
    for (const kind of Object.values(EDITED)) {
        const file = join(overlayDir, `${kind.name}.json`);
        const committed = data[kind.name] ?? {};
        const { overlay, pruned } = pruneOverlay(committed, readOverlay(file, kind), kind);
        if (pruned.length) {
            writeOverlay(file, overlay);
            log(`[data] Committed ${kind.name}.json now includes editor changes for ${pruned.join(', ')} — removed from the overlay`);
        }
        hash.update(JSON.stringify(overlay));
        data[kind.name] = applyOverlay(committed, overlay, kind);
        edits[kind.name] = { committed, overlay, file };
    }
    return { data, edits, hash: hash.digest('hex') };
}

function acquireLock(dirs) {
    mkdirSync(dirs.data, { recursive: true });
    try {
        writeFileSync(dirs.lock, String(process.pid), { flag: 'wx' });
        return true;
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        // A lock left behind by a crashed or killed process doesn't count
        const holder = Number(readFileSync(dirs.lock, 'utf8'));
        const fresh = Date.now() - statSync(dirs.lock).mtimeMs < LOCK_STALE_MS;
        if (fresh && isRunning(holder)) return false;
        rmSync(dirs.lock, { force: true });
        return acquireLock(dirs);
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

// CLI: npm run build:data [-- --force] [-- --offline]
// Exits with 0 when built or up to date, 1 when something failed, and
// BUSY_EXIT_CODE when another build is running.
// The server's builds run it too (runBuildInChild), with the server's settings
// already in their environment; from a terminal, they come from .env. (No
// top-level await here, or anywhere the server imports: the live host starts
// server.js with require(), which can't load it. test/startup.test.js)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    dotenv.config();
    const args = new Set(process.argv.slice(2));
    const config = loadConfig();
    const offline = args.has('--offline');
    // The bus network comes the way live times do, and STASY's timetables the way
    // its announcements do: directly, or through the relays
    const oasa = offline ? null : createOasaClient({ relays: config.relays, userAgent: config.userAgent }).request;
    const stasy = offline ? null : createStasyClient({ relays: config.relays, userAgent: config.userAgent });
    runBuild({ force: args.has('--force'), offline, userAgent: config.userAgent, oasa, stasy })
        .then(meta => {
            const failed = meta && Object.values(meta.outputs).some(o => !o.ok);
            return meta === null ? BUSY_EXIT_CODE : failed ? 1 : 0;
        }, err => {
            console.error(`[data] Build failed: ${err.message}`);
            return 1;
        })
        // Exits rather than waiting until nothing is left to do: on the host,
        // the child starts as `node --require lsnode.js` (LiteSpeed's, even
        // with execArgv: []), something keeps it alive, and builds stayed
        // running for hours, 11 threads each (2026-10-28)
        .then(code => process.exit(code));
}
