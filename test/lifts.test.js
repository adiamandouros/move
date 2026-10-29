import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { stationNames } from '../server/data/stasy.js';
import { liftChecks } from '../server/diagnostics.js';
import { createHealth } from '../server/health.js';
import { createLifts, LIFTS_PAGE, parseLifts } from '../server/info/lifts.js';
import { liftsPage, STASY_LINES } from './fixtures/stasy-lifts.js';
import { browserModule } from './support/browser-modules.js';

const stations = JSON.parse(readFileSync(new URL('../data/curated/stations.json', import.meta.url), 'utf8')).stations;
const names = stationNames(stations);

const OUT = {
    line119: { 'Κεραμεικός': { status: 'Error', lifts: [['Προς Δημοτικό Θέατρο', true], ['Εξωτερικός Τεχνόπολις Γκάζι', false]] } },
    // Omonia is on two lines, a lift out on each
    line118: { 'Ομόνοια': { status: 'Warning', lifts: [['Προς Πειραιά', false]] } },
    line117: { 'Ομόνοια': { status: 'Warning', lifts: [['Προς Ανθούπολη', false], ['Προς Ελληνικό', true]] } },
};

test('every station on STASY\'s lift page is one of ours', () => {
    const { unknown, checked } = parseLifts(liftsPage(), names);
    assert.deepEqual(unknown, []);
    // All but Nerantziotissa and the airport branch, which have no lifts listed
    assert.equal(checked, new Set(Object.values(STASY_LINES).flat()).size - 5);
});

test('the lift page gives the stations with lifts out, by STASY\'s names for them', () => {
    const { stations: out } = parseLifts(liftsPage(OUT), names);
    assert.deepEqual(out, {
        kerameikos: { status: 'closed', out: ['Εξωτερικός Τεχνόπολις Γκάζι'] },
        omonia: { status: 'partial', out: ['Προς Πειραιά', 'Προς Ανθούπολη'] },
    });
});

test('a station on two lines counts its worst status, and no-lift stations are left out', () => {
    const { stations: out } = parseLifts(liftsPage({
        line118: { 'Μοναστηράκι': { status: 'Warning', lifts: [['Προς Κηφισιά', false]] }, 'Νερατζιώτισσα': { status: 'Unknown', lifts: [] } },
        line119: { 'Μοναστηράκι': { status: 'Error', lifts: [['Εξωτερικός', false]] } },
    }), names);
    assert.deepEqual(out, { monastiraki: { status: 'closed', out: ['Προς Κηφισιά', 'Εξωτερικός'] } });
});

test('every station\'s lifts by STASY\'s names, for the station editor: a station on two lines counts each lift once, two lifts with one name twice', () => {
    const { lifts, stations: out } = parseLifts(liftsPage({
        line118: { 'Πειραιάς': { status: 'Warning', lifts: [['Εξωτερικός Ακτή Καλλιμασιώτη ', true], ['Προς Αεροδρόμιο', true], ['Εξωτερικός  Ακτή\tΚαλλιμασιώτη', false], ['', true]] } },
        line119: { 'Πειραιάς': { status: 'Warning', lifts: [['Εξωτερικός Ακτή Καλλιμασιώτη', true], ['Προς Αεροδρόμιο', true], ['Εξωτερικός Ακτή Καλλιμασιώτη', false], ['Προς Δημοτικό Θέατρο', true]] } },
    }), names);
    // Spaces and tabs tidied, the empty name left out
    assert.deepEqual(lifts.piraeus, ['Εξωτερικός Ακτή Καλλιμασιώτη', 'Προς Αεροδρόμιο', 'Εξωτερικός Ακτή Καλλιμασιώτη', 'Προς Δημοτικό Θέατρο']);
    assert.deepEqual(out.piraeus.out, ['Εξωτερικός Ακτή Καλλιμασιώτη']);
    // Every lift of every station, working or not
    assert.deepEqual(lifts.kifisia, ['Προς Α', 'Προς Β']);
    assert.equal(lifts.nerantziotissa, undefined, 'no lifts listed');
});

