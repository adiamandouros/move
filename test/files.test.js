import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { readJson, writeFileAtomic } from '../server/files.js';

// The file helpers the server's caches and the data build share (server/files.js)

const WRITE_OFTEN = fileURLToPath(new URL('fixtures/write-often.js', import.meta.url));

const dir = () => mkdtempSync(join(tmpdir(), 'wayhop-files-'));

test('readJson: the contents, or null when the file is missing or isn\'t JSON', () => {
    const d = dir();
    writeFileSync(join(d, 'good.json'), '{"a":[1,2]}');
    writeFileSync(join(d, 'bad.json'), '{"a":');
    assert.deepEqual(readJson(join(d, 'good.json')), { a: [1, 2] });
    assert.equal(readJson(join(d, 'bad.json')), null);
    assert.equal(readJson(join(d, 'missing.json')), null);
});

test('writeFileAtomic makes its folder, replaces the file and leaves nothing behind', () => {
    const d = dir();
    const file = join(d, 'cache', 'deeper', 'status.json');
    writeFileAtomic(file, 'one');
    writeFileAtomic(file, 'two');
    assert.equal(readFileSync(file, 'utf8'), 'two');
    assert.deepEqual(readdirSync(join(d, 'cache', 'deeper')), ['status.json']);
});

test('writeFileAtomic throws when it can\'t write, the old file stays and its temporary file goes', () => {
    const d = dir();
    const file = join(d, 'status.json');
    writeFileAtomic(file, 'kept');
    // A folder where the file goes: written, but the rename fails
    const folder = join(d, 'folder.json');
    writeFileAtomic(join(folder, 'x'), '');
    assert.throws(() => writeFileAtomic(folder, 'lost'));
    assert.equal(readFileSync(file, 'utf8'), 'kept');
    assert.deepEqual(readdirSync(d).sort(), ['folder.json', 'status.json']);
});

test('two processes saving the same file at once never fail each other', async () => {
    // Two copies of the server save oasa-usage.json each minute; through one
    // temporary name, one renamed the other's file away and lost its save
    const file = join(dir(), 'usage.json');
    const run = () => promisify(execFile)(process.execPath, [WRITE_OFTEN, file, '2000']);
    const [a, b] = await Promise.all([run(), run()]);
    assert.deepEqual([Number(a.stdout), Number(b.stdout)], [0, 0]);
    assert.ok(readJson(file));
    assert.deepEqual(readdirSync(dirname(file)), ['usage.json']);
});
