import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { withTram } from '../tools/subway/client/network.js';
import { checkReport, timetableSeconds, MOST, LEAST_SHARE, MOST_TIMES, STAND_SECONDS, WAIT_SECONDS, DAYS, BY } from '../server/riders/check.js';
import { addReport, recent, weekOf, medianSeconds, linesSummary, BAND_SECONDS, KEEP_WEEKS } from '../server/riders/totals.js';
import { createRiderTimes, REPORTS_PER_HOUR, SAVE_MS } from '../server/riders/index.js';
import { riderChecks } from '../server/diagnostics/running.js';
import { browserModule } from './support/browser-modules.js';
import { listen } from './support/listen.js';
import { DATA, site } from './support/test-site.js';

// Times measured by riders (decision 84): the rider's answer and the
// reports waiting on the phone (public/js/core/rider-times.js), and on the
// server (server/riders/): each report checked, added to the totals and
// forgotten, the totals kept 8 weeks in a file written at most every 5
// minutes, 6 reports an hour a visitor. What the phone measures:
// test/trip-measure.test.js; the page: test/browser/rider-times.spec.js.

const RAIL_FILE = join(DATA, 'rail.json');
const net = withTram(JSON.parse(readFileSync(RAIL_FILE, 'utf8')));
// The timetable's shortest and longest from one M3 station to another, toward Doukissis Plakentias
const DIR = net.lines.M3.directions.doukissis;
const at = id => DIR.stops.findIndex(s => s.station === id);
const tt = (a, b) => timetableSeconds(DIR.timetable, at(a), at(b));

// What the phone made of the morning trace (test/trip-measure.test.js), in short
const report = (more = {}) => ({
    line: 'M3', dir: 'doukissis', day: 'weekday', hour: 7,
    stretches: [
        { from: 'agia-marina', to: 'monastiraki', s: 539, by: 'network' },
        { from: 'monastiraki', to: 'syntagma', s: 103, by: 'network' },
        { from: 'syntagma', to: 'evangelismos', s: 144, by: 'network' },
    ],
    stops: [],
    wait: null,
    ...more,
});

test('the numbers agreed: at most 40 stretches and stops, half to three times the timetable, standing under 5 minutes, waiting under 30, 6 reports an hour, 15-second bands, 8 weeks, saved at most every 5 minutes', () => {
    assert.deepEqual([MOST, LEAST_SHARE, MOST_TIMES, STAND_SECONDS, WAIT_SECONDS], [40, 0.5, 3, 300, 1800]);
    assert.deepEqual([REPORTS_PER_HOUR, BAND_SECONDS, KEEP_WEEKS, SAVE_MS], [6, 15, 8, 300_000]);
    assert.deepEqual(DAYS, ['weekday', 'saturday', 'sunday']);
    assert.deepEqual(BY, ['gps', 'network']);
});

test('the timetable\'s time for a stretch: the shortest and the longest over its trains, from one station to any later one', () => {
    const [least, most] = tt('monastiraki', 'syntagma');
    assert.ok(least > 60 && least <= most && most < 300, `${least}–${most}`);
    const [far] = tt('agia-marina', 'monastiraki');
    assert.ok(far > 3 * least, 'four stations at once');
    assert.equal(tt('syntagma', 'monastiraki'), null, 'backwards');
});

test('a report that counts: the line and direction, its stops in order on them, each time near the timetable\'s', () => {
    const checked = checkReport(report(), net);
    assert.deepEqual(checked, { report: report() });
    // The tram, by its own stops' ids; a stop stood at and a wait by GPS
    const tram = { line: 'T6', dir: 'pikrodafni', day: 'sunday', hour: 0, stretches: [], stops: [{ stop: 'zappeio', s: 20, by: 'gps' }], wait: { stop: 'syntagma-tram', s: 240, by: 'gps' } };
    assert.deepEqual(checkReport(tram, net), { report: tram });
    // Only what's checked is kept
    assert.deepEqual(checkReport({ ...report(), device: 'abc', stretches: [{ ...report().stretches[0], at: 123 }] }, net), { report: report({ stretches: [report().stretches[0]] }) });
});

