import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// docs/decisions/ says why Wayhop is built as it is: one page per decision,
// each in the same shape, numbered in order and listed in its README.
const DIR = fileURLToPath(new URL('../docs/decisions/', import.meta.url));
const RECORD = /^(\d{4})-[a-z0-9-]+\.md$/;
const SECTIONS = ['## Situation', '## Decision', '## What follows', '## Look again when'];
// The line under a record's title: when it was decided, and whether it still holds
const STATUS = /^Decided \d{4}-\d{2}-\d{2} · (In force|Replaced by \[\d+\]\(\d{4}-[a-z0-9-]+\.md\))$/;

const names = readdirSync(DIR).filter(name => name !== 'README.md');
const records = names.filter(name => RECORD.test(name)).sort();
const read = name => readFileSync(join(DIR, name), 'utf8');
const number = name => Number(RECORD.exec(name)[1]);
// A record's status as the README writes it: "Replaced by 18", without the link
const status = name => STATUS.exec(read(name).split('\n')[2])?.[1].replace(/\[(\d+)\]\(.*\)/, '$1');
// The relative links in a page, without web addresses and #anchors
const links = text => [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(m => m[1])
    .filter(href => !/^([a-z]+:|#)/.test(href))
    .map(href => href.split('#')[0]);

test('every file in docs/decisions is a numbered record or the README', () => {
    assert.deepEqual(names.filter(name => !RECORD.test(name)), []);
});

test('the records are numbered 1, 2, 3… with no gaps', () => {
    assert.deepEqual(records.map(number), records.map((_, i) => i + 1));
});

for (const name of records) {
    test(`${name} has its number, its status and its four sections`, () => {
        const lines = read(name).split('\n');
        assert.match(lines[0], new RegExp(`^# ${number(name)}\\. \\S`));
        assert.match(lines[2], STATUS);
        assert.deepEqual(lines.filter(line => line.startsWith('## ')), SECTIONS);
    });
}

test('the README lists every record, in order, with its status', () => {
    const rows = [...read('README.md').matchAll(/^\| (\d+) \| \[[^\]]+\]\(([^)]+)\) \| ([^|]+) \|$/gm)];
    assert.deepEqual(rows.map(row => row[2]), records);
    for (const [, n, file, said] of rows) {
        assert.equal(Number(n), number(file), file);
        assert.equal(said.trim(), status(file), file);
    }
});

test('every link in the records and the README leads to a file that exists', () => {
    const broken = ['README.md', ...records].flatMap(name =>
        links(read(name)).filter(href => !existsSync(join(DIR, href))).map(href => `${name}: ${href}`));
    assert.deepEqual(broken, []);
});
