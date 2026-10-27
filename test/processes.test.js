import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { accountChecks } from '../server/diagnostics.js';
import { createHealth } from '../server/health.js';
import { accountStatus, copiesBefore, createProcessGuard, readProcesses, STALE_MS, THREAD_LIMIT } from '../server/processes.js';
import { stopOldCopies } from '../scripts/stop-old-copies.js';

// The hosting account's processes (server/processes.js): reading /proc,
// finding the apps' old copies, the running app stopping its own, the deploy
// stopping those from before it, and what the health page and the
// diagnostics say. /proc is a folder of fake files here.

const BOOT = Date.parse('2026-10-27T00:00:00Z');
const UID = 1001;
const APP = '/home/me/wayhop.example';
const OTHER = '/home/me/other.example';
const MINUTE = 60_000;

// procs: [{ pid, ppid?, uid?, threads?, at (ms after boot), cmd, cwd? }]
function fakeProc(procs) {
    const dir = mkdtempSync(join(tmpdir(), 'proc-'));
    writeFileSync(join(dir, 'stat'), `cpu  1 2 3\nbtime ${BOOT / 1000}\nprocesses 99\n`);
    mkdirSync(join(dir, 'self'));
    for (const p of procs) write(dir, p);
    return dir;
}

function write(dir, { pid, ppid = 1, uid = UID, threads = 11, at, cmd, cwd = null }) {
    const d = join(dir, String(pid));
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d);
    writeFileSync(join(d, 'status'), `Name:\tnode\nPPid:\t${ppid}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nThreads:\t${threads}\n`);
    // A command name with a space and a bracket, as /proc may show one
    const ticks = at / 10;
    writeFileSync(join(d, 'stat'), `${pid} (node (x) y) S ${ppid} ${Array.from({ length: 17 }, () => 0).join(' ')} ${ticks} 0 0\n`);
    writeFileSync(join(d, 'cmdline'), `${cmd.split(' ').join('\0')}\0`);
    if (cwd) symlinkSync(cwd, join(d, 'cwd'));
}

const lsnode = (pid, at, dir = APP, extra = {}) => ({ pid, at, cmd: `lsnode:${dir}/`, cwd: dir, ...extra });

test('reads each process: parent, user, threads, start time, command and folder', () => {
    const proc = fakeProc([lsnode(200, 90 * MINUTE, APP, { ppid: 7, threads: 12 }), { pid: 300, at: 1000, cmd: 'bash -l' }]);
    writeFileSync(join(proc, 'not-a-pid'), '');
    const [app, bash] = readProcesses(proc).sort((a, b) => a.pid - b.pid);
    assert.deepEqual(app, { pid: 200, ppid: 7, uid: UID, threads: 12, started: BOOT + 90 * MINUTE, cmd: `lsnode:${APP}/`, cwd: APP });
    assert.equal(bash.cmd, 'bash -l');
    assert.equal(bash.cwd, null, 'a folder that can\'t be read');
});

test('a process that ends while being read is left out', () => {
    const proc = fakeProc([lsnode(200, 0)]);
    mkdirSync(join(proc, '201'));
    assert.deepEqual(readProcesses(proc).map(p => p.pid), [200]);
});

test('groups the account\'s apps by folder, and marks copies well older than the newest', () => {
    const proc = fakeProc([
        lsnode(100, 0),
        lsnode(110, STALE_MS - MINUTE),
        lsnode(120, STALE_MS + 5 * MINUTE),
        // A data build the newest copy started: its threads count for that copy
        { pid: 121, ppid: 120, threads: 7, at: STALE_MS + 6 * MINUTE, cmd: 'node server/data/index.js', cwd: APP },
        // Started by a copy itself: part of it, not another copy
        lsnode(122, STALE_MS + 6 * MINUTE, APP, { ppid: 120, threads: 1 }),
        lsnode(200, 0, OTHER),
        { pid: 300, threads: 1, at: 0, cmd: 'bash' },
        // Another user's processes (off the host, where /proc shows them)
        lsnode(400, 0, '/home/else/site', { uid: 5, threads: 50 }),
    ]);
    const account = accountStatus(readProcesses(proc), UID);
    assert.equal(account.threads, 11 * 4 + 7 + 1 + 1);
    assert.equal(account.limit, THREAD_LIMIT);
    const [other, app] = account.apps.sort((a, b) => a.dir.localeCompare(b.dir));
    assert.equal(other.dir, OTHER);
    assert.deepEqual(other.copies.map(c => c.stale), [false]);
    assert.equal(app.dir, APP);
    assert.deepEqual(app.copies.map(c => [c.pid, c.threads, c.stale]), [[100, 11, true], [110, 11, false], [120, 11 + 7 + 1, false]]);
    assert.equal(app.threads, 11 + 11 + 19);
});

