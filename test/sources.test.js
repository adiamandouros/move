import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fetchSources, SOURCES } from '../server/data/sources.js';
import { busFeed, fakePortal, railFeed, rar, stopTable, tempDir } from './fixtures/gtfs.js';

// Fetching OASA's feeds from the open-data portal (server/data/sources.js):
// only what changed is downloaded, RAR files are unpacked, and when the
// portal fails the last downloaded copy is used.

const quiet = () => {};

// A portal offering all three datasets
function portalWithFeeds({ rarFor = [] } = {}) {
    const portal = fakePortal();
    portal.publish(SOURCES.rail.dataset, railFeed(), { rarFor });
    portal.publish(SOURCES.bus.dataset, busFeed(), { rarFor });
    portal.publishFile(SOURCES.stopTable.dataset, 'stops_all_260901.csv', readFileSync(stopTable(), 'utf8'));
    return portal;
}
const fetchAll = (portal, rawDir, options = {}) => fetchSources({ rawDir, fetch: portal.fetch, log: quiet, ...options });

test('the first time, every file is downloaded; then only what changed', async () => {
    const portal = portalWithFeeds();
    const rawDir = tempDir();
    const first = await fetchAll(portal, rawDir);
    assert.deepEqual(Object.keys(first.rail.files).sort(), ['calendar.txt', 'routes.txt', 'stop_times.txt', 'stops.txt', 'trips.txt']);
    assert.ok(existsSync(join(rawDir, 'stopTable', 'stops_all.csv')), 'the stop table, found by its changing name');
    const downloaded = portal.downloads.length;
    assert.equal(downloaded, 5 + 5 + 1);

    // Nothing new: only the portal's lists are asked for
    await fetchAll(portal, rawDir);
    assert.equal(portal.downloads.length, downloaded);

    // OASA republishes one file
    portal.publishFile(SOURCES.bus.dataset, 'stops.txt', readFileSync(join(busFeed({ stops: 1001 }), 'stops.txt'), 'utf8'), '2026-09-01T00:00:00');
    const third = await fetchAll(portal, rawDir);
    assert.deepEqual(portal.downloads.slice(downloaded), ['https://portal.example/dromologia-osy/2026-09-01T00:00:00/stops.txt']);
    assert.equal(third.bus.modified, '2026-09-01T00:00:00');
    assert.match(readFileSync(third.bus.files['stops.txt'], 'utf8'), /11000,/);
});

test('RAR files are unpacked', async () => {
    const portal = portalWithFeeds({ rarFor: ['stop_times.txt'] });
    const rawDir = tempDir();
    const result = await fetchAll(portal, rawDir);
    assert.ok(portal.downloads.some(u => u.endsWith('/stop_times.rar')));
    assert.match(readFileSync(result.bus.files['stop_times.txt'], 'utf8'), /^trip_id,arrival_time/);
    assert.ok(!existsSync(join(rawDir, 'bus', 'stop_times.txt.download')), 'the archive is cleaned up');
});

test('a RAR without the file it should hold is an error, and the last copy is used', async () => {
    const portal = portalWithFeeds();
    const rawDir = tempDir();
    await fetchAll(portal, rawDir);
    portal.remove(SOURCES.bus.dataset, 'trips.txt');
    portal.publishFile(SOURCES.bus.dataset, 'trips.rar', rar({ 'other.txt': 'x' }), '2026-09-01T00:00:00');
    const logs = [];
    const result = await fetchAll(portal, rawDir, { log: m => logs.push(m) });
    assert.ok(logs.some(l => /trips\.txt\.download does not contain trips\.txt — using the copy from/.test(l)), logs.join('\n'));
    assert.ok(result.bus.files['trips.txt'], 'the earlier trips.txt is still used');
});

test('a file dropped from the feed: optional ones are removed, required ones are an error', async () => {
    const portal = portalWithFeeds();
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

test('when the portal is down, the last downloaded copies are used', async () => {
    const portal = portalWithFeeds();
    const rawDir = tempDir();
    await fetchAll(portal, rawDir);
    portal.down();
    const logs = [];
    const result = await fetchAll(portal, rawDir, { log: m => logs.push(m) });
    for (const source of ['rail', 'bus', 'stopTable']) assert.ok(!result[source].error, `${source} has its copy`);
    assert.equal(logs.filter(l => /fetch failed — using the copy from 2026-08-01T00:00:00/.test(l)).length, 3);
});

test('when the portal is down and nothing was downloaded yet, each source reports an error', async () => {
    const portal = portalWithFeeds();
    portal.down();
    const result = await fetchAll(portal, tempDir());
    assert.deepEqual(result.rail, { error: 'fetch failed' });
    assert.deepEqual(result.bus, { error: 'fetch failed' });
});

test('a portal error page or a missing download is an error too', async () => {
    const portal = fakePortal();
    // The rail dataset doesn't exist (404); the bus one points at a file that's gone
    portal.publishFile(SOURCES.bus.dataset, 'stops.txt', 'x');
    const result = await fetchAll(portal, tempDir());
    assert.deepEqual(result.rail, { error: 'portal returned HTTP 404 for dromologia-statheron-sygkinonion' });
    assert.match(result.bus.error, /has no resource matching/);
});

test('zip files are refused with a clear message', async () => {
    const portal = portalWithFeeds();
    portal.remove(SOURCES.stopTable.dataset, 'stops_all_260901.csv');
    portal.publishFile(SOURCES.stopTable.dataset, 'stops_all.csv', 'PK', '2026-09-01T00:00:00', 'stops_all.csv.zip');
    const result = await fetchAll(portal, tempDir());
    assert.match(result.stopTable.error, /stops_all\.csv\.zip is a zip archive, which is not supported yet/);
});

test('offline, nothing is asked for and the local copies are used', async () => {
    const portal = portalWithFeeds();
    const rawDir = tempDir();
    await fetchAll(portal, rawDir);
    const asked = portal.calls.length;
    const result = await fetchAll(portal, rawDir, { offline: true });
    assert.equal(portal.calls.length, asked);
    assert.ok(result.rail.files['stops.txt']);
    assert.equal(result.rail.modified, '2026-08-01T00:00:00');
});
