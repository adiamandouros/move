import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';
import { buildTrains } from '../server/data/build-suburban.js';
import { suburbanCurated, train } from './fixtures/railway.js';

// The Trip page's searches with a bus, as its worker runs them
// (tools/trip/client/searcher.js, decision 32): leaving now first, then the
// half hour, and only for the latest trip; and the half hour's way shown in
// full timed again with live times (decision 35), with the quicker way on a
// decision (decision 36). The page's side: test/browser/trip.spec.js.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { searcher } = await browserModule('tools/trip/client/searcher.js');
const { busOptions, cityPlanner, halfHour, liveWay, shownRows } = await browserModule('tools/trip/client/buses.js');

// A Wednesday in the timetable, 10:00
const NOW = { weekday: 3, seconds: 10 * 3600 };
const menelaou = { lat: 37.95463, lng: 23.71049 };
const syntagma = { lat: rail.stations.syntagma.coords[0], lng: rail.stations.syntagma.coords[1] };
const fix = { lat: rail.stations['syggrou-fix'].coords[0], lng: rail.stations['syggrou-fix'].coords[1] };
const trip = (id, more = {}) => ({ id, from: menelaou, to: syntagma, now: NOW, half: false, ...more });

// A searcher whose half hours wait between departures until `step` lets them on
function started({ loadBuses = async () => buses, loadTrains = undefined } = {}) {
    const posted = [];
    const waiting = [];
    const handle = searcher({ loadBuses, loadTrains, post: message => posted.push(message), pause: () => new Promise(resolve => waiting.push(resolve)) });
    handle({ rail });
    // Lets the half hours that are waiting go on, until none is
    const runOut = async () => {
        while (waiting.length) {
            waiting.shift()();
            await new Promise(resolve => setImmediate(resolve));
        }
    };
    return { handle, posted, runOut };
}