test('without a folder to read, an app is known by the one its name gives', () => {
    const proc = fakeProc([{ pid: 100, at: 0, cmd: `lsnode:${APP}/` }, lsnode(101, 1000)]);
    assert.deepEqual(accountStatus(readProcesses(proc), UID).apps.map(a => [a.dir, a.copies.length]), [[APP, 2]]);
});

// Signals sent, and processes that end on SIGTERM (or ignore it)
function signals(proc, { ignore = [] } = {}) {
    const sent = [];
    const kill = (pid, signal) => {
        sent.push([pid, signal]);
        if (signal === 'SIGKILL' || !ignore.includes(pid)) rmSync(join(proc, String(pid)), { recursive: true });
    };
    return { sent, kill };
}

test('the newest copy stops the stale ones: SIGTERM, then SIGKILL for one still running', async () => {
    const proc = fakeProc([lsnode(100, 0), lsnode(101, MINUTE), lsnode(110, STALE_MS + 2 * MINUTE), lsnode(120, STALE_MS + 5 * MINUTE), lsnode(200, 0, OTHER)]);
    const { sent, kill } = signals(proc, { ignore: [101] });
    const logged = [];
    const guard = createProcessGuard({ procDir: proc, uid: UID, pid: 120, kill, wait: 1, log: m => logged.push(m) });
    assert.deepEqual(await guard.tidy(), [100, 101]);
    assert.deepEqual(sent, [[100, 'SIGTERM'], [101, 'SIGTERM'], [101, 'SIGKILL']]);
    assert.match(logged.join(), /Stopping 2 old copies of this app: 100 \(started 2026-10-27T00:00:00\.000Z\), 101/);
    assert.deepEqual(readProcesses(proc).map(p => p.pid).sort(), [110, 120, 200], 'another app\'s copies are left alone');
    assert.deepEqual(await guard.tidy(), [], 'nothing more to stop');
});

test('a process given a stopped copy\'s pid is not killed', async () => {
    const proc = fakeProc([lsnode(100, 0), lsnode(120, STALE_MS)]);
    const sent = [];
    // Copy 100 ends on SIGTERM, and something new gets its pid
    const kill = (pid, signal) => { sent.push(signal); write(proc, lsnode(100, STALE_MS + MINUTE)); };
    await createProcessGuard({ procDir: proc, uid: UID, pid: 120, kill, wait: 1, log: () => {} }).tidy();
    assert.deepEqual(sent, ['SIGTERM']);
});

test('only the newest copy, and only one LiteSpeed runs, stops anything', async () => {
    const proc = fakeProc([lsnode(100, 0), lsnode(120, STALE_MS), { pid: 130, at: STALE_MS * 2, cmd: 'node server.js', cwd: APP }]);
    const { sent, kill } = signals(proc);
    for (const pid of [100, 130, 999]) {
        assert.deepEqual(await createProcessGuard({ procDir: proc, uid: UID, pid, kill, wait: 1 }).tidy(), [], `pid ${pid}`);
    }
    assert.deepEqual(sent, []);
});

test('started, the guard tidies up at once (and every few minutes), logging what fails', async () => {
    const proc = fakeProc([lsnode(100, 0), lsnode(120, STALE_MS)]);
    const logged = [];
    // /proc can't be read by the time it checks whether copy 100 ended
    const kill = () => rmSync(join(proc, 'stat'));
    createProcessGuard({ procDir: proc, uid: UID, pid: 120, kill, wait: 1, log: m => logged.push(m) }).start();
    await new Promise(done => setTimeout(done, 50));
    assert.equal(logged.length, 2, logged.join('\n'));
    assert.match(logged[0], /Stopping 1 old copy of this app: 100/);
    assert.match(logged[1], /^\[processes\] ENOENT/);
});

test('status is null off the host, and without a /proc at all', () => {
    assert.equal(createProcessGuard({ procDir: fakeProc([{ pid: 1, at: 0, cmd: 'init' }]), uid: UID }).status(), null);
    assert.equal(createProcessGuard({ procDir: join(tmpdir(), 'no-such-proc'), uid: UID }).status(), null);
    assert.equal(createProcessGuard({ procDir: fakeProc([lsnode(100, 0)]), uid: UID }).status().apps.length, 1);
});

