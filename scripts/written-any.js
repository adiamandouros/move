// No `any` written in the types (decision 70): jsconfig.json has strict on,
// which catches every value left untyped, but no setting catches an `any`
// written into a type. `npm run typecheck` runs this after TypeScript and
// fails on any it finds, in a JavaScript file's JSDoc or anywhere in a
// declaration file (.d.ts) but its comments. A value that really can be
// anything is `unknown` and a check.
//   node scripts/written-any.js
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

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
 * What the check says of the files with any: one line each, or nothing
 * @param {Record<string, number>} anys
 */
export function said(anys) {
    const files = Object.keys(anys).filter(file => anys[file] > 0).sort();
    if (!files.length) return '';
    return `Written any, which no setting catches (decision 70): write the real type, or unknown and a check\n${files.map(file => `  ${file}: ${anys[file]}`).join('\n')}`;
}

function main() {
    const run = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'jsconfig.json', '--listFilesOnly'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status === null) throw run.error ?? new Error(`TypeScript stopped (${run.signal})`);
    /** @type {Record<string, number>} */
    const anys = {};
    for (const path of run.stdout.split('\n')) {
        const file = relative(ROOT, path.trim()).split(sep).join('/');
        if (!path.trim() || file.startsWith('..') || file.startsWith('node_modules/')) continue;
        const n = writtenAny(file, readFileSync(resolve(ROOT, file), 'utf8'));
        if (n) anys[file] = n;
    }
    const text = said(anys);
    if (!text) return;
    console.error(text);
    process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
