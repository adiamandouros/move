import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// File helpers shared by the server's caches and the data build

// A JSON file's contents, or null when it's missing or isn't JSON
/** @param {string} path */
export function readJson(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// Write a file through a temporary one and a rename, so a crash never leaves
// it half-written and nothing reads it half-written; its folder is made if
// needed. Throws when it can't be written.
/** @param {string} path @param {string | Buffer} text */
export function writeFileAtomic(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
}
