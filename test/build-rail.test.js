import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildRail } from '../server/data/build-rail.js';

// A tiny feed: line M9 with stations a–b–c, valid Mon 3 – Sun 9 Aug 2026.
// X1 is a technical stop that stations.json tells the build to ignore.
function feed({ extraStop = '' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'move-rail-'));
    const write = (name, rows) => writeFileSync(join(dir, name), rows.join('\n') + '\n');
    write('routes.txt', ['route_id,route_short_name', '1,M9', '2,T1']);
    write('calendar.txt', [
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
        'wk,1,1,1,1,1,0,0,20260803,20260809',
        'sat,0,0,0,0,0,1,0,20260803,20260809',
        'sun,0,0,0,0,0,0,1,20260803,20260809',
    ]);
    write('stops.txt', [
        'stop_id,stop_code,stop_lat,stop_lon',
        '1,A1,37.0,23.0', '2,A2,37.2,23.2', '3,B1,37.5,23.5', '4,B2,37.5,23.5',
        '5,C1,38.0,24.0', '6,C2,38.0,24.0', '7,X1,37.3,23.3', '8,Z1,0,0',
    ]);
    write('trips.txt', [
        'route_id,service_id,trip_id,direction_id',
        '1,wk,n1,0', '1,wk,n2,0', '1,wk,n3,0', '1,sat,n4,0', '1,sun,n5,0',
        '1,wk,s1,1', '1,sat,s2,1', '1,sun,s3,1',
        '2,wk,tram,0',
    ]);
    const trip = (id, stops) => stops.map(([stop, time], i) => `${id},${time},${time},${stop},${i + 1}`);
    write('stop_times.txt', [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        ...trip('n1', [[1, '08:00:00'], [3, '08:02:00'], [5, '08:05:00']]),
        ...trip('n2', [[1, '08:10:00'], [3, '08:12:00'], [5, '08:15:00']]),
        ...trip('n3', [[1, '24:30:00'], [7, '24:31:00'], [3, '24:32:00']]),
        ...trip('n4', [[1, '09:00:00'], [3, '09:02:00'], [5, '09:05:00']]),
        ...trip('n5', [[1, '10:00:00'], [3, '10:02:00'], [5, '10:05:00']]),
        ...trip('s1', [[6, '08:00:00'], [4, '08:03:00'], [2, '08:05:00']]),
        ...trip('s2', [[6, '09:00:00'], [4, '09:03:00'], [2, '09:05:00']]),
        ...trip('s3', [[6, '10:00:00'], [4, '10:03:00'], [2, '10:05:00']]),
        ...trip('tram', [[8, '08:00:00'], [8, '08:01:00']]),
        ...(extraStop ? trip('n6', [[1, '11:00:00'], [extraStop, '11:01:00']]).map(l => l.replace('n6', 'n1')) : []),
    ]);
    return dir;
}

function curated(overrides = {}) {
    return {
        stations: {
            stations: {
                a: { name: { el: 'Α', en: 'A' }, gtfs: ['A1', 'A2'] },
                b: { name: { el: 'Β', en: 'B' }, gtfs: ['B1', 'B2'] },
                c: { name: { el: 'Γ', en: 'C' }, gtfs: ['C1', 'C2'] },
            },
            ignoreGtfs: ['X1'],
        },
        lines: {
            M9: {
                name: 'M9', color: '#000',
                directions: {
                    north: { gtfsDirection: '0', toward: { el: 'Γ', en: 'C' } },
                    south: { gtfsDirection: '1', toward: { el: 'Α', en: 'A' } },
                },
            },
        },
        positions: {
            M9: {
                north: { a: { exits: [] }, b: { exits: ['front'], note: 'Hi' }, c: { exits: ['back'] } },
                south: { c: { exits: ['back'] }, b: { exits: ['center'] }, a: { exits: ['front'] } },
            },
        },
        overrides: { headways: [] },
        ...overrides,
    };
}

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
