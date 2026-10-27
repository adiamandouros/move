import { readdirSync, readFileSync, readlinkSync } from 'fs';
import { join } from 'path';
import { setTimeout as sleep } from 'timers/promises';

// The hosting account's processes. CloudLinux lets the account run
// THREAD_LIMIT threads at once, all its processes together, and each Node app
// takes about 11. Past the limit nothing new can start: not cPanel's Node.js
// page, not a deploy, not even a shell. Twice (2026-10-15, 2026-10-27) old
// copies of apps, left running after restarts, used it up.
//
// LiteSpeed runs each app as a process named "lsnode:<app folder>", so the
// copies of one app are the lsnode processes in one folder. Two copies may
// run at once for a while (a restart, or LiteSpeed starting one more under
// load); one STALE_MS older than the newest is left over from before a
// restart. The running app stops its own (createProcessGuard), the deploy
// stops those from before it (scripts/stop-old-copies.js), and
// /api/health and /admin/diagnostics report the rest.

export const THREAD_LIMIT = 100;
export const THREADS_WARN = 70;
export const STALE_MS = 10 * 60_000;
const GUARD_EVERY_MS = 5 * 60_000;
// SIGTERM, then SIGKILL for a copy still running this much later
const STOP_WAIT_MS = 10_000;

const LSNODE = /^lsnode:/;
// /proc counts start times in these ticks on every Linux
const USER_HZ = 100;

/**
 * Every process /proc shows (on the host, CageFS shows only the account's own)
 * @param {string} [procDir]
 * @returns {{ pid: number, ppid: number, uid: number, threads: number, started: number, cmd: string, cwd: string | null }[]}
 *   started: ms since 1970; cwd: null where it can't be read
 */
export function readProcesses(procDir = '/proc') {
    const btime = Number(/^btime (\d+)$/m.exec(readFileSync(join(procDir, 'stat'), 'utf8'))?.[1] ?? 0);
    const out = [];
    for (const name of readdirSync(procDir)) {
        if (!/^\d+$/.test(name)) continue;
        const dir = join(procDir, name);
        try {
            const status = readFileSync(join(dir, 'status'), 'utf8');
            const field = key => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(status)?.[1]);
            // The fields after the command name in brackets (which may hold
            // spaces and brackets itself), from the 3rd; the start time is the 22nd
            const stat = readFileSync(join(dir, 'stat'), 'utf8');
            const startTicks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
            let cwd = null;
            try { cwd = readlinkSync(join(dir, 'cwd')); } catch { /* another user's */ }
            out.push({
                pid: Number(name), ppid: field('PPid'), uid: field('Uid'), threads: field('Threads'),
                started: (btime + startTicks / USER_HZ) * 1000,
                cmd: readFileSync(join(dir, 'cmdline'), 'utf8').split('\0').join(' ').trim(),
                cwd,
            });
        } catch { /* ended while being read */ }
    }
    return out;
}

const appDir = p => (p.cwd ?? p.cmd.replace(LSNODE, '')).replace(/(.)\/+$/, '$1');

// Map.groupBy, which Node 20 doesn't have
function groupBy(list, key) {
    const groups = new Map();
    for (const item of list) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
    return groups;
}

/**
 * The account's threads and the apps LiteSpeed runs for it, oldest copy first.
 * A copy's threads include those of the processes it started (a data build).
 * @param {ReturnType<typeof readProcesses>} processes @param {number} uid
 */
