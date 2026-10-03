import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createExtractorFromFile } from 'node-unrar-js';

// OASA publishes its open data on a CKAN portal. Datasets are looked up by
// name through the CKAN API, so renamed or re-uploaded files (e.g.
// stops_260518.csv → stops_260901.csv) are picked up without code changes.
const CKAN_API = 'https://catalog.growthfund.gr/api/3/action/package_show?id=';

export const USER_AGENT = `Move (Athens transit web app${process.env.CONTACT_EMAIL ? `; ${process.env.CONTACT_EMAIL}` : ''})`;

const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const gtfs = (name, optional = false) => ({ out: `${name}.txt`, pattern: new RegExp(`^${name}\\.(txt|rar)$`, 'i'), optional });

export const SOURCES = {
    rail: {
        dataset: 'dromologia-statheron-sygkinonion',
        files: [gtfs('routes'), gtfs('trips'), gtfs('stop_times'), gtfs('stops'), gtfs('calendar', true), gtfs('calendar_dates', true)],
    },
    bus: {
        dataset: 'dromologia-osy',
        files: [gtfs('routes'), gtfs('trips'), gtfs('stop_times'), gtfs('stops'), gtfs('calendar', true), gtfs('calendar_dates', true)],
    },
    stopTable: {
        dataset: 'pinakas-staseon-oasa',
        files: [{ out: 'stops_all.csv', pattern: /stops_all.*\.csv$/i }],
    },
};

// Make sure every source's files are in rawDir/<source>/, downloading only the
// ones whose `last_modified` on the portal changed since the last run.
//
// Returns { [source]: { dir, files: { name: path }, modified } } or
// { [source]: { error } } when a source can't be fetched and there is no
// earlier copy to fall back on.
export async function fetchSources({ rawDir, offline = false, log = console.log }) {
    const result = {};
    for (const [key, source] of Object.entries(SOURCES)) {
        const dir = join(rawDir, key);
        mkdirSync(dir, { recursive: true });
        try {
            result[key] = offline
                ? useLocal(dir, source)
                : await syncSource(dir, source, log);
        } catch (err) {
            try {
                result[key] = useLocal(dir, source);
                log(`[data] ${key}: ${err.message} — using the copy from ${result[key].modified}`);
            } catch {
                result[key] = { error: err.message };
                log(`[data] ${key}: ${err.message}`);
            }
        }
    }
    return result;
}

async function syncSource(dir, source, log) {
    const res = await fetch(CKAN_API + source.dataset, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`portal returned HTTP ${res.status} for ${source.dataset}`);
    const resources = (await res.json()).result?.resources ?? [];

    const manifestPath = join(dir, 'manifest.json');
    const manifest = readJson(manifestPath) ?? {};
    const files = {};
    let modified = '';

    for (const spec of source.files) {
        const resource = resources.find(r => spec.pattern.test(r.name?.trim() ?? '') || spec.pattern.test(basename(new URL(r.url).pathname)));
        const dest = join(dir, spec.out);
        if (!resource) {
            if (!spec.optional) throw new Error(`${source.dataset} has no resource matching ${spec.pattern}`);
            // Dropped from the feed — remove our copy so it isn't used by mistake
            rmSync(dest, { force: true });
            delete manifest[spec.out];
            continue;
        }

        const version = resource.last_modified || resource.metadata_modified || resource.created;
        const known = manifest[spec.out];
        if (!known || known.url !== resource.url || known.version !== version || !existsSync(dest)) {
            log(`[data] Downloading ${resource.url}`);
            await download(resource.url, dest, spec.out);
            manifest[spec.out] = { url: resource.url, version };
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        }
        files[spec.out] = dest;
        if (version > modified) modified = version;
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return { dir, files, modified };
}

// Use whatever was downloaded last time (offline builds, or the portal is down).
function useLocal(dir, source) {
    const manifest = readJson(join(dir, 'manifest.json')) ?? {};
    const files = {};
    let modified = '';
    for (const spec of source.files) {
        const path = join(dir, spec.out);
        if (!existsSync(path)) {
            if (spec.optional) continue;
            throw new Error(`no local copy of ${spec.out}`);
        }
        files[spec.out] = path;
        const version = manifest[spec.out]?.version ?? '';
        if (version > modified) modified = version;
    }
    return { dir, files, modified };
}

async function download(url, dest, wanted) {
    const tmp = `${dest}.download`;
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

    if (/\.rar$/i.test(new URL(url).pathname)) {
        await extractRar(tmp, wanted, dest);
        rmSync(tmp);
    } else if (/\.zip$/i.test(new URL(url).pathname)) {
        rmSync(tmp);
        throw new Error(`${url} is a zip archive, which is not supported yet`);
    } else {
        renameSync(tmp, dest);
    }
}

async function extractRar(rarPath, wanted, dest) {
    const outDir = `${dest}.extract`;
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir);
    try {
        const extractor = await createExtractorFromFile({ filepath: rarPath, targetPath: outDir });
        // The file list is a lazy generator; extraction only happens while iterating it
        const extracted = [...extractor.extract({ files: h => basename(h.name) === wanted }).files];
        if (!extracted.length) throw new Error(`${basename(rarPath)} does not contain ${wanted}`);
        renameSync(join(outDir, extracted[0].fileHeader.name), dest);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
}

function readJson(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
