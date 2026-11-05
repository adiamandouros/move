import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
    buildBuses, BUSES_SCHEMA, liveRoutes, MIN_RIDES, onLiveRoutes, retimed, shared, TIMETABLE_SCHEMA, weekFromFeed, withRides,
} from '../server/data/bus-timetable.js';
import { checkOutput } from '../server/data/check-output.js';
import { tempDir } from './fixtures/gtfs.js';

// The buses' timetable for the trip search (server/data/bus-timetable.js,
// decision 30): OASA's feed of August 2026 as a week, put on today's live
// routes each night, with the ride times the server has measured.

const H8 = 8 * 3600;

// ── The feed's week ─────────────────────────────────────────────────────────

function feedDir() {
    const dir = tempDir('wayhop-bus-feed-');
    const files = {
        'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n1,040 ,ΠΕΙΡΑΙΑΣ,3\n2,12,ΟΜΟΝΟΙΑ,11\n',
        'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
            + 'day_1,1,0,0,0,0,0,0,20260803,20260824\nday_3,0,0,1,0,0,0,0,20260804,20260824\nday_7,0,0,0,0,0,0,1,20260803,20260823\n'
            + 'extra,0,0,0,0,0,0,0,20260101,20261231\n',
        // Monday and Wednesday the same, Sunday another; a trip of a service that isn't a day is left out
        'trips.txt': 'route_id,service_id,trip_id\n1,day_1,mon8\n1,day_1,mon9\n1,day_3,wed8\n1,day_3,wed9\n1,day_7,sun10\n1,day_7,sun10b\n2,day_3,trolley\n2,day_3,lone\n1,extra,x\n',
        'stop_times.txt': ['trip_id,arrival_time,departure_time,stop_id,stop_sequence',
            'mon8,08:00:00,08:00:00,10,1', 'mon8,08:05:00,08:05:00,20,2', 'mon8,08:30:00,08:30:00,30,3',
            'mon9,09:00:00,09:00:00,10,1', 'mon9,09:05:00,09:05:00,20,2', 'mon9,09:30:00,09:30:00,30,3',
            // In another order in the file: the stop sequence says
            'wed9,09:30:00,09:30:00,30,3', 'wed9,09:00:00,09:00:00,10,1', 'wed9,09:05:00,09:05:00,20,2',
            'wed8,08:00:00,08:00:00,10,1', 'wed8,08:05:00,08:05:00,20,2', 'wed8,08:30:00,08:30:00,30,3',
            'sun10,24:10:00,24:10:00,10,1', 'sun10,24:20:00,24:20:00,20,2', 'sun10,24:40:00,24:40:00,30,3',
            'sun10b,24:10:00,24:10:00,10,1', 'sun10b,24:15:00,24:15:00,20,2', 'sun10b,24:40:00,24:40:00,30,3',
            // A trip that calls at one stop isn't a ride
            'lone,08:00:00,08:00:00,10,1',
            'trolley,08:00:00,08:00:00,10,1', 'trolley,08:09:00,08:09:00,20,2',
            'x,08:00:00,08:00:00,10,1', 'x,08:01:00,08:01:00,20,2', 'x,08:02:00,08:02:00,30,3',
        ].join('\n'),
    };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), `${text}\n`);
    return dir;
}

test('the feed comes out as a week: each route\'s trips, the days with the same trips sharing them', async () => {
    const week = await weekFromFeed(feedDir(), '2026-08-06');
    assert.deepEqual(week.feed, { modified: '2026-08-06', validFrom: '2026-08-03', validTo: '2026-08-24' });
    assert.equal(week.schema, TIMETABLE_SCHEMA);
    assert.deepEqual(week.routes.map(r => [r.line, r.mode, r.stops]), [['040', 'bus', ['10', '20', '30']], ['12', 'trolley', ['10', '20']]]);
    const [bus] = week.routes;
    assert.deepEqual(bus.profiles, [[0, 300, 1800], [0, 600, 1800]], 'trips with the same times share a profile');
    assert.deepEqual(bus.patterns, [[[87_000, 0], [87_000, 1]], [[H8, 0], [9 * 3600, 0]], []], 'past midnight stays on its day');
    assert.deepEqual(bus.days, [0, 1, 2, 1, 2, 2, 2], 'Sunday, Monday = Wednesday; days without trips share an empty list');
});

// ── On today's live routes ──────────────────────────────────────────────────

