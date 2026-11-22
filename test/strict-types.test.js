import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { added, compare, countErrors, jsdocTypes, said, writtenAny, written } from '../scripts/strict-types.js';

// The rest of the strict type check held file by file (decision 70): npm run
// typecheck runs it against types/strict.json (scripts/strict-types.js)

// TypeScript's plain output: an error per line, its details indented under
// it, and one for the configuration with no file
const OUTPUT = `tools/trip/client/plan.js(96,21): error TS7006: Parameter 'leg' implicitly has an 'any' type.
tools/trip/client/plan.js(153,25): error TS7031: Binding element 'at' implicitly has an 'any' type.
server/app.js(12,3): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
  Type 'undefined' is not assignable to type 'string'.
error TS5023: Unknown compiler option 'stric'.
Found 4 errors in 2 files.
`;

test('the errors counted by file, their details and the summary not counted', () => {
    assert.deepEqual(countErrors(OUTPUT), { 'tools/trip/client/plan.js': 2, 'server/app.js': 1, '(no file)': 1 });
    assert.deepEqual(countErrors(''), {});
});

test('the types of a file\'s JSDoc: after any tag, nested braces and lines included, casts too', () => {
    const text = `/**
 * Any of the stops: the description isn't a type
 * @param {string} a any words here
 * @param {{ b: { c: number },
 *   d: any[] }} options
 * @returns {Promise<any>}
 */
const x = /** @type {any} */ (y);
// @type {any} in a line comment isn't JSDoc
/* @type {any} nor in a plain block comment */`;
    assert.deepEqual(jsdocTypes(text), ['string', '{ b: { c: number },\n  d: any[] }', 'Promise<any>', 'any']);
});

test('a written any counted where it is a type, not in a name, a property called any, quotes or words', () => {
    const js = `/**
 * Waits for any bus
 * @param {any} a
 * @param {Record<string, any>} b
 * @param {{ any: number, stop: number, many: Company, anyway?: string }} c
 * @param {'any' | "any"} d
 * @param {{ rows: any[], fn: (x: any) => void }} e
 * @property {Map<string, Set<any>>} f
 */`;
    assert.equal(writtenAny('a.js', js), 5);
    const dts = `/** For any date */
export interface Page {
    // any of them
    data: Record<string, any>;
    any: string;
    rows?: any[];
}`;
    assert.equal(writtenAny('types/pages.d.ts', dts), 2, 'a declaration file: its types, not its comments');
    assert.equal(writtenAny('a.js', 'const any = 1; // any'), 0, 'code outside JSDoc is no type');
});

test('a file\'s number: its errors and its written anys added up', () => {
    assert.deepEqual(added({ 'a.js': 2, 'b.js': 1 }, { 'b.js': 3, 'c.d.ts': 1 }), { 'a.js': 2, 'b.js': 4, 'c.d.ts': 1 });
});

test('a file over its number fails, one not listed is allowed none, and fewer must be written down', () => {
    const limits = { 'a.js': 3, 'b.js': 2, 'gone.js': 1 };
    assert.deepEqual(compare({ 'a.js': 3, 'b.js': 2, 'gone.js': 1 }, limits), [], 'as allowed');
    assert.deepEqual(compare({ 'a.js': 4, 'b.js': 1, 'new.js': 1 }, limits), [
        { file: 'a.js', now: 4, allowed: 3 },
        { file: 'b.js', now: 1, allowed: 2 },
        { file: 'gone.js', now: 0, allowed: 1 },
        { file: 'new.js', now: 1, allowed: 0 },
    ]);
    const errors = { 'a.js': 3, 'new.js': 1 };
    const anys = { 'a.js': 1, 'any.js': 2 };
    assert.equal(said({ file: 'a.js', now: 4, allowed: 3 }, errors, anys), 'a.js: 4 (3 errors with --strict, 1 written any), 3 allowed');
    assert.equal(said({ file: 'new.js', now: 1, allowed: 0 }, errors, anys), 'new.js: 1 (1 error with --strict), 0 allowed');
    assert.equal(said({ file: 'any.js', now: 2, allowed: 0 }, errors, anys), 'any.js: 2 (2 written anys), 0 allowed');
    assert.equal(said({ file: 'b.js', now: 1, allowed: 2 }, errors, anys), 'b.js: down to 1 from 2: write it down (node scripts/strict-types.js --write)');
});

test('written down: the files with any, in order, as the check reads them back', () => {
    const text = written({ 'b.js': 2, 'done.js': 0, 'a.js': 1 });
    assert.equal(text, '{\n    "a.js": 1,\n    "b.js": 2\n}\n');
    assert.deepEqual(compare({ 'b.js': 2, 'done.js': 0, 'a.js': 1 }, JSON.parse(text)), []);
});

test('the numbers allowed are written as the script writes them', () => {
    const text = readFileSync(new URL('../types/strict.json', import.meta.url), 'utf8');
    assert.equal(written(JSON.parse(text)), text);
});
