import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

const { namesToward } = await browserModule('admin/client/lift-names.js');

// STASY's names for stations' lifts, as its lift page wrote them on 2 Nov 2026
const OMONIA = ['Εξωτερικός προς Πανεπιστημίου', 'Προς Πειραιά Γραμμή 1', 'Προς Ελληνικό', 'Εξωτερικός προς Κοτοπούλη',
    'Προς αποβάθρες Γραμμή 1 και μετεπιβίβαση προς Γραμμή 2', 'Προς Κηφισιά Γραμμή 1', 'Προς Ανθούπολη'];

test('the lifts whose names say a platform\'s direction are that platform\'s', () => {
    assert.deepEqual(namesToward(OMONIA, 'Πειραιάς'), ['Προς Πειραιά Γραμμή 1'], 'Πειραιά is Πειραιάς');
    assert.deepEqual(namesToward(OMONIA, 'Κηφισιά'), ['Προς Κηφισιά Γραμμή 1']);
    assert.deepEqual(namesToward(OMONIA, 'Ελληνικό'), ['Προς Ελληνικό']);
    assert.deepEqual(namesToward(['Προς Γραμμή 1 Πειραιά', 'Προς Ανθούπολη'], 'Πειραιάς'), ['Προς Γραμμή 1 Πειραιά']);
    assert.deepEqual(namesToward(['Προς Δημοτικό Θέατρο', 'Προς Αεροδρόμιο'], 'Δημοτικό Θέατρο'), ['Προς Δημοτικό Θέατρο']);
});

test('a lift to two platforms is each one\'s, and a direction with two names takes either', () => {
    const syntagma = ['Εξωτερικός Πλατεία Συντάγματος', 'Προς Αεροδρόμιο και Ανθούπολη', 'Προς Δημοτικό Θέατρο και Ελληνικό'];
    assert.deepEqual(namesToward(syntagma, 'Ανθούπολη'), ['Προς Αεροδρόμιο και Ανθούπολη']);
    assert.deepEqual(namesToward(syntagma, 'Δουκίσσης / Αεροδρόμιο'), ['Προς Αεροδρόμιο και Ανθούπολη']);
    assert.deepEqual(namesToward(syntagma, 'Ελληνικό'), ['Προς Δημοτικό Θέατρο και Ελληνικό']);
});

test('every lift a platform\'s, a street lift that goes on to one too, each name once', () => {
    const faliro = ['Προς Πειραιά', 'Πεζογέφυρα - Στάδιο Καραϊσκάκη', 'Προς Κηφισιά', 'Μεσαία Αποβάθρα προς Κηφισιά', 'Υπόγεια Διάβαση - Δρόμος (ΣΕΦ)'];
    assert.deepEqual(namesToward(faliro, 'Κηφισιά'), ['Προς Κηφισιά', 'Μεσαία Αποβάθρα προς Κηφισιά']);
    assert.deepEqual(namesToward(['Εξωτερικός προς Κασομούλη και Ελληνικό', 'Προς Ανθούπολη'], 'Ελληνικό'), ['Εξωτερικός προς Κασομούλη και Ελληνικό']);
    assert.deepEqual(namesToward(['Προς Πειραιά', 'Προς Πειραιά'], 'Πειραιάς'), ['Προς Πειραιά']);
});

test('a name that says no direction, or names a street, is no platform\'s', () => {
    assert.deepEqual(namesToward(['Προς Αποβάθρες', 'Εξωτερικός Προς Πλατεία Εσταυρωμένου'], 'Πειραιάς'), []);
    assert.deepEqual(namesToward(['Εξωτερικός Λεωφόρος Κηφισίας'], 'Κηφισιά'), [], 'not after "προς"');
    assert.deepEqual(namesToward(['Οδός Τατοΐου -Υπόγεια Διάβαση', 'Αποβάθρα - Υπόγεια Διάβαση'], 'Πειραιάς'), []);
    assert.deepEqual(namesToward([], 'Πειραιάς'), []);
});
