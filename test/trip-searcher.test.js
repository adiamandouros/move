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
// decision (decision 36), and with the rider followed, the search ahead and
// the way switched to (T14, decision 50); and the other ways shown, timed
// the same way (decision 62), to a followed rider the ways on from where
// they are (decision 63). The page's side:
// test/browser/trip.spec.js.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { searcher } = await browserModule('tools/trip/client/searcher.js');
const { aheadWays, busOptions, cityPlanner, halfHour, hereWays, liveWay, onwardWay, OTHERS, otherWay, routeCodes, searchAhead, shownRows } = await browserModule('tools/trip/client/buses.js');

// A Wednesday in the timetable, 10:00
const NOW = { weekday: 3, seconds: 10 * 3600 };
const menelaou = { lat: 37.95463, lng: 23.71049 };
const syntagma = { lat: rail.stations.syntagma.coords[0], lng: rail.stations.syntagma.coords[1] };
const fix = { lat: rail.stations['syggrou-fix'].coords[0], lng: rail.stations['syggrou-fix'].coords[1] };
const trip = (id, more = {}) => ({ id, from: menelaou, to: syntagma, now: NOW, half: false, ...more });

// A searcher whose half hours wait between departures until `step` lets them on
// (`suburban`: false when the railway is hidden on the Subway page)
function started({ loadBuses = async () => buses, loadTrains = undefined, suburban = undefined } = {}) {
    const posted = [];
    const waiting = [];
    const handle = searcher({ loadBuses, loadTrains, post: message => posted.push(message), pause: () => new Promise(resolve => waiting.push(resolve)) });
    handle({ rail, ...(suburban !== undefined && { suburban }) });
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
    assert.deepEqual(posted, [{ id: 1, live: { seq: 2, way: liveWay(planner, menelaou, syntagma, shownRows(step.value)[1], 0, NOW, {}), others: null } }]);
    assert.ok(posted[0].live.way.asks.length > 0);
    // A row there isn't, or a way that can't be made: nothing to time
    posted.length = 0;
    await handle(liveAsk(1, 3, { row: 9 }));
    await handle(liveAsk(1, 4, { row: 1, now: { ...NOW, seconds: 27 * 3600 } }));
    assert.deepEqual(posted, [{ id: 1, live: { seq: 3, way: null, others: null } }, { id: 1, live: { seq: 4, way: null, others: null } }]);
});

test('the other ways shown are timed with live times as the page asks, each for its departure; only the latest half hour\'s, and a row there isn\'t is none', async () => {
    const { handle, posted, runOut } = started();
    const othersAsk = (id, seq, ways) => ({ id, others: { seq, ways, now: NOW, stops: {} } });
    await handle(othersAsk(1, 1, [{ row: 1, departure: 0 }]));
    assert.deepEqual(posted, [], 'nothing before a half hour has come');
    const done = handle(trip(1, { half: true }));
    await new Promise(resolve => setImmediate(resolve));
    await runOut();
    await done;
    posted.length = 0;
    await handle(othersAsk(1, 2, [{ row: 1, departure: 0 }, { row: 2, departure: 1 }, { row: 9, departure: 0 }]));
    const planner = cityPlanner(rail, buses, 3);
    const steps = halfHour(planner, menelaou, syntagma, NOW);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const rows = shownRows(step.value);
    assert.deepEqual(posted, [{ id: 1, others: { seq: 2, ways: [
        { row: 1, departure: 0, ...otherWay(planner, menelaou, syntagma, rows[1], 0, NOW, {}) },
        { row: 2, departure: 1, ...otherWay(planner, menelaou, syntagma, rows[2], 1, NOW, {}) },
        null,
    ] } }]);
    assert.equal(posted[0].others.ways[0].asks.length, 1, 'one stop each');
    posted.length = 0;
    await handle(othersAsk(0, 3, [{ row: 1, departure: 0 }]));
    assert.deepEqual(posted, [], 'an older half hour\'s');
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
        { id: 1, live: { seq: 1, way: liveWay(planner, from, to, rows[0], departure, noon, {}, { decision }), others: null } },
        { id: 1, live: { seq: 2, way: liveWay(planner, from, to, rows[0], departure, noon, {}, { decision, taken: true }), others: null } },
        { id: 1, live: { seq: 3, way: liveWay(planner, from, to, rows[1], departure, noon, {}), others: null } },
    ]);
    assert.equal(posted[0].live.way.asks[0].stop, planner.stops[decision.stop].id.replace('bus:', ''), 'the quicker way\'s stop asked');
    assert.notDeepEqual(posted[1].live.way.option.rides, posted[0].live.way.option.rides, 'the quicker way, taken');
});

