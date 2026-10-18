import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRail } from '../server/data/build-rail.js';
import { railCurated as curated, railFeed as feed } from './fixtures/gtfs.js';

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

test('headway overrides replace the chosen days using the main profile', async () => {
    const overrides = { headways: [{ line: 'M9', days: ['sat'], reason: 'test', periods: [['06:00', '07:00', 30]] }] };
    const { data } = await buildRail({ dir: feed(), curated: curated({ overrides }), today: '20261003' });
    const { patterns, days } = data.lines.M9.directions.north.timetable;
    assert.deepEqual(patterns[days[6]], [[21600, 0], [23400, 0]]);
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
