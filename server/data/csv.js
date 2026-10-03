import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// Split one CSV line into trimmed fields. Handles quoted fields, commas inside
// quotes and "" escapes. GTFS files never contain multi-line fields, so a
// line-based reader is enough.
export function parseLine(line) {
    if (!line.includes('"')) return line.split(',').map(f => f.trim());

    const out = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch !== '"') field += ch;
            else if (line[i + 1] === '"') { field += '"'; i++; }
            else quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { out.push(field.trim()); field = ''; }
        else field += ch;
    }
    out.push(field.trim());
    return out;
}

// Stream a CSV file, yielding one object per row keyed by the header names.
// Throws if the file is empty or any `required` column is missing, so a change
// in the feed's shape fails the build instead of producing garbage.
export async function* readCsv(path, { required = [] } = {}) {
    const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
    let header = null;
    for await (const line of rl) {
        if (!line.trim()) continue;
        const cols = parseLine(line);
        if (!header) {
            header = cols;
            header[0] = header[0].replace(/^﻿/, '');
            const missing = required.filter(c => !header.includes(c));
            if (missing.length) throw new Error(`${path}: missing column(s) ${missing.join(', ')}`);
            continue;
        }
        const row = {};
        for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? '';
        yield row;
    }
    if (!header) throw new Error(`${path}: file is empty`);
}

export async function readCsvAll(path, opts) {
    const rows = [];
    for await (const row of readCsv(path, opts)) rows.push(row);
    return rows;
}
