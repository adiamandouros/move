import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStops, distanceMeters, nearestStops } from '../tools/buses/client/stops.js';

// Stops spaced ~111 m apart going north from (38.0, 23.7)
const data = {
    fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'],
    stops: Array.from({ length: 10 }, (_, i) => [String(i), 38 + i * 0.001, 23.7, `Στάση ${i}`, i === 0 ? '' : `Stop ${i}`, ['1']]),
};
const stops = decodeStops(data);

test('decodeStops falls back to the Greek name', () => {
    assert.deepEqual(stops[0], { code: '0', lat: 38, lng: 23.7, name: { el: 'Στάση 0', en: 'Στάση 0' }, lines: ['1'] });
});

test('distanceMeters', () => {
    assert.equal(distanceMeters(38, 23.7, 38.001, 23.7), 111);
});

test('nearestStops keeps the closest within the radius, up to the limit', () => {
    assert.deepEqual(nearestStops(stops, 38, 23.7, { limit: 6, radius: 500 }).map(s => s.code), ['0', '1', '2', '3', '4']);
    assert.deepEqual(nearestStops(stops, 38, 23.7, { limit: 3, radius: 500 }).map(s => s.code), ['0', '1', '2']);
});

test('nearestStops still returns a few stops when none are close', () => {
    const far = nearestStops(stops, 37.9, 23.7, { limit: 6, radius: 500, min: 3 });
    assert.deepEqual(far.map(s => s.code), ['0', '1', '2']);
    assert.ok(far[0].meters > 10_000);
});
