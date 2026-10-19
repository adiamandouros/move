import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readJson, writeFileAtomic } from '../server/files.js';

// The file helpers the server's caches and the data build share (server/files.js)

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

test('writeFileAtomic throws when it can\'t write, and the old file stays', () => {
    const d = dir();
    const file = join(d, 'status.json');
    writeFileAtomic(file, 'kept');
    // A folder where the temporary file would go
    writeFileAtomic(join(d, 'status.json.tmp', 'x'), '');
    assert.throws(() => writeFileAtomic(file, 'lost'));
    assert.equal(readFileSync(file, 'utf8'), 'kept');
    assert.ok(existsSync(join(d, 'status.json.tmp')));
});
