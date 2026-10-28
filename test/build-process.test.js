import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { runBuildInChild } from '../server/data/index.js';

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

test('a build started while another one runs answers "busy"', async t => {
    await holdingTheLock(t, async () => assert.equal(await runBuildInChild({ offline: true }), 'busy'));
});

test('a build ends once it is done, even with something preloaded that would keep it running', async t => {
    // As on the host, where builds stayed running for hours (2026-10-28)
    await holdingTheLock(t, async () => {
        const run = promisify(execFile)(process.execPath, ['--require', KEEPS_RUNNING, BUILD, '--offline'], { timeout: 10_000 });
        await assert.rejects(run, err => {
            assert.equal(err.killed, false, 'still running after 10 s');
            assert.equal(err.code, 3, 'the "busy" exit code');
            return true;
        });
    });
});