test('followed on the T6: asked to, it searches ahead, keeps the way found for the next timings, leaves out one declined; switched to, that way is timed; the other ways shown are those found ahead, but the switch\'s, one declined among them', async () => {
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
    const [directions] = shownRows(step.value);
    const departure = directions.best.findIndex(Boolean);
    const onTram = { leg: 0, kind: 'ride', stop: 1, at: directions.best[departure].legs[0].boards + 120, walk: 0 };
    const ahead = searchAhead(planner, from, to, directions, departure, noon, {}, { decision, step: onTram });
    assert.ok(ahead);
    const found = aheadWays(planner, from, to, directions, departure, noon, {}, { decision, step: onTram });
    assert.equal(found[0].key, ahead.key, 'the switch\'s is the first found');
    assert.equal(found.length, 2, found.map(each => each.key).join(' / '));
    // OASA has the switch's bus coming when the timetable says, so it's offered
    const [, onward] = ahead.way.legs;
    const [route] = routeCodes(planner, [onward.line], onward.board, new Set([onward.alight])).keys();
    const stops = { [planner.stops[onward.board].id.slice('bus:'.length)]: { buses: [{ route, line: onward.line, at: onward.boards }], asked: onTram.at } };
    const shownOf = ways => ways.slice(0, OTHERS).map(each => onwardWay(planner, from, to, each, noon, stops, { step: onTram }));
    posted.length = 0;
    await handle(liveAsk(1, 1, { departure, now: noon, stops, step: onTram, ahead: true }));
    await handle(liveAsk(1, 2, { departure, now: noon, stops, step: onTram }));
    await handle(liveAsk(1, 3, { departure, now: noon, stops, step: onTram, declined: [ahead.key] }));
    const timed = liveWay(planner, from, to, directions, departure, noon, stops, { decision, step: onTram, ahead });
    assert.equal(timed.switchTo?.key, ahead.key, 'the switch offered');
    assert.deepEqual(posted, [
        { id: 1, live: { seq: 1, way: timed, others: shownOf(found.slice(1)) } },
        { id: 1, live: { seq: 2, way: timed, others: shownOf(found.slice(1)) } },
        // Declined, it's no longer the switch's, and is shown again (the rider may change their mind)
        { id: 1, live: { seq: 3, way: liveWay(planner, from, to, directions, departure, noon, stops, { decision, step: onTram }), others: shownOf(found) } },
    ]);
    assert.ok(timed.asks.some(ask => ask.ride && ask.stop === planner.stops[ahead.way.legs[1].board].id.slice('bus:'.length)), 'its bus\'s stop asked for the ride');

    // Switched: the way found is timed, whatever row and departure the page still says
    posted.length = 0;
    await handle(liveAsk(1, 4, { departure, now: noon, step: onTram, switched: ahead.key }));
    await handle(liveAsk(1, 5, { row: 1, departure: 0, now: noon, step: onTram, switched: ahead.key }));
    const onto = liveWay(planner, from, to, { key: ahead.key, best: [ahead.way], bundle: false, lines: [], stops: [] }, 0, noon, {}, { step: onTram });
    assert.deepEqual(posted, [{ id: 1, live: { seq: 4, way: onto, others: null } }, { id: 1, live: { seq: 5, way: onto, others: null } }], 'not searched from the way switched to yet');
    // A key it never found: the row's way, as the page asked
    posted.length = 0;
    await handle(liveAsk(1, 6, { departure, now: noon, step: onTram, switched: 'not found' }));
    assert.deepEqual(posted[0].live.way.option, timed.option);
    // The page on to the half hour's next departure as the clock goes on: the
    // same way followed, so its other ways are still timed, not dropped
    posted.length = 0;
    const next = directions.best.findIndex((way, d) => d > departure && way);
    await handle(liveAsk(1, 7, { departure: next, now: noon, stops, step: onTram }));
    assert.equal(posted[0].live.way.switchTo, null, 'the switch is for the departure it was searched from');
    assert.deepEqual(posted[0].live.others, shownOf(found), 'so its way is one of them');
});