// Stops 1.1 km apart along a road, as OASA's live network has them
const place = (code, n) => ({ code, el: `Στάση ${code}`, en: '', lat: 37.97 + n * 0.01, lng: 23.7 });
const liveNetwork = (...routes) => ({
    fetched: '2026-11-01T00:00:00Z',
    lines: [...new Set(routes.map(([line]) => line))].map(line => ({ code: `L${line}`, line, name: { el: line, en: line } })),
    routes: Object.fromEntries([...new Set(routes.map(([line]) => line))].map(line => [`L${line}`,
        routes.filter(([other]) => other === line).map(([, code, name]) => ({ code, type: '1', name: { el: name, en: name } }))])),
    stops: Object.fromEntries(routes.map(([, code, , stops]) => [code, { at: '', stops }])),
});
// A route of the feed's week with its trips every day
const feed = (line, codes, offsets, ...starts) => ({
    line, mode: 'bus', stops: codes, profiles: [offsets], patterns: [starts.map(start => [start, 0])], days: [0, 0, 0, 0, 0, 0, 0],
});

test('every live route is read, its stops in order, without codes the live times can\'t use', () => {
    const network = liveNetwork(
        ['040 ', '1', 'Α - Β', [place('1', 0), { ...place('X9', 1) }, place('2', 2)]],
        ['12', '2', 'Γ', [place('3', 0)]],
    );
    network.lines.push({ code: 'none', line: '999', name: { el: '999', en: '999' } });
    network.routes.L12.push({ code: 'unknown', type: '1', name: { el: 'Δ', en: 'Δ' } });
    assert.deepEqual(liveRoutes(network).map(({ line, code, stops: along }) => [line, code, along.map(stop => stop.code)]), [['040', '1', ['1', '2']]]);
});

test('stops shared with a route count in order, so the way back isn\'t the same route', () => {
    assert.deepEqual(shared(['1', '2', '3'], ['1', '9', '3']), [[0, 0], [2, 2]]);
    assert.equal(shared(['1', '2', '3'], ['3', '2', '1']).length, 1);
});

test('a live route with the same stops keeps the feed\'s times exactly, on every day', () => {
    const { routes, untimed, gone } = onLiveRoutes(
        [{ ...feed('040', ['1', '2', '3'], [0, 100, 250], H8, H8 + 600), patterns: [[[H8, 0]], [[H8 + 600, 0]]], days: [1, 0, 0, 0, 0, 0, 1] }],
        liveNetwork(['040', 'r', 'Α - Β', ['1', '2', '3'].map((code, i) => place(code, i))]),
    );
    // With the OASA route it's on, for measured ride times
    assert.deepEqual(routes, [{ line: '040', mode: 'bus', code: 'r', stops: ['1', '2', '3'], profiles: [[0, 100, 250]], patterns: [[[H8, 0]], [[H8 + 600, 0]]], days: [1, 0, 0, 0, 0, 0, 1] }]);
    assert.deepEqual([untimed, gone], [[], []]);
});

test('a stop that\'s moved is mended, the rest of the row stays', () => {
    const { routes: [route] } = onLiveRoutes(
        [feed('750', ['1', '8', '3', '4'], [0, 100, 400, 500], H8)],
        liveNetwork(['750', 'r', 'Α - Β', [place('1', 0), place('9', 1), place('3', 2), place('4', 3)]]),
    );
    assert.deepEqual(route.stops, ['1', '9', '3', '4']);
    assert.deepEqual(route.profiles, [[0, 200, 400, 500]], 'halfway between its neighbours, by the road');
});

test('a live route that starts earlier gets a stop before the feed\'s first, at the trip\'s speed', () => {
    const { routes: [route] } = onLiveRoutes(
        [feed('750', ['2', '3', '4'], [0, 300, 600], H8)],
        liveNetwork(['750', 'r', 'Α - Β', ['1', '2', '3', '4'].map((code, i) => place(code, i))]),
    );
    assert.deepEqual(route.profiles, [[0, 300, 600, 900]]);
    assert.deepEqual(route.patterns, [[[H8 - 300, 0]]]);
});

test('a time past the feed\'s last stop goes on at the trip\'s speed, and one shared stop has none', () => {
    assert.deepEqual(retimed([0, 300], [[0, 0], [1, 1]], [0, 1000, 2000]), [0, 300, 600]);
    assert.deepEqual(retimed([500], [[0, 1]], [0, 1000, 2000]), [500, 500, 500]);
});

