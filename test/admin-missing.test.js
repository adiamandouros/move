import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

const { missing, missingAtStation, unplaced } = await browserModule('admin/client/missing.js');

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

test('a station needs its exits on the street, each with its name, place and how it\'s reached, and its elevators there named and placed', () => {
    const exit = { name: { el: 'Βουλή' }, coords: [37.97552, 23.73481], way: ['stairs'] };
    assert.deepEqual(missingAtStation(undefined, [], []), ['street exits']);
    assert.deepEqual(missingAtStation({ exits: [exit] }, [], []), []);
    assert.deepEqual(missingAtStation({ exits: [exit, { name: { en: 'Parliament' }, coords: [37.97, 23.73], way: ['stairs'] }] }, [], []), ['exit details']);
    assert.deepEqual(missingAtStation({ exits: [{ ...exit, way: [] }] }, [], []), ['exit details']);
    assert.deepEqual(missingAtStation({ exits: [exit], lifts: [{ coords: [37.97, 23.73] }, { name: 'Εξωτερικός' }] }, [], []), ['elevator names', 'elevator locations']);
});

test('STASY\'s lifts at a station not recorded yet, on a platform or the street; a name it gives two needs two', () => {
    const stasy = ['Εξωτερικός Ακτή Καλλιμασιώτη', 'Προς Αεροδρόμιο', 'Εξωτερικός Ακτή Καλλιμασιώτη', 'Προς Δημοτικό Θέατρο'];
    const platforms = [
        { exits: [], elevators: [{ at: 'front', name: 'Προς Αεροδρόμιο' }] },
        // Left out on purpose ("none"), or from before names
        { exits: [], elevators: 'none' }, { exits: [], elevators: ['center'] },
    ];
    const lifts = [{ name: 'Εξωτερικός Ακτή Καλλιμασιώτη', coords: [37.94, 23.64] }];
    assert.deepEqual(unplaced(stasy, lifts, platforms), ['Εξωτερικός Ακτή Καλλιμασιώτη', 'Προς Δημοτικό Θέατρο']);
    assert.deepEqual(unplaced(stasy, [...lifts, ...lifts], [...platforms, { exits: [], elevators: [{ at: 'back', name: 'Προς Δημοτικό Θέατρο' }] }]), []);
    assert.ok(missingAtStation({ exits: [], lifts }, stasy, platforms).includes('unplaced elevators'));
});
