import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRail } from '../server/data/build-rail.js';
import { extractTables } from '../server/data/stasy.js';
import { railCurated as curated, railFeed as feed } from './fixtures/gtfs.js';
import { stasyPage, stasyTable } from './fixtures/stasy.js';

test('builds stations, stops and a compressed weekly timetable', async () => {
    const { data, warnings } = await buildRail({ dir: feed(), curated: curated(), today: '20261003' });
    const north = data.lines.M9.directions.north;

    assert.deepEqual(north.stops.map(s => s.station), ['a', 'b', 'c']);
    assert.deepEqual(north.stops[1], { station: 'b', exits: ['front'], note: 'Hi' });
    assert.deepEqual(data.stations.a, { name: { el: 'Α', en: 'A' }, coords: [37.1, 23.1], lines: ['M9'] });

    // n1 and n2 share a run-time profile; n3 skips c and the ignored X1 stop
    const { profiles, patterns, days } = north.timetable;
    assert.deepEqual(profiles, [{ stops: [0, 1, 2], offsets: [0, 120, 300] }, { stops: [0, 1], offsets: [0, 120] }]);
    assert.deepEqual(days, [0, 1, 1, 1, 1, 1, 2]);
    assert.deepEqual(patterns[1], [[28800, 0], [29400, 0], [88200, 1]]);

    assert.deepEqual(data.feed.week, { sun: '2026-08-09', mon: '2026-08-03', tue: '2026-08-04', wed: '2026-08-05', thu: '2026-08-06', fri: '2026-08-07', sat: '2026-08-08' });
    // The feed has expired: no dates of its own, only the typical week
    assert.deepEqual(north.timetable.dates, {});
    assert.ok(warnings.some(w => /no exits for M9\/north\/a/.test(w)));
    assert.ok(warnings.some(w => /expired on 2026-08-09/.test(w)));
});

test('the pages get only where the elevators are, each place once; "none" and the way to the other side are left out', async () => {
    const positions = {
        M9: {
            north: { a: { exits: ['back'], elevators: [{ at: 'front', name: 'Προς Γ' }, { at: 'back' }, { at: 'front', name: 'Εξωτερικός' }], stepFree: 'lift' }, b: { exits: ['front'], elevators: 'none', crossing: { at: ['front'], via: 'bridge' } }, c: { exits: ['back'] } },
            south: { c: { exits: ['back'] }, b: { exits: ['center'] }, a: { exits: ['front'] } },
        },
    };
    const { data } = await buildRail({ dir: feed(), curated: curated({ positions }), today: '20261003' });
    const [a, b] = data.lines.M9.directions.north.stops;
    assert.deepEqual(a, { station: 'a', exits: ['back'], elevators: ['front', 'back'], stepFree: 'lift' });
    assert.deepEqual(b, { station: 'b', exits: ['front'] });
});

test('a train the feed lists twice is kept once, the night before\'s copy on the earlier day', async () => {
    const { data, warnings } = await buildRail({ dir: feed({ copies: true }), curated: curated(), today: '20261003' });
    const { profiles, patterns, days } = data.lines.M9.directions.north.timetable;
    const day = wd => patterns[days[wd]].map(([start, p]) => [start, profiles[p].stops]);
    // Weekdays: n1, n10 (20 s behind but stopping short), n11 (2 min behind), n2, n3; n9 was n1 again
    assert.deepEqual(day(1), [[28800, [0, 1, 2]], [28820, [0, 1]], [28920, [0, 1, 2]], [29400, [0, 1, 2]], [88200, [0, 1]]]);
    // Saturday keeps its night train n7 (01:00 on Sunday); Sunday drops n8, the same train
    assert.deepEqual(day(6), [[32400, [0, 1, 2]], [90000, [0, 1, 2]]]);
    assert.deepEqual(day(0), [[36000, [0, 1, 2]]]);
    assert.ok(warnings.includes('M9/north: the feed lists some trains twice; kept one of each (sun: 1, mon: 1, tue: 1, wed: 1, thu: 1, fri: 1)'));
    // No profile is left over from the copies
    assert.equal(profiles.length, 2);
});

