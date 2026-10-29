// The nightly pull request of station edits (.github/workflows/station-edits.yml):
// what changed between the committed data/curated/positions.json and
// street.json and the editor's exports of them from wayhop.gr, as the pull
// request's description.
//
//   node scripts/station-edits.js <committed positions.json> <exported positions.json> [<committed street.json> <exported street.json>]
//
// Runs on GitHub without npm install: Node's own modules only.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Each station and direction whose entry was added, changed or removed:
// [{ line, dir, station, change }], in the export's order
export function stationChanges(before, after) {
    const refs = new Map();
    for (const positions of [after, before]) {
        for (const [line, dirs] of Object.entries(positions)) {
            for (const [dir, stations] of Object.entries(dirs)) {
                for (const station of Object.keys(stations)) refs.set(`${line}/${dir}/${station}`, { line, dir, station });
            }
        }
    }
    const entry = (positions, { line, dir, station }) => positions[line]?.[dir]?.[station];
    return [...refs.values()].flatMap(ref => {
        const was = entry(before, ref);
        const is = entry(after, ref);
        if (JSON.stringify(was) === JSON.stringify(is)) return [];
        return [{ ...ref, change: was === undefined ? 'added' : is === undefined ? 'removed' : 'changed' }];
    });
}

// Each station whose entry in street.json was added, changed or removed:
// [{ station, change }], in the export's order
export function streetChanges(before, after) {
    return [...new Set([...Object.keys(after), ...Object.keys(before)])].flatMap(station => {
        const [was, is] = [before[station], after[station]];
        if (JSON.stringify(was) === JSON.stringify(is)) return [];
        return [{ station, change: was === undefined ? 'added' : is === undefined ? 'removed' : 'changed' }];
    });
}

// The pull request's description
export function pullRequestBody(changes, street = []) {
    const lines = [
        ...changes.map(c => `- ${c.line} toward ${c.dir}: \`${c.station}\` (${c.change})`),
        ...street.map(c => `- \`${c.station}\`, its exits and elevators on the street (${c.change})`),
    ];
    return [
        'Station edits made in the editor (`/admin/stations`) that the repository doesn\'t have yet, as wayhop.gr exports them. This pull request is updated each night while there are any.',
        '',
        ...lines,
        '',
        'Once this is merged and deployed, the server drops these edits from its own files, `data/local/positions.json` and `data/local/street.json` (decision 16).',
    ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [committed, exported, committedStreet = {}, exportedStreet = {}] = process.argv.slice(2).map(file => JSON.parse(readFileSync(file, 'utf8')));
    console.log(pullRequestBody(stationChanges(committed, exported), streetChanges(committedStreet, exportedStreet)));
}
