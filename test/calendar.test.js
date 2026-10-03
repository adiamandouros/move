import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athensToday, pickWeek, serviceDates, toSeconds, weekday } from '../server/data/calendar.js';

test('toSeconds keeps times past midnight', () => {
    assert.equal(toSeconds('07:44:29'), 27869);
    assert.equal(toSeconds('25:03:00'), 90180);
    assert.equal(toSeconds('05:30'), 19800);
});

test('weekday and athensToday', () => {
    assert.equal(weekday('20261003'), 6); // Saturday
    assert.equal(athensToday(new Date('2026-10-03T22:30:00Z')), '20261004'); // already Sunday in Athens
});

test('serviceDates combines calendar.txt with calendar_dates.txt exceptions', () => {
    const calendar = [{ service_id: 'wk', monday: '1', tuesday: '1', wednesday: '0', thursday: '0', friday: '0', saturday: '0', sunday: '0', start_date: '20260803', end_date: '20260811' }];
    const exceptions = [
        { service_id: 'wk', date: '20260810', exception_type: '2' },
        { service_id: 'hol', date: '20260810', exception_type: '1' },
    ];
    const dates = serviceDates(calendar, exceptions);
    assert.deepEqual([...dates.keys()].sort(), ['20260803', '20260804', '20260810', '20260811']);
    assert.deepEqual([...dates.get('20260810')], ['hol']);
});

// One service per date, as in the STASY feed: Mon 3 Aug … Sun 16 Aug 2026
function twoWeeks(tripsByDate = {}) {
    const dateServices = new Map();
    const tripsPerService = new Map();
    for (let d = 3; d <= 16; d++) {
        const date = `202608${String(d).padStart(2, '0')}`;
        dateServices.set(date, new Set([date]));
        tripsPerService.set(date, tripsByDate[date] ?? 100);
    }
    return [dateServices, tripsPerService];
}

test('pickWeek prefers upcoming dates while the feed is valid', () => {
    const week = pickWeek(...twoWeeks(), '20260806');
    assert.deepEqual(week, ['20260809', '20260810', '20260811', '20260812', '20260806', '20260807', '20260808']);
});

test('pickWeek uses the last week of an expired feed and skips holidays', () => {
    // Sat 15 Aug is a holiday with reduced service
    const week = pickWeek(...twoWeeks({ '20260815': 60 }), '20261003');
    assert.deepEqual(week, ['20260816', '20260810', '20260811', '20260812', '20260813', '20260814', '20260808']);
});
