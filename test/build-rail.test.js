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
    assert.ok(warnings.some(w => /no exits for M9\/north\/a/.test(w)));
    assert.ok(warnings.some(w => /expired on 2026-08-09/.test(w)));
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
