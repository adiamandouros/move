import { existsSync, readFileSync } from 'fs';
import { writeFileAtomic } from '../files.js';
import { formatJson } from './format.js';
import { CROSSING_VIA, CROSSING_WAYS, EXIT_WAYS, NO_ELEVATOR, POSITIONS, STEP_FREE } from './validate.js';

// Station edits made in the admin editor live in gitignored overlay files
// beside the committed ones, with the same shape, holding only the edited
// entries: data/local/positions.json one per line, direction and station,
//   { "M1": { "kifisia": { "moschato": { "exits": ["front"] } } } }
// and data/local/street.json one per station. Each entry replaces the
// committed one. Once a committed file catches up (export → commit →
// deploy), matching entries are pruned, so an overlay only holds
// uncommitted edits. Entries are tidied as they're read, so ones saved
// before a change of format (elevators as plain positions) read as they
// would be saved now.

// The files the editor edits: the keys of a ref ({ line, dir, station })
// that find an entry, its tidy form, and for street.json the entry of a
// station that has none (nothing recorded is the same as no entry)
export const EDITED = {
    positions: { name: 'positions', keys: ['line', 'dir', 'station'], tidy: tidyEntry },
    street: { name: 'street', keys: ['station'], tidy: tidyStreet, blank: {} },
};

const pathOf = (ref, kind) => kind.keys.map(key => ref[key]);
const at = (tree, path) => path.reduce((node, key) => node?.[key], tree);

function put(tree, path, entry) {
    let node = tree;
    for (const key of path.slice(0, -1)) node = node[key] ??= {};
    node[path.at(-1)] = entry;
}

export function readOverlay(path, kind = EDITED.positions) {
    if (!existsSync(path)) return {};
    let overlay;
    try { overlay = JSON.parse(readFileSync(path, 'utf8')); }
    catch (err) { throw new Error(`${path} is not valid JSON: ${err.message}`, { cause: err }); }
    for (const { ref, entry } of overlayEntries(overlay, kind)) put(overlay, pathOf(ref, kind), kind.tidy(entry));
    return overlay;
}

export function writeOverlay(path, overlay) {
    writeFileAtomic(path, formatJson(overlay, 3) + '\n');
}

// Every entry of `overlay`, with its ref
function overlayEntries(overlay, kind) {
    const out = [];
    const walk = (node, depth, ref) => {
        if (depth === kind.keys.length) return void out.push({ ref, entry: node });
        for (const [key, child] of Object.entries(node ?? {})) walk(child, depth + 1, { ...ref, [kind.keys[depth]]: key });
    };
    walk(overlay, 0, {});
    return out;
}

// The entry of `ref` in a committed file or an overlay
export const entryAt = (tree, ref, kind = EDITED.positions) => at(tree, pathOf(ref, kind));

export function applyOverlay(committed, overlay, kind = EDITED.positions) {
    let merged = structuredClone(committed);
    for (const { ref, entry } of overlayEntries(overlay, kind)) {
        // Nothing left in it: no entry at all
        if (kind.blank && sameEntry(kind.blank, entry, kind)) merged = removeEntry(merged, ref, kind);
        else put(merged, pathOf(ref, kind), entry);
    }
    return merged;
}

export function setEntry(overlay, ref, entry, kind = EDITED.positions) {
    const next = structuredClone(overlay);
    put(next, pathOf(ref, kind), entry);
    return next;
}

export function removeEntry(overlay, ref, kind = EDITED.positions) {
    const next = structuredClone(overlay);
    const path = pathOf(ref, kind);
    const parent = at(next, path.slice(0, -1));
    if (parent) delete parent[path.at(-1)];
    return dropEmpty(next, kind.keys.length);
}

// Remove entries identical to the committed data. Returns { overlay, pruned }.
export function pruneOverlay(committed, overlay, kind = EDITED.positions) {
    let next = overlay;
    const pruned = [];
    for (const { ref, entry } of overlayEntries(overlay, kind)) {
        if (sameEntry(entryAt(committed, ref, kind), entry, kind)) {
            next = removeEntry(next, ref, kind);
            pruned.push(pathOf(ref, kind).join('/'));
        }
    }
    return { overlay: next, pruned };
}

