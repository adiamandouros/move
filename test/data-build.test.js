import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { builderFingerprint, runBuild } from '../server/data/index.js';
import { checkOutput } from '../server/data/check-output.js';
import { SOURCES } from '../server/data/sources.js';
import { busFeed, curatedDir, fakePortal, railCurated, railFeed, stopTable, tempDir } from './fixtures/gtfs.js';
import { fakeOasa } from './fixtures/network.js';
import { stasyPage, stasyTable } from './fixtures/stasy.js';

// The whole data build (runBuild in server/data/index.js), in a folder of
// its own against a fake portal and a fake OASA: what it publishes, when it
// rebuilds, and that a failure never replaces files the site is serving.

const DAY = 86_400_000;

function setup({ busStops = 1500 } = {}) {
    const portal = fakePortal();
    portal.publish(SOURCES.rail.dataset, railFeed());
    portal.publish(SOURCES.bus.dataset, busFeed());
    portal.publishFile(SOURCES.stopTable.dataset, 'stops_all.csv', readFileSync(stopTable(), 'utf8'));
    const oasa = fakeOasa({ stops: busStops });
    // The build's clock: the bus network is fetched at most once a day
    const clock = { now: Date.parse('2026-08-05T01:30:00Z') };
    const dataDir = tempDir();
    const logs = [];
    const options = {
        dataDir, curatedDir: curatedDir(), overlayFile: join(dataDir, 'local', 'positions.json'), fetch: portal.fetch, today: '20260805', log: m => logs.push(m),
        oasa: oasa.request, now: () => clock.now, sleep: async () => {},
    };
    const build = (more = {}) => runBuild({ ...options, ...more });
    const served = name => JSON.parse(readFileSync(join(dataDir, 'build', name), 'utf8'));
    // The next night: a day later, a new day for the timetable
    const nextNight = (more = {}) => { clock.now += DAY; return build({ today: '20260806', ...more }); };
    return { portal, oasa, dataDir, logs, build, nextNight, served, clock };
}

