import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBus } from '../server/data/build-bus.js';
import { checkOutput } from '../server/data/check-output.js';
import { busFeed, stopTable } from './fixtures/gtfs.js';

// bus-stops.json from OASA's bus feed (server/data/build-bus.js)

test('one row per served stop, with its lines and English name', async () => {
    const { data, warnings } = await buildBus({ dir: busFeed(), stopTablePath: stopTable(), today: '20260805' });
    assert.equal(data.stops.length, 1000);
    assert.deepEqual(data.fields, ['code', 'lat', 'lng', 'el', 'en', 'lines']);
    // Spaces collapsed, both lines, sorted the Greek way, English from the stop table
    assert.deepEqual(data.stops[0], ['10000', 37.9, 23.7, 'ΣΤΑΣΗ 0', 'STOP 0', ['040', 'Χ95']]);
    assert.deepEqual(data.stops[50], ['10050', 37.905, 23.7, 'ΣΤΑΣΗ 50', '', ['040']]);
    assert.deepEqual(data.feed, { validFrom: '2026-08-03', validTo: '2026-08-09' });
    assert.ok(warnings.includes('1 bus stops have no trips and were left out'));
    assert.deepEqual(checkOutput('bus-stops.json', data), []);
});

test('stops with codes the live times can\'t use are left out, with a warning', async () => {
    const { data, warnings } = await buildBus({ dir: busFeed({ extraStops: ['-2,ΓΡΑΜΜΑΤΙΚΟ,38.20277,23.96592'] }), stopTablePath: stopTable(), today: '20260805' });
    assert.ok(!data.stops.some(s => s[0] === '-2'));
    assert.ok(warnings.some(w => /1 bus stops have codes the live times can't use and were left out: -2/.test(w)));
    assert.deepEqual(checkOutput('bus-stops.json', data), []);
});

test('without the stop table, English names are empty and it says so', async () => {
    const { data, warnings } = await buildBus({ dir: busFeed(), today: '20260805' });
    assert.equal(data.stops[0][4], '');
    assert.ok(warnings.includes('No OASA stop table; English stop names will be empty'));
});

test('an expired feed still builds, with a warning', async () => {
    const { warnings } = await buildBus({ dir: busFeed(), today: '20261003' });
    assert.ok(warnings.includes('Bus feed expired on 2026-08-09'));
});

test('a feed with too few served stops fails', async () => {
    await assert.rejects(buildBus({ dir: busFeed({ stops: 999 }), today: '20260805' }), /only 999 served stops \(expected at least 1000\)/);
});
