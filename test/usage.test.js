import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ANSWER_MS, answerTime, createUsage, KEEP_DAYS, STOPS_KEPT_FRESH } from '../server/oasa/usage.js';
import { usageView } from '../server/admin/usage.js';
import { view } from '../server/pages/templates.js';

// The usage of OASA (server/oasa/usage.js): counted each minute, added up per
// Athens day, kept in a file for KEEP_DAYS

// 23:58 in Athens on 29 Oct 2026 (UTC+2 after the clocks went back on the 25th)
const T0 = Date.parse('2026-10-29T21:58:00Z');
const MIN = 60_000;
const quiet = () => {};

function clock(t = T0) {
    return { now: () => t, advance: ms => { t += ms; } };
}
// The page's view, in English like every admin page
const view_ = data => view('admin/usage.hbs')(data, { lang: 'en', strings: {} });
const tempFile = () => join(mkdtempSync(join(tmpdir(), 'wayhop-usage-')), 'oasa-usage.json');

test('each minute is added to its day: sums, the busiest minute, minutes waiting and dropping', () => {
    const c = clock();
    const usage = createUsage({ now: c.now });
    // A busy minute: 3 requests, one waited 2.5 s for its slot, one refresh dropped
    usage.request('arrivals-new');
    usage.request('arrivals-refresh');
    usage.request('route-names');
    usage.waited(2_500);
    usage.dropped('arrivals-refresh');
    c.advance(MIN);
    // A quiet one: a route test, a 429, every route resting once
    usage.request('route-test');
    usage.limited();
    usage.paused();
    c.advance(MIN);

    const day = usage.days()['2026-10-29'];
    assert.deepEqual(day.requests, { 'arrivals-new': 1, 'arrivals-refresh': 1, 'route-names': 1, 'route-test': 1 });
    assert.deepEqual(day.dropped, { 'arrivals-new': 0, 'arrivals-refresh': 1, 'route-names': 0, 'route-test': 0 });
    assert.deepEqual([day.limited, day.paused], [1, 1]);
    assert.deepEqual(day.peaks, { requests: 3, stops: 0, waitMs: 2_500 });
    assert.deepEqual(day.busyMinutes, { 2000: 1, 5000: 0 });
    assert.equal(day.dropMinutes, 1);
});

test('each route\'s answers and failures, their times, and the minutes it answered nothing', () => {
    const c = clock();
    const usage = createUsage({ now: c.now });
    usage.call('home relay', true, 120);
    usage.call('home relay', true, 600);
    usage.call('home relay', true, 3_000);
    usage.call('home relay', false, 9_000);
    c.advance(MIN);
    // A minute when it was asked and never answered: down
    usage.call('home relay', false, 3_000);
    usage.call('home relay', false, 3_000);
    c.advance(MIN);
    // A minute when it wasn't asked: not down
    c.advance(MIN);

    const relay = usage.days()['2026-10-29'].routes['home relay'];
    assert.deepEqual([relay.ok, relay.failed, relay.downMinutes], [3, 3, 1]);
    // <250, <500, <1000, <2000, <4000, <8000, longer (a timeout too)
    assert.deepEqual(relay.ms, [1, 0, 1, 0, 3, 0, 1]);
    assert.equal(relay.ms.length, ANSWER_MS.length + 1);
});

test('answer times from the buckets: the limit under which a share of the answers came', () => {
    assert.equal(answerTime([0, 0, 0, 0, 0, 0, 0], 0.5), null);
    assert.equal(answerTime([1, 0, 1, 0, 3, 0, 1], 0.5), 4_000);
    assert.equal(answerTime([8, 1, 1, 0, 0, 0, 0], 0.5), 250);
    assert.equal(answerTime([8, 1, 1, 0, 0, 0, 0], 0.95), 1_000);
    assert.equal(answerTime([0, 0, 0, 0, 0, 0, 2], 0.5), Infinity);
});

test('stops: different ones per day, the most in one minute, each counted once a day', () => {
    const c = clock();
    const usage = createUsage({ now: c.now });
    usage.answer('10361', 'oasa');
    usage.answer('10362', 'oasa');
    usage.answer('10361', 'cache');
    c.advance(MIN);
    usage.answer('10361', 'cache');
    usage.answer('10363', 'old');
    usage.answer('10364', 'none');
    usage.answer('10365', 'cache');

    const { hour, today } = usage.status();
    assert.deepEqual(hour.answers, { oasa: 2, cache: 3, old: 1, none: 1 });
    assert.equal(hour.stops, 5);
    assert.equal(today.stops, 5);
    // The second minute's 4, against the number that can be kept fresh
    assert.equal(today.peaks.stops, 4);
    assert.equal(STOPS_KEPT_FRESH, 60);
});

