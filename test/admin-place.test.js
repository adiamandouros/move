import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The station editor's places on the street (admin/client/place.js): written
// as "latitude, longitude", checked as the server does, and how far from the
// station, to catch a wrong one
const { coordsProblem, formatCoords, fromStation, parseCoords } = await browserModule('admin/client/place.js');
const BOUNDS = { lat: [37.7, 38.3], lng: [23.4, 24.2] };

test('a place is written as maps copy it: latitude, longitude', () => {
    assert.deepEqual(parseCoords(' 37.97552, 23.73481 '), [37.97552, 23.73481]);
    assert.deepEqual(parseCoords('37.97552 23.73481'), [37.97552, 23.73481]);
    assert.equal(parseCoords('  '), null, 'not known yet');
    for (const text of ['37.97552', '37°58\'31.9"N 23°44\'05.3"E', '37,97552, 23,73481', 'here']) assert.equal(parseCoords(text), undefined, text);
    assert.equal(formatCoords([37.975521, 23.7348]), '37.97552, 23.73480');
});

test('a place that can\'t be read, or isn\'t around Athens, stops the save with why; none is fine', () => {
    assert.equal(coordsProblem('', BOUNDS), '');
    assert.equal(coordsProblem('37.97552, 23.73481', BOUNDS), '');
    assert.match(coordsProblem('37.97552', BOUNDS), /^Write it as latitude, longitude/);
    assert.match(coordsProblem('23.73481, 37.97552', BOUNDS), /the right way round\?$/);
});

test('how far a place is from its station; far off, a question', () => {
    const syntagma = [37.9755, 23.7348];
    assert.equal(fromStation([37.9764, 23.7348], syntagma), '100 m from the station');
    assert.deepEqual(fromStation([37.9855, 23.7348], syntagma), { warn: '1112 m from the station: is that right?' });
});
