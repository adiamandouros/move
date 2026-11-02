import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createArrivals } from '../server/oasa/arrivals.js';
import { createOasaClient, OasaUnavailable } from '../server/oasa/client.js';
import { ASK_EVERY_MS, createCollector, FIRST_WEEK, HOURS, loadStopSets, stopsAt, stopToAsk } from '../server/oasa/collector.js';
import { CLOSE_MINUTES, createPasses, MAX_GAP_MS } from '../server/oasa/passes.js';
import { createUsage, visitorsDropped } from '../server/oasa/usage.js';
import { usageView } from '../server/admin/usage.js';
import { AREAS, AROUND_KM, coverage, km, PER_WEEK, pickWeeks, STRETCH_KM, WEEKS } from '../scripts/collector-stops.js';

// Roadmap Plan 3, decision 26: buses seen passing a stop, and the collector
// that asks for a few stops in the weekday rush hours so they are.

const MIN = 60_000;
const quiet = () => {};
const bus = (vehicle, minutes, line = 'Α2', route = '5567') => ({ route, vehicle, minutes, line, to: null });
const tempDir = () => mkdtempSync(join(tmpdir(), 'wayhop-passes-'));
const lines = file => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));

// ── Passes ──────────────────────────────────────────────────────────────────

test('a bus a few minutes away that is gone from the next answer passed when OASA said it would', () => {
    const dir = tempDir();
    const counts = [];
    const passes = createPasses({ dir, counted: n => counts.push(n) });
    const at = Date.parse('2026-11-03T06:00:00Z'); // 08:00 in Athens
    assert.deepEqual(passes.seen('60002', [bus('1', 2), bus('2', 9)], at), []);
    const found = passes.seen('60002', [bus('2', 6)], at + 3 * MIN);
    assert.deepEqual(found, [{ at: at + 2 * MIN, stop: '60002', route: '5567', line: 'Α2', vehicle: '1' }]);
    assert.deepEqual(counts, [1]);
    // A line a pass, in the Athens day's file, in seconds
    assert.deepEqual(readdirSync(dir), ['2026-11-03.jsonl']);
    assert.deepEqual(lines(join(dir, '2026-11-03.jsonl')), [{ at: (at + 2 * MIN) / 1000, stop: '60002', route: '5567', line: 'Α2', vehicle: '1' }]);
});

test('no pass from a bus still coming, one further than CLOSE_MINUTES, or answers too far apart', () => {
    const passes = createPasses();
    const at = Date.parse('2026-11-03T06:00:00Z');
    passes.seen('1', [bus('a', 1), bus('b', CLOSE_MINUTES + 1)], at);
    // a is still listed; b vanished, but it was too far off to have passed: OASA dropped it
    assert.deepEqual(passes.seen('1', [bus('a', 0)], at + MIN), []);
    // Too long since the last answer: a may have passed any time
    assert.deepEqual(passes.seen('1', [], at + MIN + MAX_GAP_MS + 1), []);
});

test('a pass is never later than the answer that missed the bus, and the same bus at a stop is one pass', () => {
    const passes = createPasses();
    const at = Date.parse('2026-11-03T06:00:00Z');
    passes.seen('1', [bus('a', 3)], at);
    assert.deepEqual(passes.seen('1', [], at + MIN).map(p => p.at), [at + MIN]);
    // Listed again (OASA lists it a moment longer), then gone again: still the one pass
    passes.seen('1', [bus('a', 0)], at + 2 * MIN);
    assert.deepEqual(passes.seen('1', [], at + 3 * MIN), []);
    // The same bus on its next trip, much later, is a new pass
    passes.seen('1', [bus('a', 1)], at + 40 * MIN);
    assert.equal(passes.seen('1', [], at + 41 * MIN).length, 1);
});

test('stops are watched apart, and the day file follows Athens time, not UTC', () => {
    const dir = tempDir();
    const passes = createPasses({ dir });
    const at = Date.parse('2026-11-03T21:58:00Z'); // 23:58 in Athens
    passes.seen('1', [bus('a', 1)], at);
    passes.seen('2', [bus('b', 3)], at);
    passes.seen('1', [], at + 2 * MIN);
    passes.seen('2', [], at + 4 * MIN);
    assert.deepEqual(readdirSync(dir).sort(), ['2026-11-03.jsonl', '2026-11-04.jsonl']);
    assert.deepEqual(lines(join(dir, '2026-11-04.jsonl')).map(p => p.stop), ['2']);
});

