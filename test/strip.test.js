import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';

// A way as one strip (tools/subway/client/strip.js, decision 77): its parts in
// order by their minutes, drawn as shares of the width

const { stripParts, wayStrip } = await browserModule('tools/subway/client/strip.js');
const STYLE = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');

// The strip's parts as drawn: kind, share and the class that colours a ride
const drawn = view => [...String(view).matchAll(/<span class="way-strip-(walk|wait|ride) way-share-(\d+)(?: ([\w-]+))?"><\/span>/g)]
    .map(([, kind, share, colour]) => ({ kind, share: Number(share), ...(colour && { colour }) }));

test('a way\'s parts: the walk, the wait for the train, the ride, and so on to the door', () => {
    const parts = stripParts([
        { walk: 3, departs: 600, arrives: 1200, line: 'M3' },
        { walk: 2, departs: 1500, arrives: 2100, line: null },
    ], 4, 0);
    assert.deepEqual(parts, [
        { kind: 'walk', minutes: 3 }, { kind: 'wait', minutes: 7 }, { kind: 'ride', minutes: 10, line: 'M3' },
        { kind: 'walk', minutes: 2 }, { kind: 'wait', minutes: 3 }, { kind: 'ride', minutes: 10, line: null },
        { kind: 'walk', minutes: 4 },
    ]);
    // So it adds up to the way's minutes from when it starts
    assert.equal(parts.reduce((sum, part) => sum + part.minutes, 0), (2100 + 4 * 60) / 60);
});

test('with no start, the way starts with the walk to its first ride: no wait before it', () => {
    assert.deepEqual(stripParts([{ walk: 5, departs: 3600, arrives: 4200, line: 'M1' }], 0), [
        { kind: 'walk', minutes: 5 }, { kind: 'ride', minutes: 10, line: 'M1' },
    ]);
});

test('a wait under a minute isn\'t drawn, nor a walk of none; a ride is at least a minute', () => {
    assert.deepEqual(stripParts([
        { walk: 0, departs: 30, arrives: 600, line: 'M2' },
        { walk: 0, departs: 650, arrives: 660, line: 'M3' },
    ], 0, 0), [{ kind: 'ride', minutes: 9.5, line: 'M2' }, { kind: 'ride', minutes: 1, line: 'M3' }]);
    assert.deepEqual(stripParts([], 3, 0), []);
});

test('drawn: each part a share of twenty by its minutes, a ride in its line\'s colour, a bus neutral, hidden from screen readers', () => {
    const view = String(wayStrip([
        { kind: 'walk', minutes: 3 }, { kind: 'wait', minutes: 7 }, { kind: 'ride', minutes: 10, line: 'M3' },
        { kind: 'walk', minutes: 2 }, { kind: 'wait', minutes: 3 }, { kind: 'ride', minutes: 10, line: null }, { kind: 'walk', minutes: 4 },
    ]));
    assert.match(view, /^<span class="way-strip" aria-hidden="true">/);
    const parts = drawn(view);
    assert.deepEqual(parts.map(({ kind, colour }) => [kind, colour]), [
        ['walk', undefined], ['wait', undefined], ['ride', 'strip-m3'], ['walk', undefined], ['wait', undefined], ['ride', 'way-strip-bus'], ['walk', undefined],
    ]);
    assert.equal(parts.reduce((sum, part) => sum + part.share, 0), 20, 'the shares add up to the whole');
    assert.deepEqual(parts.map(part => part.share), [2, 3, 5, 1, 2, 5, 2]);
    assert.equal(wayStrip([]), '');
});

test('a part far too short for its share still gets one; the other ways\' strip is the small one', () => {
    const view = String(wayStrip([{ kind: 'walk', minutes: 1 }, { kind: 'ride', minutes: 90, line: 'A1' }], true));
    assert.match(view, /^<span class="way-strip way-strip-small" aria-hidden="true">/);
    assert.deepEqual(drawn(view).map(part => part.share), [1, 19]);
});

test('every share and line the strip can draw has its rule', () => {
    for (let share = 1; share <= 20; share++) assert.match(STYLE, new RegExp(`\\.way-share-${share} \\{ flex-grow: ${share}; \\}`), `share ${share}`);
    const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
    for (const line of [...Object.keys(rail.lines), 'A1', 'A2', 'A3', 'A4']) assert.match(STYLE, new RegExp(`\\.strip-${line.toLowerCase()} \\{`), line);
});
