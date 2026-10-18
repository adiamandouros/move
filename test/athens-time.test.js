import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { athensToday } from '../server/data/calendar.js';
import { createHealth } from '../server/health.js';
import { athensDate, athensNow, nextDay, planTrip } from '../tools/subway/client/network.js';
import { rail } from './fixtures/rail.js';

// Athens time across the clock changes. Greece moves its clocks back on the
// last Sunday of October (04:00 → 03:00, so 03:00–04:00 happens twice) and
// forward on the last Sunday of March (03:00 → 04:00, so 03:00–04:00 never
// happens). Times, days and dates must follow Athens, whatever the server's
// or the phone's clock is set to.

const H = 3600;
const at = iso => athensNow(new Date(iso));
const hhmm = now => `${String(Math.floor(now.seconds / H)).padStart(2, '0')}:${String(Math.floor(now.seconds % H / 60)).padStart(2, '0')}`;

test('October: 03:00–04:00 on Sunday the 25th happens twice', () => {
    assert.deepEqual(at('2026-10-24T20:59:00Z'), { weekday: 6, seconds: 23 * H + 59 * 60, date: '2026-10-24' }); // 23:59 summer time
    assert.equal(at('2026-10-24T21:00:00Z').date, '2026-10-25');
    assert.equal(hhmm(at('2026-10-25T00:30:00Z')), '03:30'); // summer time, UTC+3
    assert.equal(hhmm(at('2026-10-25T00:59:00Z')), '03:59');
    assert.equal(hhmm(at('2026-10-25T01:00:00Z')), '03:00'); // the clocks go back
    assert.equal(hhmm(at('2026-10-25T01:30:00Z')), '03:30'); // winter time, UTC+2
    // Midnight that night is at 22:00 UTC, not 21:00
    assert.equal(at('2026-10-25T21:30:00Z').date, '2026-10-25');
    assert.deepEqual(at('2026-10-25T22:00:00Z'), { weekday: 1, seconds: 0, date: '2026-10-26' });
});

test('March: Sunday the 29th goes from 02:59 straight to 04:00', () => {
    assert.equal(hhmm(at('2026-03-29T00:59:00Z')), '02:59'); // winter time, UTC+2
    assert.equal(hhmm(at('2026-03-29T01:00:00Z')), '04:00'); // the clocks go forward
    assert.deepEqual(at('2026-03-28T22:00:00Z'), { weekday: 0, seconds: 0, date: '2026-03-29' });
    assert.deepEqual(at('2026-03-29T21:00:00Z'), { weekday: 1, seconds: 0, date: '2026-03-30' });
});

test('the server\'s and the browser\'s Athens dates agree every half hour around both changes', () => {
    for (const [from, to] of [['2026-10-23T00:00:00Z', '2026-10-28T00:00:00Z'], ['2026-03-27T00:00:00Z', '2026-04-01T00:00:00Z']]) {
        for (let t = Date.parse(from); t < Date.parse(to); t += H * 500) {
            const date = new Date(t);
            assert.equal(athensToday(date), athensDate(date).replaceAll('-', ''), date.toISOString());
            assert.equal(athensNow(date).date, athensDate(date), date.toISOString());
        }
    }
});

test('the day after Saturday the 24th is Sunday the 25th, clock change or not', () => {
    assert.deepEqual(nextDay(at('2026-10-24T20:00:00Z')), { weekday: 0, seconds: 0, date: '2026-10-25' });
    assert.deepEqual(nextDay(at('2026-03-28T20:00:00Z')), { weekday: 0, seconds: 0, date: '2026-03-29' });
});

test('both 03:30s of the 25th plan the same trip', () => {
    // L2 runs all night from Saturday into Sunday (fixtures/rail.js)
    const first = planTrip(rail, 'x', 'c', at('2026-10-25T00:30:00Z'));
    const second = planTrip(rail, 'x', 'c', at('2026-10-25T01:30:00Z'));
    assert.ok(first.plans.length, 'there is a train');
    assert.deepEqual(second, first);
});

test('the health check counts whole days to the timetable\'s end through the clock change', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wayhop-health-'));
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ generated: '2026-10-24T01:30:00Z', outputs: { 'rail.json': { ok: true } } }));
    writeFileSync(join(dir, 'rail.json'), JSON.stringify({ feed: { validTo: '2026-10-31' } }));
    const daysLeft = async iso => (await createHealth({
        busStatus: () => ({ routes: [] }),
        announcementStatus: () => ({}),
        buildDir: dir,
        now: () => Date.parse(iso),
    }).check()).data.timetableDaysLeft;
    assert.equal(await daysLeft('2026-10-24T12:00:00Z'), 7);
    assert.equal(await daysLeft('2026-10-25T12:00:00Z'), 6); // a 25-hour day
    assert.equal(await daysLeft('2026-10-30T21:30:00Z'), 1); // 23:30 on the 30th in Athens
    assert.equal(await daysLeft('2026-10-30T22:30:00Z'), 0); // 00:30 on the 31st
});
