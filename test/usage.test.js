import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ANSWER_MS, answerTime, createUsage, KEEP_DAYS, STOPS_KEPT_FRESH } from '../server/oasa/usage.js';

// The usage of OASA (server/oasa/usage.js): counted each minute, added up per
// Athens day, kept in a file for KEEP_DAYS

// 23:58 in Athens on 29 Oct 2026 (UTC+2 after the clocks went back on the 25th)
const T0 = Date.parse('2026-10-29T21:58:00Z');
const MIN = 60_000;
const quiet = () => {};

function clock(t = T0) {
    return { now: () => t, advance: ms => { t += ms; } };
}
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
