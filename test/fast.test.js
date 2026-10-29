import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';

// The Node tests stay fast (test/README.md). A server a test starts itself
// is started with support/listen.js, whose close() doesn't wait seconds for
// the connections fetch() keeps open.

const DIR = new URL('./', import.meta.url);
const files = [
    ...readdirSync(DIR).filter(name => name.endsWith('.test.js')),
    ...readdirSync(new URL('support/', DIR)).filter(name => name !== 'listen.js').map(name => `support/${name}`),
];

test('every test starts its servers with listen() from support/listen.js', () => {
    assert.deepEqual(files.filter(name => /\.listen\(/.test(readFileSync(new URL(name, DIR), 'utf8'))), []);
});