test('a report with anything wrong counts for nothing', () => {
    const [least, most] = tt('monastiraki', 'syntagma');
    const stretch = (s, more = {}) => report({ stretches: [{ from: 'monastiraki', to: 'syntagma', s, by: 'network', ...more }] });
    const wrong = {
        'not an object': [],
        'no line': report({ line: 'M9' }),
        'the suburban railway': report({ line: 'A1' }),
        'no direction': report({ dir: 'north' }),
        'a day': report({ day: 'holiday' }),
        'an hour': report({ hour: 24 }),
        'an hour, not whole': report({ hour: 7.5 }),
        'empty': report({ stretches: [] }),
        'too many stretches': report({ stretches: Array.from({ length: 41 }, () => report().stretches[1]) }),
        'too many stops': report({ stops: Array.from({ length: 41 }, (_, i) => ({ stop: DIR.stops[i % 27].station, s: 20, by: 'gps' })) }),
        'backwards': report({ stretches: [{ from: 'syntagma', to: 'monastiraki', s: 103, by: 'network' }] }),
        'not on the line': report({ stretches: [{ from: 'omonia', to: 'syntagma', s: 103, by: 'network' }] }),
        'stretches out of order': report({ stretches: [report().stretches[1], report().stretches[0]] }),
        'too quick': stretch(Math.floor(least * LEAST_SHARE) - 1),
        'too slow': stretch(Math.ceil(most * MOST_TIMES) + 1),
        'seconds, not whole': stretch(100.5),
        'how it was measured': stretch(103, { by: 'guess' }),
        'stood 5 minutes': report({ stops: [{ stop: 'syntagma', s: 300, by: 'gps' }] }),
        'stood no time': report({ stops: [{ stop: 'syntagma', s: 0, by: 'gps' }] }),
        'stops out of order': report({ stops: [{ stop: 'syntagma', s: 20, by: 'gps' }, { stop: 'monastiraki', s: 20, by: 'gps' }] }),
        'waited 30 minutes': report({ wait: { stop: 'korydallos', s: 1800, by: 'gps' } }),
        'a wait elsewhere': report({ wait: { stop: 'omonia', s: 60, by: 'gps' } }),
    };
    for (const [why, body] of Object.entries(wrong)) assert.ok('problem' in checkReport(body, net), why);
    // At the limits, it counts
    assert.ok('report' in checkReport(stretch(Math.ceil(least * LEAST_SHARE)), net));
    assert.ok('report' in checkReport(stretch(Math.floor(most * MOST_TIMES)), net));
    assert.ok('report' in checkReport(report({ stops: [{ stop: 'syntagma', s: 299, by: 'gps' }], wait: { stop: 'korydallos', s: 1799, by: 'gps' } }), net));
});

// 2026-11-27 07:50 Athens, a Friday
const FRIDAY = Date.UTC(2026, 10, 27, 5, 50);
const DAY = 86_400_000;

test('the week a report is counted in starts on Monday, in Athens', () => {
    assert.equal(weekOf(FRIDAY), '2026-11-23');
    assert.equal(weekOf(Date.UTC(2026, 10, 29, 21, 59)), '2026-11-23', 'Sunday 23:59 in Athens');
    assert.equal(weekOf(Date.UTC(2026, 10, 29, 22, 0)), '2026-11-30', 'Monday 00:00 in Athens, still Sunday in UTC');
});

test('the totals: rides per line, direction, day and hour; per stretch, stop and wait, how many in each 15-second band, by GPS and by network fixes apart', () => {
    const totals = { weeks: {} };
    addReport(totals, report(), FRIDAY);
    addReport(totals, report({ stretches: [{ from: 'monastiraki', to: 'syntagma', s: 110, by: 'network' }], stops: [{ stop: 'syntagma', s: 25, by: 'gps' }], wait: { stop: 'korydallos', s: 200, by: 'gps' } }), FRIDAY + 60_000);
    addReport(totals, report({ stretches: [{ from: 'monastiraki', to: 'syntagma', s: 106, by: 'gps' }] }), FRIDAY);
    const week = totals.weeks['2026-11-23'];
    assert.deepEqual(week.rides, { 'M3|doukissis|weekday|7': 3 });
    assert.deepEqual(week.stretches['M3|doukissis|weekday|7|network|monastiraki|syntagma'], { n: 2, bands: { 6: 1, 7: 1 } }, '103 s and 110 s: bands 6 (90–104) and 7 (105–119)');
    assert.deepEqual(week.stretches['M3|doukissis|weekday|7|gps|monastiraki|syntagma'], { n: 1, bands: { 7: 1 } });
    assert.deepEqual(week.stops, { 'M3|doukissis|weekday|7|gps|syntagma': { n: 1, bands: { 1: 1 } } });
    assert.deepEqual(week.waits, { 'M3|doukissis|weekday|7|gps|korydallos': { n: 1, bands: { 13: 1 } } });
    // Nothing else: no time but the week, no address, no report
    assert.deepEqual(Object.keys(totals), ['weeks']);
    assert.deepEqual(Object.keys(week), ['rides', 'stretches', 'stops', 'waits']);
});

