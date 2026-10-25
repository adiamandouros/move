import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { unusedExports } from './support/exports.js';

// Every export in the app's code is used by another file, the app's or a
// test's (test/support/exports.js): an export nothing imports is noise, or
// code that's no longer used.

const ROOT = new URL('..', import.meta.url).pathname;
const CODE = ['server.js', 'server', 'public/js', 'tools', 'admin/client', 'scripts', 'proxy'];
const USERS = [...CODE, 'test', 'playwright.config.js', 'playwright.live.config.js'];
const SKIP = /(^|\/)(node_modules|\.wrangler)\//;

function jsFiles(entries) {
    return entries.flatMap(entry => {
        const path = join(ROOT, entry);
        const files = statSync(path).isDirectory() ? readdirSync(path, { recursive: true }).map(f => join(path, String(f))) : [path];
        return files.map(f => relative(ROOT, f)).filter(f => f.endsWith('.js') && !SKIP.test(f));
    });
}

test('every export of the app\'s code is used by another file', () => {
    const code = jsFiles(CODE);
    const sources = Object.fromEntries(jsFiles(USERS).map(f => [f, readFileSync(join(ROOT, f), 'utf8')]));
    assert.ok(code.length > 50, 'found the code');
    assert.deepEqual(unusedExports(sources, code), []);
});

test('the check catches an export nothing uses, and only that', () => {
    const sources = {
        'a.js': 'export const used = 1;\nexport function unused() {}\nexport { a as b, c };\nconst a = 1, c = 2;',
        'b.js': "import { used, b } from './a.js';",
        'layout.js': 'export const anything = 1;',
        'map.js': "import * as layout from './layout.js';",
        // A name only in its own file doesn't count
        'c.js': 'export const lonely = 1;\nconsole.log(lonely);',
    };
    assert.deepEqual(unusedExports(sources, ['a.js', 'layout.js', 'c.js']), ['a.js: unused', 'a.js: c', 'c.js: lonely']);
});
