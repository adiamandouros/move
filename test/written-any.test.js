import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsdocTypes, said, writtenAny } from '../scripts/written-any.js';

// No any written in the types (decision 70): npm run typecheck runs the check
// after TypeScript, with strict on (scripts/written-any.js)

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

test('the check names each file with written anys, and says nothing when there are none', () => {
    assert.equal(said({}), '');
    assert.equal(said({ 'b.js': 2, 'a.d.ts': 1 }),
        'Written any, which no setting catches (decision 70): write the real type, or unknown and a check\n  a.d.ts: 1\n  b.js: 2');
});