test('the deploy stops every copy from before the restart, whatever its age', async () => {
    const proc = fakeProc([lsnode(100, 0), lsnode(110, 5 * MINUTE), lsnode(120, 8 * MINUTE), lsnode(200, 0, OTHER)]);
    const before = BOOT + 6 * MINUTE;
    assert.deepEqual(copiesBefore({ dir: `${APP}/`, before, uid: UID, procDir: proc }).map(c => c.pid), [100, 110]);
    assert.deepEqual(copiesBefore({ dir: '/home/me/nothing', before, uid: UID, procDir: proc }), []);
    const { sent, kill } = signals(proc);
    const logged = [];
    assert.deepEqual(await stopOldCopies({ dir: APP, before, uid: UID, procDir: proc, kill, wait: 1, log: m => logged.push(m) }), [100, 110]);
    assert.deepEqual(sent, [[100, 'SIGTERM'], [110, 'SIGTERM']]);
    assert.match(logged[0], /Stopping 2 copies from before the restart: 100, 110/);
    assert.deepEqual(await stopOldCopies({ dir: APP, before, uid: UID, procDir: proc, kill, wait: 1, log: m => logged.push(m) }), []);
    assert.match(logged[1], /No copies left/);
});

test('the deploy script stops old copies after restarting the app', () => {
    // The script in an app folder of its own, with a stand-in for CloudLinux's tool
    const home = mkdtempSync(join(tmpdir(), 'deploy-'));
    const app = join(home, 'app');
    const bin = join(home, 'bin');
    for (const d of ['scripts', 'server', '../bin']) mkdirSync(join(app, d), { recursive: true });
    for (const f of ['scripts/cpanel-deploy.sh', 'scripts/stop-old-copies.js', 'server/processes.js']) copyFileSync(f, join(app, f));
    writeFileSync(join(bin, 'cloudlinux-selector'), `#!/bin/sh\necho "selector $1" >> "${home}/calls"\n`);
    chmodSync(join(bin, 'cloudlinux-selector'), 0o755);
    const out = execFileSync('bash', [join(app, 'scripts/cpanel-deploy.sh')], {
        env: { HOME: home, PATH: `${bin}:${join(process.execPath, '..')}:/usr/bin:/bin` }, encoding: 'utf8',
    });
    assert.match(out, /No copies left from before the restart\n\[deploy\] Done\./);
});

// What the health page and the diagnostics make of it
const account = (threads, apps) => ({ threads, limit: THREAD_LIMIT, apps });
const copy = (pid, stale = false) => ({ pid, started: BOOT, threads: 11, stale });

test('the health page warns near the thread limit and about old copies, naming no folder', async () => {
    const health = processes => createHealth({ busStatus: () => ({ routes: [] }), announcementStatus: () => ({}), buildDir: mkdtempSync(join(tmpdir(), 'b-')), processes }).check();
    assert.equal((await health(() => null)).server, null);
    const fine = await health(() => account(44, [{ dir: APP, threads: 11, copies: [copy(1)] }]));
    assert.deepEqual(fine.server, { ok: true, threads: 44, limit: THREAD_LIMIT, appsWithOldCopies: 0 });
    assert.doesNotMatch(fine.problems.join(), /Server/);
    const busy = await health(() => account(74, [{ dir: APP, threads: 22, copies: [copy(1, true), copy(2)] }, { dir: OTHER, threads: 11, copies: [copy(3)] }]));
    assert.equal(busy.server.ok, false);
    const server = busy.problems.filter(p => p.startsWith('Server'));
    assert.match(server[0], /runs 74 of its 100 threads/);
    assert.match(server[1], /1 app has old copies still running/);
    assert.doesNotMatch(server.join(), /example/);
});

test('the diagnostics show the threads and each app, with the pids to stop', () => {
    assert.deepEqual(accountChecks(null), []);
    const [threads, app, other] = accountChecks(account(74, [
        { dir: APP, threads: 11, copies: [copy(1)] },
        { dir: OTHER, threads: 22, copies: [copy(5, true), copy(6)] },
    ]));
    assert.deepEqual([threads.status, threads.detail], ['warn', '74 of the 100 the account may run at once']);
    assert.match(threads.hint, /nothing new can start/);
    assert.deepEqual([app.title, app.status, app.detail], ['wayhop.example', 'ok', '1 copy, 11 threads, running since 2026-10-27 00:00 UTC']);
    assert.deepEqual([other.title, other.status], ['other.example', 'warn']);
    assert.match(other.detail, /2 copies, 22 threads; 1 left over from before a restart: 5 \(since 2026-10-27 00:00 UTC\)/);
    assert.match(other.hint, /kill 5$/);
    assert.equal(accountChecks(account(90, []))[0].status, 'fail');
    assert.equal(accountChecks(account(40, []))[0].status, 'ok');
});
