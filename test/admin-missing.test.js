import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

const { missing } = await browserModule('admin/client/missing.js');

test('the station editor marks what a platform still needs: its exits, its elevators, their names', () => {
    assert.deepEqual(missing({ exits: [] }), ['exits', 'elevators']);
    assert.deepEqual(missing({ exits: ['back'], elevators: [{ at: 'front', name: 'Προς Πειραιά' }] }), []);
    assert.deepEqual(missing({ exits: ['back'], elevators: 'none' }), []);
    assert.deepEqual(missing({ exits: ['back'], elevators: [{ at: 'front', name: 'Προς Πειραιά' }, { at: 'back' }] }), ['elevator names']);
    // As the editor sent them before they had names: nothing pressed, or plain positions
    assert.deepEqual(missing({ exits: ['back'], elevators: [] }), ['elevators']);
    assert.deepEqual(missing({ exits: ['back'], elevators: ['front'] }), ['elevator names']);
});

test('a platform reached by a ramp or on the level isn\'t asked for elevators (a surface station\'s)', () => {
    assert.deepEqual(missing({ exits: ['back'], stepFree: 'ramp' }), []);
    assert.deepEqual(missing({ exits: ['back'], stepFree: 'level' }), []);
    for (const stepFree of ['lift', 'yes', 'no']) assert.deepEqual(missing({ exits: ['back'], stepFree }), ['elevators'], stepFree);
});
