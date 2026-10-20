import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBusLines, buildBusStops, towardName } from '../server/data/build-bus.js';
import { checkOutput } from '../server/data/check-output.js';
import { fetchNetwork } from '../server/data/oasa-network.js';
import { fakeOasa } from './fixtures/network.js';

// bus-stops.json and bus-lines.json from today's network, as OASA's live API
// gives it (server/data/build-bus.js)

const network = async (options) => (await fetchNetwork({ request: fakeOasa(options).request, sleep: async () => {} })).network;

test('every stop on a route today, with every line that calls there', async () => {
    const { data, warnings } = buildBusStops(await network());
    assert.equal(data.stops.length, 1000);
    assert.deepEqual(data.fields, ['code', 'lat', 'lng', 'el', 'en', 'lines']);
    // Spaces collapsed, both names; the 040 and the Α10 (its own route and its short working) and the 830
    assert.deepEqual(data.stops[0], ['10000', 37.9, 23.7, 'ΣΤΑΣΗ 0', 'STOP 0', ['040']]);
    assert.deepEqual(data.stops[7][5], ['040', 'Α10']);
    assert.deepEqual(data.stops[8][5], ['040', '830', 'Α10']);
    assert.match(data.fetched, /^\d{4}-\d\d-\d\dT/);
    // The live times can't use "-2"
    assert.ok(!data.stops.some(s => s[0] === '-2'));
    assert.deepEqual(warnings, ['1 bus stops have codes the live times can\'t use and were left out: -2']);
    assert.deepEqual(checkOutput('bus-stops.json', data), []);
});

test('a network with too few stops, or none yet, fails (the build keeps the last files)', async () => {
    assert.throws(() => buildBusStops(null), /no bus network from OASA yet/);
    assert.throws(() => buildBusLines(null), /no bus network from OASA yet/);
    assert.throws(() => buildBusStops({ lines: [], routes: {}, stops: {}, fetched: '2026-10-20T01:00:00Z' }), /only 0 stops \(expected at least 1000\)/);
});

test('each line\'s stops in order, there and back: its own code, the plain route of each way', async () => {
    const { data } = buildBusLines(await network({ stops: 1000 }));
    const byLine = Object.fromEntries(data.lines.map(l => [l.line, l]));
    assert.deepEqual(data.lines.map(l => l.line), ['040', '830', 'Α10']);
    const the040 = byLine['040'];
    assert.deepEqual(the040.name, { el: 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ', en: 'PEIRAIAS - SYNTAGMA' });
    // Not the night variant; in the order OASA numbers them, not the order it answers in
    assert.deepEqual(the040.directions.map(d => [d.to, d.stops.length, d.stops[0]]), [
        [{ el: 'ΣΥΝΤΑΓΜΑ', en: 'SYNTAGMA' }, 1000, '10000'],
        [{ el: 'ΠΕΙΡΑΙΑΣ', en: 'PEIRAIAS' }, 1000, '10999'],
    ]);
    // The Α10's own code (two routes), not its short working; only variants there, so those, without the note
    assert.deepEqual(byLine['Α10'].directions, [
        { to: { el: 'ΑΧΑΡΝΑΙ', en: 'ACHARNAI' }, stops: ['10007', '10006', '10005'] },
        { to: { el: 'ΣΤ. ΛΑΡΙΣΗΣ', en: 'ST. LARISIS' }, stops: ['10005', '10006', '10007'] },
    ]);
    // Circular: one direction; no English route name, so the Greek; no "-2"
    assert.deepEqual(byLine['830'].directions, [{ to: { el: 'ΣΤ. ΚΟΡΥΔΑΛΛΟΣ', en: 'ΣΤ. ΚΟΡΥΔΑΛΛΟΣ' }, stops: ['10008', '10009', '10008'] }]);
    assert.deepEqual(checkOutput('bus-lines.json', data), []);
});

test('where a route goes: the last part of its name, without notes in brackets', () => {
    assert.equal(towardName('ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ'), 'ΠΕΙΡΑΙΑΣ');
    assert.equal(towardName('ΑΓ.ΒΑΡΒΑΡΑ - ΣΤ.ΚΟΡΥΔΑΛΛΟΣ [ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ]  '), 'ΣΤ.ΚΟΡΥΔΑΛΛΟΣ');
    assert.equal(towardName('PEIRAIAS - SYNTAGMA [22:00-06:00]'), 'SYNTAGMA');
    assert.equal(towardName('ΚΥΚΛΟΣ'), 'ΚΥΚΛΟΣ');
    assert.equal(towardName(''), '');
});