// STASY's site, as server/stasy.js's client, with pages the build can read
// for the fixture's stations (Α, Β, Γ)
function fakeStasy() {
    const T = ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ'];
    const page = stasyPage([stasyTable(T, [['Α', '08:00', '00:30'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ Γ', '08:05', '00:35']]), stasyTable(T, [['Γ', '08:00', '23:00'], ['Α', '08:05', '23:05']])]);
    return {
        asked: /** @type {number[]} */ ([]), down: false, route: 'home relay',
        async timetable(line) {
            this.asked.push(line);
            if (this.down) throw new Error('home relay: HTTP 502');
            return page;
        },
    };
}

test('a first build publishes every file, which pass their checks', async () => {
    const { build, served, dataDir } = setup();
    const meta = await build();
    assert.deepEqual(Object.fromEntries(Object.entries(meta.outputs).map(([k, o]) => [k, o.ok])), { 'rail.json': true, 'bus-stops.json': true, 'bus-lines.json': true });
    assert.deepEqual(checkOutput('rail.json', served('rail.json')), []);
    assert.deepEqual(checkOutput('bus-stops.json', served('bus-stops.json')), []);
    assert.deepEqual(checkOutput('bus-lines.json', served('bus-lines.json')), []);
    assert.deepEqual(served('bus-lines.json').lines.map(l => l.line), ['040', '830', 'Α10']);
    assert.equal(served('bus-stops.json').stops.length, 1500);
    assert.deepEqual(served('meta.json').fingerprint.today, '20260805');
    assert.equal(served('meta.json').fingerprint.sources.network, '2026-08-05T01:30:00.000Z');
    for (const leftover of ['build.next', '.build.lock']) assert.ok(!existsSync(join(dataDir, leftover)), `${leftover} is cleaned up`);
});

test('nothing changed: no rebuild; a new day: rebuilt without downloading', async () => {
    const { build, portal, oasa, logs } = setup();
    const first = await build();
    const downloads = portal.downloads.length;
    const asked = oasa.calls.length;

    // A restart the same night: OASA isn't asked again
    const again = await build();
    assert.equal(again.generated, first.generated);
    assert.ok(logs.includes('[data] Build is up to date'));
    assert.equal(portal.downloads.length, downloads);
    assert.equal(oasa.calls.length, asked);

    const nextDay = await build({ today: '20260806' });
    assert.notEqual(nextDay.generated, first.generated);
    assert.equal(nextDay.fingerprint.today, '20260806');
    assert.equal(portal.downloads.length, downloads);
});

test('a change to the build\'s code rebuilds, with the same feeds on the same day', async () => {
    const { build, portal } = setup();
    const first = await build({ builder: 'aaaaaaaaaaaa' });
    const downloads = portal.downloads.length;
    assert.equal((await build({ builder: 'aaaaaaaaaaaa' })).generated, first.generated);
    const rebuilt = await build({ builder: 'bbbbbbbbbbbb' });
    assert.notEqual(rebuilt.generated, first.generated);
    assert.equal(rebuilt.fingerprint.builder, 'bbbbbbbbbbbb');
    assert.equal(portal.downloads.length, downloads, 'nothing downloaded again');
});

test('the builder\'s fingerprint follows its code', () => {
    const dir = tempDir('wayhop-builder-');
    cpSync(new URL('../server/data/', import.meta.url), dir, { recursive: true });
    const before = builderFingerprint(dir);
    assert.match(before, /^[0-9a-f]{12}$/);
    assert.equal(builderFingerprint(dir), before, 'the same code, the same fingerprint');
    writeFileSync(join(dir, 'build-bus.js'), `${readFileSync(join(dir, 'build-bus.js'), 'utf8')}\n// a fix\n`);
    assert.notEqual(builderFingerprint(dir), before);
    assert.equal(builderFingerprint(), builderFingerprint(new URL('../server/data/', import.meta.url).pathname), 'by default, server/data/');
});

test('the next night\'s network is fetched and built, and the replaced files are kept in build.prev', async () => {
    const { build, nextNight, oasa, served, dataDir } = setup();
    await build();
    // A diversion: new routes, so their stops are asked for at once
    oasa.divert(1600);
    const meta = await nextNight();
    assert.equal(meta.outputs['bus-stops.json'].ok, true);
    assert.equal(served('bus-stops.json').stops.length, 1600);
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'build.prev', 'bus-stops.json'), 'utf8')).stops.length, 1500);
    assert.equal(meta.fingerprint.sources.network, '2026-08-06T01:30:00.000Z');
});

test('STASY\'s timetables come with the build at most every 14 days, and one that can\'t be fetched doesn\'t stop it', async () => {
    const stasy = fakeStasy();
    const { build, nextNight, clock, logs } = setup();
    const meta = await build({ stasy });
    assert.deepEqual(stasy.asked, [1, 2, 3]);
    assert.equal(meta.fingerprint.sources.stasy, '2026-08-05T01:30:00.000Z');
    // The fixture's line isn't one of STASY's, so its first and last trains stay the GTFS's
    assert.ok(meta.outputs['rail.json'].warnings.includes('STASY M9: not in the copy; its first and last trains come from the GTFS'));

    await nextNight({ stasy });
    assert.deepEqual(stasy.asked, [1, 2, 3]);
    // 14 days on, STASY can't be reached: the build goes on with the copy
    stasy.down = true;
    clock.now += 13 * DAY;
    const later = await nextNight({ stasy });
    assert.deepEqual(stasy.asked, [1, 2, 3, 1]);
    assert.equal(later.outputs['rail.json'].ok, true);
    assert.equal(later.fingerprint.sources.stasy, '2026-08-05T01:30:00.000Z');
    assert.ok(logs.includes('[data] Couldn\'t fetch STASY\'s timetables: home relay: HTTP 502 — using the copy from 2026-08-05'));
});

test('a broken new feed keeps the files the site serves', async () => {
    const { build, portal, served } = setup();
    await build();
    const before = served('rail.json');
    // OASA publishes a stops.txt without coordinates
    portal.publishFile(SOURCES.rail.dataset, 'stops.txt', 'stop_id,stop_code\n1,A1\n', '2026-09-01T00:00:00');
    const meta = await build();
    assert.equal(meta.outputs['rail.json'].ok, false);
    assert.equal(meta.outputs['rail.json'].keptPrevious, true);
    assert.match(meta.outputs['rail.json'].error, /stop_lat/);
    assert.deepEqual(served('rail.json'), before);
    assert.equal(meta.outputs['bus-stops.json'].ok, true, 'the other files are unaffected');
});

test('when OASA can\'t be asked at night, the bus files stay as they were', async () => {
    const { build, nextNight, oasa, served, logs } = setup();
    await build();
    const before = [served('bus-stops.json'), served('bus-lines.json')];
    oasa.down();
    const meta = await nextNight();
    assert.ok(meta.outputs['bus-stops.json'].ok && meta.outputs['bus-lines.json'].ok);
    assert.deepEqual([served('bus-stops.json'), served('bus-lines.json')], before);
    assert.ok(logs.some(l => /Couldn't fetch the bus network from OASA \(the lines: fake OASA: down \(4 tries\)\) after \d+ s; 0 route\(s\) saved for the next try — using the network from/.test(l)));
});

test('without any network yet (OASA can\'t be asked), the bus files aren\'t published', async () => {
    const { build, oasa, dataDir } = setup();
    oasa.down();
    const meta = await build();
    for (const name of ['bus-stops.json', 'bus-lines.json']) {
        assert.deepEqual(meta.outputs[name], { ok: false, error: 'source unavailable: network (the lines: fake OASA: down (4 tries))', keptPrevious: false });
        assert.ok(!existsSync(join(dataDir, 'build', name)));
    }
    assert.equal(meta.outputs['rail.json'].ok, true);
});

test('a network that suddenly shrinks is held back, unless forced', async () => {
    const { nextNight, build, oasa, served } = setup();
    await build();
    // 1100 stops after 1500: under 80%, as if OASA answered with part of the network
    oasa.divert(1100);
    const held = await nextNight();
    assert.equal(held.outputs['bus-stops.json'].ok, false);
    assert.match(held.outputs['bus-stops.json'].error, /failed its checks: bus-stops\.json has 1100 stops, the last good build had 1500/);
    assert.equal(served('bus-stops.json').stops.length, 1500);

    const forced = await build({ today: '20260806', force: true });
    assert.equal(forced.outputs['bus-stops.json'].ok, true);
    assert.equal(served('bus-stops.json').stops.length, 1100);
});

test('when the portal goes down, builds go on from the last downloads', async () => {
    const { build, portal, logs } = setup();
    await build();
    portal.down();
    const meta = await build({ today: '20260806' });
    assert.ok(Object.values(meta.outputs).every(o => o.ok));
    assert.ok(logs.some(l => /fetch failed — using the copy from/.test(l)));
});

test('when the portal is down from the start, the build fails without publishing its data', async () => {
    const { build, portal, dataDir } = setup();
    portal.down();
    const meta = await build();
    assert.equal(meta.outputs['rail.json'].ok, false);
    assert.equal(meta.outputs['rail.json'].keptPrevious, false);
    assert.match(meta.outputs['rail.json'].error, /source unavailable/);
    assert.ok(!existsSync(join(dataDir, 'build', 'rail.json')));
    // The buses come from OASA's live API, not the portal
    assert.equal(meta.outputs['bus-stops.json'].ok, true);
});

test('a build waits its turn: a running build\'s lock is respected, a dead one\'s is not', async () => {
    const { build, dataDir } = setup();
    // Held by this (running) process
    writeFileSync(join(dataDir, '.build.lock'), String(process.pid));
    assert.equal(await build(), null);
    // Left behind by a process that has ended
    const ended = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(join(dataDir, '.build.lock'), String(ended));
    const meta = await build();
    assert.ok(meta.outputs['rail.json'].ok);
});

test('mistakes in the curated files stop the build before anything is downloaded', async () => {
    const { build, portal, oasa } = setup();
    const broken = railCurated();
    broken.stations.stations.a.name.en = '';
    await assert.rejects(build({ curatedDir: curatedDir(broken) }), /Curated data has errors:[\s\S]*a needs name\.el and name\.en/);
    assert.equal(portal.calls.length, 0);
    assert.equal(oasa.calls.length, 0);
});