// Entries are equal if they mean the same thing: key order, empty optional
// fields and the order of positions in a list don't matter.
export function sameEntry(a, b, kind = EDITED.positions) {
    const [x, y] = [a ?? kind.blank, b ?? kind.blank];
    return x !== undefined && y !== undefined && JSON.stringify(kind.tidy(x)) === JSON.stringify(kind.tidy(y));
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
    const crossing = tidyCrossing(entry.crossing);
    if (crossing) out.crossing = crossing;
    if (typeof entry.note === 'string' && entry.note.trim()) out.note = entry.note.trim();
    return out;
}

// The way to the other side: where to stand for it, back to front, what it
// is and how it's reached, each in its own order; left out with none of them
function tidyCrossing(crossing) {
    if (typeof crossing !== 'object' || crossing === null) return undefined;
    const at = order(crossing.at);
    const way = CROSSING_WAYS.filter(w => Array.isArray(crossing.way) && crossing.way.includes(w));
    const via = CROSSING_VIA.includes(crossing.via) ? crossing.via : undefined;
    const out = { ...(at.length && { at }), ...(via && { via }), ...(way.length && { way }) };
    return Object.keys(out).length ? out : undefined;
}

const byPosition = (a, b) => POSITIONS.indexOf(a) - POSITIONS.indexOf(b);
const order = list => [...new Set(list ?? [])].sort(byPosition);
const trimmed = text => typeof text === 'string' ? text.trim() : '';

// "none", or each elevator as { at, name? } from the back to the front; an
// empty list (nothing recorded) is left out, as is anything else. Plain
// positions, how elevators were written before they had names, become
// elevators without a name.
function tidyElevators(elevators) {
    if (elevators === NO_ELEVATOR) return NO_ELEVATOR;
    if (!Array.isArray(elevators)) return undefined;
    const lifts = elevators.map(lift => {
        const { at, name } = typeof lift === 'string' ? { at: lift } : lift ?? {};
        const named = trimmed(name);
        return { at, ...(named && { name: named }) };
    });
    return lifts.length ? lifts.sort((a, b) => byPosition(a.at, b.at)) : undefined;
}

// A station's entry in street.json: its exits, then its lifts, each in the
// order they were recorded, with names trimmed, places to 5 decimals (about
// 1 m) and an exit's ways in their own order. One with neither a name nor
// a place, and empty fields, are left out.
export function tidyStreet(entry) {
    const exits = (Array.isArray(entry?.exits) ? entry.exits : []).flatMap(exit => {
        const [el, en] = [trimmed(exit?.name?.el), trimmed(exit?.name?.en)];
        const coords = tidyCoords(exit?.coords);
        const way = EXIT_WAYS.filter(w => Array.isArray(exit?.way) && exit.way.includes(w));
        if (!el && !en && !coords) return [];
        return [{ ...((el || en) && { name: { ...(el && { el }), ...(en && { en }) } }), ...(coords && { coords }), ...(way.length && { way }) }];
    });
    const lifts = (Array.isArray(entry?.lifts) ? entry.lifts : []).flatMap(lift => {
        const name = trimmed(lift?.name);
        const coords = tidyCoords(lift?.coords);
        return name || coords ? [{ ...(name && { name }), ...(coords && { coords }) }] : [];
    });
    return { ...(exits.length && { exits }), ...(lifts.length && { lifts }) };
}

// [lat, lng] to 5 decimals; anything else as it is, for the checks to refuse
function tidyCoords(coords) {
    if (coords === null || coords === undefined || coords === '') return undefined;
    const ok = Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite);
    return ok ? coords.map(n => Math.round(n * 1e5) / 1e5) : coords;
}

// Remove the levels above the entries that have none left
function dropEmpty(node, depth) {
    if (depth <= 1) return node;
    for (const [key, child] of Object.entries(node)) {
        dropEmpty(child, depth - 1);
        if (!Object.keys(child).length) delete node[key];
    }
    return node;
}