test('a station Wayhop doesn\'t know is left out and listed; a page with few stations has changed', () => {
    const lines = { ...STASY_LINES, line120: ['Νέος Σταθμός'] };
    const { stations: out, unknown } = parseLifts(liftsPage({ line120: { 'Νέος Σταθμός': { status: 'Error', lifts: [['Εξωτερικός', false]] } } }, lines), names);
    assert.deepEqual(out, {});
    assert.deepEqual(unknown, ['Νέος Σταθμός']);
    assert.throws(() => parseLifts(liftsPage({}, { line118: STASY_LINES.line118 }), names), /has it changed/);
    assert.throws(() => parseLifts('<html>Maintenance</html>', names), /has it changed/);
});

// A fake web: the lift page (a string, an Error, or a function giving one);
// records each URL fetched
function fakeWeb(page) {
    const calls = [];
    const fetch = async url => {
        calls.push(String(url));
        const body = typeof page === 'function' ? page() : page;
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, text: async () => body };
    };
    return { fetch, calls };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const NOW = Date.parse('2026-10-27T12:00:00Z');
const MIN = 60_000;

test('the lift page is fetched at most every 10 minutes, and only when asked', async () => {
    let t = NOW;
    let page = liftsPage(OUT);
    const web = fakeWeb(() => page);
    const lifts = createLifts({ fetch: web.fetch, now: () => t, log: () => {} });
    assert.equal(web.calls.length, 0, 'nothing until someone asks');

    const first = await lifts.current();
    assert.deepEqual(web.calls, [LIFTS_PAGE]);
    assert.equal(first.fetched, new Date(NOW).toISOString());
    assert.deepEqual(Object.keys(first.stations).sort(), ['kerameikos', 'omonia']);

    t += 9 * MIN;
    await lifts.current();
    assert.equal(web.calls.length, 1, 'within 10 minutes: the copy');

    // After 10 minutes: answered from the copy, refreshed behind it
    t += 2 * MIN;
    page = liftsPage();
    assert.deepEqual(Object.keys((await lifts.current()).stations).sort(), ['kerameikos', 'omonia']);
    assert.equal(web.calls.length, 2);
    await settle();
    assert.deepEqual((await lifts.current()).stations, {});
});

test('a failure keeps the copy for 2 hours, then there is none', async () => {
    let t = NOW;
    let page = liftsPage(OUT);
    const web = fakeWeb(() => page);
    const lifts = createLifts({ fetch: web.fetch, now: () => t, log: () => {} });
    await lifts.current();
    page = new Error('down');

    t += 11 * MIN;
    assert.ok((await lifts.current()).stations.kerameikos);
    await settle();
    assert.equal(lifts.status().ok, false);
    assert.match(lifts.status().error, /down/);

    // Retried at most every 10 minutes while it fails
    const calls = web.calls.length;
    t += 5 * MIN;
    await lifts.current();
    assert.equal(web.calls.length, calls);

    t = NOW + 2 * 60 * MIN;
    assert.equal(await lifts.current(), null, 'an outage that old may be fixed');
});

test('a restart starts from the kept copy, without fetching again at once', async () => {
    const cacheFile = join(mkdtempSync(join(tmpdir(), 'lifts-')), 'lifts.json');
    const first = createLifts({ fetch: fakeWeb(liftsPage(OUT)).fetch, now: () => NOW, cacheFile, log: () => {} });
    await first.current();

    const web = fakeWeb(new Error('not now'));
    const again = createLifts({ fetch: web.fetch, now: () => NOW + 5 * MIN, cacheFile, log: () => {} });
    assert.ok((await again.current()).stations.kerameikos);
    assert.equal(web.calls.length, 0);
    assert.equal(again.status().updated, new Date(NOW).toISOString());
});

