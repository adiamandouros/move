import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { userAgentFor } from '../config.js';
import { readJson } from '../files.js';

// OASA publishes its open data on a CKAN portal. Datasets are looked up by
// name through the CKAN API, so renamed or re-uploaded files are picked up
// without code changes. Only the metro and tram timetable is used now: the
// buses come from OASA's live API (oasa-network.js), since its bus timetable
// stopped in August 2026.
export const CKAN_API = 'https://catalog.growthfund.gr/api/3/action/package_show?id=';

const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const gtfs = (name, optional = false) => ({ out: `${name}.txt`, pattern: new RegExp(`^${name}\\.(txt|rar|zip)$`, 'i'), optional });

export const SOURCES = {
    rail: {
        dataset: 'dromologia-statheron-sygkinonion',
        files: [gtfs('routes'), gtfs('trips'), gtfs('stop_times'), gtfs('stops'), gtfs('calendar', true), gtfs('calendar_dates', true)],
    },
};

// Make sure every source's files are in rawDir/<source>/, downloading only the
// ones whose `last_modified` on the portal changed since the last run.
//
// Returns { [source]: { dir, files: { name: path }, modified } } or
// { [source]: { error } } when a source can't be fetched and there is no
// earlier copy to fall back on. `fetch` reaches the portal (tests pass a fake);
// `userAgent` is what it sees us as (config.userAgent).
export async function fetchSources({ rawDir, offline = false, log = console.log, fetch = globalThis.fetch, userAgent = userAgentFor(null) }) {
    const result = {};
    for (const [key, source] of Object.entries(SOURCES)) {
        const dir = join(rawDir, key);
        mkdirSync(dir, { recursive: true });
        try {
            result[key] = offline
                ? useLocal(dir, source)
                : await syncSource(dir, source, log, fetch, userAgent);
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

async function syncSource(dir, source, log, fetch, userAgent) {
    const res = await fetch(CKAN_API + source.dataset, {
        headers: { 'User-Agent': userAgent },
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
            await download(resource.url, dest, fetch, userAgent);
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

async function download(url, dest, fetch, userAgent) {
    // The metro feed comes as plain files. The bus one came in RAR archives
    // too; an archive now is a change worth hearing about, before downloading it.
    const archive = new URL(url).pathname.match(/\.(zip|rar)$/i)?.[1].toLowerCase();
    if (archive) throw new Error(`${url} is a ${archive} archive, which is not supported`);
    const tmp = `${dest}.download`;
    const res = await fetch(url, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, dest);
}
