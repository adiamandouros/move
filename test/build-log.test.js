import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createBuildLog, endedBySignal, lastRun } from '../server/data/build-log.js';
import { tempDir } from './fixtures/gtfs.js';

// The data build's own log (server/data/build-log.js): what a build writes,
// and how the diagnostics read the last build back out of it.

const MB = 1024 * 1024;
const T0 = Date.parse('2026-11-25T02:30:00Z');

// A log with a clock and memory the test moves
function fakeLog({ file = join(tempDir('wayhop-log-'), 'build.log'), pid = 41, args = [], maxBytes } = {}) {
    const state = { now: T0, rss: 100 * MB, heap: 40 * MB, peak: 300 * MB };
    const log = createBuildLog({
        file, pid, args, maxBytes, now: () => state.now,
        memory: () => ({ rss: state.rss, heapUsed: state.heap }), peak: () => state.peak,
    });
    return { log, state, file, lines: () => readFileSync(file, 'utf8').trimEnd().split('\n') };
}

test('each line has the time, the pid and the memory; a build says when it started and how it ended', () => {
    const { log, state, lines } = fakeLog({ args: ['--offline'] });
    state.now += 5_000; state.rss = 180 * MB; state.heap = 90 * MB;
    log.write('Step: rail.json');
    state.now += 7_000;
    log.end('done');
    assert.deepEqual(lines(), [
        '2026-11-25T02:30:00.000Z  pid 41  rss 100 MB  heap 40 MB  Build started (--offline)',
        '2026-11-25T02:30:05.000Z  pid 41  rss 180 MB  heap 90 MB  Step: rail.json',
        '2026-11-25T02:30:12.000Z  pid 41  rss 180 MB  heap 90 MB  Ended: done after 12 s, most memory 300 MB',
    ]);
});

test('a message of several lines keeps the time and memory on each', () => {
    const { log, lines } = fakeLog();
    log.write('Curated data has errors:\n  one\n  two');
    assert.deepEqual(lines().slice(1).map(l => l.split('MB  ').at(-1)), ['Curated data has errors:', '  one', '  two']);
});

test('a log grown too big moves aside as the next build starts, one older log kept', () => {
    const file = join(tempDir('wayhop-log-'), 'build.log');
    writeFileSync(file, 'x'.repeat(2000));
    const { lines } = fakeLog({ file, maxBytes: 1000 });
    assert.equal(readFileSync(`${file}.1`, 'utf8'), 'x'.repeat(2000));
    assert.equal(lines().length, 1);
    // Under the limit, it stays
    fakeLog({ file, maxBytes: 1000 });
    assert.equal(readFileSync(`${file}.1`, 'utf8'), 'x'.repeat(2000));
    assert.equal(lines().length, 2);
});

test('a log that can\'t be written never stops the build', () => {
    const { log } = fakeLog({ file: join(tempDir('wayhop-log-'), 'no-such-folder', 'build.log') });
    log.write('Step: rail.json');
    log.end('done');
});

test('the last build: how it ended, its steps and the most memory a line showed', () => {
    const { log, state, file } = fakeLog();
    log.write('Step: rail.json');
    state.rss = 607 * MB;
    log.write('Step: buses.json');
    state.rss = 200 * MB;
    log.end('done');
    const run = lastRun(file);
    assert.equal(run?.pid, 41);
    assert.equal(run?.started, T0);
    assert.equal(run?.mostRss, 607);
    assert.match(run?.end?.message ?? '', /^Ended: done/);
    assert.equal(run?.lines.length, 4);
});

test('a build still running, or stopped without a word, has no end', () => {
    const { log, state, file } = fakeLog();
    state.now += 60_000;
    log.write('Still running');
    const run = lastRun(file);
    assert.equal(run?.end, null);
    assert.equal(run?.last.message, 'Still running');
    assert.equal(run?.last.at, T0 + 60_000);
});

test('a build turned away as busy is skipped, even with its lines among the running build\'s', () => {
    const file = join(tempDir('wayhop-log-'), 'build.log');
    const running = fakeLog({ file, pid: 7 });
    running.log.write('Step: OASA\'s bus network');
    const busy = fakeLog({ file, pid: 8 });
    busy.log.end('busy (another build holds the lock)');
    running.log.write('Step: rail.json');
    const run = lastRun(file);
    assert.equal(run?.pid, 7);
    assert.equal(run?.end, null);
    assert.equal(run?.last.message, 'Step: rail.json');
});

test('the server notes a build stopped by a signal, with no memory of its own', () => {
    const { log, state, file } = fakeLog({ pid: 9 });
    state.rss = 500 * MB;
    log.write('Step: rail.json');
    endedBySignal(file, 9, 'SIGKILL', T0 + 3_600_000);
    const run = lastRun(file);
    assert.equal(run?.end?.message, 'Ended: stopped by SIGKILL (seen by the server)');
    assert.equal(run?.end?.rss, null);
    assert.equal(run?.mostRss, 500);
});

test('a pid used again later is another build', () => {
    const file = join(tempDir('wayhop-log-'), 'build.log');
    fakeLog({ file, pid: 5 }).log.end('done');
    const second = fakeLog({ file, pid: 5 });
    second.log.write('Step: rail.json');
    const run = lastRun(file);
    assert.equal(run?.end, null);
    assert.equal(run?.lines.length, 2);
});

test('no log yet', () => {
    const file = join(tempDir('wayhop-log-'), 'build.log');
    assert.equal(existsSync(file), false);
    assert.equal(lastRun(file), null);
});
