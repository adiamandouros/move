import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// The Trip page's searches with a bus, as its worker runs them
// (tools/trip/client/searcher.js, decision 32): leaving now first, then the
// half hour, and only for the latest trip. The page's side: test/browser/trip.spec.js.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { searcher } = await browserModule('tools/trip/client/searcher.js');
const { busOptions, cityPlanner } = await browserModule('tools/trip/client/buses.js');

// A Wednesday in the timetable, 10:00
const NOW = { weekday: 3, seconds: 10 * 3600 };
const menelaou = { lat: 37.95463, lng: 23.71049 };
const syntagma = { lat: rail.stations.syntagma.coords[0], lng: rail.stations.syntagma.coords[1] };
const fix = { lat: rail.stations['syggrou-fix'].coords[0], lng: rail.stations['syggrou-fix'].coords[1] };
const trip = (id, more = {}) => ({ id, from: menelaou, to: syntagma, now: NOW, half: false, ...more });

// A searcher whose half hours wait between departures until `step` lets them on
function started({ loadBuses = async () => buses } = {}) {
    const posted = [];
    const waiting = [];
    const handle = searcher({ loadBuses, post: message => posted.push(message), pause: () => new Promise(resolve => waiting.push(resolve)) });
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
