// Stops the copies of an app that started before a time, for the deploy
// (scripts/cpanel-deploy.sh): after the restart, nothing from before it
// should still run, and leftovers use up the account's threads
// (server/processes.js).
//   node scripts/stop-old-copies.js <app folder> <before, ms since 1970>
import { realpathSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { copiesBefore, stopProcesses } from '../server/processes.js';

/**
 * → the pids it stopped
 * @param {{ dir: string, before: number, uid?: number, procDir?: string, kill?: (pid: number, signal: string) => void, wait?: number, log?: (message: string) => void }} options
 */
export async function stopOldCopies({ dir, before, uid = process.getuid?.() ?? -1, procDir, kill, wait, log = console.log }) {
    const old = copiesBefore({ dir, before, uid, procDir });
    log(old.length
        ? `[deploy] Stopping ${old.length} cop${old.length === 1 ? 'y' : 'ies'} from before the restart: ${old.map(c => c.pid).join(', ')}`
        : '[deploy] No copies left from before the restart');
    await stopProcesses(old, { procDir, kill, wait });
    return old.map(c => c.pid);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [dir, before] = process.argv.slice(2);
    if (!dir || !Number(before)) {
        console.error('Usage: node scripts/stop-old-copies.js <app folder> <before, ms since 1970>');
        process.exitCode = 1;
    } else {
        await stopOldCopies({ dir: realpathSync(dir), before: Number(before) });
    }
}
