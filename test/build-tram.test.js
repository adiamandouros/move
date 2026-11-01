import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRail } from '../server/data/build-rail.js';
import { buildTram } from '../server/data/build-tram.js';
import { tramCurated, tramFeed } from './fixtures/gtfs.js';

// The tram network for its map and the planner (build-tram.js), from a small
// feed with a one-way loop, a shared stop and a few odd runs (fixtures/gtfs.js,
// tramFeed), on the week the metro's build picks from the same feed

const metroStations = { b: { lines: ['M9'] } };
const metroCurated = {
    stations: { stations: { m: { name: { el: 'Μ', en: 'M' }, gtfs: ['M'] } } },
    lines: { M9: { name: 'M9', color: '#000000', directions: { x: { gtfsDirection: '0', toward: { el: 'Μ', en: 'M' } } } } },
    positions: {},
};
const calendarOf = async dir => (await buildRail({ dir, curated: metroCurated, today: '20260803' })).calendar;
const built = async (tram = tramCurated(), dir = tramFeed()) => buildTram({ dir, tram, metroStations, calendar: await calendarOf(dir) });
const at = (hours, minutes) => hours * 3600 + minutes * 60;

test('each direction is its most common run of stops, and may go another way', async () => {
    const { data } = await built();
    const stops = (line, dir) => data.lines[line].directions[dir].stops.map(s => s.station);
    assert.deepEqual(stops('T1', 'out'), ['p', 'a', 'n', 'c', 'e']);
    assert.deepEqual(stops('T1', 'back'), ['e', 'c', 'n', 'b', 'p']);
    assert.deepEqual(stops('T2', 'up'), ['q', 'e']);
    assert.deepEqual(stops('T2', 'down'), ['e', 'q']);
    assert.deepEqual(data.lines.T1.directions.out.toward, { el: 'Ε', en: 'E' });
    assert.equal(data.lines.T1.color, '#b6d433');
    // The metro line in the feed is left alone
    assert.deepEqual(Object.keys(data.lines), ['T1', 'T2']);
});

test('stops: their lines, where they are, and the metro they change to', async () => {
    const { data } = await built();
    assert.deepEqual(data.stations.e.lines, ['T1', 'T2']);
    assert.deepEqual(data.stations.b.lines, ['T1']);
    // The average of its platforms
    assert.deepEqual(data.stations.c.coords, [37.4, 23.3]);
    assert.deepEqual(data.stations.n.metro, { station: 'b', lines: ['M9'] });
    assert.equal(data.stations.q.metro, undefined);
    assert.equal(data.stations.lonely, undefined);
});

test('stops keep what\'s a short walk from them, among the stops rail.json has', async () => {
    const { data, warnings } = await built();
    assert.deepEqual(data.stations.n.walks, [{ metro: 'b', minutes: 3 }, { stop: 'c', minutes: 5 }]);
    assert.equal(data.stations.q.walks, undefined);
    assert.equal(data.stations.p.walks, undefined);
    assert.ok(warnings.includes('tram.json: q has a walk to a stop that isn\'t in rail.json'));
});

test('each direction has a timetable, on the same days as the metro', async () => {
    const { data } = await built();
    const { timetable } = data.lines.T1.directions.out;
    const trains = timetable.patterns[timetable.days[3]].map(([start, profile]) => [start, timetable.profiles[profile]]);
    assert.deepEqual(trains, [
        [at(8, 0), { stops: [0, 1, 2, 3, 4], offsets: [0, 60, 120, 180, 240] }],
        [at(8, 10), { stops: [0, 1, 2, 3, 4], offsets: [0, 60, 120, 180, 240] }],
    ]);
    // The feed runs them every day, so one pattern does for the week
    assert.deepEqual(new Set(timetable.days).size, 1);
});

test('the calendar decides the days: a tram on no kept day isn\'t in the timetable', async () => {
    const calendar = { daysOf: () => [1, 2], serviceDays: [{ key: 1, before: 0 }, { key: 2, before: 1 }], ownDates: [] };
    const { data } = await buildTram({ dir: tramFeed(), tram: tramCurated(), metroStations, calendar });
    const { days, patterns } = data.lines.T1.directions.out.timetable;
    assert.equal(patterns[days[1]].length, 2);
    assert.equal(patterns[days[0]].length, 0);
});

test('a tram that turns back early goes in the timetable as far as it follows the stops', async () => {
    const { data } = await built();
    const { timetable } = data.lines.T1.directions.back;
    const called = timetable.patterns[timetable.days[3]].map(([start, profile]) => [start, timetable.profiles[profile].stops]);
    assert.deepEqual(called, [
        [at(8, 0), [0, 1, 2, 3, 4]],
        [at(8, 10), [0, 1, 2, 3, 4]],
        [at(8, 20), [0, 1]],
        // Ends at A, which this direction doesn't call at: it counts as ending at N
        [at(8, 30), [0, 1, 2]],
    ]);
});

test('a tram listed twice is kept once, as a metro train is', async () => {
    const { warnings } = await built();
    assert.ok(warnings.some(w => w.startsWith('T1/out: the feed lists some trains twice')), warnings.join('\n'));
});

test('warnings: unknown stops, runs to stops a line isn\'t drawn through or a direction doesn\'t call at, stops no tram serves, unknown metro stations', async () => {
    const { warnings } = await built();
    assert.deepEqual(warnings.filter(w => !w.includes('lists some trains twice')).sort(), [
        'T1/back: trams call at stops off this direction, left out of its timetable: a',
        'T2/down: 1 trips call at stops the map doesn\'t show for the line: c',
        'T2/down: trams call at stops off this direction, left out of its timetable: c',
        'tram.json: lonely is not served by any tram',
        'tram.json: q changes to nowhere, which isn\'t a metro station in rail.json',
        'tram.json: q has a walk to a stop that isn\'t in rail.json',
        'tram.json: tram stops not on the map (add them to a stop\'s "gtfs" list): X9',
    ]);
});

test('a line with no trips in the feed is left out, with a warning', async () => {
    const tram = tramCurated();
    tram.lines.T3 = { name: 'T3', color: '#b6d433', directions: { x: { gtfsDirection: '0', toward: { el: 'Χ', en: 'X' } } } };
    const { data, warnings } = await built(tram);
    assert.equal(data.lines.T3, undefined);
    assert.ok(warnings.includes('T3/x: no tram trips in the rail feed'));
});

test('a direction with no trams on the kept days says so', async () => {
    const { warnings } = await buildTram({
        dir: tramFeed(), tram: tramCurated(), metroStations,
        calendar: { daysOf: () => [], serviceDays: [], ownDates: [] },
    });
    assert.ok(warnings.includes('T1/out: no tram trips in the chosen week'), warnings.join('\n'));
});
