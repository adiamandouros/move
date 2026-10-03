import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseLine, readCsvAll } from '../server/data/csv.js';

test('parseLine splits plain and quoted fields', () => {
    assert.deepEqual(parseLine('a, b ,c'), ['a', 'b', 'c']);
    assert.deepEqual(parseLine('"1","Urban, Rail","x"'), ['1', 'Urban, Rail', 'x']);
    assert.deepEqual(parseLine('"say ""hi""",,end'), ['say "hi"', '', 'end']);
});

test('readCsvAll strips the BOM, handles CRLF and skips blank lines', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'move-csv-')), 'f.txt');
    writeFileSync(path, '﻿"id","name"\r\n1,Πειραιάς\r\n\r\n2,"Ν. Κόσμος"\r\n');
    assert.deepEqual(await readCsvAll(path), [{ id: '1', name: 'Πειραιάς' }, { id: '2', name: 'Ν. Κόσμος' }]);
});

test('readCsvAll fails on missing required columns and empty files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'move-csv-'));
    writeFileSync(join(dir, 'a.txt'), 'id,name\n1,x\n');
    writeFileSync(join(dir, 'b.txt'), '');
    await assert.rejects(readCsvAll(join(dir, 'a.txt'), { required: ['id', 'stop_lat'] }), /missing column\(s\) stop_lat/);
    await assert.rejects(readCsvAll(join(dir, 'b.txt')), /empty/);
});