test('a new day begins at midnight in Athens, with its own stops', () => {
    const c = clock();
    const usage = createUsage({ now: c.now });
    usage.request('arrivals-new');
    usage.answer('10361', 'oasa');
    // 00:00:30 in Athens, the 30th
    c.advance(2 * MIN + 30_000);
    usage.request('arrivals-refresh');
    usage.answer('10361', 'cache');
    c.advance(MIN);

    const days = usage.days();
    assert.deepEqual(Object.keys(days), ['2026-10-29', '2026-10-30']);
    assert.deepEqual([days['2026-10-29'].requests['arrivals-new'], days['2026-10-29'].stops], [1, 1]);
    assert.deepEqual([days['2026-10-30'].requests['arrivals-refresh'], days['2026-10-30'].stops], [1, 1]);
    // Today so far is the new day only
    assert.equal(usage.status().today.requests['arrivals-new'], 0);
});

test('the past hour forgets what is older than an hour', () => {
    const c = clock();
    const usage = createUsage({ now: c.now });
    usage.request('arrivals-new');
    c.advance(30 * MIN);
    usage.request('arrivals-refresh');
    assert.equal(usage.status().hour.requests['arrivals-new'], 1);
    c.advance(31 * MIN);
    assert.deepEqual(usage.status().hour.requests, { 'arrivals-new': 0, 'arrivals-refresh': 1, 'route-names': 0, 'route-test': 0 });
});

test('the days are kept in the file: a restart carries on with today, and counts no stop twice', () => {
    const c = clock(Date.parse('2026-10-30T10:00:00Z'));
    const file = tempFile();
    const first = createUsage({ file, now: c.now });
    first.request('arrivals-new');
    first.answer('10361', 'oasa');
    c.advance(MIN);
    first.save();

    // The app restarts
    const second = createUsage({ file, now: c.now });
    second.request('arrivals-new');
    second.answer('10361', 'cache');
    second.answer('10362', 'oasa');
    c.advance(MIN);
    second.save();
    const today = JSON.parse(readFileSync(file, 'utf8')).days['2026-10-30'];
    assert.equal(today.requests['arrivals-new'], 2);
    assert.equal(today.stops, 2);
    assert.deepEqual(second.status().today.answers, { oasa: 2, cache: 1, old: 0, none: 0 });
});

test(`days older than ${KEEP_DAYS} are dropped when the file is saved`, () => {
    const c = clock(Date.parse('2026-10-30T10:00:00Z'));
    const file = tempFile();
    const old = createUsage({ file, now: c.now });
    old.request('arrivals-new');
    c.advance(MIN);
    old.save();
    c.advance(KEEP_DAYS * 86_400_000);
    const later = createUsage({ file, now: c.now });
    later.request('arrivals-new');
    c.advance(MIN);
    assert.ok(later.days()['2026-10-30'], 'kept until saved');
    later.save();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).days), ['2027-02-27']);
});

test('an unreadable file is said once and replaced, not fatal', () => {
    const c = clock();
    const file = tempFile();
    writeFileSync(file, '{"days": {');
    const logs = [];
    const usage = createUsage({ file, now: c.now, log: m => logs.push(m) });
    assert.match(logs.join('\n'), /^\[oasa\] Ignoring an unreadable .*oasa-usage\.json/);
    usage.request('route-test');
    c.advance(MIN);
    usage.save();
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).days['2026-10-29'].requests['route-test'], 1);
});

test('the nightly bus-network fetch\'s requests go under the day it ran', () => {
    const c = clock(Date.parse('2026-10-30T10:00:00Z'));
    const networkFile = tempFile();
    // 04:30 in Athens
    writeFileSync(networkFile, JSON.stringify({ at: '2026-10-30T02:30:00.000Z', ok: true, seconds: 600, requests: 572 }));
    const usage = createUsage({ networkFile, now: c.now, log: quiet });
    usage.request('arrivals-new');
    c.advance(MIN);
    usage.save();
    assert.equal(usage.days()['2026-10-30'].network, 572);
    assert.equal(usage.status().today.network, 572);
});

// ── /admin/usage ────────────────────────────────────────────────────────────

