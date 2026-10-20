import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PACE_MS, STASY_MAX_AGE_MS, extractTables, readLine, stasyFetchFile, stasyNameKey, stasyTables, stationNames } from '../server/data/stasy.js';
import { createStasyClient } from '../server/stasy.js';
import { daysBack, daysOut, lineBack, lineOut, plainBack, plainOut, stasyPage, stasyStations, stasyTable } from './fixtures/stasy.js';

// STASY's first and last trains (server/data/stasy.js): reading its timetable
// pages, and fetching them for the data build (server/stasy.js)

const H = 3600;
const DAY = 86_400;
const at = (h, m) => h * H + m * 60;
const names = stationNames(stasyStations);
const read = (lineId, ...tables) => readLine(lineId, extractTables(stasyPage(tables)), names);
const hours = (direction, station) => Object.fromEntries(direction.hours.get(station).map(({ to, first, last }) => [to, { first, last }]));

test('the first-and-last tables of a page, as text: headings, rows and notes', () => {
    const [out, back] = extractTables(stasyPage([lineOut, lineBack]));
    assert.equal(extractTables(stasyPage([lineOut, lineBack])).length, 2);
    assert.deepEqual(out.header.slice(0, 3), ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟΣ', 'ΠΡΩΤΟ (ΑΕΡΟΔΡΟΜΙΟ)']);
    assert.equal(out.header[6], 'ΤΕΛΕΥΤΑΙΟ (ΔΕΛΤΑ) [ΔΕΥ - ΠΕΜ & ΚΥΡ]');
    assert.deepEqual(out.rows[0], ['ΑΛΦΑ', '05:30', '05:30', '06:06', '22:54', '00:20', '23:57', '01:34']);
    assert.equal(out.rows.length, 5);
    assert.match(out.notes[0], /^Σημείωση: Κάθε Σάββατο υπάρχει 24ωρη λειτουργία/);
    assert.equal(back.rows.at(-1)[0], 'ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ ΑΛΦΑ');
});

test('each column\'s trains go as far as its last time; "to X" counts every train going at least that far', () => {
    const [out] = read('M9', lineOut, lineBack);
    assert.deepEqual(out.stations, ['alpha', 'beta', 'gamma', 'delta', 'airport']);
    const alpha = hours(out, 'alpha');
    assert.deepEqual(Object.keys(alpha), ['gamma', 'delta', 'airport']);
    // To gamma: the last one only as far as gamma (00:20), or later on Fridays to delta (01:34)
    assert.deepEqual(alpha.gamma.last, [DAY + at(0, 20), DAY + at(0, 20), DAY + at(0, 20), DAY + at(0, 20), DAY + at(0, 20), DAY + at(1, 34), null]);
    assert.deepEqual(alpha.delta.last, [at(23, 57), at(23, 57), at(23, 57), at(23, 57), at(23, 57), DAY + at(1, 34), null]);
    // Airport trains: every day the same, and not all night on Saturdays
    assert.deepEqual(alpha.airport, { first: Array(7).fill(at(5, 30)), last: Array(7).fill(at(22, 54)) });
    // From delta, only the airport trains go on
    assert.deepEqual(Object.keys(hours(out, 'delta')), ['airport']);
    assert.equal(out.hours.has('airport'), false);
});

test('Saturday\'s trains run all night on the lines the note names: no last on Saturday, no first on Sunday', () => {
    const [out, back] = read('M9', lineOut, lineBack);
    assert.deepEqual(hours(out, 'alpha').delta.first, [null, ...Array(6).fill(at(5, 30))]);
    // Back from delta: its own trains and the airport trains, to alpha; the airport ones alone at the airport
    assert.deepEqual(hours(back, 'delta').alpha, {
        first: [null, ...Array(6).fill(at(5, 30))],
        last: [DAY + at(0, 1), DAY + at(0, 1), DAY + at(0, 1), DAY + at(0, 1), DAY + at(0, 1), DAY + at(1, 38), null],
    });
    assert.deepEqual(hours(back, 'airport').alpha, { first: Array(7).fill(at(6, 10)), last: Array(7).fill(at(23, 34)) });
    // A line the note doesn't name: Saturday's last train to delta is the last airport train, Sunday starts at 05:30
    const [other] = read('M4', lineOut, lineBack);
    assert.equal(hours(other, 'alpha').delta.last[6], at(22, 54));
    assert.equal(hours(other, 'alpha').delta.first[0], at(5, 30));
});

test('first trains by days: Monday to Friday, and weekends', () => {
    const [out, back] = read('M2', daysOut, daysBack);
    assert.deepEqual(out.stations, ['alpha', 'beta', 'gamma']);
    assert.deepEqual(hours(out, 'alpha').gamma, {
        first: [null, at(5, 30), at(5, 30), at(5, 30), at(5, 30), at(5, 30), at(5, 40)],
        last: [DAY + at(0, 6), DAY + at(0, 6), DAY + at(0, 6), DAY + at(0, 6), DAY + at(0, 6), DAY + at(1, 43), null],
    });
    assert.deepEqual(back.stations, ['gamma', 'beta', 'alpha']);
    assert.deepEqual(hours(back, 'beta').alpha.first, [null, ...Array(6).fill(at(5, 32))]);
});

test('station names: accents, case, dots and Latin look-alikes don\'t matter; other names come from "stasy"', () => {
    const named = stationNames({ ...stasyStations, kat: { name: { el: 'ΚΑΤ', en: 'KAT' } } });
    for (const [written, id] of [['Κ.Α.Τ.', 'kat'], ['ΓAMMA', 'gamma'], ['γάμμα', 'gamma'], ['Βήτα σταθμός', 'beta'], ['ALFA', undefined]]) {
        assert.equal(named.get(stasyNameKey(written)), id, written);
    }
    const unknown = stasyTable(['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ'], [['ΑΛΦΑ', '05:30', '00:15'], ['ΩΜΕΓΑ', '05:32', '00:17'], ['ΓΑΜΜΑ', '05:34', '00:19']]);
    assert.throws(() => read('M1', unknown, daysBack), /unknown station "ΩΜΕΓΑ" \(add how STASY writes it to the station's "stasy" names in stations\.json\)/);
});

test('anything the reader doesn\'t know makes the page unreadable, rather than read wrong', () => {
    const page = (heading, cells = ['05:30', '05:32'], notes = []) => stasyTable(['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', heading], [['ΑΛΦΑ', '05:30', cells[0]], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:32', cells[1]]], notes);
    const back = stasyTable(['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ'], [['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:30', '00:15'], ['ΑΛΦΑ', '05:32', '00:17']]);
    assert.equal(read('M1', page('ΤΕΛΕΥΤΑΙΟ', ['00:15', '00:17']), back).length, 2);
    for (const [table, error] of [
        [page('ΤΕΛΕΥΤΑΙΟ (ΚΑΘΗΜΕΡΙΝΕΣ)', ['00:15', '00:17']), /unknown column "ΤΕΛΕΥΤΑΙΟ \(ΚΑΘΗΜΕΡΙΝΕΣ\)"/],
        [page('ΤΕΛΕΥΤΑΙΟ (ΔΕΥ-ΠΑΡ) (ΣΑΒ)', ['00:15', '00:17']), /unknown column/],
        [page('ΕΠΟΜΕΝΟ', ['00:15', '00:17']), /unknown column "ΕΠΟΜΕΝΟ"/],
        [page('ΤΕΛΕΥΤΑΙΟ', ['24:15', '00:17']), /unknown time "24:15"/],
        [page('ΤΕΛΕΥΤΑΙΟ', ['μετά τις 12', '00:17']), /unknown time/],
        [page('ΤΕΛΕΥΤΑΙΟ (ΠΑΡ)', ['01:30', '01:32']), /no last train from alpha to beta on day 0, 1, 2, 3, 4, 6/],
        [page('ΤΕΛΕΥΤΑΙΟ', ['00:15', '00:17'], ['Σημείωση: 24ωρη λειτουργία τις Κυριακές']), /unknown note/],
        [page('ΤΕΛΕΥΤΑΙΟ', ['00:15', '00:17'], ['* Κάθε Σάββατο υπάρχει 24ωρη λειτουργία στις Γραμμές 1 και 3. Εξαιρούνται τα δρομολόγια προς τον σταθμό.']), /which trains it leaves out/],
    ]) assert.throws(() => read('M1', table, back), error);
    assert.throws(() => read('M1', back), /1 first-and-last tables, not one for each direction/);
    const twice = stasyTable(['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ'], [['ΑΛΦΑ', '05:30', '00:15'], ['ΑΛΦΑ', '05:31', '00:16'], ['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:32', '00:17']]);
    assert.throws(() => read('M1', twice, back), /a station is listed twice/);
});

// ── Fetching ────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-10-20T02:30:00Z');
const pages = { 1: stasyPage([plainOut, plainBack]), 2: stasyPage([daysOut, daysBack]), 3: stasyPage([lineOut, lineBack]) };
// STASY through a fake client: `answer(line)` → page, or throws
function client(answer = line => pages[line]) {
    const asked = [];
    return { asked, route: 'home relay', async timetable(line) { asked.push(line); return answer(line); } };
}
const fetchTables = (rawDir, c, { now = NOW, offline = false, sleeps = [] } = {}) =>
    stasyTables({ rawDir, client: c, stations: stasyStations, offline, now: () => now, sleep: async ms => { sleeps.push(ms); }, log: () => {} });

test('fetches the three pages, a second apart, then keeps the copy for 14 days', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'stasy-'));
    const stasy = client();
    const sleeps = [];
    const { copy } = await fetchTables(rawDir, stasy, { sleeps });
    assert.deepEqual(stasy.asked, [1, 2, 3]);
    assert.deepEqual(sleeps, [PACE_MS, PACE_MS]);
    assert.equal(copy.fetched, new Date(NOW).toISOString());
    assert.deepEqual(Object.keys(copy.lines), ['M1', 'M2', 'M3']);
    assert.deepEqual(copy.lines.M3[0].rows[0].slice(0, 2), ['ΑΛΦΑ', '05:30']);
    // How often trains run, for the nightly checks (rail-checks.js)
    assert.deepEqual(copy.frequencies.M3, [['ΗΜΕΡΑ', 'ΩΡΑ', 'ΣΥΧΝΟΤΗΤΑ'], ['Δευτέρα', '05:30 - 06:00', '10′']]);
    assert.deepEqual(JSON.parse(readFileSync(stasyFetchFile(rawDir), 'utf8')), { at: copy.fetched, ok: true, route: 'home relay' });

    // Less than 14 days later: the copy, without asking
    const later = client();
    assert.deepEqual((await fetchTables(rawDir, later, { now: NOW + STASY_MAX_AGE_MS - 1 })).copy, copy);
    assert.deepEqual(later.asked, []);
    // Offline, or without a client: the copy too
    assert.deepEqual((await fetchTables(rawDir, null)).copy, copy);
    assert.deepEqual((await fetchTables(rawDir, later, { offline: true })).copy, copy);
    // 14 days later, a new one
    assert.equal((await fetchTables(rawDir, later, { now: NOW + STASY_MAX_AGE_MS })).copy.fetched, new Date(NOW + STASY_MAX_AGE_MS).toISOString());
});

test('a failed fetch keeps the last copy; pages that changed keep it too, and say so', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'stasy-'));
    const first = await fetchTables(rawDir, client());
    const later = NOW + STASY_MAX_AGE_MS;

    const down = await fetchTables(rawDir, client(line => { if (line === 2) throw new Error('home relay: HTTP 502'); return pages[line]; }), { now: later });
    assert.deepEqual(down, { copy: first.copy });
    assert.deepEqual(JSON.parse(readFileSync(stasyFetchFile(rawDir), 'utf8')), { at: new Date(later).toISOString(), ok: false, error: 'home relay: HTTP 502' });

    const changed = await fetchTables(rawDir, client(line => line === 3 ? stasyPage([lineOut]) : pages[line]), { now: later });
    assert.deepEqual(changed, { copy: first.copy });
    assert.deepEqual(JSON.parse(readFileSync(stasyFetchFile(rawDir), 'utf8')),
        { at: new Date(later).toISOString(), ok: false, error: 'M3: 1 first-and-last tables, not one for each direction', unreadable: true, route: 'home relay' });

    // With no copy yet: the error
    const empty = mkdtempSync(join(tmpdir(), 'stasy-'));
    assert.deepEqual(await fetchTables(empty, client(() => { throw new Error('direct: HTTP 403'); })), { copy: null, error: 'direct: HTTP 403' });
    assert.deepEqual(await fetchTables(mkdtempSync(join(tmpdir(), 'stasy-')), null), { copy: null, error: 'STASY\'s timetables haven\'t been fetched yet' });
    assert.equal(existsSync(join(empty, 'stasy', 'tables.json')), false);
});

