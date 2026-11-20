// The stricter type check, step by step (decision 66): `npm run typecheck`
// runs TypeScript a second time with strictNullChecks and holds each file to
// the number of errors types/strict-null-checks.json allows it, so the count
// only goes down:
//   node scripts/strict-nulls.js          the check (npm run typecheck)
//   node scripts/strict-nulls.js --write  the file rewritten with today's numbers
// Once every file is at none, strictNullChecks goes on in jsconfig.json and
// this goes.
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIMITS = 'types/strict-null-checks.json';
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

/**
 * The files whose errors aren't the number allowed them: more (a file not
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
 * What the check says of a file `compare` found
 * @param {{ file: string, now: number, allowed: number }} change
 */
export function said({ file, now, allowed }) {
    return now > allowed
        ? `${file}: ${now} error${now === 1 ? '' : 's'} with strictNullChecks, ${allowed} allowed`
        : `${file}: down to ${now} from ${allowed}: write it down (node scripts/strict-nulls.js --write)`;
}

/**
 * The file's text for today's counts: the files with any, in order
 * @param {Record<string, number>} counts
 */
export function written(counts) {
    const listed = Object.keys(counts).filter(file => counts[file] > 0).sort();
    return `${JSON.stringify(Object.fromEntries(listed.map(file => [file, counts[file]])), null, 4)}\n`;
}

function main() {
    const tsc = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'jsconfig.json', '--strictNullChecks', '--pretty', 'false'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (tsc.error || tsc.status === null) throw tsc.error ?? new Error(`TypeScript stopped (${tsc.signal})`);
    const counts = countErrors(tsc.stdout);
    const path = resolve(ROOT, LIMITS);
    const changes = compare(counts, JSON.parse(readFileSync(path, 'utf8')));
    const up = changes.filter(({ now, allowed }) => now > allowed);
    if (process.argv.includes('--write')) {
        // A number that goes up is written too: a type made exact can move
        // errors to the code using it. The pull request says why (decision 66)
        writeFileSync(path, written(counts));
        console.log(`${LIMITS} written${up.length ? `; up, to explain in the pull request:\n  ${up.map(said).join('\n  ')}` : ''}`);
        return;
    }
    if (!changes.length) return;
    console.error(`strictNullChecks, against ${LIMITS} (decision 66):\n  ${changes.map(said).join('\n  ')}`);
    if (up.length) console.error('  The errors: node_modules/.bin/tsc -p jsconfig.json --strictNullChecks');
    process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
