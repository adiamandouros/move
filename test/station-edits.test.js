import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestBody, stationChanges, streetChanges } from '../scripts/station-edits.js';

// The nightly pull request of station edits (.github/workflows/station-edits.yml):
// what it says changed between the committed positions.json and the export

const committed = {
    M1: {
        kifisia: { moschato: { exits: ['back'] }, faliro: { exits: ['center'] } },
        piraeus: { kifisia: { exits: ['back'] } },
    },
};

test('each station and direction added, changed or removed, and nothing else', () => {
    const exported = {
        M1: {
            kifisia: { moschato: { exits: ['back', 'front'] }, faliro: { exits: ['center'] }, thiseio: { exits: ['front'] } },
            piraeus: {},
        },
    };
    assert.deepEqual(stationChanges(committed, exported), [
        { line: 'M1', dir: 'kifisia', station: 'moschato', change: 'changed' },
        { line: 'M1', dir: 'kifisia', station: 'thiseio', change: 'added' },
        { line: 'M1', dir: 'piraeus', station: 'kifisia', change: 'removed' },
    ]);
    assert.deepEqual(stationChanges(committed, structuredClone(committed)), []);
});

test('the pull request lists them, and says what merging does', () => {
    const text = pullRequestBody([{ line: 'M1', dir: 'kifisia', station: 'moschato', change: 'changed' }]);
    assert.match(text, /^Station edits made in the editor/);
    assert.match(text, /^- M1 toward kifisia: `moschato` \(changed\)$/m);
    assert.match(text, /drops these edits from its own files, `data\/local\/positions\.json` and `data\/local\/street\.json`/);
});

test('each station whose exits or elevators on the street were added, changed or removed, listed too', () => {
    const before = { syntagma: { exits: [{ name: { el: 'Βουλή' } }] }, omonia: { lifts: [{ name: 'Εξωτερικός' }] } };
    const after = { syntagma: { exits: [{ name: { el: 'Βουλή' }, coords: [37.97552, 23.73481] }] }, monastiraki: { exits: [{ name: { el: 'Αθηνάς' } }] } };
    const changes = streetChanges(before, after);
    assert.deepEqual(changes, [
        { station: 'syntagma', change: 'changed' },
        { station: 'monastiraki', change: 'added' },
        { station: 'omonia', change: 'removed' },
    ]);
    assert.deepEqual(streetChanges(before, structuredClone(before)), []);
    const text = pullRequestBody([{ line: 'M1', dir: 'kifisia', station: 'moschato', change: 'changed' }], changes);
    assert.match(text, /^- M1 toward kifisia: `moschato` \(changed\)\n- `syntagma`, its exits and elevators on the street \(changed\)$/m);
});