test('the usage page: a day per row, newest first, and each route\'s answers per day', () => {
    const c = clock(Date.parse('2026-10-30T10:00:00Z'));
    const usage = createUsage({ now: c.now });
    usage.request('arrivals-new');
    usage.call('home relay', true, 300);
    usage.answer('10361', 'oasa');
    usage.answer('10361', 'cache');
    usage.answer('10362', 'cache');
    usage.request('arrivals-refresh');
    usage.waited(2_400);
    usage.dropped('arrivals-refresh');
    c.advance(86_400_000);
    usage.call('home relay', false, 9_000);

    const view = usageView(usage.days());
    assert.deepEqual(view.asked.map(d => d.date), ['2026-10-31', '2026-10-30']);
    assert.deepEqual(view.asked[1], {
        date: '2026-10-30', requests: 2, firstLooks: 1, refreshes: 1, routeNames: 0, routeTests: 0, network: '–',
        fromCache: '67%', stops: 2, mostAtOnce: 2, longestWait: '2.4 s', busyMinutes: '1 / 0', dropped: '1 (in 1 min)', paused: 0, limited: 0,
    });
    assert.deepEqual(view.answered, [
        { date: '2026-10-31', route: 'home relay', ok: 0, failed: 1, half: 'over 8 s', most: 'over 8 s', downMinutes: 1 },
        { date: '2026-10-30', route: 'home relay', ok: 1, failed: 0, half: 'under 500 ms', most: 'under 500 ms', downMinutes: 0 },
    ]);

    const html = view_(view);
    assert.match(html, /<table class="table table-sm usage-table">\s*<caption class="sr-only">What Wayhop asked of OASA, per day<\/caption>/);
    assert.match(html, /<th scope="col">Minutes waiting over 2 s \/ 5 s<\/th>/);
    assert.match(html, /<th scope="row">2026-10-30<\/th>\s*<td>2<\/td>\s*<td>1<\/td>/);
    assert.match(html, /<td class="text-start">home relay<\/td>\s*<td>0<\/td>\s*<td>1<\/td>\s*<td>over 8 s<\/td>/);
    assert.match(view_(usageView({})), /<p>Nothing has been counted yet\.<\/p>/);
});

test('how far ahead OASA predicts: per line, the most minutes in the day, across minutes and restarts', () => {
    const c = clock(Date.parse('2026-10-30T10:00:00Z'));
    const file = tempFile();
    // A day kept before the horizon was counted
    writeFileSync(file, JSON.stringify({ days: { '2026-10-30': { ...createUsage({ now: c.now }).status().today, horizon: undefined } } }));
    const usage = createUsage({ file, now: c.now });
    usage.horizon('040', 12);
    usage.horizon('040', 31);
    usage.horizon('Χ95', 44);
    c.advance(MIN);
    usage.horizon('040', 18);
    c.advance(MIN);
    assert.deepEqual(usage.days()['2026-10-30'].horizon, { '040': 31, 'Χ95': 44 });
    assert.deepEqual(usage.status().hour.horizon, { '040': 31, 'Χ95': 44 });
});

test('the usage page: how far ahead OASA predicts each line over the newest 7 days, and on a typical day', () => {
    const day = horizon => ({ ...createUsage().status().today, horizon });
    const days = {
        // Older than the 7 newest: left out
        '2026-10-01': day({ '040': 90, A1: 70 }),
        '2026-10-24': day({ '040': 30 }),
        '2026-10-25': day({ '040': 20, 'Χ95': 50 }),
        '2026-10-26': day({ '040': 25 }),
        '2026-10-27': day({ '040': 40, '2': 15 }),
        '2026-10-28': day({}),
        '2026-10-29': day({ '040': 22 }),
        // Kept before the horizon was counted
        '2026-10-30': { ...day({}), horizon: undefined },
    };
    const view = usageView(days);
    assert.equal(view.horizonDays, 7);
    // In the order of their numbers, then their letters
    assert.deepEqual(view.horizon, [
        { line: '2', most: 15, typical: 15, days: 1 },
        { line: '040', most: 40, typical: 25, days: 5 },
        { line: 'Χ95', most: 50, typical: 50, days: 1 },
    ]);
    const html = view_(view);
    assert.match(html, /<div class="table-responsive usage-table-wrap" tabindex="0" role="region" aria-labelledby="horizon-title">/);
    assert.match(html, /<th scope="row" lang="el">040<\/th>\s*<td>40<\/td>\s*<td>25<\/td>\s*<td>5<\/td>/);
    assert.match(view_(usageView({ '2026-10-30': day({}) })), /No predictions counted yet\./);
});
