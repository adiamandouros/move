import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fetchSources, SOURCES } from '../server/data/sources.js';
import { fakePortal, railFeed, tempDir } from './fixtures/gtfs.js';

// Fetching the metro and tram timetable from OASA's open-data portal
// (server/data/sources.js): only what changed is downloaded, archives are
// refused, and when the portal fails the last downloaded copy is used.

const quiet = () => {};

// A portal offering the metro and tram timetable
function portalWithFeed() {
    const portal = fakePortal();
    portal.publish(SOURCES.rail.dataset, railFeed());
    return portal;
}
const fetchAll = (portal, rawDir, options = {}) => fetchSources({ rawDir, fetch: portal.fetch, log: quiet, ...options });

test('only the metro and tram timetable is fetched: the buses come from the live API', () => {
    assert.deepEqual(Object.keys(SOURCES), ['rail']);
});

test('the first time, every file is downloaded; then only what changed', async () => {
    const portal = portalWithFeed();
    const rawDir = tempDir();
    const first = await fetchAll(portal, rawDir);
    assert.deepEqual(Object.keys(first.rail.files).sort(), ['calendar.txt', 'routes.txt', 'stop_times.txt', 'stops.txt', 'trips.txt']);
    const downloaded = portal.downloads.length;
    assert.equal(downloaded, 5);

    // Nothing new: only the portal's list is asked for
    await fetchAll(portal, rawDir);
    assert.equal(portal.downloads.length, downloaded);

    // OASA republishes one file
    const stops = readFileSync(join(rawDir, 'rail', 'stops.txt'), 'utf8');
    portal.publishFile(SOURCES.rail.dataset, 'stops.txt', `${stops}9,Q1,37.1,23.1\n`, '2026-09-01T00:00:00');
    const third = await fetchAll(portal, rawDir);
    assert.deepEqual(portal.downloads.slice(downloaded), ['https://portal.example/dromologia-statheron-sygkinonion/2026-09-01T00:00:00/stops.txt']);
    assert.equal(third.rail.modified, '2026-09-01T00:00:00');
    assert.match(readFileSync(third.rail.files['stops.txt'], 'utf8'), /9,Q1,/);
});

test('a file that comes as an archive is refused before it is downloaded, and the last copy is used', async () => {
    const portal = portalWithFeed();
    const rawDir = tempDir();
    await fetchAll(portal, rawDir);
    for (const [kind, name] of [['rar', 'stop_times.rar'], ['zip', 'stop_times.zip']]) {
        portal.remove(SOURCES.rail.dataset, 'stop_times.txt');
        portal.remove(SOURCES.rail.dataset, 'stop_times.rar');
        portal.publishFile(SOURCES.rail.dataset, name, 'archive', `2026-09-0${kind === 'rar' ? 1 : 2}T00:00:00`);
        const logs = [];
        const result = await fetchAll(portal, rawDir, { log: m => logs.push(m) });
        assert.ok(logs.some(l => new RegExp(`${name.replace('.', '\\.')} is a ${kind} archive, which is not supported — using the copy from`).test(l)), logs.join('\n'));
        assert.ok(!portal.downloads.some(u => u.endsWith(`/${name}`)), 'not downloaded');
        assert.match(readFileSync(result.rail.files['stop_times.txt'], 'utf8'), /^trip_id,/, 'the earlier stop_times.txt is still used');
    }
});

test('a file dropped from the feed: optional ones are removed, required ones are an error', async () => {
    const portal = portalWithFeed();
    const rawDir = tempDir();
    await fetchAll(portal, rawDir);

    portal.remove(SOURCES.rail.dataset, 'calendar.txt');
    const result = await fetchAll(portal, rawDir);
    assert.equal(result.rail.files['calendar.txt'], undefined);
    assert.ok(!existsSync(join(rawDir, 'rail', 'calendar.txt')), 'not used by mistake');

    // A required file gone from the portal: the last download is used
    portal.remove(SOURCES.rail.dataset, 'stops.txt');
    const logs = [];
    const again = await fetchAll(portal, rawDir, { log: m => logs.push(m) });
    assert.ok(again.rail.files['stops.txt']);
    assert.ok(logs.some(l => /has no resource matching .*stops.* — using the copy from/.test(l)), logs.join('\n'));
});

test('when the portal is down, the last downloaded copy is used', async () => {
    const portal = portalWithFeed();
    const rawDir = tempDir();
    await fetchAll(portal, rawDir);
    portal.down();
    const logs = [];
    const result = await fetchAll(portal, rawDir, { log: m => logs.push(m) });
    assert.ok(!result.rail.error, 'the timetable has its copy');
    assert.equal(logs.filter(l => /fetch failed — using the copy from 2026-08-01T00:00:00/.test(l)).length, 1);
});

test('when the portal is down and nothing was downloaded yet, the source reports an error', async () => {
    const portal = portalWithFeed();
    portal.down();
    const result = await fetchAll(portal, tempDir());
    assert.deepEqual(result.rail, { error: 'fetch failed' });
});

test('a portal error page or a missing download is an error too', async () => {
    // The dataset doesn't exist (404)
    const result = await fetchAll(fakePortal(), tempDir());
    assert.deepEqual(result.rail, { error: 'portal returned HTTP 404 for dromologia-statheron-sygkinonion' });

    // A required file isn't offered
    const portal = fakePortal();
    portal.publishFile(SOURCES.rail.dataset, 'stops.txt', 'x');
    assert.match((await fetchAll(portal, tempDir())).rail.error, /has no resource matching/);
});

test('offline, nothing is asked for and the local copies are used', async () => {
    const portal = portalWithFeed();
    const rawDir = tempDir();
    await fetchAll(portal, rawDir);
    const asked = portal.calls.length;
    const result = await fetchAll(portal, rawDir, { offline: true });
    assert.equal(portal.calls.length, asked);
    assert.ok(result.rail.files['stops.txt']);
    assert.equal(result.rail.modified, '2026-08-01T00:00:00');
});
