// The rest of the strict type check, step by step (decision 70): `npm run
// typecheck` runs TypeScript a second time with `--strict` and holds each
// file to the number types/strict.json allows it, so the count only goes
// down. A file's number is its errors with --strict plus the `any`s written
// in its types, which no setting catches:
//   node scripts/strict-types.js          the check (npm run typecheck)
//   node scripts/strict-types.js --write  the file rewritten with today's numbers
// Once every file is at none, strict goes on in jsconfig.json.
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIMITS = 'types/strict.json';
// An error TypeScript can't tie to a file (the configuration's)
const NO_FILE = '(no file)';

/**
 * Errors by file in TypeScript's plain output (`--pretty false`): each error
 * is a line `file(line,col): error TS…: …`; the lines under it, indented,
 * are its details
 * @param {string} output
 * @returns {Record<string, number>}
 */
export function countErrors(output) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const line of output.split('\n')) {
        const match = /^(?:(.+?)\(\d+,\d+\): )?error TS\d+:/.exec(line);
        if (!match) continue;
        const file = match[1] ?? NO_FILE;
        counts[file] = (counts[file] ?? 0) + 1;
    }
    return counts;
}

// `any` as a type: not part of a longer name, not a property called any
// (`{ any: number }`), not inside quotes
const ANY = /(?<![\w$.'"`])any(?![\w$'"`])(?!\s*\??\s*:)/g;

/**
 * The type expressions of a JavaScript file's JSDoc: the braces after a tag
 * (`@param {…}`, `@type {…}`, `@typedef {…}`…), nested braces and lines
 * included
 * @param {string} text
 * @returns {string[]}
 */
export function jsdocTypes(text) {
    const types = [];
    for (const [comment] of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
        const body = comment.slice(3, -2).replace(/^[ \t]*\*[ \t]?/gm, '');
        for (const tag of body.matchAll(/@\w+[ \t]*\{/g)) {
            const start = (tag.index ?? 0) + tag[0].length;
            let depth = 1;
            let end = start;
            for (; end < body.length && depth; end++) {
                if (body[end] === '{') depth++;
                else if (body[end] === '}') depth--;
            }
            types.push(body.slice(start, end - 1));
        }
    }
    return types;
}

/**
 * The `any`s written in a file's types: in a JavaScript file's JSDoc, or
 * anywhere in a declaration file (.d.ts) but its comments
 * @param {string} file
 * @param {string} text
 */
export function writtenAny(file, text) {
    const types = file.endsWith('.d.ts')
        ? [text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')]
        : jsdocTypes(text);
    return types.reduce((sum, type) => sum + (type.match(ANY)?.length ?? 0), 0);
}

/**
 * Two counts by file added up
 * @param {Record<string, number>} a
 * @param {Record<string, number>} b
 * @returns {Record<string, number>}
 */
export function added(a, b) {
    /** @type {Record<string, number>} */
    const sum = { ...a };
    for (const [file, n] of Object.entries(b)) sum[file] = (sum[file] ?? 0) + n;
    return sum;
}

/**
 * The files whose number isn't the one allowed them: more (a file not
 * listed is allowed none), or fewer, as the number written down comes down
 * with them
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} limits
 * @returns {{ file: string, now: number, allowed: number }[]}
 */
export function compare(counts, limits) {
    const files = [...new Set([...Object.keys(counts), ...Object.keys(limits)])].sort();
    return files.map(file => ({ file, now: counts[file] ?? 0, allowed: limits[file] ?? 0 })).filter(({ now, allowed }) => now !== allowed);
}

/**
 * What the check says of a file `compare` found, with how many of its
 * number are errors and how many written `any`s
 * @param {{ file: string, now: number, allowed: number }} change
 * @param {Record<string, number>} errors
 * @param {Record<string, number>} anys
 */
export function said({ file, now, allowed }, errors, anys) {
    if (now < allowed) return `${file}: down to ${now} from ${allowed}: write it down (node scripts/strict-types.js --write)`;
    const parts = [[errors[file] ?? 0, 'error', 'with --strict'], [anys[file] ?? 0, 'written any', '']]
        .filter(([n]) => n)
        .map(([n, what, how]) => `${n} ${what}${n === 1 ? '' : 's'}${how ? ` ${how}` : ''}`);
    return `${file}: ${now} (${parts.join(', ')}), ${allowed} allowed`;
}

/**
 * The file's text for today's counts: the files with any, in order
 * @param {Record<string, number>} counts
 */
export function written(counts) {
    const listed = Object.keys(counts).filter(file => counts[file] > 0).sort();
    return `${JSON.stringify(Object.fromEntries(listed.map(file => [file, counts[file]])), null, 4)}\n`;
}

/**
 * TypeScript on the app with these extra options
 * @param {string[]} options
 */
function tsc(...options) {
    const run = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'jsconfig.json', '--pretty', 'false', ...options],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status === null) throw run.error ?? new Error(`TypeScript stopped (${run.signal})`);
    return run.stdout;
}

function main() {
    const errors = countErrors(tsc('--strict'));
    /** @type {Record<string, number>} */
    const anys = {};
    for (const path of tsc('--listFilesOnly').split('\n')) {
        const file = relative(ROOT, path.trim()).split(sep).join('/');
        if (!path.trim() || file.startsWith('..') || file.startsWith('node_modules/')) continue;
        const n = writtenAny(file, readFileSync(resolve(ROOT, file), 'utf8'));
        if (n) anys[file] = n;
    }
    const counts = added(errors, anys);
    const path = resolve(ROOT, LIMITS);
    const changes = compare(counts, JSON.parse(readFileSync(path, 'utf8')));
    const up = changes.filter(({ now, allowed }) => now > allowed);
    const say = (/** @type {{ file: string, now: number, allowed: number }} */ change) => said(change, errors, anys);
    if (process.argv.includes('--write')) {
        // A number that goes up is written too: a type made exact can move
        // errors to the code using it. The pull request says why (decision 70)
        writeFileSync(path, written(counts));
        console.log(`${LIMITS} written${up.length ? `; up, to explain in the pull request:\n  ${up.map(say).join('\n  ')}` : ''}`);
        return;
    }
    if (!changes.length) return;
    console.error(`--strict and written anys, against ${LIMITS} (decision 70):\n  ${changes.map(say).join('\n  ')}`);
    if (up.length) console.error('  The errors: node_modules/.bin/tsc -p jsconfig.json --strict');
    process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