test('weeks older than 8 go; the median band, so a few wrong reports hardly move it; per line, rides over 2 weeks for phase 3\'s test', () => {
    const totals = { weeks: {} };
    for (let w = 0; w < 10; w++) addReport(totals, report(), FRIDAY - w * 7 * DAY);
    const kept = recent(totals, FRIDAY);
    assert.equal(Object.keys(kept.weeks).length, KEEP_WEEKS);
    assert.ok(!('2026-09-28' in kept.weeks) && '2026-10-05' in kept.weeks);
    assert.equal(medianSeconds({ n: 5, bands: { 6: 3, 7: 1, 40: 1 } }), 97.5, 'the middle of band 6');
    assert.equal(medianSeconds({ n: 4, bands: { 6: 2, 7: 2 } }), 97.5);
    // Two reports this week and one the week before, one at night: 12 days counted
    const two = { weeks: {} };
    addReport(two, report(), FRIDAY);
    addReport(two, report({ hour: 23 }), FRIDAY);
    addReport(two, report({ line: 'T6', dir: 'syntagma', stretches: [], stops: [{ stop: 'edem', s: 20, by: 'gps' }] }), FRIDAY - 7 * DAY);
    const lines = linesSummary(two, FRIDAY);
    assert.deepEqual(lines.map(l => [l.line, l.rides]), [['M3', 2], ['T6', 1]]);
    assert.equal(lines[0].perDay, 2 / 12);
    assert.equal(lines[0].perTenMinutes, 1 / (12 * 15 * 6), 'the 23 o\'clock one isn\'t in 07:00–22:00');
});

// The endpoint on its own, with the totals in `dir`
async function endpoint(t, { file = null, now = () => FRIDAY, limiter } = {}) {
    const riders = createRiderTimes({ file, railFile: RAIL_FILE, now, log: () => {}, ...limiter && { limiter } });
    const server = await listen(express().set('trust proxy', true).use('/api/rider-times', riders.router));
    t.after(server.close);
    /** @param {unknown} body @param {string} [ip] */
    const send = (body, ip = '203.0.113.7') => fetch(`${server.url}/api/rider-times`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { riders, send };
}

test('POST /api/rider-times: counted (204), refused as wrong (400), counted in the totals and nothing else', async t => {
    const { riders, send } = await endpoint(t);
    assert.equal((await send(report())).status, 204);
    const bad = await send(report({ line: 'M9' }));
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'no such line or direction' });
    assert.equal((await send('{not json')).status, 400);
    assert.equal((await send({ ...report(), pad: 'x'.repeat(20_000) })).status, 400, 'too big');
    assert.deepEqual(riders.totals().weeks['2026-11-23'].rides, { 'M3|doukissis|weekday|7': 1 });
    assert.deepEqual(riders.status(), { counted: 1, refused: 3, lines: [{ line: 'M3', rides: 1, perDay: 1 / 12, perTenMinutes: 1 / (12 * 90) }] });
});

test('each visitor may send 6 reports an hour; wrong ones don\'t count against them; another address is another visitor', async t => {
    let now = FRIDAY;
    const { send } = await endpoint(t, { now: () => now });
    for (let i = 0; i < 6; i++) assert.equal((await send(report())).status, 204);
    assert.equal((await send(report({ line: 'M9' }))).status, 400);
    const over = await send(report());
    assert.equal(over.status, 429);
    assert.equal(over.headers.get('retry-after'), '3600');
    assert.equal((await send(report(), '203.0.113.8')).status, 204);
    now += 3_600_000;
    assert.equal((await send(report())).status, 204, 'the next hour');
});

test('the totals kept in a file at most every 5 minutes, the old weeks dropped, read back when the server starts', async t => {
    const file = join(mkdtempSync(join(tmpdir(), 'riders-')), 'rider-times.json');
    let now = FRIDAY;
    /** @type {{ fn: () => void, at: number }[]} */
    const timers = [];
    const riders = createRiderTimes({ file, railFile: RAIL_FILE, now: () => now, log: () => {}, later: (fn, ms) => timers.push({ fn, at: now + ms }) });
    const server = await listen(express().use('/api/rider-times', riders.router));
    t.after(server.close);
    const post = () => fetch(`${server.url}/api/rider-times`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report()) });
    // Time going by: the saves due run
    const pass = ms => {
        now += ms;
        for (const timer of timers.filter(x => x.at <= now)) {
            timers.splice(timers.indexOf(timer), 1);
            timer.fn();
        }
    };
    const rides = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).weeks['2026-11-23']?.rides['M3|doukissis|weekday|7'] ?? 0 : 0;
    assert.equal((await post()).status, 204);
    pass(0);
    assert.equal(rides(), 1, 'the first at once');
    pass(60_000);
    assert.equal((await post()).status, 204);
    assert.equal((await post()).status, 204);
    assert.equal(timers.length, 1, 'one save waits for both');
    pass(SAVE_MS - 60_000 - 1);
    assert.equal(rides(), 1, 'not within 5 minutes of the last save');
    pass(1);
    assert.equal(rides(), 3);
    const saved = readFileSync(file, 'utf8');
    assert.doesNotMatch(saved, /203\.0\.113|127\.0\.0\.1|::1|T\d\d:/, 'no address, no time but the week');
    // Read back, nine weeks on: the old week goes at the next save
    const later = createRiderTimes({ file, railFile: RAIL_FILE, now: () => FRIDAY + 9 * 7 * DAY, log: () => {} });
    assert.ok('2026-11-23' in later.totals().weeks);
    later.save();
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { weeks: {} });
});