test('a file that can\'t be written is said once, and the passes are still counted', () => {
    const dir = join(tempDir(), 'file');
    writeFileSync(dir, '');
    const said = [];
    let counted = 0;
    const passes = createPasses({ dir, log: m => said.push(m), counted: n => { counted += n; } });
    const at = Date.parse('2026-11-03T06:00:00Z');
    for (const stop of ['1', '2']) {
        passes.seen(stop, [bus('a', 1)], at);
        passes.seen(stop, [], at + MIN);
    }
    assert.equal(said.length, 1);
    assert.match(said[0], /Couldn't write the buses that passed/);
    assert.equal(counted, 2);
});

// ── The arrivals cache and the client ───────────────────────────────────────

// A fake clock where sleeping moves time forward
function clock(t = Date.parse('2026-11-03T06:00:00Z')) {
    return { now: () => t, sleep: async ms => { t += ms; }, advance: ms => { t += ms; } };
}
const oasaAnswer = rows => async url => {
    const act = new URL(url).searchParams.get('act');
    const body = act === 'webRoutesForStop' ? [{ RouteCode: '5567', LineID: 'Α2', RouteDescr: 'x', RouteDescrEng: 'x' }] : rows();
    return { ok: true, text: async () => JSON.stringify(body) };
};

test('each fresh answer is shown to the passes; the collector\'s asks go in the low lane and aren\'t visitors\' answers', async () => {
    const c = clock();
    let rows = [{ route_code: '5567', veh_code: '7', btime2: '1' }];
    const usage = createUsage({ now: c.now });
    const client = createOasaClient({ fetch: oasaAnswer(() => rows), now: c.now, sleep: c.sleep, log: quiet, usage });
    const seen = [];
    const arrivals = createArrivals({ client, now: c.now, usage, passes: { seen: (stop, list, at) => seen.push([stop, list.map(a => a.vehicle), at]) } });

    await arrivals.stopArrivals('60002', { collect: true });
    // A visitor a moment later gets the cached answer: not shown to the passes again
    await arrivals.stopArrivals('60002');
    c.advance(3 * MIN);
    rows = [];
    await arrivals.stopArrivals('60002', { collect: true });

    assert.deepEqual(seen.map(([stop, vehicles]) => [stop, vehicles]), [['60002', ['7']], ['60002', []]]);
    const { today } = usage.status();
    assert.equal(today.requests.collector, 2);
    assert.equal(today.requests['arrivals-new'], 0);
    // Only the visitor's answer counts as one
    assert.deepEqual(today.answers, { oasa: 0, cache: 1, old: 0, none: 0 });
});

test('the low lane goes after everyone else, and skips its turn when anyone is waiting', async () => {
    const c = clock();
    const order = [];
    const usage = createUsage({ now: c.now });
    let sleeps = 0;
    const client = createOasaClient({
        fetch: async url => { order.push(new URL(url).searchParams.get('p1')); return { ok: true, text: async () => 'null' }; },
        // Each slot is waited for: the queue is real for the requests behind it
        now: c.now, sleep: async ms => { sleeps++; c.advance(ms); }, log: quiet, usage,
    });
    // An idle queue: the collector's request goes at once
    await client.request('getStopArrivals', 'low-1', { lane: 'low' });
    // Three visitors queue up behind the slot just taken: the collector skips
    const visitors = ['a', 'b', 'c'].map(s => client.request('getStopArrivals', s));
    await assert.rejects(client.request('getStopArrivals', 'low-2', { lane: 'low' }), OasaUnavailable);
    await Promise.all(visitors);
    assert.deepEqual(order, ['low-1', 'a', 'b', 'c']);
    assert.ok(sleeps > 0);
    const { today } = usage.status();
    assert.deepEqual([today.requests.collector, today.dropped.collector], [1, 1]);
    assert.equal(visitorsDropped(today.dropped), 0);
});

test('while every route rests, the collector is refused without counting as a refused visitor', async () => {
    const c = clock();
    const usage = createUsage({ now: c.now });
    const client = createOasaClient({ fetch: async () => { throw new Error('down'); }, now: c.now, sleep: c.sleep, log: quiet, usage });
    for (let i = 0; i < 5; i++) await assert.rejects(client.request('getStopArrivals', '1'));
    await assert.rejects(client.request('getStopArrivals', '1', { lane: 'low' }), /paused/);
    assert.equal(usage.status().today.paused, 0);
});

// ── Counting ────────────────────────────────────────────────────────────────

test('the usage page shows the collector\'s requests, its skipped turns and the buses seen passing; older days show none', () => {
    const c = clock(Date.parse('2026-11-03T06:00:00Z'));
    const file = join(tempDir(), 'oasa-usage.json');
    // A day kept before the collector: no count of its kind, no passes
    const before = createUsage({ now: c.now }).status().today;
    delete before.requests.collector;
    delete before.dropped.collector;
    delete before.passes;
    writeFileSync(file, JSON.stringify({ days: { '2026-11-02': before } }));
    const usage = createUsage({ file, now: c.now });
    usage.request('collector');
    usage.request('collector');
    usage.dropped('collector');
    usage.dropped('arrivals-refresh');
    usage.passes(4);
    c.advance(MIN);

    const view = usageView(usage.days());
    const pick = d => [d.date, d.collector, d.collectorSkipped, d.passes, d.dropped];
    assert.deepEqual(view.asked.map(pick), [
        ['2026-11-03', 2, 1, 4, '1 (in 1 min)'],
        ['2026-11-02', '–', '–', '–', 0],
    ]);
});

// ── The collector ───────────────────────────────────────────────────────────

const athens = (date, time) => Date.parse(`${date}T${time}+02:00`); // winter time
const WEEKS_ = [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']];

test('the collector asks only on weekdays in the rush hours, Athens time', () => {
    assert.deepEqual(HOURS, [[7, 10], [16, 20]]);
    const monday = FIRST_WEEK;
    for (const [time, asks] of [['06:59:59', false], ['07:00:00', true], ['09:59:59', true], ['10:00:00', false], ['15:59:00', false], ['16:00:00', true], ['19:59:00', true], ['20:00:00', false]]) {
        assert.equal(stopsAt(WEEKS_, athens(monday, time)).length > 0, asks, time);
    }
    // Saturday and Sunday: never
    assert.deepEqual(stopsAt(WEEKS_, athens('2026-11-07', '08:00:00')), []);
    assert.deepEqual(stopsAt(WEEKS_, athens('2026-11-08', '08:00:00')), []);
});

test('each week has its own stops, from the first week on, starting again after the last', () => {
    assert.deepEqual(stopsAt(WEEKS_, athens('2026-11-02', '08:00:00')), WEEKS_[0]);
    assert.deepEqual(stopsAt(WEEKS_, athens('2026-11-06', '19:00:00')), WEEKS_[0]);
    assert.deepEqual(stopsAt(WEEKS_, athens('2026-11-09', '08:00:00')), WEEKS_[1]);
    assert.deepEqual(stopsAt(WEEKS_, athens('2026-11-16', '08:00:00')), WEEKS_[0]);
    // A day before the first week still has a set
    assert.deepEqual(stopsAt(WEEKS_, athens('2026-10-30', '08:00:00')), WEEKS_[1]);
});

test('one stop every 6 seconds, each in turn, never two at once', async () => {
    const start = athens('2026-11-03', '08:00:00');
    const asked = [];
    for (let t = start; t < start + 6 * ASK_EVERY_MS; t += ASK_EVERY_MS) asked.push(stopToAsk(WEEKS_, t));
    assert.deepEqual(asked.toSorted(), ['a1', 'a1', 'a2', 'a2', 'a3', 'a3']);
    assert.deepEqual(asked.slice(0, 3).toSorted(), ['a1', 'a2', 'a3']);
    // With the real sets, each of a week's stops is asked about every 3 minutes
    assert.equal(PER_WEEK * ASK_EVERY_MS, 3 * MIN);
    assert.equal(stopToAsk(WEEKS_, athens('2026-11-03', '12:00:00')), null);
});

test('the collector\'s tick asks for that stop, and a refused request is only a gap', async () => {
    let t = athens('2026-11-03', '08:00:00');
    const asked = [];
    let timer = null;
    const collector = createCollector({
        weeks: WEEKS_, now: () => t,
        ask: async stop => { asked.push(stop); throw new OasaUnavailable('busy'); },
        every: (fn, ms) => { timer = { fn, ms }; return {}; },
    });
    collector.start();
    assert.equal(timer.ms, ASK_EVERY_MS);
    timer.fn();
    t = athens('2026-11-03', '12:00:00');
    timer.fn();
    await new Promise(setImmediate);
    assert.equal(asked.length, 1);
    assert.ok(WEEKS_[0].includes(asked[0]));
});

// ── The stops it asks for ───────────────────────────────────────────────────

test('the committed stop sets: 10 weeks of 30 different stops, each named', () => {
    const file = JSON.parse(readFileSync(new URL('../server/oasa/collector-stops.json', import.meta.url), 'utf8'));
    const weeks = loadStopSets();
    assert.equal(weeks.length, WEEKS);
    for (const week of weeks) {
        assert.equal(new Set(week).size, PER_WEEK);
        for (const code of week) {
            assert.match(code, /^\d{1,8}$/);
            assert.ok(file.names[code], code);
        }
    }
});

// A made-up network along one road east from Syntagma, with a branch north
//   S ─ 1 km ─ A ─ 2 km ─ B ─ 2 km ─ C          (line 1: every 5 minutes)
//              └─ 3 km north ─ N                (line 2: every 20 minutes)
// and Z, near one of the areas, on line 3 to A
const SYN = [37.9755, 23.7348];
const east = d => [SYN[0], SYN[1] + d / 88];
const north = (from, d) => [from[0] + d / 111, from[1]];
const rush = every => Array.from({ length: 7 * 60 / every }, (_, i) => [7 * 3600 + i * every * 60, 0]);
const STOPS = { S: [...SYN, 'S'], A: [...east(1), 'A'], B: [...east(3), 'B'], C: [...east(5), 'C'], N: [...north(east(1), 3), 'N'], Z: [...north(east(1), 2), 'Z'], F: [...east(30), 'F'] };
const ROUTES = [
    { line: '1', stops: ['S', 'A', 'B', 'C'], trips: rush(5) },
    { line: '2', stops: ['A', 'N'], trips: rush(20) },
    { line: '3', stops: ['Z', 'A'], trips: rush(30) },
    // Too far out to be asked for
    { line: '4', stops: ['C', 'F'], trips: rush(5) },
];
const NETWORK = { stops: STOPS, routes: ROUTES };
const LIVE = new Set(Object.keys(STOPS));

test('the stops chosen measure the busiest stretches first, 1 to 6 km long, and only near the centre', () => {
    assert.deepEqual(STRETCH_KM, [1, 6]);
    const [first] = pickWeeks(NETWORK, LIVE, { weeks: 1, perWeek: 2, areas: {} });
    // S to B or A to C: 3 or 4 km of the line every 5 minutes; F is out of reach
    assert.ok(km(STOPS[first[0]], STOPS[first[1]]) >= 3, first.join());
    assert.ok(!first.includes('F'));
    assert.ok(km(STOPS.F, SYN) > AROUND_KM);
});

test('a later week measures what earlier weeks didn\'t', () => {
    const weeks = pickWeeks(NETWORK, LIVE, { weeks: 2, perWeek: 2, areas: {} });
    const measured = w => coverage(NETWORK, [w]);
    assert.ok(measured(weeks[1]) > 0);
    assert.ok(coverage(NETWORK, weeks) > measured(weeks[0]));
});

test('every area named gets a stretch in the first week, and the real list names five', () => {
    assert.deepEqual(Object.keys(AREAS), ['Kypseli', 'Patisia', 'Galatsi', 'Vyronas', 'Zografou']);
    const [first] = pickWeeks(NETWORK, LIVE, { weeks: 1, perWeek: 3, areas: { here: STOPS.Z.slice(0, 2) } });
    // Z, then what measures most with it: A, 2 km along line 3
    assert.deepEqual(first.slice(0, 2), ['Z', 'A']);
});

test('a stop OASA\'s live network doesn\'t have is never chosen', () => {
    const [first] = pickWeeks(NETWORK, new Set(['A', 'B', 'C', 'N']), { weeks: 1, perWeek: 4, areas: {} });
    assert.ok(!first.includes('S'));
});
