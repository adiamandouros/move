import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { readJson, writeFileAtomic } from '../files.js';
import { PACE_MS, STASY_LINES } from './stasy.js';

// STASY's airport timetable (data/curated/airport.json, copied by hand from
// two PDFs of June 2024) doesn't change, but in case it does: once a week the
// nightly build fetches STASY's line 3 page and the airport PDFs, and compares
// them with airport.json. Approved 2026-10-20:
//   - 3 requests a week (the page, then each PDF), PACE_MS apart, directly or
//     through the relays like the timetable pages (server/stasy.js)
//   - due AIRPORT_CHECK_MAX_AGE_MS (7 days) after the last check that finished,
//     or as soon as airport.json's PDFs change (after updating it)
//   - no retries: a failed fetch is tried again the next night (at most 3
//     requests a night)
// A change can be a new PDF on the page (STASY uploads a new timetable under
// a new name, and the old one stays), one of ours no longer linked, or one of
// ours whose bytes changed (SHA-256). It fails /api/health, so it's emailed;
// the build keeps adding airport.json's trains meanwhile.
//
// The result, rawDir/stasy/airport-check.json:
// { at, checked?, against?, changes?: [...], route?, error? }
//   at: the last try; checked: when the last check finished; against: which
//   airport.json PDFs it compared with; changes: what differs (empty: nothing);
//   error: why the last try failed (the last finished check's result is kept)

export const AIRPORT_CHECK_MAX_AGE_MS = 7 * 86_400_000;
export const airportCheckFile = rawDir => join(rawDir, 'stasy', 'airport-check.json');
const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A link's file, as people read it: "ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-….pdf"
const fileName = url => decodeURIComponent(new URL(url).pathname.split('/').at(-1));
// A link's path, the same however it's written (stasy.gr or www., encoded or not)
const pathOf = url => decodeURIComponent(new URL(url).pathname);

// The airport PDFs a timetable page links: their names say "ΑΕΡΟΔΡΟΜΙ…"
/** @param {string} html @returns {string[]} */
export function airportLinks(html) {
    const links = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map(m => m[1].replace(/&amp;/g, '&'));
    return [...new Set(links.filter(url => /ΑΕΡΟΔΡΟΜΙ/i.test(fileName(url))))];
}

/**
 * The check, when it's due. client: server/stasy.js's (none, or offline: no check);
 * airport: airport.json (none: nothing to check).
 * @returns {Promise<any>} the result, as kept in airport-check.json, or null when there's none
 */
export async function checkAirport({ rawDir, client = null, airport = null, offline = false, now = Date.now, sleep = realSleep, log = console.log }) {
    const last = readJson(airportCheckFile(rawDir));
    if (offline || !client || !airport) return last;
    const directions = Object.entries(airport.lines).flatMap(([lineId, dirs]) => Object.entries(dirs).map(([dirKey, d]) => ({ lineId, dirKey, ...d })));
    const against = createHash('sha256').update(JSON.stringify(directions.map(d => [d.pdf, d.sha256]))).digest('hex').slice(0, 16);
    if (last?.checked && last.against === against && now() - Date.parse(last.checked) < AIRPORT_CHECK_MAX_AGE_MS) return last;

    const at = new Date(now()).toISOString();
    let result;
    try {
        const changes = [];
        for (const lineId of new Set(directions.map(d => d.lineId))) {
            await sleep(PACE_MS);
            const linked = airportLinks(await client.timetable(STASY_LINES[lineId]));
            const ours = directions.filter(d => d.lineId === lineId).map(d => pathOf(d.pdf));
            for (const url of linked.filter(url => !ours.includes(pathOf(url)))) changes.push(`STASY's ${lineId} page links an airport PDF airport.json doesn't have: ${fileName(url)}`);
            for (const d of directions.filter(d => d.lineId === lineId && !linked.some(url => pathOf(url) === pathOf(d.pdf)))) {
                changes.push(`STASY's ${lineId} page no longer links ${d.lineId}/${d.dirKey}'s PDF: ${fileName(d.pdf)}`);
            }
        }
        for (const d of directions) {
            await sleep(PACE_MS);
            const sha256 = createHash('sha256').update(await client.file(d.pdf)).digest('hex');
            if (sha256 !== d.sha256) changes.push(`${d.lineId}/${d.dirKey}'s PDF changed: ${fileName(d.pdf)}`);
        }
        result = { at, checked: at, against, changes, route: client.route };
        log(changes.length ? `[data] STASY's airport timetable changed: ${changes.join('; ')}` : `[data] Checked STASY's airport timetable: unchanged (${client.route})`);
    } catch (err) {
        result = { ...(last?.checked && { checked: last.checked, against: last.against, changes: last.changes }), at, error: err.message };
        log(`[data] Couldn't check STASY's airport timetable: ${err.message}`);
    }
    mkdirSync(join(rawDir, 'stasy'), { recursive: true });
    writeFileAtomic(airportCheckFile(rawDir), JSON.stringify(result));
    return result;
}