test('a file that can\'t be written is logged, and the totals stay in memory', () => {
    const logged = [];
    // Its folder is a file
    const blocked = join(mkdtempSync(join(tmpdir(), 'riders-')), 'local');
    writeFileSync(blocked, '');
    const riders = createRiderTimes({ file: join(blocked, 'rider-times.json'), railFile: RAIL_FILE, log: m => logged.push(m) });
    riders.save();
    assert.match(logged[0] ?? '', /\[riders\] Couldn't save the totals/);
});

test('without rail.json, nothing can be checked: 503, and the phone tries again later', async t => {
    const riders = createRiderTimes({ file: null, railFile: join(tmpdir(), 'no-such-rail.json'), log: () => {} });
    const server = await listen(express().use('/api/rider-times', riders.router));
    t.after(server.close);
    const res = await fetch(`${server.url}/api/rider-times`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report()) });
    assert.equal(res.status, 503);
});

test('the whole site answers /api/rider-times, and diagnostics say what came', async t => {
    const server = await listen(site());
    t.after(server.close);
    const res = await fetch(`${server.url}/api/rider-times`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report()) });
    assert.equal(res.status, 204);
    assert.deepEqual(riderChecks({ counted: 3, refused: 1, lines: [{ line: 'M3', rides: 3, perDay: 0.25, perTenMinutes: 0.002 }] }).map(c => [c.status, c.detail]), [
        ['info', '3 counted, 1 refused as wrong'],
        ['info', 'M3 3 (0.3 a day, 0.00 each 10 minutes 07:00–22:00); phase 3 needs 1 each 10 minutes'],
    ]);
    const [warn] = riderChecks({ counted: 1, refused: 5, lines: [] });
    assert.equal(warn.status, 'warn');
    assert.match(warn.hint, /made-up reports/);
    assert.equal(riderChecks({ counted: 0, refused: 0, lines: [] })[1].detail, 'None yet');
    assert.deepEqual(riderChecks(null), []);
});

// ── On the phone: the answer and the reports waiting ────────────────────────

const stored = new Map();
globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) };
const phone = await browserModule('public/js/core/rider-times.js');

test('the rider\'s answer is kept on the device; "No thanks" drops the reports waiting', () => {
    stored.clear();
    assert.equal(phone.riderAnswer(), null, 'not asked yet');
    phone.setRiderAnswer('yes');
    assert.equal(phone.riderAnswer(), 'yes');
    phone.keepWaiting(phone.withReport([], report(), FRIDAY, 0.5));
    assert.equal(phone.waitingReports().length, 1);
    phone.setRiderAnswer('no');
    assert.equal(phone.riderAnswer(), 'no');
    assert.deepEqual(phone.waitingReports(), []);
    stored.set('rider-times', 'maybe');
    assert.equal(phone.riderAnswer(), null);
    stored.set('rider-times-waiting', '{broken');
    assert.deepEqual(phone.waitingReports(), []);
});

test('a report waits a random 0 to 15 minutes, then is due; past a day unsent, it\'s dropped', () => {
    assert.equal(phone.DELAY_MS, 15 * 60_000);
    assert.equal(phone.KEEP_MS, DAY);
    const first = phone.withReport([], report(), FRIDAY, 0);
    const both = phone.withReport(first, report({ hour: 8 }), FRIDAY, 0.999);
    assert.deepEqual(both.map(w => [w.at - FRIDAY, w.until - FRIDAY]), [[0, DAY], [Math.floor(0.999 * 15 * 60_000), DAY]]);
    const soon = phone.dueReports(both, FRIDAY + 60_000);
    assert.deepEqual([soon.due.length, soon.later.length], [1, 1]);
    const gone = phone.dueReports(both, FRIDAY + DAY);
    assert.deepEqual(gone, { due: [], later: [] });
    phone.keepWaiting([]);
    assert.equal(stored.has('rider-times-waiting'), false);
});