test('the STASY client: a timetable page directly, or through the relays once STASY refuses', async () => {
    const asked = [];
    const fetch = async (url, init) => {
        asked.push(decodeURI(String(url)));
        if (String(url).startsWith('https://www.stasy.gr/')) return new Response('Forbidden', { status: 403 });
        assert.equal(init.headers['X-Relay-Key'], 'k');
        return new Response('<html>line 3</html>');
    };
    const stasy = createStasyClient({ fetch, now: () => NOW, relays: [{ name: 'home relay', url: 'https://pi.example/', key: 'k' }] });
    assert.equal(await stasy.timetable(3), '<html>line 3</html>');
    assert.equal(stasy.route, 'home relay');
    assert.deepEqual(asked, ['https://www.stasy.gr/δρομολόγια/γραμμή-3/', 'https://pi.example/?act=stasyTimetable&line=3']);
    // Direct access rests for a day after a refusal
    await stasy.timetable(1);
    assert.deepEqual(asked.slice(2), ['https://pi.example/?act=stasyTimetable&line=1']);
});

test('the STASY client: an uploaded PDF as bytes, directly or through the relays', async () => {
    const pdf = 'https://www.stasy.gr/wp-content/uploads/2024/06/ΔΙΕΛΕΥΣΕΙΣ-ΣΥΡΜΩΝ.pdf';
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0xe2]);
    const asked = [];
    let refuse = false;
    const fetch = async url => {
        asked.push(decodeURIComponent(String(url)));
        if (refuse && String(url).startsWith('https://www.stasy.gr/')) return new Response('Forbidden', { status: 403 });
        return new Response(bytes);
    };
    const stasy = createStasyClient({ fetch, now: () => NOW, relays: [{ name: 'home relay', url: 'https://pi.example/', key: 'k' }] });
    assert.deepEqual(new Uint8Array(await stasy.file(pdf)), bytes);
    assert.equal(stasy.route, 'direct');
    refuse = true;
    assert.deepEqual(new Uint8Array(await stasy.file(pdf)), bytes);
    assert.equal(stasy.route, 'home relay');
    // The relay is sent the name percent-encoded, as its own rule allows only that
    assert.deepEqual(asked, [pdf, pdf, `https://pi.example/?act=stasyFile&path=${new URL(pdf).pathname.slice(1)}`]);
});
