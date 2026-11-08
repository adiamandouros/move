import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, athensSeconds, buildTrains } from '../server/data/build-suburban.js';
import { checkOutput } from '../server/data/check-output.js';
import { board, suburbanCurated, train } from './fixtures/railway.js';

// trains.json from railway.gov.gr's boards (server/data/build-suburban.js,
// decision 40): each date's trains by their stops, in seconds from that
// date's midnight in Athens

const H = 3600;

test('a time in seconds from the midnight in Athens that starts the date, summer or winter, past 24:00 after midnight', () => {
    // Athens is 3 hours ahead of UTC in summer, 2 in winter
    assert.equal(athensSeconds('2026-08-05T05:00:00.000Z', '2026-08-05'), 8 * H);
    assert.equal(athensSeconds('2026-11-08T09:28:00.000Z', '2026-11-08'), 11 * H + 28 * 60);
    // A train leaving at midnight is on its date's board from the evening before in UTC
    assert.equal(athensSeconds('2026-11-06T22:00:00.000Z', '2026-11-07'), 0);
    assert.equal(athensSeconds('2026-11-08T22:30:00.000Z', '2026-11-08'), 24 * H + 30 * 60);
    // The night the clocks go back (25 October 2026): 03:30 summer time, then 03:30 winter time an hour later
    assert.equal(athensSeconds('2026-10-25T00:30:00.000Z', '2026-10-25'), 3 * H + 30 * 60);
    assert.equal(athensSeconds('2026-10-25T01:30:00.000Z', '2026-10-25'), 3 * H + 30 * 60);
});

test('each date\'s suburban trains by their stops: one route each way, its profiles and trips in order, times in Athens', () => {
    const { data, warnings } = buildTrains({ '2026-11-08': board('2026-11-08') }, suburbanCurated());
    assert.deepEqual(warnings, []);
    assert.equal(data.schema, SCHEMA);
    assert.deepEqual(data.stations, {
        piraeus: [37.94913, 23.64372, 'Πειραιάς', 'Piraeus'],
        athens: [37.99284, 23.72015, 'Αθήνα', 'Athens'],
        airport: [37.93698, 23.94481, 'Αεροδρόμιο', 'Airport'],
        liosia: [38.07077, 23.70985, 'Άνω Λιόσια', 'Ano Liosia'],
        ska2: [38.06565, 23.73777, 'ΣΚΑ-Αχαρναί', 'SKA-Acharnai'],
        ska3: [38.06813, 23.73774, 'ΣΚΑ', 'SKA'],
    });
    // suburban.json's walks as the search names its stops, in seconds, with their notes; the stations outside OASA's ticket
    assert.deepEqual(data.walks, [['train:athens', 'rail:b', 240, { el: 'Απέναντι', en: 'Across the road' }], ['train:ska2', 'train:ska3', 360]]);
    assert.deepEqual(data.outside, ['airport']);
    // The freight train is left out; the two to the airport run the same way
    assert.deepEqual(data.dates['2026-11-08'], [
        { line: 'A1', stops: ['piraeus', 'athens', 'airport'], profiles: [[0, 15 * 60, 65 * 60]], trips: [[8 * H, 0], [9 * H, 0]] },
        { line: 'A1', stops: ['airport', 'athens', 'piraeus'], profiles: [[0, 50 * 60, 65 * 60]], trips: [[8.5 * H, 0]] },
    ]);
    assert.deepEqual(checkOutput('trains.json', data), []);
});

test('a train that runs differently on the same stops has a profile of its own; a train past midnight runs past 24:00', () => {
    const date = '2026-11-08';
    const { data } = buildTrains({ [date]: { schedules: [
        train(date, '1', [['o1', '23:30'], ['o2', '23:45'], ['o3', '24:35']]),
        train(date, '2', [['o1', '06:00'], ['o2', '06:20'], ['o3', '07:10']]),
        train(date, '3', [['o1', '07:00'], ['o3', '07:50']]),
    ] } }, suburbanCurated());
    assert.deepEqual(data.dates[date], [
        { line: 'A1', stops: ['piraeus', 'athens', 'airport'], profiles: [[0, 15 * 60, 65 * 60], [0, 20 * 60, 70 * 60]], trips: [[6 * H, 1], [23.5 * H, 0]] },
        // Not stopping at Athens: other stops, another route
        { line: 'A1', stops: ['piraeus', 'airport'], profiles: [[0, 50 * 60]], trips: [[7 * H, 0]] },
    ]);
});

test('every date fetched, in order; a station\'s second OSE id is the same station', () => {
    const second = { schedules: [train('2026-11-09', '7', [['o2', '10:00'], ['o3b', '10:40']])] };
    const { data } = buildTrains({ '2026-11-09': second, '2026-11-08': board('2026-11-08') }, suburbanCurated());
    assert.deepEqual(Object.keys(data.dates), ['2026-11-08', '2026-11-09']);
    assert.deepEqual(data.dates['2026-11-09'], [{ line: 'A1', stops: ['athens', 'airport'], profiles: [[0, 40 * 60]], trips: [[10 * H, 0]] }]);
});

