import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'fs';

// The data build's own log file (data/local/build.log). On the host a build's
// progress lines go nowhere (LiteSpeed sends stdout to /dev/null and stderr
// to stderr.log with no times), so on 9 Nov a build that hung while the
// account sat at its memory limit left no trace of where it stopped. Each
// build writes here, synchronously so a hang still leaves every line on disk:
// when it started, each step, a line a minute while it runs, how it ended,
// each line with the time, the build's pid and its memory.
//
// A line: `2026-11-25T02:30:01.123Z  pid 1234  rss 173 MB  heap 80 MB  message`.
// A line the server writes for a build it saw stopped from outside has no
// memory (it isn't the build's). Two builds can write at once (one finds the
// other's lock and ends "busy"), so lines are grouped by pid, not by order.

// Over this, the log moves to build.log.1 as the next build starts (one older log kept)
const BUILD_LOG_MAX_BYTES = 512 * 1024;
const HEARTBEAT_MS = 60_000;
const STARTED = 'Build started';
const ENDED = 'Ended:';
const BUSY = `${ENDED} busy`;

const MB = 1024 * 1024;
const LINE = /^(\S+) {2}pid (\d+) {2}(?:rss (\d+) MB {2}heap (\d+) MB {2})?(.*)$/;

/** @param {string} file @param {string} text */
function append(file, text) {
    try { appendFileSync(file, text); } catch { /* a log that can't be written never stops a build */ }
}

/**
 * The log of one build, in the build's process
 * @param {{ file: string, args?: string[], pid?: number, now?: () => number,
 *   memory?: () => { rss: number, heapUsed: number }, peak?: () => number, maxBytes?: number }} options
 *   peak: the most memory the process has used, in bytes (process.resourceUsage's maxRSS)
 */
export function createBuildLog({
    file, args = [], pid = process.pid, now = Date.now,
    memory = () => process.memoryUsage(), peak = () => process.resourceUsage().maxRSS * 1024,
    maxBytes = BUILD_LOG_MAX_BYTES,
}) {
    try { if (existsSync(file) && statSync(file).size > maxBytes) renameSync(file, `${file}.1`); } catch { /* kept as it is */ }
    const started = now();
    let timer = /** @type {ReturnType<typeof setInterval> | undefined} */ (undefined);

    /** @param {string} message */
    function write(message) {
        const { rss, heapUsed } = memory();
        const head = `${new Date(now()).toISOString()}  pid ${pid}  rss ${Math.round(rss / MB)} MB  heap ${Math.round(heapUsed / MB)} MB  `;
        append(file, String(message).split('\n').map(line => head + line + '\n').join(''));
    }

    /** @param {string} how what ended it: "done", "busy", "stopped by SIGTERM"… */
    function end(how) {
        clearInterval(timer);
        const took = Math.round((now() - started) / 1000);
        write(`${ENDED} ${how} after ${took} s, most memory ${Math.round(peak() / MB)} MB`);
    }

    write(`${STARTED}${args.length ? ` (${args.join(' ')})` : ''}`);
    timer = setInterval(() => write('Still running'), HEARTBEAT_MS);
    timer.unref();
    return { write, end };
}

/**
 * For the server: a build it started was stopped by a signal before it could
 * say so itself (SIGKILL, or SIGTERM while it hung)
 * @param {string} file @param {number} pid @param {string} signal @param {number} [at]
 */
export function endedBySignal(file, pid, signal, at = Date.now()) {
    append(file, `${new Date(at).toISOString()}  pid ${pid}  ${ENDED} stopped by ${signal} (seen by the server)\n`);
}

/**
 * @typedef {{ at: number, pid: number, rss: number | null, message: string }} LogLine
 * @typedef {{ pid: number, started: number, lines: LogLine[], end: LogLine | null, last: LogLine, mostRss: number | null }} Run
 */

/**
 * The last build in the log that wasn't turned away as busy: its lines,
 * how it ended (null: it hasn't said) and the most memory a line showed
 * @param {string} file @returns {Run | null}
 */
export function lastRun(file) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { return null; }
    /** @type {LogLine[]} */
    const lines = text.split('\n').flatMap(raw => {
        const m = LINE.exec(raw);
        return m ? [{ at: Date.parse(m[1]), pid: Number(m[2]), rss: m[3] === undefined ? null : Number(m[3]), message: m[5] }] : [];
    });
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].message.startsWith(STARTED)) continue;
        const { pid, at } = lines[i];
        // Its own lines, up to its end (a pid used again later is another build)
        const own = [];
        for (const line of lines.slice(i)) {
            if (line.pid !== pid) continue;
            if (own.length && line.message.startsWith(STARTED)) break;
            own.push(line);
            if (line.message.startsWith(ENDED)) break;
        }
        const end = own.find(l => l.message.startsWith(ENDED)) ?? null;
        if (end?.message.startsWith(BUSY)) continue;
        const shown = own.flatMap(l => l.rss === null ? [] : [l.rss]);
        return { pid, started: at, lines: own, end, last: own[own.length - 1], mostRss: shown.length ? Math.max(...shown) : null };
    }
    return null;
}
