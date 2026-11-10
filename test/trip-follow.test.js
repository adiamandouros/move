import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// My location following the rider on the Trip page (decision 45): when the
// trip is planned again from where they are (tools/trip/client/follow.js).
// The page's side: test/browser/location.spec.js.

const { MOVED_METRES, REPLAN_MS, replanDue } = await browserModule('tools/trip/client/follow.js');

// Syntagma, and about 0.0009° of latitude to 100 m north of it
const SYNTAGMA = { lat: 37.9755, lng: 23.7348 };
const north = metres => ({ lat: SYNTAGMA.lat + metres / 111_195, lng: SYNTAGMA.lng });
const T = 1_000_000;

test('the numbers agreed for OASA: 200 m from where the trip was planned, at most every 2 minutes', () => {
    assert.equal(MOVED_METRES, 200);
    assert.equal(REPLAN_MS, 120_000);
});

test('planned again once the rider is 200 m or more from where it was planned, and 2 minutes or more after', () => {
    const planned = { ...SYNTAGMA, at: T };
    assert.equal(replanDue(planned, north(200), T + REPLAN_MS), true);
    assert.equal(replanDue(planned, north(2_000), T + 10 * REPLAN_MS), true);
    // Not far enough, however long
    assert.equal(replanDue(planned, north(195), T + 10 * REPLAN_MS), false);
    assert.equal(replanDue(planned, SYNTAGMA, T + 10 * REPLAN_MS), false);
    // Far enough, but too soon, however far: a ride doesn't plan it again every second
    assert.equal(replanDue(planned, north(200), T + REPLAN_MS - 1), false);
    assert.equal(replanDue(planned, north(5_000), T + 1_000), false);
});

test('the distance is from where it was planned, in any direction', () => {
    const planned = { ...SYNTAGMA, at: T };
    const east = { lat: SYNTAGMA.lat, lng: SYNTAGMA.lng + 250 / (111_195 * Math.cos(SYNTAGMA.lat * Math.PI / 180)) };
    assert.equal(replanDue(planned, east, T + REPLAN_MS), true);
    assert.equal(replanDue({ ...north(300), at: T }, north(150), T + REPLAN_MS), false);
});
