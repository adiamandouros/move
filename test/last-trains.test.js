import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { createPages } from '../server/pages/index.js';
import { lastTrains } from '../server/pages/last-trains.js';
import { loadTools } from '../server/pages/registry.js';
import { listen } from './support/listen.js';

// The Info page's last metro trains (server/pages/last-trains.js), from
// rail.json: the rows and facts the info tool's data.json lists

const H = 3600;
const s = key => ({ 'info.all-night': 'all night' })[key] ?? key;
const week = (sunThu, fri, sat) => [sunThu, sunThu, sunThu, sunThu, sunThu, fri, sat];

// M9 from a to c, and back. Out of a: STASY's times to b and to c (the
// airport-like branch: earlier every day); back: only the timetable's
function network() {
    const station = en => ({ name: { en, el: `${en} (el)` }, coords: [38, 23.7], lines: ['M9'] });
    return {
        hours: { fetched: '2026-10-01' },
        stations: { a: station('Alpha'), b: station('Beta'), c: station('Gamma') },
        lines: {
            M9: {
                name: 'M9',
                directions: {
                    out: {
                        stops: [
                            { station: 'a', hours: [
                                { to: 'b', first: Array(7).fill(5.5 * H), last: week(24 * H, 25.5 * H, null) },
                                { to: 'c', first: Array(7).fill(6 * H), last: Array(7).fill(22.9 * H) },
                            ] },
                            { station: 'b', hours: [{ to: 'c', first: Array(7).fill(6.1 * H), last: Array(7).fill(23 * H) }] },
                            { station: 'c' },
                        ],
                        timetable: { profiles: [{ stops: [0, 1, 2], offsets: [0, 300, 600] }], patterns: [[[6 * H, 0]]], days: Array(7).fill(0) },
                    },
                    back: {
                        stops: [{ station: 'c' }, { station: 'b' }, { station: 'a' }],
                        // Weekdays until 00:15, Saturdays until 01:00
                        timetable: {
                            profiles: [{ stops: [0, 1, 2], offsets: [0, 300, 600] }],
                            patterns: [[[5 * H, 0], [24.25 * H, 0]], [[5 * H, 0], [25 * H, 0]]],
                            days: [0, 0, 0, 0, 0, 0, 1],
                        },
                    },
                },
            },
        },
    };
}

const spec = {
    table: [
        { line: 'M9', from: 'a', to: 'b' },
        { line: 'M9', from: 'a', to: 'c', showTo: true },
        { line: 'M9', from: 'c', to: 'a' },
        { line: 'M4', from: 'x', to: 'y' },
    ],
    facts: { toC: { line: 'M9', from: 'a', to: 'c' }, firstToC: { line: 'M9', from: 'a', to: 'c', first: true }, nowhere: { line: 'M4', from: 'x', to: 'y' } },
};

test('each row: its last train Sundays to Thursdays, Fridays and Saturdays, one cell when they\'re the same', () => {
    const { rows, facts, stasy } = lastTrains(network(), spec, 'en', s);
    // The line's pill heads its rows
    assert.equal(String(rows[0].badge.pill), '<span class="line-pill pill-m line-m9">M9</span>');
    assert.deepEqual(rows.map(row => row.badge ? { ...row, badge: { rows: row.badge.rows } } : row), [
        { badge: { rows: 3 }, name: 'Alpha', times: [{ text: '00:00' }, { text: '01:30' }, { text: 'all night' }] },
        { name: 'Alpha → Gamma', times: [{ text: '22:54', colspan: 3 }] },
        // Back, from the timetable: 00:15 on weekdays, 01:00 on Saturdays
        { name: 'Gamma', times: [{ text: '00:15' }, { text: '00:15' }, { text: '01:00' }] },
    ]);
    // A line rail.json doesn't have is left out of the table, and its fact says so
    assert.deepEqual(facts, { toC: '22:54', firstToC: '06:00', nowhere: '–' });
    // Some times aren't STASY's: no STASY date
    assert.equal(stasy, null);
    assert.equal(lastTrains(network(), spec, 'el', s).rows[0].name, 'Alpha (el)');
});

test('when every time is STASY\'s, the date of its copy; before the first build, nothing', () => {
    const out = { table: spec.table.slice(0, 2), facts: { toC: spec.facts.toC } };
    assert.equal(lastTrains(network(), out, 'en', s).stasy, '01/10/2026');
    assert.deepEqual(lastTrains(null, out, 'en', s), { rows: [], facts: { toC: '–' }, stasy: null });
});

test('every row and fact of the Info page is on the real network', () => {
    const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
    const info = loadTools().find(t => t.id === 'info');
    const { rows, facts } = lastTrains(rail, info.data.lastTrains, 'en', s);
    assert.equal(rows.length, info.data.lastTrains.table.length);
    for (const [key, value] of Object.entries(facts)) assert.match(value, /^\d\d:\d\d$/, key);
});

test('the Info page is drawn again when rail.json changes, without a restart', async () => {
    const railFile = join(mkdtempSync(join(tmpdir(), 'last-trains-')), 'rail.json');
    const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
    const toAirport = last => {
        const stop = rail.lines.M3.directions.doukissis.stops[0];
        stop.hours = [{ to: 'airport', first: Array(7).fill(5.5 * H), last: Array(7).fill(last) }];
        writeFileSync(railFile, JSON.stringify(rail));
    };
    toAirport(22.9 * H);
    const app = express().use(createPages(loadTools(), { railFile }).router);
    const server = await listen(app);
    const info = async () => (await fetch(`${server.url}/info`)).text();
    try {
        assert.match(await info(), /the last train to the airport leaves Dimotiko Theatro at 22:54;/);
        toAirport(23.25 * H);
        utimesSync(railFile, new Date(), new Date(Date.now() + 60_000));
        assert.match(await info(), /the last train to the airport leaves Dimotiko Theatro at 23:15;/);
        assert.match(await info(), /<th scope="row">Dimotiko Theatro → Airport<\/th><td colspan="3">23:15<\/td>/);
    } finally {
        server.close();
    }
});