test('a train\'s line from its corridor and stops: A2 for the Piraeus–Airport trains at Ano Liosia; SKA is A2\'s station or A3\'s, by the train\'s line', () => {
    const date = '2026-11-08';
    const { data, warnings } = buildTrains({ [date]: { schedules: [
        train(date, '4200', [['o4', '08:00'], ['o5', '08:03'], ['o3', '08:40']]),
        train(date, '1560', [['o2', '08:00'], ['o5', '08:10'], ['o4', '08:20']], { corridor: 'CHALKIDA' }),
        train(date, '1200', [['o1', '08:00'], ['o3', '09:00']]),
        // An A1 train at SKA: neither station is A1's
        train(date, '1204', [['o1', '10:00'], ['o5', '10:20'], ['o3', '11:00']]),
    ] } }, suburbanCurated());
    assert.deepEqual(data.dates[date].map(route => [route.line, route.stops]), [
        ['A2', ['liosia', 'ska2', 'airport']],
        // Ano Liosia doesn't make a train of another corridor A2's
        ['A3', ['athens', 'ska3', 'liosia']],
        ['A1', ['piraeus', 'airport']],
    ]);
    assert.deepEqual(warnings, ['A1 trains calling at "Σταθμός o5" (OSE o5) left out: data/curated/suburban.json has no station with that id for A1']);
});

test('left out: cancelled trains, other kinds and other lines; with a warning, trains at a station suburban.json doesn\'t have and times that go back', () => {
    const date = '2026-11-08';
    const { data, warnings } = buildTrains({ [date]: { schedules: [
        train(date, '1', [['o1', '08:00'], ['o3', '09:00']], { status: 'cancelled' }),
        train(date, '2', [['o1', '08:00'], ['o3', '09:00']], { serviceType: 'InterCity' }),
        train(date, '3', [['o1', '08:00'], ['o3', '09:00']], { corridor: 'THESLAR' }),
        train(date, '4', [['o1', '08:00'], ['x9', '08:30'], ['o3', '09:00']]),
        train(date, '5', [['o1', '08:00'], ['x9', '08:30']]),
        train(date, '6', [['o1', '08:00'], ['o3', '07:00']]),
        // Running late doesn't change its timetable
        train(date, '7', [['o1', '10:00'], ['o3', '11:00']], { status: 'completed', delay: 9 }),
    ] } }, suburbanCurated());
    assert.deepEqual(data.dates[date], [{ line: 'A1', stops: ['piraeus', 'airport'], profiles: [[0, H]], trips: [[10 * H, 0]] }]);
    assert.deepEqual(warnings, [
        'Train 6 on 2026-11-08 left out: its times don\'t go forward',
        'A1 trains calling at "Σταθμός x9" (OSE x9) left out: data/curated/suburban.json has no station with that id for A1',
    ]);
});

test('trains.json\'s checks catch a broken file', () => {
    const good = buildTrains({ '2026-11-08': board('2026-11-08') }, suburbanCurated()).data;
    const broken = structuredClone(good);
    broken.stations.athens = [0, 0, 'Αθήνα', ''];
    broken.dates['2026-11-08'][0].stops.push('nowhere');
    broken.dates['2026-11-08'][1].profiles = [[0, 600, 300]];
    broken.dates['2026-11-08'][1].trips = [[100, 3]];
    broken.dates.tomorrow = [];
    broken.walks.push(['train:nowhere', 'rail:b', 60], ['train:athens', 'rail:b', 0], ['train:athens', 'train:ska2', 60, { el: 'Μόνο ελληνικά' }]);
    broken.outside.push('nowhere');
    assert.deepEqual(checkOutput('trains.json', broken), [
        'trains.json: station athens must be [lat, lng, Greek name, English name]',
        'trains.json: walk ["train:nowhere","rail:b",60] must be [a station, a station or the metro\'s, seconds, a note in both languages or none]',
        'trains.json: walk ["train:athens","rail:b",0] must be [a station, a station or the metro\'s, seconds, a note in both languages or none]',
        'trains.json: walk ["train:athens","train:ska2",60,{"el":"Μόνο ελληνικά"}] must be [a station, a station or the metro\'s, seconds, a note in both languages or none]',
        'trains.json: outside must list stations',
        'trains.json: 2026-11-08 line A1: needs its line and two of the stations or more',
        'trains.json: 2026-11-08 line A1: each profile needs the seconds from its first stop to each, going forward',
        'trains.json: 2026-11-08 line A1: each trip needs its start in seconds and a profile',
        'trains.json: tomorrow must be YYYY-MM-DD with a list of routes',
    ]);
    assert.deepEqual(checkOutput('trains.json', { schema: 1, stations: {}, walks: [], outside: [], dates: {} }), ['trains.json: no stations']);
    assert.deepEqual(checkOutput('trains.json', {}), ['trains.json: wrong schema number']);
});