test('a list of the feed goes on the route of its line it fits best, the plain one if a variant fits as well', () => {
    const stopsOf = (...codes) => codes.map((code, i) => place(code, i));
    const network = liveNetwork(
        ['822', 'market', 'Α - Β [Λαϊκή κάθε Πέμπτη]', stopsOf('1', '2', '3', '4')],
        ['822', 'plain', 'Α - Β', stopsOf('1', '2', '3', '4')],
        ['822', 'short', 'Α - Β [ΕΩΣ Γ]', stopsOf('1', '2')],
        ['822', 'back', 'Β - Α', stopsOf('4', '3', '2', '1')],
    );
    const { routes, untimed } = onLiveRoutes([
        feed('822', ['1', '2', '3', '4'], [0, 100, 200, 300], H8),
        feed('822', ['1', '2'], [0, 100], H8),
    ], network);
    assert.deepEqual(routes.map(route => route.code), ['plain', 'short']);
    assert.deepEqual(untimed.map(route => route.code), ['market', 'back'], 'no times are made up for these');
});

test('a line the live network no longer has is gone, and a route too different isn\'t its stand-in', () => {
    const { routes, gone, untimed } = onLiveRoutes([
        feed('122Θ', ['1', '2'], [0, 100], H8),
        feed('836', ['1', '2', '3', '4', '5'], [0, 100, 200, 300, 400], H8),
    ], liveNetwork(['836', 'r', 'Α - Β', ['1', '7', '8', '9'].map((code, i) => place(code, i))]));
    assert.deepEqual(routes, []);
    assert.deepEqual(gone, ['122Θ', '836']);
    assert.deepEqual(untimed.map(route => route.code), ['r']);
});

// ── With the ride times measured ────────────────────────────────────────────

// One route of 4 stops, 2 minutes apart in the feed, a trip at 08:00 and one
// at 12:00 on weekdays, and the one at 08:00 on weekends
const ROUTE = {
    line: 'Α2', mode: 'bus', code: '100', stops: ['1', '2', '3', '4'], profiles: [[0, 120, 240, 360]],
    patterns: [[[8 * 3600, 0]], [[8 * 3600, 0], [12 * 3600, 0]]], days: [0, 1, 1, 1, 1, 1, 0],
};
const table = (from, to, times) => ({ rides: [{ route: '100', from, to, times }] });

test('a measured stretch takes its median, and the stops after it move with it', () => {
    const { routes: [route], retimed: changed } = withRides([ROUTE], table('2', '4', { 'wd 8': [MIN_RIDES, 600, 900] }));
    assert.deepEqual(route.profiles, [[0, 120, 240, 360], [0, 120, 420, 720]]);
    // Only the weekdays' trip at 08:00: 12:00 has no rides, and weekends aren't weekdays
    assert.deepEqual(route.patterns[route.days[3]], [[8 * 3600, 1], [12 * 3600, 0]]);
    assert.deepEqual(route.patterns[route.days[0]], [[8 * 3600, 0]]);
    assert.equal(route.days[0], route.days[6], 'Saturday and Sunday still share their trips');
    assert.equal(changed, 5, 'the 08:00 of each weekday');
});

test('a bad day takes the slowest tenth instead of the median', () => {
    const { routes: [route] } = withRides([ROUTE], table('2', '4', { 'wd 8': [MIN_RIDES, 600, 900] }), { badDay: true });
    assert.deepEqual(route.profiles[route.patterns[route.days[1]][0][1]], [0, 120, 570, 1020]);
});

test('too few rides, another kind of day, or another route: the feed\'s times stay', () => {
    for (const times of [{ 'wd 8': [MIN_RIDES - 1, 600, 900] }, { 'sa 9': [9, 600, 900] }]) {
        const { routes: [route] } = withRides([ROUTE], table('2', '4', times));
        assert.deepEqual(route.profiles, ROUTE.profiles);
    }
    assert.deepEqual(withRides([ROUTE], { rides: [{ route: '999', from: '2', to: '4', times: { 'wd 8': [9, 600, 900] } }] }).routes, [ROUTE]);
    const { code, ...noCode } = ROUTE;
    assert.deepEqual(withRides([noCode], table('2', '4', { 'wd 8': [9, 600, 900] })).routes, [noCode], `no OASA route, as ${code} would be: no rides`);
});

test('Saturday\'s rides time Saturday only', () => {
    const { routes: [route] } = withRides([ROUTE], table('1', '2', { 'sa 8': [5, 300, 300] }));
    assert.deepEqual(route.profiles[route.patterns[route.days[6]][0][1]], [0, 300, 420, 540]);
    assert.deepEqual(route.profiles[route.patterns[route.days[0]][0][1]], [0, 120, 240, 360]);
});

