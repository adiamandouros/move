import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// File helpers shared by the server's caches and the data build

// A JSON file's contents, or null when it's missing or isn't JSON
/** @param {string} path */
export function readJson(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// Write a file through a temporary one and a rename, so a crash never leaves
// it half-written and nothing reads it half-written; its folder is made if
// needed. Throws when it can't be written. The temporary file is named for
// the process, as two copies of the server can save the same file at once
// (oasa-usage.json each minute): through one name, one renamed the other's
// away and its own rename failed.
/** @param {string} path @param {string | Buffer} text */
export function writeFileAtomic(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    try {
        writeFileSync(tmp, text);
        renameSync(tmp, path);
    } catch (err) {
        rmSync(tmp, { force: true, recursive: true });
        throw err;
    }
}
