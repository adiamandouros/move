import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDown, elapsedMinutes, refreshEvery, REFRESH, REFRESH_SLOW_MS, SLACK_MS } from '../tools/buses/client/timing.js';

// When the bus page asks again for a stop, and how the minutes count down in
// between (tools/buses/client/timing.js). The browser tests check the same
// in a real page (test/browser/buses.spec.js); these say exactly where each
// boundary is.

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