test('stretches one after the other both count; one overlapping a measured one doesn\'t', () => {
    const rides = {
        rides: [
            { route: '100', from: '1', to: '2', times: { 'wd 8': [5, 300, 300] } },
            { route: '100', from: '1', to: '3', times: { 'wd 8': [5, 900, 900] } },
            { route: '100', from: '2', to: '4', times: { 'wd 8': [5, 600, 600] } },
        ],
    };
    const { routes: [route] } = withRides([ROUTE], rides);
    assert.deepEqual(route.profiles[route.patterns[route.days[1]][0][1]], [0, 300, 600, 900]);
});

// ── buses.json ──────────────────────────────────────────────────────────────

const week = routes => ({ schema: TIMETABLE_SCHEMA, feed: { modified: '2026-08-06', validFrom: '2026-08-03', validTo: '2026-08-24' }, routes });

test('buses.json: the live stops by index, each run to the 10 s, and each trip after the one before', () => {
    const network = liveNetwork(
        ['040', '3922', 'Α - Β', [{ ...place('1', 0), en: 'SYNTAGMA' }, { ...place('2', 1), el: 'ΣΥΝΤΑΓΜΑ', en: 'SYNTAGMA' }, place('3', 2)]],
        ['999', '7', 'Γ - Δ', [place('8', 0), place('9', 1)]],
    );
    const { data, warnings } = buildBuses(week([feed('040', ['1', '2', '3'], [0, 104, 251], H8, H8 + 605), feed('Χ80', ['1', '2'], [0, 60], H8)]), network, { rides: [] });
    assert.deepEqual(data, {
        schema: BUSES_SCHEMA,
        feed: { modified: '2026-08-06', validFrom: '2026-08-03', validTo: '2026-08-24' },
        // Only the stops of a route with times; English only where it isn't the Greek in Latin letters
        stops: [['1', 37.97, 23.7, 'Στάση 1', 'SYNTAGMA'], ['2', 37.98, 23.7, 'ΣΥΝΤΑΓΜΑ', ''], ['3', 37.99, 23.7, 'Στάση 3', '']],
        routes: [{ line: '040', mode: 'bus', code: '3922', stops: [0, 1, 2], runs: [[100, 150]], patterns: [[[H8, 0], [605, 0]]], days: [0, 0, 0, 0, 0, 0, 0] }],
    });
    assert.deepEqual(warnings, ['1 of OASA\'s routes have no times in the feed, so the search leaves them out', 'Lines of the feed OASA no longer runs: Χ80']);
    assert.deepEqual(checkOutput('buses.json', data), []);
});

test('buses.json needs the network and a timetable it knows', () => {
    assert.throws(() => buildBuses(week([]), null, { rides: [] }), /no bus network/);
    assert.throws(() => buildBuses({ ...week([]), schema: 99 }, liveNetwork(), { rides: [] }), /isn't schema/);
});

test('the checks catch a broken buses.json', () => {
    const good = buildBuses(week([feed('040', ['1', '2'], [0, 100], H8)]), liveNetwork(['040', '5', 'Α - Β', [place('1', 0), place('2', 1)]]), { rides: [] }).data;
    const broken = (change, problem) => assert.match(checkOutput('buses.json', change(structuredClone(good))).join(), problem);
    broken(data => { data.routes[0].runs = [[100, 60]]; return data; }, /each run needs a time in whole seconds to each next stop/);
    broken(data => { data.routes[0].days = [0, 0, 0, 0, 0, 0, 1]; return data; }, /needs a pattern for each weekday/);
    broken(data => { data.routes[0].patterns = [[[H8, 3]]]; return data; }, /each trip needs its seconds after the one before and a run/);
    broken(data => { data.stops[0][1] = 0; return data; }, /stop 0 must be/);
    broken(data => { data.routes = []; return data; }, /no stops or no routes/);
    broken(data => { data.feed.validTo = 'soon'; return data; }, /validFrom and validTo/);
    broken(data => { data.routes[0].mode = 'boat'; return data; }, /needs its line, bus or trolley, and its OASA route code/);
    broken(data => { data.routes[0].stops = [0]; return data; }, /needs two stops or more, from the list/);
    broken(data => { data.routes[0].runs = null; data.routes[0].patterns = null; data.routes[0].days = null; return data; },
        /each run needs.*needs a pattern for each weekday/);
    broken(data => { data.stops = [null]; return data; }, /stop 0 must be/);
    broken(data => { data.stops = null; return data; }, /no stops or no routes/);
    broken(() => ({}), /wrong schema number/);
});