test('the lifts\' names come from the last copy, however old, and ask for a new one no more than the warnings do', async () => {
    let t = NOW;
    const web = fakeWeb(liftsPage(OUT));
    const lifts = createLifts({ fetch: web.fetch, now: () => t, log: () => {} });
    assert.deepEqual(lifts.liftNames(), {}, 'no copy yet: nothing, without waiting');
    await settle();
    assert.equal(web.calls.length, 1);
    assert.deepEqual(lifts.liftNames().kerameikos, ['Προς Δημοτικό Θέατρο', 'Εξωτερικός Τεχνόπολις Γκάζι']);
    assert.equal(web.calls.length, 1, 'within 10 minutes: the copy');

    // Too old for the warnings, still good for the names; the refresh it
    // starts is the warnings' too
    t += 3 * 60 * MIN;
    web.calls.length = 0;
    assert.ok(lifts.liftNames().kerameikos);
    assert.equal((await lifts.current()).fetched, new Date(t).toISOString());
    assert.equal(web.calls.length, 1, 'one refresh for both');
});

test('refused directly, the lift page comes through the relay', async () => {
    const calls = [];
    const fetch = async url => {
        calls.push(String(url));
        if (String(url) === LIFTS_PAGE) return { ok: false, status: 403 };
        return { ok: true, status: 200, text: async () => liftsPage(OUT) };
    };
    const lifts = createLifts({ fetch, now: () => NOW, relays: [{ name: 'home relay', url: 'https://relay.example/', key: 'k' }], log: () => {} });
    assert.ok((await lifts.current()).stations.kerameikos);
    assert.equal(calls[1], 'https://relay.example/?act=stasyPage&path=elevators');
    assert.equal(lifts.status().route, 'home relay');
});

test('the diagnostics and the health check report the lift page', async () => {
    const ok = liftChecks({ ok: true, route: 'home relay', stations: 59, unknown: [], updated: new Date(NOW).toISOString() }, () => NOW);
    assert.deepEqual(ok.map(c => [c.status, c.detail]), [['ok', '59 stations, through the home relay']]);

    const failing = liftChecks({ ok: false, error: 'direct: HTTP 403', stations: 59, unknown: ['Νέος Σταθμός'], updated: new Date(NOW - 30 * MIN).toISOString() }, () => NOW);
    assert.deepEqual(failing.map(c => c.status), ['warn', 'warn']);
    assert.match(failing[0].detail, /30 min ago/);
    assert.match(failing[0].hint, /home relay/);
    assert.match(failing[1].detail, /"Νέος Σταθμός"/);
    assert.equal(liftChecks({ error: 'x', ok: false, stations: 0, unknown: [], updated: null })[0].status, 'fail');
    assert.equal(liftChecks({ stations: 0, unknown: [], updated: null })[0].status, 'info');

    const health = liftStatus => createHealth({ busStatus: () => ({ routes: [] }), announcementStatus: () => ({}), liftStatus, buildDir: mkdtempSync(join(tmpdir(), 'b-')) }).check();
    assert.equal((await health(() => ({ updated: null }))).lifts.ok, true, 'not asked for yet');
    const down = await health(() => ({ ok: false, updated: null }));
    assert.equal(down.lifts.ok, false);
    assert.ok(down.problems.some(p => /^Lifts:/.test(p)));
});

// ── In the browser (public/js/core/lifts.js) ────────────────────────────────

