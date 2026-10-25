import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AIRPORT_STALE_DAYS, BUILD_MAX_AGE_MS, dataStatus, STASY_STALE_DAYS, TIMETABLE_WARN_DAYS } from '../server/data/status.js';
import { runDiagnostics } from '../server/diagnostics.js';
import { createHealth } from '../server/health.js';

// How the data stands (server/data/status.js): judged once, so /api/health
// and /admin/diagnostics always agree

const NOW = Date.parse('2026-10-18T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = ms => new Date(ms).toISOString();

// A data folder (build/ and raw/) whose build is `buildHours` old, whose STASY
// copy is `stasyDays` old, whose airport timetable was checked `airportDays`
// ago, and whose metro timetable runs until `validTo`
function dataDir({ buildHours = 2, stasyDays = 10, airportDays = 3, validTo = '2026-10-31' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'wayhop-status-'));
    mkdirSync(join(dir, 'build'));
    mkdirSync(join(dir, 'raw', 'stasy'), { recursive: true });
    writeFileSync(join(dir, 'build', 'meta.json'), JSON.stringify({ generated: iso(NOW - buildHours * HOUR), outputs: { 'rail.json': { ok: true, warnings: [] } } }));
    writeFileSync(join(dir, 'build', 'rail.json'), JSON.stringify({ feed: { validTo }, hours: { fetched: iso(NOW - stasyDays * DAY).slice(0, 10) } }));
    writeFileSync(join(dir, 'raw', 'stasy', 'last-fetch.json'), JSON.stringify({ at: iso(NOW - stasyDays * DAY), ok: true, route: 'home relay' }));
    const checked = iso(NOW - airportDays * DAY);
    writeFileSync(join(dir, 'raw', 'stasy', 'airport-check.json'), JSON.stringify({ at: checked, checked, changes: [], route: 'home relay' }));
    return dir;
}
const status = options => {
    const dir = dataDir(options);
    return dataStatus({ buildDir: join(dir, 'build'), rawDir: join(dir, 'raw'), now: () => NOW });
};

test('the limits: a build over 36 h old, a STASY copy over 45 days, an airport check over 21 days, a timetable ending within 7 days', () => {
    assert.equal(BUILD_MAX_AGE_MS, 36 * HOUR);
    assert.equal(status({ buildHours: 35 }).build.ok, true);
    assert.deepEqual([status({ buildHours: 36 }).build.ok, status({ buildHours: 36 }).build.tooOld], [false, true]);

    assert.equal(STASY_STALE_DAYS, 45);
    assert.deepEqual(status({ stasyDays: 45 }).stasy, { ok: true, fetched: '2026-09-03', daysOld: 45, unreadable: false });
    assert.equal(status({ stasyDays: 46 }).stasy.ok, false);

    assert.equal(AIRPORT_STALE_DAYS, 21);
    assert.equal(status({ airportDays: 21 }).airport.ok, true);
    assert.deepEqual(status({ airportDays: 22 }).airport, { ok: false, checked: iso(NOW - 22 * DAY), daysOld: 22, changed: false });

    // Days left of the timetable, from today in Athens
    assert.equal(TIMETABLE_WARN_DAYS, 7);
    assert.equal(status().build.timetableDaysLeft, 13);
    assert.equal(status({ validTo: '2026-10-24' }).build.timetableDaysLeft, 6);
});

test('health and diagnostics agree on the data, at both sides of each limit', async () => {
    const health = dir => createHealth({ busStatus: () => ({ routes: [] }), announcementStatus: () => ({}), buildDir: join(dir, 'build'), now: () => NOW }).check();
    const diagnostics = dir => runDiagnostics({
        dataDir: dir, now: () => NOW, nodeVersion: 'v20.20.2',
        fetch: async () => { throw new TypeError('fetch failed'); },
        dnsLookup: async () => { throw Object.assign(new Error('x'), { code: 'EAI_AGAIN' }); },
    });
    const cases = [
        ['build', 'Last data build', /^Data:/, [{ buildHours: 35 }, { buildHours: 37 }]],
        ['stasy', 'STASY timetables', /^STASY timetables:/, [{ stasyDays: 45 }, { stasyDays: 46 }]],
        ['airport', 'STASY airport timetable', /^Airport timetable:/, [{ airportDays: 21 }, { airportDays: 22 }]],
        ['timetable', 'Metro timetable', /^Timetable:/, [{ validTo: '2026-10-25' }, { validTo: '2026-10-24' }]],
    ];
    for (const [name, row, problem, [fine, stale]] of cases) {
        for (const [options, ok] of [[fine, true], [stale, false]]) {
            const dir = dataDir(options);
            const healthSays = !(await health(dir)).problems.some(p => problem.test(p));
            const diagnosticsSays = (await diagnostics(dir)).checks.find(c => c.title === row).status === 'ok';
            assert.equal(healthSays, ok, `${name} ${JSON.stringify(options)}: health`);
            assert.equal(diagnosticsSays, ok, `${name} ${JSON.stringify(options)}: diagnostics`);
        }
    }
    const timetable = (await diagnostics(dataDir({ validTo: '2026-10-24' }))).checks.find(c => c.title === 'Metro timetable');
    assert.equal(timetable.detail, 'Ends on 2026-10-24 (in 6 days), and no newer one has been published yet');
});
