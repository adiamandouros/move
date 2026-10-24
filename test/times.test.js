import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soonTier, timeBadge } from '../public/js/core/times.js';

// The time badge (public/js/core/times.js): how soon, on one scale for buses and trains

test('how soon: due up to 3 minutes, close up to 8, later after', () => {
    assert.deepEqual([0, 1, 3, 4, 8, 9, 60].map(soonTier), ['due', 'due', 'due', 'close', 'close', 'later', 'later']);
});

test('a badge is its tier\'s class around the content, with its words as the title', () => {
    assert.equal(String(timeBadge('due', '2 min')), '<span class="time-badge time-due">2 min</span>');
    assert.equal(String(timeBadge('last', '05:32', 'Last train')), '<span class="time-badge time-last" title="Last train">05:32</span>');
});
