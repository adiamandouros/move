import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDown, dueStops, elapsedMinutes, IDLE_MS, isIdle, refreshEvery, REFRESH, REFRESH_SLOW_MS, SLACK_MS } from '../tools/buses/client/timing.js';

// Which stops the bus page asks for, when it asks again, and how the minutes
// count down in between (tools/buses/client/timing.js), exactly where each
// boundary is. In a real page: every request of a scripted visit in
// test/browser/bus-trace.spec.js, and the minutes counting down while
// offline in failures.spec.js.

const at = minutes => ({ arrivals: minutes.map(m => ({ minutes: m, line: '040' })) });

test('the approved tiers: 30 s up to 10 minutes, 60 s up to 20, then 120 s, each plus 2 s', () => {
    assert.deepEqual(REFRESH, [[10, 30_000], [20, 60_000]]);
    assert.equal(REFRESH_SLOW_MS, 120_000);
    assert.equal(SLACK_MS, 2_000);
    assert.equal(refreshEvery(at([0])), 32_000);
    assert.equal(refreshEvery(at([10])), 32_000);
    assert.equal(refreshEvery(at([11])), 62_000);
    assert.equal(refreshEvery(at([20])), 62_000);
    assert.equal(refreshEvery(at([21])), 122_000);
    // Only the next bus counts
    assert.equal(refreshEvery(at([25, 3])), 122_000);
});

test('no buses: slowest; no answer yet, unavailable or opened: fastest', () => {
    assert.equal(refreshEvery(at([])), 122_000);
    assert.equal(refreshEvery(undefined), 32_000);
    assert.equal(refreshEvery({ arrivals: [], unavailable: true }), 32_000);
    assert.equal(refreshEvery(at([30]), { opened: true }), 32_000);
});

test('whole minutes since the answer came in', () => {
    assert.equal(elapsedMinutes(undefined, 1_000_000), 0);
    assert.equal(elapsedMinutes(1_000_000, 1_000_000 + 59_999), 0);
    assert.equal(elapsedMinutes(1_000_000, 1_000_000 + 60_000), 1);
    assert.equal(elapsedMinutes(1_000_000, 1_000_000 + 179_000), 2);
});

test('counting down takes minutes off and drops buses that should have come', () => {
    assert.deepEqual(countDown(at([1, 5, 12]), 2), at([3, 10]));
    assert.deepEqual(countDown(at([1, 5]), 1), at([0, 4]), 'a bus due now stays');
    // Nothing to do: the same object back
    const answer = at([5]);
    assert.equal(countDown(answer, 0), answer);
    assert.equal(countDown(undefined, 3), undefined);
    const unavailable = { arrivals: [], unavailable: true };
    assert.equal(countDown(unavailable, 3), unavailable);
});

test('a stop counted down into a faster tier is refreshed sooner', () => {
    // 12 minutes away: every 62 s; two minutes later it's 10 away: every 32 s
    assert.equal(refreshEvery(at([12])), 62_000);
    assert.equal(refreshEvery(countDown(at([12]), 2)), 32_000);
});

// ── Which stops are due ─────────────────────────────────────────────────────

const NOW = 10_000_000;
// Four stops listed near you: 1 and 2 on screen, 3 below it, 4 hidden by "Hide empty stops"
const listed = (more = {}) => ({
    codes: ['1', '2', '3', '4'],
    view: 'nearby',
    opened: new Set(),
    watched: new Set(['1', '2', '4']),
    asking: new Set(),
    asked: {},
    fetched: {},
    results: {},
    ...more,
});

test('near you: every stop watched is asked for at once, not those off screen', () => {
    assert.deepEqual(dueStops(listed(), NOW), ['1', '2', '4']);
    // Not one already being asked for
    assert.deepEqual(dueStops(listed({ asking: new Set(['2']) }), NOW), ['1', '4']);
});

test('a stop or a line: only the stops opened, watched or not', () => {
    for (const view of ['stop', 'line']) {
        assert.deepEqual(dueStops(listed({ view }), NOW), [], view);
        assert.deepEqual(dueStops(listed({ view, opened: new Set(['3']) }), NOW), ['3'], view);
    }
});

test('each stop again once its answer is due, by its next bus, counted down', () => {
    const answered = (code, minutes, ago) => ({ asked: { [code]: NOW - ago }, fetched: { [code]: NOW - ago }, results: { [code]: at(minutes) } });
    const only1 = more => dueStops(listed({ watched: new Set(['1']), ...more }), NOW);
    // Next bus in 5 minutes: again after 32 s
    assert.deepEqual(only1(answered('1', [5], 31_999)), []);
    assert.deepEqual(only1(answered('1', [5], 32_000)), ['1']);
    // In 15: after 62 s; in 25: after 122 s
    assert.deepEqual(only1(answered('1', [15], 61_999)), []);
    assert.deepEqual(only1(answered('1', [15], 62_000)), ['1']);
    assert.deepEqual(only1(answered('1', [25], 121_999)), []);
    assert.deepEqual(only1(answered('1', [25], 122_000)), ['1']);
    // In 22, answered 2 minutes ago: 20 now, so its tier is 62 s and it's due
    assert.deepEqual(only1(answered('1', [22], 120_000)), ['1']);
    // Opened: every 32 s, whenever its bus comes
    assert.deepEqual(only1({ ...answered('1', [25], 32_000), opened: new Set(['1']) }), ['1']);
    // Asked 40 s ago without an answer (the server didn't reply): again now
    assert.deepEqual(only1({ asked: { 1: NOW - 40_000 }, results: { 1: { arrivals: [], unavailable: true } }, fetched: { 1: NOW - 40_000 } }), ['1']);
});

test('nothing is asked once the page has gone 10 minutes untouched', () => {
    assert.equal(IDLE_MS, 600_000);
    assert.equal(isIdle(NOW - IDLE_MS, NOW), false);
    assert.equal(isIdle(NOW - IDLE_MS - 1, NOW), true);
});
