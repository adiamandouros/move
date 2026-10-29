import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { validateCurated } from '../server/data/validate.js';

const load = name => JSON.parse(readFileSync(new URL(`../data/curated/${name}.json`, import.meta.url), 'utf8'));
const real = () => ({ stations: load('stations'), lines: load('lines'), positions: load('positions'), airport: load('airport'), tram: load('tram') });

test('the committed curated files are valid', () => {
    const { errors } = validateCurated(real());
    assert.deepEqual(errors, []);
});

test('catches typical editing mistakes', () => {
    const c = real();
    c.positions.M1.kifisia.faliro = { exit: ['back'], exits: ['middle'], transfers: { 'M1/piraeus': ['back'], 'M4/x': [] } };
    c.stations.stations.kat.gtfs.push('MON1');

    const { errors } = validateCurated(c);
    assert.ok(errors.some(e => e.includes('unknown field "exit"')));
    assert.ok(errors.some(e => e.includes('unknown position "middle"')));
    assert.ok(errors.some(e => e.includes('"M1/piraeus" is on the same line')));
    assert.ok(errors.some(e => e.includes('unknown direction "M4/x"')));
    assert.ok(errors.some(e => e.includes('MON1 is used by both')));
});

test('escalators and stairs are lists of positions', () => {
    const c = real();
    c.positions.M1.kifisia.faliro = { exits: ['center'], escalators: ['center'], stairs: ['top'] };
    const { errors } = validateCurated(c);
    assert.deepEqual(errors, ['positions.json: M1/kifisia/faliro.stairs: unknown position "top" (use back, center-back, center, center-front, front)']);
});

test('elevators: "none", or each with where it is and, once known, its name', () => {
    const c = real();
    c.positions.M1.kifisia.faliro = { exits: ['center'], elevators: [{ at: 'center', name: 'Προς Πειραιά' }, { at: 'front' }] };
    c.positions.M1.kifisia.moschato = { exits: ['back'], elevators: 'none' };
    assert.deepEqual(validateCurated(c).errors, []);

    c.positions.M1.kifisia.faliro = { exits: ['center'], elevators: ['center', { at: 'top', floor: 1 }, { at: 'back', name: ' ' }] };
    c.positions.M1.kifisia.moschato = { exits: ['back'], elevators: 'no' };
    assert.deepEqual(validateCurated(c).errors, [
        'positions.json: M1/kifisia/faliro.elevators[0] must be { "at": position, "name": … }',
        'positions.json: M1/kifisia/faliro.elevators[1]: unknown field "floor"',
        'positions.json: M1/kifisia/faliro.elevators[1].at: unknown position "top" (use back, center-back, center, center-front, front)',
        'positions.json: M1/kifisia/faliro.elevators[2].name must be text',
        'positions.json: M1/kifisia/moschato.elevators must be "none" or a list of elevators',
    ]);
});

test('step-free access is one of its values, or left out (not known yet)', () => {
    const c = real();
    c.positions.M1.kifisia.faliro = { exits: ['center'], stepFree: 'stairs' };
    c.positions.M1.kifisia.moschato = { exits: ['back'], stepFree: 'no' };
    c.positions.M1.kifisia.kallithea = { exits: ['back'] };
    const { errors } = validateCurated(c);
    assert.deepEqual(errors, ['positions.json: M1/kifisia/faliro.stepFree must be one of lift, ramp, level, yes, no']);
});

test('any platform\'s step-free access may be not known yet, however many', () => {
    // Which ones is the station editor's call, never a test's (decision 16)
    const c = real();
    for (const stops of Object.values(c.positions).flatMap(dirs => Object.values(dirs))) {
        for (const p of Object.values(stops)) delete p.stepFree;
    }
    assert.deepEqual(validateCurated(c).errors, []);
});

test('how STASY writes a name: a list of names, each leading to one station', () => {
    const c = real();
    c.stations.stations.omonia.stasy = 'ΟΜΟΝΟΙΑ';
    c.stations.stations.kat.stasy = ['Σύνταγμα'];
    const { errors } = validateCurated(c);
    assert.ok(errors.includes('stations.json: omonia.stasy must be a list of names'), errors.join('\n'));
    assert.ok(errors.includes('stations.json: the name "Σύνταγμα" is used by both kat and syntagma'), errors.join('\n'));
});

test('airport.json: STASY\'s airport trains, one time per station, in order, and where they came from', () => {
    const c = real();
    const toAirport = c.airport.lines.M3.doukissis;
    toAirport.sha256 = 'abc';
    toAirport.serves = 'kifisia';
    toAirport.trains[0].times.pop();
    toAirport.trains[1].times[3] = '5:35';
    toAirport.trains[2].times.reverse();
    c.airport.lines.M3.nowhere = { ...toAirport };
    const { errors } = validateCurated(c);
    for (const e of [
        'airport.json: M3/doukissis: "sha256" must be the PDF\'s SHA-256, in hex',
        'airport.json: M3/doukissis: "serves" must be one of its stations',
        'airport.json: M3/doukissis: train 1 (332) needs one time per station',
        'airport.json: M3/doukissis: train 2 (333): times must be HH:MM (after midnight 24:05)',
        'airport.json: M3/doukissis: train 3 (334) goes back in time',
        'airport.json: M3/nowhere: unknown direction',
    ]) assert.ok(errors.includes(e), `${e}\n${errors.join('\n')}`);
});

test('tram.json: lines with a colour and directions, stops with names and their own codes, metro stations that exist', () => {
    const c = real();
    c.tram.lines.T6.color = 'green';
    c.tram.lines.T7.directions.voula.gtfsDirection = '0';
    delete c.tram.stops.edem.name.en;
    c.tram.stops.batis.gtfs.push('SYNPF', 'MON1');
    c.tram.stops.fix.metro = 'fix';
    const { errors } = validateCurated(c);
    assert.deepEqual(errors.sort(), [
        'tram.json: T6 needs a name and a #rrggbb color',
        'tram.json: T7 has two directions with gtfsDirection 0',
        'tram.json: edem needs name.el and name.en',
        'tram.json: fix changes to an unknown metro station "fix"',
        'tram.json: gtfs code MON1 is used by both monastiraki and batis',
        'tram.json: gtfs code SYNPF is used by both batis and syntagma',
    ].sort());
});

