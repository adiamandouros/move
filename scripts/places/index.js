// Builds the address search index on GitHub (.github/workflows/places-index.yml):
// fetches OpenStreetMap's data, builds, checks, and writes the file to publish.
// Nothing is written if the checks fail, so the published index stays.
//
//   node --max-old-space-size=4096 scripts/places/index.js <out.json.gz>
//
// Runs on GitHub without npm install: Node's own modules only.

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';
import { countsOf, PUBLISHED, unpack } from '../../server/places/published.js';
import { buildIndex } from './build.js';
import { problemsWith } from './check.js';
import { fetchAll } from './fetch.js';

// The stations come from the live site: rail.json is built there, not kept here
const RAIL = 'https://wayhop.gr/data/rail.json';

/** @typedef {import('./fetch.js').Get} Get */

// The published index's counts, or null before the first one
/** @param {Get} get */
export async function publishedCounts(get = fetch) {
    const response = await get(PUBLISHED);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`The published index: ${response.status}`);
    return countsOf(unpack(Buffer.from(await response.arrayBuffer())));
}

/** @param {Get} get @returns {Promise<import('../../types/data.js').Rail>} */
async function railData(get) {
    const response = await get(RAIL);
    if (!response.ok) throw new Error(`rail.json: ${response.status}`);
    return response.json();
}

// The index, compressed, or an error saying everything that's wrong with it
/**
 * @param {{ get?: Get, raw?: import('./fetch.js').Answers | null, log?: (message: unknown) => void, checks?: Parameters<typeof problemsWith>[1] }} [options]
 */
export async function makeIndex({ get = fetch, raw = null, log = console.log, checks = {} } = {}) {
    const [rail, previous] = [await railData(get), await publishedCounts(get)];
    const { index, stats } = buildIndex(raw ?? await fetchAll({ get, log }), rail);
    log(stats);
    log({ ...countsOf(index), previous });
    const problems = problemsWith(index, { previous, ...checks });
    if (problems.length) throw new Error(`The index isn't good enough:\n${problems.join('\n')}`);
    return gzipSync(JSON.stringify(index), { level: 9 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const out = process.argv[2];
    const file = await makeIndex();
    writeFileSync(out, file);
    console.log({ out, megabytes: +(file.length / 1e6).toFixed(2), peakMemoryMB: Math.round(process.resourceUsage().maxRSS / 1024) });
}
