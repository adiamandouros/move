import { existsSync, readFileSync } from 'fs';
import { writeFileAtomic } from '../files.js';
import { formatJson } from './format.js';
import { NO_ELEVATOR, POSITIONS, STEP_FREE } from './validate.js';

// Station edits made in the admin editor live in a gitignored overlay file
// with the same shape as positions.json, holding only the edited stations:
//   { "M1": { "kifisia": { "moschato": { "exits": ["front"] } } } }
// Each entry replaces the committed entry for that station and direction.
// Once the committed positions.json catches up (export → commit → deploy),
// matching entries are pruned, so the overlay only holds uncommitted edits.
// Entries are tidied as they're read, so ones saved before a change of
// format (elevators as plain positions) read as they would be saved now.

export function readOverlay(path) {
    if (!existsSync(path)) return {};
    let overlay;
    try { overlay = JSON.parse(readFileSync(path, 'utf8')); }
    catch (err) { throw new Error(`${path} is not valid JSON: ${err.message}`, { cause: err }); }
    for (const { line, dir, station, entry } of overlayEntries(overlay)) overlay[line][dir][station] = tidyEntry(entry);
    return overlay;
}

export function writeOverlay(path, overlay) {
    writeFileAtomic(path, formatJson(overlay, 3) + '\n');
}

function overlayEntries(overlay) {
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
    const out = { exits: order(entry.exits) };
    const elevators = tidyElevators(entry.elevators);
    if (elevators) out.elevators = elevators;
    if (entry.escalators?.length) out.escalators = order(entry.escalators);
    if (entry.stairs?.length) out.stairs = order(entry.stairs);
    if (entry.centralPlatform) out.centralPlatform = true;
    if (STEP_FREE.includes(entry.stepFree)) out.stepFree = entry.stepFree;
    const transfers = Object.entries(entry.transfers ?? {})
        .filter(([, list]) => list?.length)
        .sort(([a], [b]) => a.localeCompare(b));
    if (transfers.length) out.transfers = Object.fromEntries(transfers.map(([k, v]) => [k, order(v)]));
    if (typeof entry.note === 'string' && entry.note.trim()) out.note = entry.note.trim();
    return out;
}

const byPosition = (a, b) => POSITIONS.indexOf(a) - POSITIONS.indexOf(b);
const order = list => [...new Set(list ?? [])].sort(byPosition);

// "none", or each elevator as { at, name? } from the back to the front; an
// empty list (nothing recorded) is left out, as is anything else. Plain
// positions, how elevators were written before they had names, become
// elevators without a name.
function tidyElevators(elevators) {
    if (elevators === NO_ELEVATOR) return NO_ELEVATOR;
    if (!Array.isArray(elevators)) return undefined;
    const lifts = elevators.map(lift => {
        const { at, name } = typeof lift === 'string' ? { at: lift } : lift ?? {};
        const named = typeof name === 'string' ? name.trim() : '';
        return { at, ...(named && { name: named }) };
    });
    return lifts.length ? lifts.sort((a, b) => byPosition(a.at, b.at)) : undefined;
}

function dropEmpty(overlay) {
    for (const [line, dirs] of Object.entries(overlay)) {
        for (const [dir, stations] of Object.entries(dirs)) if (!Object.keys(stations).length) delete dirs[dir];
        if (!Object.keys(dirs).length) delete overlay[line];
    }
    return overlay;
}
