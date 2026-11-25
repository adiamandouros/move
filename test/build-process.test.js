import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { lastRun } from '../server/data/build-log.js';
import { runBuildInChild } from '../server/data/index.js';
import { tempDir } from './fixtures/gtfs.js';

// The server runs its data builds in a child process (runBuildInChild in
// server/data/index.js), which answers through its exit code. A held lock is
// the first thing a build checks, so this downloads and builds nothing.

const LOCK = fileURLToPath(new URL('../data/.build.lock', import.meta.url));
const BUILD = fileURLToPath(new URL('../server/data/index.js', import.meta.url));
const KEEPS_RUNNING = fileURLToPath(new URL('fixtures/keeps-running.cjs', import.meta.url));

// The lock of a running process (this one), for the length of `run`
async function holdingTheLock(t, run) {
    if (existsSync(LOCK)) return t.skip('a real build is running');
    mkdirSync(dirname(LOCK), { recursive: true });
    writeFileSync(LOCK, String(process.pid));
    try {
        await run();
    } finally {
        rmSync(LOCK, { force: true });
    }
}

test('a build started while another one runs answers "busy", and says so in its log', async t => {
    const logFile = join(tempDir('wayhop-log-'), 'build.log');
    await holdingTheLock(t, async () => assert.equal(await runBuildInChild({ offline: true, logFile }), 'busy'));
    const lines = readFileSync(logFile, 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^\S+Z {2}pid \d+ {2}rss \d+ MB {2}heap \d+ MB {2}Build started \(--offline\)$/);
    assert.match(lines[1], / {2}\[data\] Another build is running — skipping$/);
    assert.match(lines[2], / {2}Ended: busy \(another build holds the lock\) after \d+ s, most memory \d+ MB$/);
    // Not the last build the diagnostics show
    assert.equal(lastRun(logFile), null);
});

test('a build ends once it is done, even with something preloaded that would keep it running', async t => {
    // As on the host, where builds stayed running for hours (2026-10-28)
    await holdingTheLock(t, async () => {
        const run = promisify(execFile)(process.execPath, ['--require', KEEPS_RUNNING, BUILD, '--offline', `--log=${join(tempDir('wayhop-log-'), 'build.log')}`], { timeout: 10_000 });
        await assert.rejects(run, err => {
            assert.equal(err.killed, false, 'still running after 10 s');
            assert.equal(err.code, 3, 'the "busy" exit code');
            return true;
        });
    });
});