test('a date whose trains aren\'t its weekday\'s has them, from yesterday to the feed\'s end', async () => {
    // Thursday 13 Aug is a holiday with Saturday's trains; today is Wednesday 5 Aug
    const { data } = await buildRail({ dir: feed({ holiday: '20260813' }), curated: curated(), today: '20260805' });
    const { profiles, patterns, days, dates } = data.lines.M9.directions.north.timetable;
    const day = p => patterns[p].map(([start, k]) => [start, profiles[k].stops]);
    // The typical Thursday is the 6th; the 13th runs n4, at 09:00
    assert.equal(data.feed.week.thu, '2026-08-06');
    assert.deepEqual(days, [0, 1, 1, 1, 1, 1, 2]);
    assert.deepEqual(Object.keys(dates), ['2026-08-13']);
    assert.deepEqual(day(dates['2026-08-13']), [[9 * 3600, [0, 1, 2]]]);
    assert.equal(dates['2026-08-13'], days[6], 'the same trains as Saturday, stored once');
    assert.deepEqual(data.lines.M9.directions.south.timetable.dates, { '2026-08-13': 2 });

    // Yesterday is the earliest date kept (its trains after midnight); a holiday before it is left out
    const later = await buildRail({ dir: feed({ holiday: '20260813' }), curated: curated(), today: '20260814' });
    assert.deepEqual(Object.keys(later.data.lines.M9.directions.north.timetable.dates), ['2026-08-13']);
    const after = await buildRail({ dir: feed({ holiday: '20260813' }), curated: curated(), today: '20260815' });
    assert.deepEqual(after.data.lines.M9.directions.north.timetable.dates, {});
});

test('a date the feed lays two timetables over keeps its weekday\'s trains, with a note', async () => {
    const { data, notes } = await buildRail({ dir: feed({ crowded: '20260813' }), curated: curated(), today: '20260805' });
    assert.deepEqual(data.lines.M9.directions.north.timetable.dates, {});
    assert.deepEqual(notes, ['2026-08-13: the GTFS lists far more trains than usual for a line (two timetables laid over each other?); the typical thu is used']);
});

test('the copies the feed lists are dropped on its dates too, so they match their weekdays', async () => {
    // Sunday 9 Aug's copy n8 is Saturday 8 Aug's n7, the night before
    const { data } = await buildRail({ dir: feed({ copies: true }), curated: curated(), today: '20260803' });
    assert.deepEqual(data.lines.M9.directions.north.timetable.dates, {});
});

test('fails on stops that no station claims', async () => {
    await assert.rejects(buildRail({ dir: feed({ extraStop: 8 }), curated: curated(), today: '20261003' }), /not mapped to any station.*Z1/);
});

