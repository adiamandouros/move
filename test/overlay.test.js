import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { applyOverlay, pruneOverlay, readOverlay, removeEntry, sameEntry, setEntry, tidyEntry } from '../server/data/overlay.js';

const positions = {
    M1: { kifisia: { faliro: { exits: ['center-back', 'center'] }, moschato: { exits: [] } } },
};

test('tidyEntry orders positions back to front and drops empty fields', () => {
    assert.deepEqual(
        tidyEntry({ note: '  hi ', exits: ['front', 'back', 'front'], elevators: [], centralPlatform: false, transfers: { 'M3/x': ['front', 'center'], 'M2/y': [] }, junk: 1 }),
        { exits: ['back', 'front'], transfers: { 'M3/x': ['center', 'front'] }, note: 'hi' },
    );
    // How the exits are reached, kept like the elevators
    assert.deepEqual(tidyEntry({ exits: ['front', 'back'], stairs: ['front', 'back'], escalators: [] }), { exits: ['back', 'front'], stairs: ['back', 'front'] });
    // Step-free access: kept when it's one of the values; not known yet ('') left out
    assert.deepEqual(tidyEntry({ note: 'x', stepFree: 'ramp', centralPlatform: true, exits: [] }), { exits: [], centralPlatform: true, stepFree: 'ramp', note: 'x' });
    assert.deepEqual(tidyEntry({ exits: [], stepFree: '' }), { exits: [] });
    assert.deepEqual(tidyEntry({ exits: [], stepFree: 'maybe' }), { exits: [] });
    assert.ok(!sameEntry({ exits: [] }, { exits: [], stepFree: 'no' }));
});

test('elevators: "none", or each with where it is and its name, back to front; an empty list is not known yet', () => {
    assert.deepEqual(
        tidyEntry({ exits: [], elevators: [{ name: ' Προς Πειραιά ', at: 'front' }, { at: 'back', name: '  ' }, { at: 'front' }] }),
        { exits: [], elevators: [{ at: 'back' }, { at: 'front', name: 'Προς Πειραιά' }, { at: 'front' }] },
    );
    assert.deepEqual(tidyEntry({ exits: [], elevators: 'none' }), { exits: [], elevators: 'none' });
    // What the editor sent before elevators had names: nothing pressed is not known yet
    assert.deepEqual(tidyEntry({ exits: [], elevators: [] }), { exits: [] });
    assert.deepEqual(tidyEntry({ exits: [], elevators: ['front', 'center'] }), { exits: [], elevators: [{ at: 'center' }, { at: 'front' }] });
    assert.ok(sameEntry({ exits: [], elevators: ['center'] }, { exits: [], elevators: [{ at: 'center' }] }));
    assert.ok(!sameEntry({ exits: [], elevators: [{ at: 'center' }] }, { exits: [], elevators: [{ at: 'center', name: 'Προς Αποβάθρες' }] }));
    assert.ok(!sameEntry({ exits: [] }, { exits: [], elevators: 'none' }));
});

test('an overlay saved before elevators had names reads as it would be saved now', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'overlay-')), 'positions.json');
    writeFileSync(file, JSON.stringify({ M1: { kifisia: { faliro: { exits: ['center'], elevators: ['center'] }, moschato: { exits: ['back'], elevators: [] } } } }));
    assert.deepEqual(readOverlay(file), { M1: { kifisia: { faliro: { exits: ['center'], elevators: [{ at: 'center' }] }, moschato: { exits: ['back'] } } } });
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
