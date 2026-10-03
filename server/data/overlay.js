import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { formatJson } from './format.js';
import { POSITIONS } from './validate.js';

// Station edits made in the admin editor live in a gitignored overlay file
// with the same shape as positions.json, holding only the edited stations:
//   { "M1": { "kifisia": { "moschato": { "exits": ["front"] } } } }
// Each entry replaces the committed entry for that station and direction.
// Once the committed positions.json catches up (export → commit → deploy),
// matching entries are pruned, so the overlay only holds uncommitted edits.

export function readOverlay(path) {
    if (!existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (err) { throw new Error(`${path} is not valid JSON: ${err.message}`); }
}

// Write via a temp file and rename, so a crash never leaves a half-written file
export function writeOverlay(path, overlay) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, formatJson(overlay, 3) + '\n');
    renameSync(tmp, path);
}

export function overlayEntries(overlay) {
    const out = [];
    for (const [line, dirs] of Object.entries(overlay)) {
        for (const [dir, stations] of Object.entries(dirs)) {
            for (const [station, entry] of Object.entries(stations)) out.push({ line, dir, station, entry });
        }
    }
    return out;
}

export function applyOverlay(positions, overlay) {
    const merged = structuredClone(positions);
    for (const { line, dir, station, entry } of overlayEntries(overlay)) {
        ((merged[line] ??= {})[dir] ??= {})[station] = entry;
    }
    return merged;
}

export function setEntry(overlay, { line, dir, station }, entry) {
    const next = structuredClone(overlay);
    ((next[line] ??= {})[dir] ??= {})[station] = entry;
    return next;
}

export function removeEntry(overlay, { line, dir, station }) {
    const next = structuredClone(overlay);
    delete next[line]?.[dir]?.[station];
    return dropEmpty(next);
}

// Remove entries identical to the committed data. Returns { overlay, pruned }.
export function pruneOverlay(positions, overlay) {
    let next = overlay;
    const pruned = [];
    for (const ref of overlayEntries(overlay)) {
        if (sameEntry(positions[ref.line]?.[ref.dir]?.[ref.station], ref.entry)) {
            next = removeEntry(next, ref);
            pruned.push(`${ref.line}/${ref.dir}/${ref.station}`);
        }
    }
    return { overlay: next, pruned };
}

// Entries are equal if they mean the same thing: key order, empty optional
// fields and the order of positions in a list don't matter.
export function sameEntry(a, b) {
    return a !== undefined && b !== undefined && JSON.stringify(tidyEntry(a)) === JSON.stringify(tidyEntry(b));
}

// The canonical form of an entry: fields in a fixed order, positions from the
// back of the train to the front, empty optional fields left out.
export function tidyEntry(entry) {
    const order = list => [...new Set(list ?? [])].sort((a, b) => POSITIONS.indexOf(a) - POSITIONS.indexOf(b));
    const out = { exits: order(entry.exits) };
    if (entry.elevators?.length) out.elevators = order(entry.elevators);
    if (entry.centralPlatform) out.centralPlatform = true;
    const transfers = Object.entries(entry.transfers ?? {})
        .filter(([, list]) => list?.length)
        .sort(([a], [b]) => a.localeCompare(b));
    if (transfers.length) out.transfers = Object.fromEntries(transfers.map(([k, v]) => [k, order(v)]));
    if (typeof entry.note === 'string' && entry.note.trim()) out.note = entry.note.trim();
    return out;
}

function dropEmpty(overlay) {
    for (const [line, dirs] of Object.entries(overlay)) {
        for (const [dir, stations] of Object.entries(dirs)) if (!Object.keys(stations).length) delete dirs[dir];
        if (!Object.keys(dirs).length) delete overlay[line];
    }
    return overlay;
}
