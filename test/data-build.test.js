import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { builderFingerprint, runBuild } from '../server/data/index.js';
import { checkOutput } from '../server/data/check-output.js';
import { SOURCES } from '../server/data/sources.js';
import { busFeed, curatedDir, fakePortal, railCurated, railFeed, stopTable, tempDir } from './fixtures/gtfs.js';

// The whole data build (runBuild in server/data/index.js), in a folder of
// its own against a fake portal: what it publishes, when it rebuilds, and
// that a failure never replaces files the site is serving.

function setup({ busStops = 1500 } = {}) {
    const portal = fakePortal();
    portal.publish(SOURCES.rail.dataset, railFeed());
    portal.publish(SOURCES.bus.dataset, busFeed({ stops: busStops }));
    portal.publishFile(SOURCES.stopTable.dataset, 'stops_all.csv', readFileSync(stopTable(), 'utf8'));
    const dataDir = tempDir();
    const logs = [];
    const options = { dataDir, curatedDir: curatedDir(), overlayFile: join(dataDir, 'local', 'positions.json'), fetch: portal.fetch, today: '20260805', log: m => logs.push(m) };
    const build = (more = {}) => runBuild({ ...options, ...more });
    const served = name => JSON.parse(readFileSync(join(dataDir, 'build', name), 'utf8'));
    return { portal, dataDir, logs, build, served };
}

// A newer version of one bus feed file on the portal
function republishBus(portal, feedDir, name, version = '2026-09-01T00:00:00') {
    portal.publishFile(SOURCES.bus.dataset, name, readFileSync(join(feedDir, name), 'utf8'), version);
}

test('a first build publishes every file, which pass their checks', async () => {
    const { build, served, dataDir } = setup();
    const meta = await build();
    assert.deepEqual(Object.fromEntries(Object.entries(meta.outputs).map(([k, o]) => [k, o.ok])), { 'rail.json': true, 'bus-stops.json': true, 'bus-lines.json': true });
    assert.deepEqual(checkOutput('rail.json', served('rail.json')), []);
    assert.deepEqual(checkOutput('bus-stops.json', served('bus-stops.json')), []);
    assert.deepEqual(checkOutput('bus-lines.json', served('bus-lines.json')), []);
    assert.deepEqual(served('bus-lines.json').lines.map(l => l.line), ['040']);
    assert.equal(served('bus-stops.json').stops.length, 1500);
    assert.deepEqual(served('meta.json').fingerprint.today, '20260805');
    for (const leftover of ['build.next', '.build.lock']) assert.ok(!existsSync(join(dataDir, leftover)), `${leftover} is cleaned up`);
});

test('nothing changed: no rebuild; a new day: rebuilt without downloading', async () => {
    const { build, portal, logs } = setup();
    const first = await build();
    const downloads = portal.downloads.length;

    const again = await build();
    assert.equal(again.generated, first.generated);
    assert.ok(logs.includes('[data] Build is up to date'));
    assert.equal(portal.downloads.length, downloads);

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

test('a new feed is downloaded and built, and the replaced files are kept in build.prev', async () => {
    const { build, portal, served, dataDir } = setup();
    await build();
    const newer = busFeed({ stops: 1600 });
    for (const name of ['stops.txt', 'stop_times.txt']) republishBus(portal, newer, name);
    const meta = await build();
    assert.equal(meta.outputs['bus-stops.json'].ok, true);
    assert.equal(served('bus-stops.json').stops.length, 1600);
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'build.prev', 'bus-stops.json'), 'utf8')).stops.length, 1500);
    assert.equal(meta.fingerprint.sources.bus, '2026-09-01T00:00:00');
});

test('a broken new feed keeps the files the site serves', async () => {
    const { build, portal, served } = setup();
    await build();
    const before = served('bus-stops.json');
    // OASA publishes a stops.txt without coordinates
    portal.publishFile(SOURCES.bus.dataset, 'stops.txt', 'stop_id,stop_name\n10000,Α\n', '2026-09-01T00:00:00');
    const meta = await build();
    assert.equal(meta.outputs['bus-stops.json'].ok, false);
    assert.equal(meta.outputs['bus-stops.json'].keptPrevious, true);
    assert.match(meta.outputs['bus-stops.json'].error, /stop_lat/);
    assert.deepEqual(served('bus-stops.json'), before);
    // The lines come from the same feed: kept too
    assert.equal(meta.outputs['bus-lines.json'].ok, false);
    assert.equal(meta.outputs['bus-lines.json'].keptPrevious, true);
    assert.deepEqual(served('bus-lines.json').lines.map(l => l.line), ['040']);
    assert.equal(meta.outputs['rail.json'].ok, true, 'the other file is unaffected');
});

test('a feed that suddenly shrinks is held back, unless forced', async () => {
    const { build, portal, served } = setup();
    await build();
    // 1100 stops after 1500: under 80%, as if OASA published part of the feed
    const partial = busFeed({ stops: 1100 });
    for (const name of ['stops.txt', 'stop_times.txt']) republishBus(portal, partial, name);
    const held = await build();
    assert.equal(held.outputs['bus-stops.json'].ok, false);
    assert.match(held.outputs['bus-stops.json'].error, /failed its checks: bus-stops\.json has 1100 stops, the last good build had 1500/);
    assert.equal(served('bus-stops.json').stops.length, 1500);

    const forced = await build({ force: true });
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

test('when the portal is down from the start, the build fails without publishing data', async () => {
    const { build, portal, dataDir } = setup();
    portal.down();
    const meta = await build();
    for (const output of Object.values(meta.outputs)) {
        assert.equal(output.ok, false);
        assert.equal(output.keptPrevious, false);
        assert.match(output.error, /source unavailable/);
    }
    assert.ok(!existsSync(join(dataDir, 'build', 'rail.json')));
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
    const { build, portal } = setup();
    const broken = railCurated();
    broken.stations.stations.a.name.en = '';
    await assert.rejects(build({ curatedDir: curatedDir(broken) }), /Curated data has errors:[\s\S]*a needs name\.el and name\.en/);
    assert.equal(portal.calls.length, 0);
});
