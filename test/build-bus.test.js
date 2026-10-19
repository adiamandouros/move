import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBus, buildBusLines, readBusFeed, towardName } from '../server/data/build-bus.js';
import { checkOutput } from '../server/data/check-output.js';
import { busFeed, busLinesFeed, stopTable } from './fixtures/gtfs.js';

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

// bus-lines.json from the same feed (buildBusLines)

test('each line\'s stops in order: the busiest sequence and the busiest one back', async () => {
    const { data, warnings } = await buildBusLines({ dir: busLinesFeed(), today: '20260805' });
    assert.deepEqual(data.lines, [
        { line: '040', name: 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ', directions: [
            { to: 'ΠΕΙΡΑΙΑΣ', stops: ['1', '2', '3', '4'] },
            { to: 'ΣΥΝΤΑΓΜΑ', stops: ['4', '3', '2', '1'] },
        ] },
        // Circular: one direction; the stop the live times can't use is left out
        { line: 'Κ1', name: 'ΚΥΚΛΟΣ (ΚΥΚΛΙΚΗ)', directions: [{ to: 'ΚΥΚΛΟΣ', stops: ['5', '6', '5'] }] },
    ]);
    assert.deepEqual(data.feed, { validFrom: '2026-08-03', validTo: '2026-08-09' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(checkOutput('bus-lines.json', data), []);
});

test('where a direction goes: the headsign\'s last part without notes about works or hours, or the last stop', () => {
    assert.equal(towardName('ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ(ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)', 'X'), 'ΠΕΙΡΑΙΑΣ');
    assert.equal(towardName('ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ (22:00-06:00) (ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)', 'X'), 'ΣΥΝΤΑΓΜΑ');
    assert.equal(towardName('ΚΑΙΣΑΡΙΑΝΗ - ΕΛ. ΒΕΝΙΖΕΛΟΥ (Προσωρινή λόγω έργων)', 'X'), 'ΕΛ. ΒΕΝΙΖΕΛΟΥ');
    assert.equal(towardName('ΣΥΝΤΑΓΜΑ - ΑΕΡΟΛ. ΑΘΗΝΩΝ (EXPRESS)', 'X'), 'ΑΕΡΟΛ. ΑΘΗΝΩΝ (EXPRESS)');
    assert.equal(towardName('', 'ΤΕΡΜΑ'), 'ΤΕΡΜΑ');
});

test('one read of the feed gives both files', async () => {
    const dir = busFeed();
    const feed = await readBusFeed(dir);
    const stops = await buildBus({ dir: '/nowhere', today: '20260805', feed });
    const lines = await buildBusLines({ dir: '/nowhere', today: '20260805', feed });
    assert.equal(stops.data.stops.length, 1000);
    assert.equal(lines.data.lines[0].directions[0].stops.length, 1000);
});

test('a feed whose trips\' stops are mixed up fails the lines, not the stops', async () => {
    const feed = await readBusFeed(busLinesFeed({ ungrouped: true }));
    await assert.rejects(buildBusLines({ dir: '', today: '20260805', feed }), /stop_times\.txt doesn't list each trip's stops together \(trip up1\)/);
    assert.ok(feed.stopLines.get('4').has('040'));
});
