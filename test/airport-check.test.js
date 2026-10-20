import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AIRPORT_CHECK_MAX_AGE_MS, airportCheckFile, airportLinks, checkAirport } from '../server/data/airport-check.js';
import { PACE_MS } from '../server/data/stasy.js';

const NOW = Date.parse('2026-10-20T02:30:00Z');
const UPLOADS = 'https://www.stasy.gr/wp-content/uploads/2024/06/';
const TO = `${UPLOADS}ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΠΡΟΣ-ΑΕΡΟΔΡΟΜΙΟ.pdf`;
const FROM = `${UPLOADS}ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΑΠΟ-ΑΕΡΟΔΡΟΜΙΟ.pdf`;
const sha = text => createHash('sha256').update(text).digest('hex');
// airport.json as far as the check reads it
const airport = () => ({ lines: { M3: { doukissis: { pdf: TO, sha256: sha('to') }, dimotiko: { pdf: FROM, sha256: sha('from') } } } });
// STASY's line 3 page, linking `links` (and a PDF that isn't the airport's)
const page = links => `<p><a href="https://stasy.gr/wp-content/uploads/2022/03/APOF.-3677.pdf">x</a>${links.map(l => `<a href="${l}">y</a>`).join('')}</p>`;

// STASY through a fake client: line 3's page links `links`; `files` are the PDFs' bytes
function client({ links = [TO, FROM], files = { [TO]: 'to', [FROM]: 'from' }, down = false } = {}) {
    const asked = [];
    return {
        asked, route: 'home relay',
        async timetable(line) { asked.push(`page ${line}`); if (down) throw new Error('home relay: HTTP 502'); return page(links); },
        async file(url) { asked.push(decodeURI(url).split('/').at(-1)); return Buffer.from(files[url]); },
    };
}
const run = (rawDir, c, { now = NOW, offline = false, file = airport(), sleeps = [] } = {}) =>
    checkAirport({ rawDir, client: c, airport: file, offline, now: () => now, sleep: async ms => { sleeps.push(ms); }, log: () => {} });

test('airportLinks: the airport PDFs a page links, however their address is written', () => {
    assert.deepEqual(airportLinks(page([TO, encodeURI(FROM), TO])), [TO, encodeURI(FROM)]);
    assert.deepEqual(airportLinks('<a href="https://www.stasy.gr/a.pdf">x</a>'), []);
});

test('checks the page and both PDFs, a second apart, then not for a week', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'airport-'));
    const stasy = client();
    const sleeps = [];
    const result = await run(rawDir, stasy, { sleeps });
    assert.deepEqual(stasy.asked, ['page 3', 'ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΠΡΟΣ-ΑΕΡΟΔΡΟΜΙΟ.pdf', 'ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΑΠΟ-ΑΕΡΟΔΡΟΜΙΟ.pdf']);
    assert.deepEqual(sleeps, [PACE_MS, PACE_MS, PACE_MS]);
    assert.deepEqual({ ...result, against: typeof result.against }, { at: new Date(NOW).toISOString(), checked: new Date(NOW).toISOString(), against: 'string', changes: [], route: 'home relay' });
    assert.deepEqual(JSON.parse(readFileSync(airportCheckFile(rawDir), 'utf8')), result);

    // Within the week: the last result, without asking; offline or without a client or airport.json, too
    const later = client();
    assert.deepEqual(await run(rawDir, later, { now: NOW + AIRPORT_CHECK_MAX_AGE_MS - 1 }), result);
    assert.deepEqual(await run(rawDir, later, { offline: true, now: NOW + AIRPORT_CHECK_MAX_AGE_MS }), result);
    assert.deepEqual(await run(rawDir, null, { now: NOW + AIRPORT_CHECK_MAX_AGE_MS }), result);
    assert.deepEqual(later.asked, []);
    // A week on, again
    assert.equal((await run(rawDir, later, { now: NOW + AIRPORT_CHECK_MAX_AGE_MS })).checked, new Date(NOW + AIRPORT_CHECK_MAX_AGE_MS).toISOString());
    assert.equal(later.asked.length, 3);
});

test('a changed PDF, a new airport PDF on the page or one no longer linked are changes', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'airport-'));
    const NEW = `${UPLOADS.replace('2024/06', '2026/11')}ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΝΕΟ.pdf`;
    const result = await run(rawDir, client({ links: [TO, NEW], files: { [TO]: 'to, changed', [FROM]: 'from' } }));
    assert.deepEqual(result.changes, [
        'STASY\'s M3 page links an airport PDF airport.json doesn\'t have: ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΝΕΟ.pdf',
        'STASY\'s M3 page no longer links M3/dimotiko\'s PDF: ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΑΠΟ-ΑΕΡΟΔΡΟΜΙΟ.pdf',
        'M3/doukissis\'s PDF changed: ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ-ΑΕΡΟΔΡΟΜΙΟΥ-ΠΡΟΣ-ΑΕΡΟΔΡΟΜΙΟ.pdf',
    ]);

    // airport.json updated to match: checked again at once, not a week later
    const updated = airport();
    updated.lines.M3.doukissis.sha256 = sha('to, changed');
    const again = client({ files: { [TO]: 'to, changed', [FROM]: 'from' } });
    assert.deepEqual((await run(rawDir, again, { now: NOW + 1000, file: updated })).changes, []);
    assert.equal(again.asked.length, 3);
});

test('a check that can\'t be done keeps the last one\'s result, and is tried again the next night', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'airport-'));
    const first = await run(rawDir, client({ files: { [TO]: 'to, changed', [FROM]: 'from' } }));
    const due = NOW + AIRPORT_CHECK_MAX_AGE_MS;
    const down = client({ down: true });
    const failed = await run(rawDir, down, { now: due });
    assert.deepEqual(failed, { checked: first.checked, against: first.against, changes: first.changes, at: new Date(due).toISOString(), error: 'home relay: HTTP 502' });
    assert.deepEqual(down.asked, ['page 3']);
    const next = client();
    assert.deepEqual((await run(rawDir, next, { now: due + 86_400_000 })).changes, []);
    assert.equal(next.asked.length, 3);
    // Never checked, and the first try fails: just the error
    assert.deepEqual(await run(mkdtempSync(join(tmpdir(), 'airport-')), client({ down: true })), { at: new Date(NOW).toISOString(), error: 'home relay: HTTP 502' });
});