test('followed on foot: asked to, the other ways shown are those from where the rider is, leaving now, but the way shown; none past the last ride', async () => {
    const { handle, posted, runOut } = started();
    const done = handle(trip(1, { half: true }));
    await new Promise(resolve => setImmediate(resolve));
    await runOut();
    await done;
    const planner = cityPlanner(rail, buses, 3);
    const steps = halfHour(planner, menelaou, syntagma, NOW);
    let step = steps.next();
    while (!step.done) step = steps.next();
    // The 040 then the M2, walking to its stop, a few streets on
    const rows = shownRows(step.value);
    const row = rows.findIndex(each => each.key.startsWith('040'));
    const here = { lat: 37.9562, lng: 23.7125 };
    const walking = { leg: 0, kind: 'walk', stop: 0, at: NOW.seconds + 60, walk: 120 };
    posted.length = 0;
    await handle(liveAsk(1, 1, { row, step: walking, ahead: true, here }));
    const found = hereWays(planner, here, syntagma, rows[row], 0, NOW);
    assert.ok(found.length > 0 && found.every(each => each.leg === -1 && each.key !== rows[row].key), found.map(each => each.key).join(' / '));
    assert.deepEqual(posted[0].live.others, found.slice(0, OTHERS).map(each => onwardWay(planner, here, syntagma, each, NOW, {}, { step: walking })));
    assert.ok(posted[0].live.others.every(other => other.option.rides.length > 0));
    // On the last walk: none to show
    posted.length = 0;
    await handle(liveAsk(1, 2, { row, step: { ...walking, leg: 2, kind: 'last' }, ahead: true, here }));
    assert.deepEqual(posted[0].live.others, []);
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

// The suburban railway (decision 41): on Wednesday 21 October, from Athens station to the airport
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
    assert.deepEqual(byTrain(answer.options).map(o => o.rides.map(ride => [ride.line, ride.board.id, ride.alight.id, ride.boards])), [[['A1', 'train:athens', 'train:airport', 10 * 3600 + 300]]]);

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

test('with the suburban railway hidden on the Subway page, trains.json isn\'t loaded and the city has no trains (decision 41)', async () => {
    let asked = 0;
    const hidden = started({ loadTrains: async () => { asked++; return trains; }, suburban: false });
    await hidden.handle({ id: 1, from: athensStation, to: airportStation, now: { ...NOW, date: DATE }, half: false });
    assert.equal(asked, 0);
    assert.equal(hidden.posted[0].trains, false);
    assert.deepEqual(byTrain(hidden.posted[0].options), []);
    // Shown, it's loaded
    const shown = started({ loadTrains: async () => { asked++; return trains; }, suburban: true });
    await shown.handle({ id: 1, from: athensStation, to: airportStation, now: { ...NOW, date: DATE }, half: false });
    assert.equal(asked, 1);
    assert.equal(shown.posted[0].trains, true);
});