test('a trip is answered for leaving now, with how long it took, then its half hour', async () => {
    const { handle, posted, runOut } = started();
    const done = handle(trip(1, { half: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(posted.length, 1, 'leaving now, before the half hour');
    const [now] = posted;
    assert.deepEqual(now.options, busOptions(cityPlanner(rail, buses, 3), menelaou, syntagma, NOW));
    assert.ok(Number.isInteger(now.timing.city) && Number.isInteger(now.timing.answer));
    await runOut();
    await done;
    assert.equal(posted.length, 2);
    assert.equal(posted[1].id, 1);
    assert.equal(posted[1].half.kind, 'depends', 'by the 040, or by M2 from Syggrou-Fix');
    assert.ok(Number.isInteger(posted[1].half.ms));
    // As the page shows it (halfView): the ways, each for every departure tried
    assert.equal(posted[1].half.departures.length, 16);
    assert.ok(posted[1].half.rows.length > 0 && posted[1].half.rows.every(row => row.options.length === 16));
    assert.deepEqual(JSON.parse(JSON.stringify(posted[1].half)).rows, posted[1].half.rows, 'plain data, as a worker can send');
});

test('the city is made once a day: the next trip says so with no time for it', async () => {
    const { handle, posted } = started();
    await handle(trip(1));
    await handle(trip(2, { to: fix }));
    await handle(trip(3, { now: { weekday: 4, seconds: NOW.seconds } }));
    assert.deepEqual(posted.map(({ timing }) => typeof timing.city), ['number', 'object', 'number']);
    assert.equal(posted[1].timing.city, null);
});

test('only the latest trip is answered: one asked before the buses had loaded gets nothing', async () => {
    const { handle, posted } = started();
    await Promise.all([handle(trip(1)), handle(trip(2, { to: fix }))]);
    assert.deepEqual(posted.map(({ id }) => id), [2]);
});

test('the same trip asked again leaves its half hour going; another trip\'s stops it', async () => {
    const { handle, posted, runOut } = started();
    const first = handle(trip(1, { half: true }));
    await new Promise(resolve => setImmediate(resolve));
    // A minute on, the page asks again, for leaving now only
    await handle(trip(2, { now: { ...NOW, seconds: NOW.seconds + 60 } }));
    await runOut();
    await first;
    assert.deepEqual(posted.map(message => [message.id, 'half' in message ? 'half' : 'now']), [[1, 'now'], [2, 'now'], [1, 'half']]);

    posted.length = 0;
    const third = handle(trip(3, { half: true }));
    await new Promise(resolve => setImmediate(resolve));
    const fourth = handle(trip(4, { to: fix, now: { ...NOW, seconds: 12 * 3600 }, half: true }));
    await runOut();
    await Promise.all([third, fourth]);
    assert.deepEqual(posted.map(message => [message.id, 'half' in message ? 'half' : 'now']), [[3, 'now'], [4, 'now'], [4, 'half']]);
    assert.equal(posted.at(-1).half.kind, 'clear', 'to Syggrou-Fix at noon: any of the buses from the start');
});

test('buses that can\'t be loaded: the latest trip is told, and nothing is searched', async () => {
    const { handle, posted } = started({ loadBuses: () => Promise.reject(new Error('HTTP 503')) });
    await Promise.all([handle(trip(1, { half: true })), handle(trip(2))]);
    assert.deepEqual(posted, [{ id: 2, error: true }]);
});

test('a search that fails says so, rather than leave the page waiting', async () => {
    const { handle, posted } = started();
    await handle(trip(1, { from: null }));
    assert.deepEqual(posted, [{ id: 1, error: true }]);
});

// The half hour's way shown in full, row `row` for departure 0, timed with `stops` at `now`
const liveAsk = (id, seq, more = {}) => ({ id, live: { seq, row: 0, departure: 0, now: NOW, stops: {}, ...more } });

test('the latest half hour\'s way shown in full is timed again with live times, as the page asks', async () => {
    const { handle, posted, runOut } = started();
    // Nothing to time before a half hour has come
    await handle(liveAsk(1, 1));
    assert.deepEqual(posted, []);
    const done = handle(trip(1, { half: true }));
    await new Promise(resolve => setImmediate(resolve));
    await runOut();
    await done;
    posted.length = 0;
    await handle(liveAsk(1, 2, { row: 1 }));
    const planner = cityPlanner(rail, buses, 3);
    const steps = halfHour(planner, menelaou, syntagma, NOW);
    let step = steps.next();
    while (!step.done) step = steps.next();
    assert.deepEqual(posted, [{ id: 1, live: { seq: 2, way: liveWay(planner, menelaou, syntagma, shownRows(step.value)[1], 0, NOW, {}) } }]);
    assert.ok(posted[0].live.way.asks.length > 0);
    // A row there isn't, or a way that can't be made: nothing to time
    posted.length = 0;
    await handle(liveAsk(1, 3, { row: 9 }));
    await handle(liveAsk(1, 4, { row: 1, now: { ...NOW, seconds: 27 * 3600 } }));
    assert.deepEqual(posted, [{ id: 1, live: { seq: 3, way: null } }, { id: 1, live: { seq: 4, way: null } }]);
});

test('on a decision, the directions are timed with the quicker way, and once it\'s taken, the quicker way is timed instead', async () => {
    // From Σταύρου 1 to Μενελάου 45 at noon: the T6 and a bus, or off sooner for one (decision 36)
    const from = { lat: 37.9535, lng: 23.7255 };
    const to = { lat: 37.955, lng: 23.707 };
    const noon = { weekday: 3, seconds: 12 * 3600 };
    const { handle, posted, runOut } = started();
    const done = handle(trip(1, { from, to, now: noon, half: true }));
    await new Promise(resolve => setImmediate(resolve));
    await runOut();
    await done;
    const planner = cityPlanner(rail, buses, 3);
    const steps = halfHour(planner, from, to, noon);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const { decision } = step.value;
    assert.ok(decision, step.value.kind);
    const rows = shownRows(step.value);
    const departure = rows[0].best.findIndex(Boolean);
    posted.length = 0;
    await handle(liveAsk(1, 1, { departure, now: noon }));
    await handle(liveAsk(1, 2, { departure, now: noon, taken: true }));
    await handle(liveAsk(1, 3, { row: 1, departure, now: noon, taken: true }));
    assert.deepEqual(posted, [
        { id: 1, live: { seq: 1, way: liveWay(planner, from, to, rows[0], departure, noon, {}, { decision }) } },
        { id: 1, live: { seq: 2, way: liveWay(planner, from, to, rows[0], departure, noon, {}, { decision, taken: true }) } },
        { id: 1, live: { seq: 3, way: liveWay(planner, from, to, rows[1], departure, noon, {}) } },
    ]);
    assert.equal(posted[0].live.way.asks[0].stop, planner.stops[decision.stop].id.replace('bus:', ''), 'the quicker way\'s stop asked');
    assert.notDeepEqual(posted[1].live.way.option.rides, posted[0].live.way.option.rides, 'the quicker way, taken');
});

test('live times are only for the latest half hour, and timing them never stops one being worked out', async () => {
    const { handle, posted, runOut } = started();
    const first = handle(trip(1, { half: true }));
    await new Promise(resolve => setImmediate(resolve));
    await runOut();
    await first;
    // The next trip's half hour, under way
    const second = handle(trip(2, { to: fix, now: { ...NOW, seconds: 12 * 3600 }, half: true }));
    await new Promise(resolve => setImmediate(resolve));
    posted.length = 0;
    await handle(liveAsk(1, 1));
    await handle(liveAsk(2, 2));
    assert.deepEqual(posted.map(message => [message.id, message.live.seq]), [[1, 1]], 'trip 1\'s, as trip 2\'s hasn\'t come');
    await runOut();
    await second;
    assert.deepEqual(posted.slice(1).map(message => [message.id, 'half' in message]), [[2, true]], 'trip 2\'s half hour came all the same');
    posted.length = 0;
    await handle(liveAsk(1, 3));
    await handle(liveAsk(2, 4));
    assert.deepEqual(posted.map(message => [message.id, message.live.seq]), [[2, 4]], 'now only trip 2\'s');
});

// The suburban railway (decision 40): on Wednesday 21 October, from Athens station to the airport
const DATE = '2026-10-21';
const trains = buildTrains({ [DATE]: { schedules: [train(DATE, '1210', [['o2', '10:05'], ['o3', '10:45']])] } }, suburbanCurated()).data;
const athensStation = { lat: 37.99284, lng: 23.72015 };
const airportStation = { lat: 37.93698, lng: 23.94481 };
const byTrain = options => options.filter(o => o.rides.some(ride => ride.mode === 'suburban'));

test('the day\'s city has that date\'s trains, and the answer says so; without trains.json, or a day it lacks, none, and it says that', async () => {
    const withTrains = started({ loadTrains: async () => trains });
    await withTrains.handle({ id: 1, from: athensStation, to: airportStation, now: { ...NOW, date: DATE }, half: false });
    const [answer] = withTrains.posted;
    assert.equal(answer.trains, true);
    assert.deepEqual(byTrain(answer.options).map(o => o.rides.map(ride => [ride.line, ride.board.id, ride.alight.id, ride.boards])), [[['P', 'train:athens', 'train:airport', 10 * 3600 + 300]]]);

    // The next day: a city of its own, with no trains, as trains.json has none for it
    await withTrains.handle({ id: 2, from: athensStation, to: airportStation, now: { weekday: 4, seconds: 10 * 3600, date: '2026-10-22' }, half: false });
    assert.equal(withTrains.posted[1].trains, false);
    assert.ok(Number.isInteger(withTrains.posted[1].timing.city), 'made again');
    assert.deepEqual(byTrain(withTrains.posted[1].options), []);

    // trains.json couldn't be loaded: the buses still are
    const failed = started({ loadTrains: async () => { throw new Error('HTTP 404'); } });
    await failed.handle({ id: 1, from: menelaou, to: syntagma, now: { ...NOW, date: DATE }, half: false });
    assert.equal(failed.posted[0].trains, false);
    assert.deepEqual(failed.posted[0].options, busOptions(cityPlanner(rail, buses, 3), menelaou, syntagma, NOW));
});
