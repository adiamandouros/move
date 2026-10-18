import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { runBuildInChild } from '../server/data/index.js';

// The server runs its data builds in a child process (runBuildInChild in
// server/data/index.js), which answers through its exit code. A held lock is
// the first thing a build checks, so this downloads and builds nothing.

const LOCK = fileURLToPath(new URL('../data/.build.lock', import.meta.url));

test('a build started while another one runs answers "busy"', async t => {
    if (existsSync(LOCK)) return t.skip('a real build is running');
    mkdirSync(dirname(LOCK), { recursive: true });
    // The lock of a running process (this one)
    writeFileSync(LOCK, String(process.pid));
    try {
        assert.equal(await runBuildInChild({ offline: true }), 'busy');
    } finally {
        rmSync(LOCK, { force: true });
    }
});
