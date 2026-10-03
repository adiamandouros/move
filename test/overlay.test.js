import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlay, pruneOverlay, removeEntry, sameEntry, setEntry, tidyEntry } from '../server/data/overlay.js';

const positions = {
    M1: { kifisia: { faliro: { exits: ['center-back', 'center'] }, moschato: { exits: [] } } },
};

test('tidyEntry orders positions back to front and drops empty fields', () => {
    assert.deepEqual(
        tidyEntry({ note: '  hi ', exits: ['front', 'back', 'front'], elevators: [], centralPlatform: false, transfers: { 'M3/x': ['front', 'center'], 'M2/y': [] }, junk: 1 }),
        { exits: ['back', 'front'], transfers: { 'M3/x': ['center', 'front'] }, note: 'hi' },
    );
});

test('sameEntry ignores order and empty optional fields', () => {
    assert.ok(sameEntry({ exits: ['center', 'center-back'] }, { exits: ['center-back', 'center'], elevators: [], note: '' }));
    assert.ok(!sameEntry({ exits: ['center'] }, { exits: ['center'], note: 'x' }));
    assert.ok(!sameEntry(undefined, { exits: [] }));
});

test('setEntry / applyOverlay / removeEntry', () => {
    const ref = { line: 'M1', dir: 'kifisia', station: 'moschato' };
    const overlay = setEntry({}, ref, { exits: ['front'] });
    assert.deepEqual(applyOverlay(positions, overlay).M1.kifisia.moschato, { exits: ['front'] });
    assert.deepEqual(positions.M1.kifisia.moschato, { exits: [] }); // input untouched
    assert.deepEqual(removeEntry(overlay, ref), {});
});

test('pruneOverlay removes entries the committed data now matches', () => {
    const overlay = {
        M1: { kifisia: { faliro: { exits: ['center', 'center-back'] }, moschato: { exits: ['front'] } } },
    };
    const { overlay: left, pruned } = pruneOverlay(positions, overlay);
    assert.deepEqual(pruned, ['M1/kifisia/faliro']);
    assert.deepEqual(left, { M1: { kifisia: { moschato: { exits: ['front'] } } } });
});