export function accountStatus(processes, uid) {
    const own = processes.filter(p => p.uid === uid);
    const children = groupBy(own, p => p.ppid);
    const threadsOf = p => p.threads + (children.get(p.pid) ?? []).reduce((sum, c) => sum + threadsOf(c), 0);
    const lsnode = own.filter(p => LSNODE.test(p.cmd));
    const ids = new Set(lsnode.map(p => p.pid));
    // An lsnode process an lsnode process started is part of that copy
    const copies = groupBy(lsnode.filter(p => !ids.has(p.ppid)), appDir);
    const apps = [...copies].map(([dir, list]) => {
        const newest = Math.max(...list.map(c => c.started));
        const shown = list.sort((a, b) => a.started - b.started)
            .map(c => ({ pid: c.pid, started: c.started, threads: threadsOf(c), stale: newest - c.started >= STALE_MS }));
        return { dir, threads: shown.reduce((sum, c) => sum + c.threads, 0), copies: shown };
    });
    return { threads: own.reduce((sum, p) => sum + p.threads, 0), limit: THREAD_LIMIT, apps };
}

/**
 * SIGTERM, then SIGKILL for any still running after `wait` ms (checked by
 * pid and start time, so a new process given the same pid is left alone)
 * @param {{ pid: number, started: number }[]} copies
 * @param {{ procDir?: string, kill?: (pid: number, signal: string) => void, wait?: number }} [options]
 */
export async function stopProcesses(copies, { procDir = '/proc', kill = (pid, signal) => process.kill(pid, signal), wait = STOP_WAIT_MS } = {}) {
    if (!copies.length) return;
    const send = (pid, signal) => { try { kill(pid, signal); } catch { /* already gone */ } };
    for (const c of copies) send(c.pid, 'SIGTERM');
    await sleep(wait);
    const running = readProcesses(procDir);
    for (const c of copies) {
        if (running.some(p => p.pid === c.pid && p.started === c.started)) send(c.pid, 'SIGKILL');
    }
}

/**
 * The copies of the app in `dir` that started before `before` (ms), for the
 * deploy: everything from before the restart
 * @param {{ dir: string, before: number, uid: number, procDir?: string }} options
 */
export function copiesBefore({ dir, before, uid, procDir = '/proc' }) {
    const app = accountStatus(readProcesses(procDir), uid).apps.find(a => a.dir === dir.replace(/(.)\/+$/, '$1'));
    return app?.copies.filter(c => c.started < before) ?? [];
}

/**
 * Watches the account from inside the running app: status() for the health
 * page and the diagnostics, and start() to stop this app's stale copies every
 * GUARD_EVERY_MS. Only the newest copy stops any, so two copies never stop
 * each other. Reading /proc starts no process, so this works even when the
 * account is at its limit.
 * @param {{ procDir?: string, uid?: number, pid?: number, kill?: (pid: number, signal: string) => void, wait?: number, log?: (message: string) => void }} [options]
 */
export function createProcessGuard({ procDir = '/proc', uid = process.getuid?.() ?? -1, pid = process.pid, kill, wait, log = console.warn } = {}) {
    const read = () => {
        try { return readProcesses(procDir); } catch { return []; }
    };

    // null where LiteSpeed runs no app for this account (anywhere but the host)
    function status() {
        const account = accountStatus(read(), uid);
        return account.apps.length ? account : null;
    }

    // → the pids it stopped
    async function tidy() {
        const processes = read();
        const self = processes.find(p => p.pid === pid);
        if (!self || !LSNODE.test(self.cmd)) return [];
        const app = accountStatus(processes, uid).apps.find(a => a.dir === appDir(self));
        if (!app || app.copies.at(-1).pid !== pid) return [];
        const stale = app.copies.filter(c => c.stale);
        if (!stale.length) return [];
        log(`[processes] Stopping ${stale.length} old cop${stale.length === 1 ? 'y' : 'ies'} of this app: ${stale.map(c => `${c.pid} (started ${new Date(c.started).toISOString()})`).join(', ')}`);
        await stopProcesses(stale, { procDir, kill, wait });
        return stale.map(c => c.pid);
    }

    function start() {
        const run = () => tidy().catch(err => log(`[processes] ${err.message}`));
        run();
        setInterval(run, GUARD_EVERY_MS).unref();
    }

    return { status, tidy, start };
}
