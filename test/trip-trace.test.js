// The trace of a ride (tools/trip/client/trace.js, decision 69): what's kept,
// what its panel counts and the file it's saved as. The panel itself, its
// buttons and the download: test/browser/trip-trace.spec.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

const { added, summary, traceFile, fileName, MAX_ENTRIES } = await browserModule('tools/trip/client/trace.js');
const { ROUGH_METRES } = await browserModule('tools/trip/client/follow.js');

const fix = (at, accuracy) => ({ kind: 'fix', at, got: at, lat: 37.97, lng: 23.73, accuracy, speed: null });

test('a trace keeps everything in order, the oldest going first past its limit', () => {
    let entries = [];
    for (let at = 1; at <= MAX_ENTRIES + 2; at++) entries = added(entries, fix(at, 20));
    assert.equal(entries.length, MAX_ENTRIES);
    assert.equal(entries[0].at, 3, 'the two oldest dropped');
    assert.equal(entries.at(-1).at, MAX_ENTRIES + 2);
    const kept = [fix(1, 20)];
    assert.deepEqual(added(kept, { kind: 'station', at: 2, count: 1 }), [fix(1, 20), { kind: 'station', at: 2, count: 1 }]);
    assert.equal(kept.length, 1, 'a new list: the one given is left as it was');
});

test('its panel counts the positions, those rougher than following uses, the last one\'s accuracy and the stations marked', () => {
    assert.deepEqual(summary([]), { fixes: 0, rough: 0, accuracy: null, stations: 0 });
    const entries = [
        fix(1, 12), { kind: 'hidden', at: 2 }, fix(3, ROUGH_METRES), fix(4, ROUGH_METRES + 1),
        { kind: 'station', at: 5, count: 1 }, fix(6, null), { kind: 'station', at: 7, count: 2 },
        { kind: 'placed', at: 7, left: true, step: 2, stop: 1, any: null, off: false },
    ];
    assert.deepEqual(summary(entries), { fixes: 4, rough: 1, accuracy: null, stations: 2 }, 'exactly the limit isn\'t rough; no accuracy said isn\'t either');
    assert.equal(summary(entries.slice(0, 4)).accuracy, ROUGH_METRES + 1);
});

test('it\'s saved as a file that says what it is, when, on what browser and with what limit', () => {
    const saved = Date.UTC(2026, 10, 22, 13, 30, 5);
    const entries = [fix(1, 20)];
    assert.deepEqual(traceFile(entries, saved, 'Phone'), {
        wayhop: 'trace', version: 1, saved: '2026-11-22T13:30:05.000Z', browser: 'Phone', roughMetres: ROUGH_METRES, entries,
    });
    assert.equal(fileName(saved), 'wayhop-trace-20261122-1330Z.json');
    assert.equal(fileName(Date.UTC(2026, 0, 2, 3, 4)), 'wayhop-trace-20260102-0304Z.json');
});