test('the page asks for the lifts at most every 10 minutes, and keeps a copy for 2 hours offline', async () => {
    const { watchLifts } = await browserModule('public/js/core/lifts.js', 'en');
    let t = NOW;
    let answer = { ok: true, body: { fetched: new Date(NOW).toISOString(), stations: { kerameikos: { status: 'closed', out: [] } } } };
    const asked = [];
    const fetch = async url => {
        asked.push(url);
        if (answer instanceof Error) throw answer;
        return { ok: answer.ok, json: async () => answer.body };
    };
    let changes = 0;
    const lifts = watchLifts(() => changes++, { fetch, now: () => t });

    assert.equal(lifts(), null, 'not known yet');
    await settle();
    assert.deepEqual(asked, ['/api/lifts']);
    assert.equal(changes, 1, 'drawn again once they came');
    assert.ok(lifts().stations.kerameikos);

    t += 9 * MIN;
    lifts();
    assert.equal(asked.length, 1);

    // The server has no recent copy (503): nothing, though the page's is recent
    answer = { ok: false };
    t += 2 * MIN;
    lifts();
    await settle();
    assert.equal(asked.length, 2);
    assert.equal(lifts(), null);

    // Offline: the copy, until it's 2 hours old
    answer = { ok: true, body: { fetched: new Date(t).toISOString(), stations: { kerameikos: { status: 'closed', out: [] } } } };
    t += 10 * MIN;
    lifts();
    await settle();
    answer = new Error('offline');
    const fetched = t;
    t += 10 * MIN;
    lifts();
    await settle();
    assert.equal(asked.length, 4);
    assert.ok(lifts().stations.kerameikos);
    t = fetched + 2 * 60 * MIN;
    assert.equal(lifts(), null);
});

test('a station\'s words in the search: none when its lifts work', async () => {
    const lifts = { fetched: new Date(NOW).toISOString(), stations: { kerameikos: { status: 'closed', out: [] }, omonia: { status: 'partial', out: ['Προς Ανθούπολη'] } } };
    const en = await browserModule('public/js/core/lifts.js', 'en');
    const el = await browserModule('public/js/core/lifts.js', 'el');
    assert.deepEqual(en.liftWords(lifts, 'kerameikos'), { text: 'No step-free access right now', closed: true });
    assert.deepEqual(el.liftWords(lifts, 'omonia'), { text: 'Ανελκυστήρας εκτός λειτουργίας', closed: false });
    assert.equal(en.liftWords(lifts, 'syntagma'), null);
    assert.equal(en.liftWords(null, 'kerameikos'), null);
    // ?from=constructor isn't a station with lifts out
    assert.equal(en.liftWords(lifts, 'constructor'), null);
    assert.equal(en.liftNotice(lifts, ['syntagma'], id => id), '');

    // A platform with steps only: after a lift out that leaves none, before one partly out
    const gaps = [{ station: 'omonia', toward: 'Piraeus' }];
    assert.deepEqual(en.liftWords(lifts, 'omonia', gaps), { text: 'Steps only toward Piraeus', closed: true });
    assert.deepEqual(en.liftWords(lifts, 'kerameikos', [{ station: 'kerameikos', toward: 'Airport' }]), { text: 'No step-free access right now', closed: true });
    assert.deepEqual(el.liftWords(null, 'thiseio', [{ station: 'thiseio', toward: 'Πειραιάς' }]), { text: 'Μόνο με σκαλοπάτια προς Πειραιάς', closed: true });
});

test('the platforms with steps only, from the data: each once, with where their trains go', async () => {
    const { stationPlatforms, stepFreeGaps } = await browserModule('public/js/core/lifts.js', 'en');
    const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
    assert.deepEqual(stationPlatforms(rail, 'syntagma'), [
        { line: 'M2', dir: 'anthoupoli', station: 'syntagma' }, { line: 'M2', dir: 'elliniko', station: 'syntagma' },
        { line: 'M3', dir: 'dimotiko', station: 'syntagma' }, { line: 'M3', dir: 'doukissis', station: 'syntagma' },
    ]);
    assert.deepEqual(stepFreeGaps(rail, stationPlatforms(rail, 'thiseio')), [], 'by elevator and by ramp');
    rail.lines.M1.directions.piraeus.stops.find(s => s.station === 'thiseio').stepFree = 'no';
    const thiseio = { line: 'M1', dir: 'piraeus', station: 'thiseio' };
    assert.deepEqual(stepFreeGaps(rail, [thiseio, ...stationPlatforms(rail, 'thiseio')]), [{ station: 'thiseio', toward: 'Piraeus' }]);
});
