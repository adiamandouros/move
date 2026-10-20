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

// One service per date, as in the STASY feed, from Mon 3 Aug 2026 for `weeks`
// weeks. Every date has 100 trips on M1 and 100 on M2, unless `trips` gives
// that date its own: { '20260815': { M1: 60, M2: 60 } }.
function feedDays(weeks, trips = {}) {
    const dateServices = new Map();
    const tripsPerService = new Map();
    for (let d = 3; d < 3 + weeks * 7; d++) {
        const date = `202608${String(d).padStart(2, '0')}`;
        dateServices.set(date, new Set([date]));
        tripsPerService.set(date, new Map(Object.entries(trips[date] ?? { M1: 100, M2: 100 })));
    }
    return [dateServices, tripsPerService];
}

test('pickWeek prefers upcoming dates while the feed is valid', () => {
    const week = pickWeek(...feedDays(2), '20260806');
    assert.deepEqual(week, ['20260809', '20260810', '20260811', '20260812', '20260806', '20260807', '20260808']);
});

test('pickWeek uses the last week of an expired feed and skips holidays', () => {
    // Sat 15 Aug is a holiday with reduced service
    const week = pickWeek(...feedDays(2, { '20260815': { M1: 60, M2: 60 } }), '20261003');
    assert.deepEqual(week, ['20260816', '20260810', '20260811', '20260812', '20260813', '20260814', '20260808']);
});

test('pickWeek skips a date on which a line has far more trips than usual', () => {
    // Thu 20 Aug has M1's timetable twice; Fri 21 Aug just runs a few more M2 trains
    const week = pickWeek(...feedDays(3, { '20260820': { M1: 200, M2: 100 }, '20260821': { M1: 100, M2: 130 } }), '20260817');
    assert.equal(week[4], '20260813');
    assert.equal(week[5], '20260821');
});

test('pickWeek still picks a date when none looks usual', () => {
    // Each Thursday has one line far above the others' count for it
    const thursdays = { '20260806': { M1: 300, M2: 100, M3: 100 }, '20260813': { M1: 100, M2: 300, M3: 100 }, '20260820': { M1: 100, M2: 100, M3: 300 } };
    assert.equal(pickWeek(...feedDays(3, thursdays), '20260817')[4], '20260820');
});
