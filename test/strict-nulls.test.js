import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { compare, countErrors, said, written } from '../scripts/strict-nulls.js';

// The stricter type check held file by file (decision 66): npm run typecheck
// runs it against types/strict-null-checks.json (scripts/strict-nulls.js)

// TypeScript's plain output: an error per line, its details indented under
// it, and one for the configuration with no file
const OUTPUT = `tools/trip/client/plan.js(96,21): error TS18047: 'plan.arrives' is possibly 'null'.
tools/trip/client/plan.js(153,25): error TS18047: 'a' is possibly 'null'.
server/app.js(12,3): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
  Type 'undefined' is not assignable to type 'string'.
error TS5023: Unknown compiler option 'strictNul'.
Found 4 errors in 2 files.
`;

test('the errors counted by file, their details and the summary not counted', () => {
    assert.deepEqual(countErrors(OUTPUT), { 'tools/trip/client/plan.js': 2, 'server/app.js': 1, '(no file)': 1 });
    assert.deepEqual(countErrors(''), {});
});

test('a file with more errors than allowed fails, one not listed is allowed none, and fewer must be written down', () => {
    const limits = { 'a.js': 3, 'b.js': 2, 'gone.js': 1 };
    assert.deepEqual(compare({ 'a.js': 3, 'b.js': 2, 'gone.js': 1 }, limits), [], 'as allowed');
    assert.deepEqual(compare({ 'a.js': 4, 'b.js': 1, 'new.js': 1 }, limits), [
        { file: 'a.js', now: 4, allowed: 3 },
        { file: 'b.js', now: 1, allowed: 2 },
        { file: 'gone.js', now: 0, allowed: 1 },
        { file: 'new.js', now: 1, allowed: 0 },
    ]);
    assert.equal(said({ file: 'a.js', now: 4, allowed: 3 }), 'a.js: 4 errors with strictNullChecks, 3 allowed');
    assert.equal(said({ file: 'new.js', now: 1, allowed: 0 }), 'new.js: 1 error with strictNullChecks, 0 allowed');
    assert.equal(said({ file: 'b.js', now: 1, allowed: 2 }), 'b.js: down to 1 from 2: write it down (node scripts/strict-nulls.js --write)');
});

test('written down: the files with any errors, in order, as the check reads them back', () => {
    const text = written({ 'b.js': 2, 'done.js': 0, 'a.js': 1 });
    assert.equal(text, '{\n    "a.js": 1,\n    "b.js": 2\n}\n');
    assert.deepEqual(compare({ 'b.js': 2, 'done.js': 0, 'a.js': 1 }, JSON.parse(text)), []);
});

test('the numbers allowed are written as the script writes them', () => {
    const text = readFileSync(new URL('../types/strict-null-checks.json', import.meta.url), 'utf8');
    assert.equal(written(JSON.parse(text)), text);
});
