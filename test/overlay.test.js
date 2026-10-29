import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatJson } from '../server/data/format.js';
import { EDITED, applyOverlay, pruneOverlay, readOverlay, removeEntry, sameEntry, setEntry, tidyEntry, tidyStreet } from '../server/data/overlay.js';

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

// ── street.json: one entry per station ──────────────────────────────────────

test('a station\'s street entry: names trimmed, places to about 1 m, ways in their order; empty rows and fields left out', () => {
    assert.deepEqual(tidyStreet({
        lifts: [{ name: ' Εξωτερικός ', coords: [37.975481234, 23.735019876] }, { name: '', coords: null }],
        exits: [
            { name: { el: ' Βουλή ', en: '' }, coords: [37.97552, 23.73481], way: ['escalator-up', 'stairs', 'stairs'] },
            { name: { el: '', en: '' }, way: ['stairs'] },
            { name: { el: '', en: 'Parliament' } },
        ],
        junk: 1,
    }), {
        exits: [
            { name: { el: 'Βουλή' }, coords: [37.97552, 23.73481], way: ['stairs', 'escalator-up'] },
            { name: { en: 'Parliament' } },
        ],
        lifts: [{ name: 'Εξωτερικός', coords: [37.97548, 23.73502] }],
    });
    assert.deepEqual(tidyStreet({ exits: [], lifts: [] }), {});
    // A place that isn't one stays as it is, for the checks to refuse
    assert.deepEqual(tidyStreet({ lifts: [{ name: 'x', coords: [1] }] }), { lifts: [{ name: 'x', coords: [1] }] });
});

test('street edits: set, applied, removed; nothing recorded is the same as no entry', () => {
    const kind = EDITED.street;
    const committed = { syntagma: { exits: [{ name: { el: 'Βουλή' } }] } };
    const ref = { station: 'omonia' };
    const overlay = setEntry({}, ref, { lifts: [{ name: 'Εξωτερικός' }] }, kind);
    assert.deepEqual(overlay, { omonia: { lifts: [{ name: 'Εξωτερικός' }] } });
    assert.deepEqual(Object.keys(applyOverlay(committed, overlay, kind)), ['syntagma', 'omonia']);
    assert.deepEqual(removeEntry(overlay, ref, kind), {});

    // Everything removed from a station: no entry left in the data
    const cleared = setEntry({}, { station: 'syntagma' }, {}, kind);
    assert.deepEqual(applyOverlay(committed, cleared, kind), {});
    assert.ok(sameEntry(undefined, {}, kind));
    assert.ok(!sameEntry(undefined, {}), 'positions.json: a platform with no entry has none');

    const { overlay: left, pruned } = pruneOverlay(committed, { syntagma: { exits: [{ name: { el: ' Βουλή ' } }] }, ...overlay }, kind);
    assert.deepEqual(pruned, ['syntagma']);
    assert.deepEqual(left, overlay);
});

test('a street overlay is read tidied, and written with each exit on its own line', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'overlay-')), 'street.json');
    writeFileSync(file, JSON.stringify({ syntagma: { exits: [{ name: { el: ' Βουλή ' }, coords: [37.975521, 23.734809] }, { name: { el: 'Αμαλίας' } }] } }));
    const overlay = readOverlay(file, EDITED.street);
    assert.deepEqual(overlay, { syntagma: { exits: [{ name: { el: 'Βουλή' }, coords: [37.97552, 23.73481] }, { name: { el: 'Αμαλίας' } }] } });
    assert.equal(formatJson(overlay, 3), [
        '{',
        '  "syntagma": {',
        '    "exits": [',
        '      { "name": { "el": "Βουλή" }, "coords": [37.97552, 23.73481] },',
        '      { "name": { "el": "Αμαλίας" } }',
        '    ]',
        '  }',
        '}',
    ].join('\n'));
});