test('fails when positions.json names a station the line does not serve', async () => {
    const c = curated();
    c.stations.stations.d = { name: { el: 'Δ', en: 'D' }, gtfs: ['D1'] };
    c.positions.M9.north.d = { exits: ['front'] };
    await assert.rejects(buildRail({ dir: feed(), curated: c, today: '20261003' }), /M9\/north lists stations the line doesn't serve: d/);
});

// STASY's first and last trains for M9 (a → b → c and back), as stasyTables
// keeps them; `out` and `back` are each direction's rows
const T = ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ'];
const OUT = [['Α', '08:00', '00:30'], ['Β', '08:02', '00:32'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ Γ', '08:05', '00:35']];
const BACK = [['Γ', '08:00', '23:00'], ['Β', '08:03', '23:03'], ['Α', '08:05', '23:05']];
const stasy = ({ out = OUT, back = BACK, line = 'M9' } = {}) => ({
    fetched: '2026-10-01T02:30:00.000Z',
    lines: { [line]: extractTables(stasyPage([stasyTable(T, out), stasyTable(T, back)])) },
});

test('STASY\'s first and last trains go on the stops they leave from, by where they go', async () => {
    const { data, warnings } = await buildRail({ dir: feed(), curated: curated(), today: '20261003', stasy: stasy() });
    assert.deepEqual(data.hours, { fetched: '2026-10-01' });
    const [a, b, c] = data.lines.M9.directions.north.stops;
    assert.deepEqual(a.hours, [{ to: 'c', first: Array(7).fill(8 * 3600), last: Array(7).fill(24.5 * 3600) }]);
    assert.deepEqual(b.hours[0].first, Array(7).fill(8 * 3600 + 120));
    assert.equal(c.hours, undefined);
    assert.deepEqual(data.lines.M9.directions.south.stops[0].hours[0].last, Array(7).fill(23 * 3600));
    assert.ok(!warnings.some(w => w.startsWith('STASY')), warnings.join('; '));
});

test('without STASY\'s times for a line, its first and last trains come from the GTFS, with a warning', async () => {
    const build = async copy => {
        const { data, warnings } = await buildRail({ dir: feed(), curated: curated(), today: '20261003', stasy: copy });
        return { hours: data.hours, stops: data.lines.M9.directions.north.stops.filter(s => s.hours).length, warnings: warnings.filter(w => w.startsWith('STASY')) };
    };
    assert.deepEqual(await build(null), { hours: undefined, stops: 0, warnings: [] });
    for (const [copy, warning] of [
        [stasy({ line: 'M1' }), 'STASY M9: not in the copy; its first and last trains come from the GTFS'],
        [stasy({ out: OUT.slice(0, 2) }), 'STASY M9: a table ends at b, where no direction ends; its first and last trains come from the GTFS'],
        [stasy({ out: [OUT[1], OUT[0], OUT[2]] }), 'STASY M9: north: a isn\'t where the line has it; its first and last trains come from the GTFS'],
        [stasy({ back: OUT }), 'STASY M9: both tables are for north; its first and last trains come from the GTFS'],
        [stasy({ out: [['Α', '08:00', 'όλη νύχτα'], ...OUT.slice(1)] }), 'STASY M9: unknown time "όλη νύχτα"; its first and last trains come from the GTFS'],
    ]) assert.deepEqual(await build(copy), { hours: undefined, stops: 0, warnings: [warning] });

    // A station STASY leaves out keeps its GTFS times; the rest get STASY's
    const partly = await build(stasy({ out: [OUT[0], OUT[2]] }));
    assert.deepEqual(partly, { hours: { fetched: '2026-10-01' }, stops: 1, warnings: ['STASY M9/north: no first and last trains for b; their GTFS times are used'] });
});

test('trains outside STASY\'s first and last trains are left out, or start where they\'re in service', async () => {
    // At a, the first train is 08:10 (n1's 08:00 there is too early) and the last 00:15 (n3's 00:30 is too late);
    // at b, n1's 08:02 is fine, so n1 runs from b
    const copy = stasy({ out: [['Α', '08:10', '00:15'], ['Β', '08:00', '00:17'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ Γ', '08:05', '00:20']] });
    const { data, warnings } = await buildRail({ dir: feed(), curated: curated(), today: '20261003', stasy: copy });
    const { profiles, patterns, days } = data.lines.M9.directions.north.timetable;
    const day = wd => patterns[days[wd]].map(([start, p]) => [start, profiles[p].stops]);
    assert.deepEqual(day(1), [[8 * 3600 + 120, [1, 2]], [8 * 3600 + 600, [0, 1, 2]]]);
    assert.deepEqual(day(6), [[9 * 3600, [0, 1, 2]]]);
    assert.ok(warnings.includes('M9/north: 10 trains run outside STASY\'s first and last trains: 5 left out, 5 shortened'), warnings.join('; '));
    // The other way, every train is inside: nothing changes
    assert.deepEqual(data.lines.M9.directions.south.timetable.patterns.flat().length, 3);
});

// STASY's tables for M9 where the last train north is 08:30, except on
// Saturdays (all night) and Fridays (01:00)
function allNightStasy() {
    const T = ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ (ΔΕΥ - ΠΕΜ & ΚΥΡ)', 'ΤΕΛΕΥΤΑΙΟ (ΠΑΡ)'];
    const note = 'Σημείωση: Κάθε Σάββατο υπάρχει 24ωρη λειτουργία στις Γραμμές 9 του Μετρό.';
    const out = stasyTable(T, [['Α', '08:00', '08:30', '01:00'], ['Β', '08:02', '08:32', '01:02'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ Γ', '08:05', '08:35', '01:05']], [note]);
    const back = stasyTable(T, [['Γ', '08:00', '23:00', '23:00'], ['Β', '08:03', '23:03', '23:03'], ['Α', '08:05', '23:05', '23:05']], [note]);
    return { fetched: '2026-10-01T02:30:00.000Z', lines: { M9: extractTables(stasyPage([out, back])) } };
}

test('a holiday keeps to its own weekday\'s first and last trains, as STASY\'s tables have no holidays', async () => {
    // Thursday 13 Aug runs Saturday's n4 at 09:00, but a Thursday's last train is 08:30: it doesn't run
    const { data } = await buildRail({ dir: feed({ holiday: '20260813' }), curated: curated(), today: '20260805', stasy: allNightStasy() });
    const { patterns, days, dates } = data.lines.M9.directions.north.timetable;
    assert.deepEqual(patterns[days[6]].map(([start]) => start), [9 * 3600]);
    assert.deepEqual(patterns[dates['2026-08-13']], []);
});

test('a night STASY says runs all night keeps its late trains; the next morning\'s too', async () => {
    const { data } = await buildRail({ dir: feed(), curated: curated(), today: '20261003', stasy: allNightStasy() });
    const { patterns, days } = data.lines.M9.directions.north.timetable;
    const starts = wd => patterns[days[wd]].map(([start]) => start);
    // Weekdays: n1 and n2 (n3 at 00:30 is after 08:30, but Friday's 01:00 lets it run on Fridays)
    assert.deepEqual(starts(1), [8 * 3600, 8 * 3600 + 600]);
    assert.deepEqual(starts(5), [8 * 3600, 8 * 3600 + 600, 24.5 * 3600]);
    // Saturday's 09:00 runs (no last train), Sunday's 10:00 doesn't (after 08:30)
    assert.deepEqual(starts(6), [9 * 3600]);
    assert.deepEqual(starts(0), []);
});

// STASY's airport timetable for M9 north (a → b → c), every day, through c
const airportFile = trains => ({
    checked: '2026-10-20', page: 'https://www.stasy.gr/x/',
    lines: { M9: { north: { pdf: 'https://www.stasy.gr/wp-content/uploads/2024/06/a.pdf', sha256: '0'.repeat(64), serves: 'c', stations: ['a', 'b', 'c'], trains: trains.map((times, i) => ({ train: String(i + 1), times })) } } },
});

test('STASY\'s airport trains: the GTFS\'s are kept, the ones it lacks or ends early are added, every day', async () => {
    const airport = airportFile([
        ['08:01', '08:03', '08:06'],   // n1 on weekdays (c within 90 s): kept; added at the weekend
        ['08:10', '08:15', '08:15'],   // n2 on weekdays, though 3 minutes off at b: kept, and said
        ['24:30', '24:32', '24:35'],   // n3 ends early at b on weekdays: replaced, and added every day
    ]);
    const { data, warnings } = await buildRail({ dir: feed(), curated: curated({ airport }), today: '20261003' });
    const { profiles, patterns, days } = data.lines.M9.directions.north.timetable;
    const day = wd => patterns[days[wd]].map(([start, p]) => [start, profiles[p].stops, profiles[p].offsets]);
    const H = 3600;
    assert.deepEqual(day(1), [[8 * H, [0, 1, 2], [0, 120, 300]], [8 * H + 600, [0, 1, 2], [0, 120, 300]], [24.5 * H, [0, 1, 2], [0, 120, 300]]]);
    assert.deepEqual(day(6), [
        [8 * H + 60, [0, 1, 2], [0, 120, 300]], [8 * H + 600, [0, 1, 2], [0, 300, 300]], [9 * H, [0, 1, 2], [0, 120, 300]], [24.5 * H, [0, 1, 2], [0, 120, 300]],
    ]);
    assert.ok(warnings.includes('M9/north: STASY\'s airport timetable adds trains the GTFS doesn\'t have, or has only part of: 08:01 (sun, sat), 08:10 (sun, sat), 24:30 (every day)'), warnings.join('\n'));
    assert.ok(warnings.includes('M9/north: the GTFS times airport trains differently from STASY\'s airport timetable (the GTFS\'s are kept; check them on the platform): 08:10 (up to 3 min)'), warnings.join('\n'));
    // Saturday's 09:00 and Sunday's 10:00 aren't in STASY's: kept, to check
    assert.ok(warnings.includes('M9/north: the GTFS has airport trains STASY\'s airport timetable doesn\'t (kept; check them on the platform): a 09:00 (sat), a 10:00 (sun)'), warnings.join('\n'));
});

test('a train as close as an airport train but going its own way isn\'t taken for it', async () => {
    // n1 runs all the way on weekdays, so n10 (20 s behind, to b only) is another train
    const airport = airportFile([['08:00', '08:02', '08:05']]);
    const { data } = await buildRail({ dir: feed({ copies: true }), curated: curated({ airport }), today: '20261003' });
    const { patterns, days } = data.lines.M9.directions.north.timetable;
    assert.ok(patterns[days[1]].some(([start]) => start === 8 * 3600 + 20));
});

test('STASY\'s airport trains on stations other than the line\'s are left out, with a warning', async () => {
    const airport = airportFile([['12:00', '12:02', '12:05']]);
    airport.lines.M9.north.stations = ['a', 'c', 'b'];
    const { data, warnings } = await buildRail({ dir: feed(), curated: curated({ airport }), today: '20261003' });
    assert.ok(warnings.includes('airport.json: M9/north lists other stations than the line has; its trains weren\'t added'));
    assert.ok(!data.lines.M9.directions.north.timetable.patterns.flat().some(([start]) => start === 12 * 3600));
});
