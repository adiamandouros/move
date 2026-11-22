// Address search over the index that scripts/places/ builds: pure logic, so
// the build and the checks before publishing use it too. How exactly it
// answers, and why: decision 22.

import { fold, plain } from '../../public/js/core/text.js';

export { fold };

/**
 * A point on the map
 * @typedef {{ lat: number, lng: number }} Point
 */
/**
 * A house number where it is; `range`: it's one end of a range of numbers
 * @typedef {Point & { n: number, range?: boolean }} Numbered
 */
/**
 * A street's lines and its numbers, as locate and streetMiddle read them
 * @typedef {{ lines: Point[][], pts: Numbered[] }} Street
 */
/**
 * Where a house number is, and how exactly (locate)
 * @typedef {Point & ({ kind: 'exact' | 'range' | 'street' } | { kind: 'between', lo: number, hi: number }
 *   | { kind: 'beyond', near: number, away: number } | { kind: 'nearest', near: number })} Located
 */
/**
 * What load makes of the index: a street, whose lines and numbers are read
 * from the index the first time they're needed (geometry), or a place (a
 * metro station's lines in `lines`); `words`: each of its names' words;
 * `count`: how many house numbers it has
 * @typedef {{ names: string[], town: number, words: string[][], count: number }} EntryBase
 * @typedef {EntryBase & { type: 'street', kind?: undefined, rawLines: number[][], rawPts: number[], lines?: Point[][], pts?: Numbered[] }} StreetEntry
 * @typedef {EntryBase & Point & { type: 'place', kind: string, lines: string[], rawLines: [] }} PlaceEntry
 * @typedef {StreetEntry | PlaceEntry} Entry
 */
/**
 * The towns or neighbourhoods some words name (whereIs); `partly`: the
 * last word may be cut short
 * @typedef {{ towns: number[], areas: PlaceEntry[], partly: boolean }} Where
 */
/**
 * One way of reading a query (readings): the house number, the street's
 * words, the town's words (null for none), and whether the town came after
 * a comma
 * @typedef {{ n: number | null, words: string[], town: string[] | null, explicit: boolean }} Reading
 */
/**
 * An entry found, and how well (score)
 * @typedef {{ e: Entry, s: number }} Scored
 */
/** @typedef {ReturnType<typeof load>} Places the index, loaded */

// Words that say what kind of street it is, not which one
const NOISE = new Set(['stathmos', 'stathmu', 'metro', 'station', 'stasi', 'odos', 'odu', 'leoforos', 'leof', 'leoforu', 'l', 'platia', 'plateia', 'pl', 'ave', 'avenue', 'street', 'str', 'st', 'road', 'square', 'dimos', 'dimu', 'tu', 'tis', 'ton', 'ke', 'k', 'municipality', 'of']);
/** @param {string} text */
export function wordsOf(text) {
    const all = fold(text).split(' ').filter(Boolean);
    const kept = all.filter(w => !NOISE.has(w));
    return kept.length ? kept : all;
}
/** @param {string} text */
export const keyOf = text => wordsOf(text).join(' ');

const M_LAT = 111320, M_LNG = 111320 * Math.cos(37.97 * Math.PI / 180);
/** @param {Point} a @param {Point} b */
export const meters = (a, b) => Math.hypot((a.lat - b.lat) * M_LAT, (a.lng - b.lng) * M_LNG);
/** @param {number} n */
const round = n => Math.round(n * 1e5) / 1e5;

// Closest point on a street's lines
/** @param {{ lines: Point[][] }} street @param {Point} p */
function snap(street, p) {
    let best = /** @type {{ lat: number, lng: number } | null} */ (null), bestD = Infinity;
    for (const line of street.lines) {
        for (let i = 0; i < line.length - 1 || i === 0; i++) {
            const a = line[i], b = line[i + 1] ?? a;
            const ax = a.lng * M_LNG, ay = a.lat * M_LAT, dx = (b.lng - a.lng) * M_LNG, dy = (b.lat - a.lat) * M_LAT;
            const len = dx * dx + dy * dy;
            const t = len ? Math.max(0, Math.min(1, ((p.lng * M_LNG - ax) * dx + (p.lat * M_LAT - ay) * dy) / len)) : 0;
            const q = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
            const d = meters(p, q);
            if (d < bestD) { bestD = d; best = q; }
        }
    }
    return best ? { ...best, d: bestD } : { ...p, d: 0 };
}

/** @param {Street} street @param {Point} p */
const onStreet = (street, p, limit = 60) => {
    const q = snap(street, p);
    return q.d <= limit ? { lat: q.lat, lng: q.lng } : { lat: p.lat, lng: p.lng };
};

// The middle of a street, by length: a straight road has only its two ends
// as points, so its middle point is one of them
/** @param {Street} street @returns {Point | null} */
export function streetMiddle(street) {
    let lat = 0, lng = 0, total = 0;
    for (const line of street.lines) {
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1], b = line[i], m = meters(a, b);
            lat += (a.lat + b.lat) / 2 * m; lng += (a.lng + b.lng) / 2 * m; total += m;
        }
    }
    if (total) { const q = snap(street, { lat: lat / total, lng: lng / total }); return { lat: q.lat, lng: q.lng }; }
    return street.lines[0]?.[0] ?? street.pts[street.pts.length >> 1] ?? null;
}

// Numbers along the street, as a straight line: how far each is along it, and
// whether they grow steadily one way
/** @param {Numbered[]} pts */
function trend(pts) {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.lng, 0) / n * M_LNG, my = pts.reduce((s, p) => s + p.lat, 0) / n * M_LAT;
    let xx = 0, yy = 0, xy = 0;
    for (const p of pts) { const x = p.lng * M_LNG - mx, y = p.lat * M_LAT - my; xx += x * x; yy += y * y; xy += x * y; }
    const angle = Math.atan2(2 * xy, xx - yy) / 2, ux = Math.cos(angle), uy = Math.sin(angle);
    const along = pts.map(p => (p.lng * M_LNG - mx) * ux + (p.lat * M_LAT - my) * uy);
    const mn = pts.reduce((s, p) => s + p.n, 0) / n, ms = along.reduce((a, b) => a + b, 0) / n;
    let nn = 0, ss = 0, ns = 0;
    pts.forEach((p, i) => { const a = p.n - mn, b = along[i] - ms; nn += a * a; ss += b * b; ns += a * b; });
    if (!nn || !ss) return null;
    return { r: ns / Math.sqrt(nn * ss), slope: ns / nn, ux, uy };
}

// Where a house number is, as exactly as the data allows.
// kind: exact, range, between, beyond, nearest, street
/** @param {Street} street @param {number} n @returns {Located | null} */
export function locate(street, n, pts = street.pts) {
    if (!pts.length) {
        const m = streetMiddle(street);
        return m && { kind: 'street', lat: m.lat, lng: m.lng };
    }
    const hit = pts.find(p => p.n === n);
    if (hit) return { kind: hit.range ? 'range' : 'exact', lat: hit.lat, lng: hit.lng };
    const side = pts.filter(p => p.n % 2 === n % 2);
    /** @param {Numbered[]} list */
    const pick = list => {
        const lo = list.filter(p => p.n < n).at(-1), hi = list.find(p => p.n > n);
        return lo && hi ? { lo, hi } : null;
    };
    const pair = pick(side) ?? pick(pts);
    if (pair) {
        const { lo, hi } = pair, t = (n - lo.n) / (hi.n - lo.n);
        // Far apart for the numbers between them: not the same stretch of street
        if (meters(lo, hi) > 500 && meters(lo, hi) / (hi.n - lo.n) > 40) {
            const close = n - lo.n <= hi.n - n ? lo : hi;
            return { kind: 'nearest', lat: close.lat, lng: close.lng, near: close.n };
        }
        const p = onStreet(street, { lat: lo.lat + (hi.lat - lo.lat) * t, lng: lo.lng + (hi.lng - lo.lng) * t });
        return { kind: 'between', lat: p.lat, lng: p.lng, lo: lo.n, hi: hi.n };
    }
    const edge = n < pts[0].n ? pts[0] : pts[pts.length - 1];
    const near = (side.length ? (n < side[0].n ? side[0] : side[side.length - 1]) : edge);
    const line = trend(pts);
    if (pts.length >= 3 && line && Math.abs(line.r) >= 0.9) {
        const perNumber = Math.max(1, Math.min(12, Math.abs(line.slope))) * Math.sign(line.slope);
        const shift = (n - near.n) * perNumber;
        if (Math.abs(shift) <= 1500) {
            const raw = { lat: near.lat + line.uy * shift / M_LAT, lng: near.lng + line.ux * shift / M_LNG };
            // With no lines to snap to, it stays where it is
            const q = snap(street, raw);
            const away = meters(near, q);
            if (!street.lines.length || q.d <= Math.abs(shift) * 0.5 + 60) return { kind: 'beyond', lat: q.lat, lng: q.lng, near: near.n, away: Math.round(away) };
        }
    }
    return { kind: 'nearest', lat: near.lat, lng: near.lng, near: near.n };
}

/** @param {string} a @param {string} b */
const commonStart = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
// The same name, give or take its ending: 'kalithea' and 'kalitheas'
/** @param {string} a @param {string} b */
const sameName = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && commonStart(a, b) >= Math.max(a.length, b.length) - 2);

/** @param {string} a @param {string} b */
export function editOne(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, cost = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++cost > 1) return false;
        if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return cost + (a.length - i) + (b.length - j) <= 1;
}

/** @param {number[]} d @returns {Point[]} */
const decodeLine = d => {
    const out = [];
    let lat = 0, lng = 0;
    for (let i = 0; i < d.length; i += 2) { lat += d[i]; lng += d[i + 1]; out.push({ lat: lat / 1e5, lng: lng / 1e5 }); }
    return out;
};
/** @param {number[]} d @returns {Numbered[]} */
const decodePts = d => {
    const out = [];
    let lat = 0, lng = 0;
    for (let i = 0; i < d.length; i += 3) {
        lat += d[i + 1]; lng += d[i + 2];
        out.push({ n: Math.abs(d[i]), range: d[i] < 0, lat: lat / 1e5, lng: lng / 1e5 });
    }
    return out;
};

/** @param {import('./published.js').PlacesIndex} index */
export function load(index) {
    const towns = index.towns.map(([name, ...aliases]) => ({ name, keys: [name, ...aliases].map(wordsOf) }));
    /** @type {Entry[]} */
    const entries = [];
    for (const [names, town, lines, pts] of index.streets) {
        entries.push({ type: 'street', names, town, rawLines: lines, rawPts: pts, count: pts.length / 3, words: names.map(wordsOf) });
    }
    for (const [names, town, kind, lat, lng, lines] of index.places) {
        entries.push({ type: 'place', names, town, kind, lat: lat / 1e5, lng: lng / 1e5, lines: lines ?? [], rawLines: [], count: 0, words: names.map(wordsOf) });
    }
    /** @type {Map<string, number[]>} */
    const postings = new Map();
    entries.forEach((e, id) => {
        for (const w of new Set(e.words.flat())) {
            let ids = postings.get(w);
            if (!ids) postings.set(w, ids = []);
            ids.push(id);
        }
    });
    const areas = entries.flatMap(e => e.type === 'place' && /^(town|suburb|neighbourhood|quarter|village)$/.test(e.kind) ? [e] : []);
    return { towns, entries, postings, vocabulary: [...postings.keys()].sort(), areas };
}

/** @param {StreetEntry} e */
const geometry = e => {
    if (!e.lines) { e.lines = e.rawLines.map(decodeLine); e.pts = decodePts(e.rawPts); }
    return /** @type {StreetEntry & Street} */ (e);
};

/** @param {string[]} vocabulary @param {string} w */
function wordRange(vocabulary, w) {
    let lo = 0, hi = vocabulary.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (vocabulary[m] < w) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < vocabulary.length && vocabulary[i].startsWith(w); i++) out.push(vocabulary[i]);
    return out;
}

// The entries with every word (the last ones may be cut short), with how well.
// A mended word is any of its mendings
/** @param {Places} db @param {(string | string[])[]} words */
function match(db, words) {
    let found = /** @type {Map<number, number> | null} */ (null);
    for (const word of words) {
        const typed = Array.isArray(word) ? word : [word];
        const forms = typed.flatMap(w => [w, ...(w.includes('ks') ? [w.replaceAll('ks', 'h')] : [])]);
        const here = new Map();
        for (const form of forms) {
            for (const v of wordRange(db.vocabulary, form)) {
                for (const id of db.postings.get(v) ?? []) here.set(id, Math.max(here.get(id) ?? 0, v === form ? 2 : 1));
            }
        }
        if (found === null) found = here;
        else {
            const both = new Map();
            for (const [id, s] of here) {
                const before = found.get(id);
                if (before !== undefined) both.set(id, before + s);
            }
            found = both;
        }
        if (!found.size) break;
    }
    return found ?? new Map();
}

const LETTERS = { greek: 'αβγδεζηθικλμνξοπρστυφχψω', latin: 'abcdefghijklmnopqrstuvwxyz' };
// Every way of writing a word with one letter changed, added or dropped, past
// its first. In the letters typed, as the fold can make one letter two: it
// merges doubled letters, so «Μεελάου» is 'melau', two from 'menelau'
/** @param {string} word */
function respellings(word) {
    const letters = /[α-ω]/.test(word) ? LETTERS.greek : LETTERS.latin;
    /** @type {Set<string>} */
    const out = new Set();
    for (let i = 1; i <= word.length; i++) {
        const head = word.slice(0, i), tail = word.slice(i);
        if (tail) out.add(head + tail.slice(1));
        for (const c of letters) {
            out.add(head + c + tail);
            if (tail) out.add(head + c + tail.slice(1));
        }
    }
    return out;
}

// Every way of mending a misspelt word by one letter; the town then picks among them.
// typed: each word's fold, and how it was typed
/** @param {Places} db @param {string[]} words @param {Map<string, string>} typed */
function corrected(db, words, typed) {
    let changed = false;
    const fixed = words.map(w => {
        if (w.length < 4 || db.postings.has(w) || wordRange(db.vocabulary, w).length) return [w];
        const close = new Set(db.vocabulary.filter(v => v[0] === w[0] && editOne(v, w)));
        // Every word of the query has its fold in typed
        const respelt = new Set([...respellings(typed.get(w) ?? w)].map(fold).filter(f => db.postings.has(f)));
        // One letter off both as typed and folded beats one way only:
        // «Νικοάου» is 'nikolau' both ways, and 'nikiu' only as «Νικοιου»
        const both = [...close].filter(f => respelt.has(f));
        const mended = both.length ? both : [...new Set([...close, ...respelt])];
        if (mended.length) changed = true;
        return mended.length ? mended : [w];
    });
    return changed ? fixed : null;
}

// The town or neighbourhood these words name, if any. While someone is still
// typing it (partly), the last word may be cut short: 'kera' is Keratsini,
// and also Keratea or Kerameikos
/** @param {Places} db @param {string[]} words @returns {Where | null} */
function whereIs(db, words, partly = false) {
    // 'Μαρο' is on its way to 'Μαρού', and folds to a different letter until it gets there
    /** @param {string} w */
    const cut = w => (w.length >= 4 && /[aeio]$/.test(w) ? w.slice(0, -1) : w);
    /** @param {string} w @param {string} k @param {boolean} last */
    const fits = (w, k, last) => sameName(w, k) || (partly && (words.length > 1 ? k.startsWith(cut(w)) : last && w.length >= 2 && k.startsWith(cut(w))));
    /** @type {number[]} */
    const towns = [];
    db.towns.forEach((t, i) => {
        if (t.keys.some(key => words.every((w, i) => key.some(k => fits(w, k, i === words.length - 1))))) towns.push(i);
    });
    const areas = db.areas.filter(a => a.words.some(key => key.length === words.length && words.every((w, i) => fits(w, key[i], i === words.length - 1))));
    return towns.length || areas.length ? { towns, areas, partly } : null;
}

/** @param {Places} db @param {Entry} e @param {Where} where */
const inside = (db, e, where) => {
    if (where.towns.includes(e.town)) return true;
    if (where.towns.length && !where.partly) return false;
    if (e.type === 'place') return where.areas.some(a => meters(a, e) <= 2500);
    const { lines, pts } = geometry(e);
    const points = [...lines.flat(), ...pts];
    return where.areas.some(a => points.some(p => meters(a, p) <= (a.kind === 'town' ? 3000 : 2000)));
};

const KNOWN = new Set(['metro', 'tram', 'airport']);

// The street's own name counts for more than an old or other name; so does a
// name with nothing left over beside what was typed. A mended word is any of
// its mendings
/** @param {string[]} name @param {(string | string[])[]} words */
const covers = (name, words) => words.every(w => [w].flat().some(f => name.some(n => n.startsWith(f) || f.startsWith(n))));
/** @param {Entry} e @param {(string | string[])[]} words @param {number} strength */
function score(e, words, strength) {
    const known = e.type === 'place' && KNOWN.has(e.kind);
    // A station's or airport's other names are as good as its first
    const names = known ? e.words.filter(n => covers(n, words)) : [e.words[0]].filter(n => covers(n, words));
    const own = names.length > 0;
    const left = own ? Math.min(...names.map(n => Math.abs(n.length - words.length))) : 0;
    const far = e.type === 'place' && !known ? meters(e, { lat: 37.98, lng: 23.73 }) / 10000 : 0;
    return strength * 4 + (own ? 12 : 0) - (own ? left * 2 : 4) + Math.min(e.count, 200) / 40 + (known ? 3 : e.type === 'place' ? 0.5 : 0) - far;
}

// A query read every way that makes sense: with or without a house number,
// with or without a town at its end
/** @param {string} query @returns {Reading[]} */
function readings(query) {
    const [first, ...rest] = query.split(',');
    const explicit = rest.length ? rest.join(' ') : null;
    const tokens = first.trim().split(/\s+/).filter(Boolean);
    const out = [];
    /** @type {number[]} */
    const numberAt = [];
    tokens.forEach((t, i) => { if (/^\d+[α-ωa-z]?([-/]\d+[α-ωa-z]?)?$/i.test(t)) numberAt.push(i); });
    const choices = [...numberAt.map(i => ({ n: parseInt(tokens[i], 10), words: tokens.filter((_, j) => j !== i) })), { n: null, words: tokens }];
    for (const c of choices) {
        const words = wordsOf(c.words.join(' '));
        if (!words.length) continue;
        if (explicit !== null) { out.push({ n: c.n, words, town: wordsOf(explicit), explicit: true }); continue; }
        for (const k of [2, 1]) if (words.length > k) out.push({ n: c.n, words: words.slice(0, -k), town: words.slice(-k), explicit: false });
        out.push({ n: c.n, words, town: null, explicit: false });
    }
    return out;
}

/** @param {Entry} e @param {number | null} n @returns {Located | (Point & { kind: 'place' }) | null} */
function answer(e, n) {
    if (e.type === 'place') return { kind: 'place', lat: e.lat, lng: e.lng };
    const street = geometry(e);
    if (n !== null) return locate(street, n);
    // Only where it is: a street known by its numbers alone has one of them
    // as its middle, which wasn't asked for
    const m = streetMiddle(street);
    return m && { kind: 'street', lat: m.lat, lng: m.lng };
}

const KIND_ORDER = { exact: 0, range: 1, between: 2, beyond: 3, nearest: 4, street: 5, place: 6 };

/**
 * What a search answers: the places found, the town typed when they aren't
 * in it (`notInTown`; `noSuchTown`: no town has that name), and whether the
 * words were mended
 * @typedef {{ results: ReturnType<typeof rank>, notInTown: string | null, noSuchTown?: boolean, corrected: boolean }} Answer
 */

/** @param {Places} db @param {string} query @returns {Answer} */
export function search(db, query, limit = 10) {
    /** @type {Answer} */
    const out = { results: [], notInTown: null, corrected: false };
    if (!query.trim()) return out;
    // Each word's fold, and the word as typed
    const typed = new Map(plain(query).split(/[^\p{L}\p{N}]+/u).flatMap(t => fold(t).split(' ').map(w => [w, t])));
    let elsewhere = /** @type {{ reading: Reading, list: Scored[], fixed: boolean } | null} */ (null);
    // A town after a comma can be cut short at once; one with no comma only
    // once nothing else has made sense of the words
    const tries = readings(query).flatMap(r => [{ ...r, partly: r.explicit }]);
    tries.push(...readings(query).filter(r => !r.explicit && r.town).map(r => ({ ...r, partly: true })));
    for (const reading of tries) {
        // One letter says too little to choose a town by
        if (reading.explicit && reading.town && reading.town.join('').length < 2) reading.town = null;
        // A whole town name stays strict: never a neighbour's street
        const whole = reading.town?.length ? whereIs(db, reading.town) : null;
        const cutShort = reading.partly && reading.town?.length ? whereIs(db, reading.town, true) : null;
        // Still on its way to more towns than the one it looks like ('kerat': Keratea, Keratsini)
        const growing = cutShort?.towns.some(t => !whole?.towns.includes(t));
        const where = growing || !whole?.towns.length ? cutShort ?? whole : whole;
        if (reading.town && !where && !reading.explicit) continue;
        const named = reading.explicit && reading.town;
        /** @type {(string | string[])[]} */
        let words = reading.words;
        let found = match(db, words);
        let fixed = false;
        if (!found.size) {
            const mended = corrected(db, reading.words, typed);
            if (mended) { found = match(db, mended); fixed = found.size > 0; words = mended; }
        }
        if (!found.size) continue;
        // A mended word is scored as what it was mended to, not as typed
        let list = [...found].map(([id, s]) => ({ e: db.entries[id], s: score(db.entries[id], words, s) }));
        if (reading.n !== null) list = list.filter(x => x.e.type === 'street');
        if (where || named) {
            const near = where ? list.filter(x => inside(db, x.e, where)) : [];
            if (!near.length) {
                if (!reading.explicit) { elsewhere ??= { reading, list, fixed }; continue; }
                // Named after a comma, so there is a town
                out.notInTown = reading.town?.join(' ') ?? null;
                out.noSuchTown = !where;
            } else if (where) list = where.partly ? near.map(x => ({ ...x, s: x.s + (where.towns.includes(x.e.town) ? 8 : 0) })) : near;
        }
        if (!list.length) continue;
        out.corrected = fixed;
        out.results = rank(db, list, reading.n, limit);
        if (out.results.length) return out;
    }
    if (elsewhere) {
        // Only kept when it named a town
        out.notInTown = elsewhere.reading.town?.join(' ') ?? null;
        out.corrected = elsewhere.fixed;
        out.results = rank(db, elsewhere.list, elsewhere.reading.n, limit);
    }
    return out;
}

/** @param {Places} db @param {Scored[]} list @param {number | null} n @param {number} limit */
function rank(db, list, n, limit) {
    return list
            .flatMap(x => { const at = answer(x.e, n); return at ? [{ ...x, at }] : []; })
            .sort((a, b) => (b.s - KIND_ORDER[b.at.kind]) - (a.s - KIND_ORDER[a.at.kind]))
            // A street on a border is kept in both towns: once is enough here
            .filter((x, i, all) => !all.slice(0, i).some(y => y.e.type === x.e.type && y.e.names[0] === x.e.names[0] && meters(y.at, x.at) < 150))
            .slice(0, limit)
            .map(x => ({
                name: x.e.names[0], town: db.towns[x.e.town]?.name ?? '', type: x.e.type, placeKind: x.e.kind, lineNames: x.e.type === 'place' ? x.e.lines : [], n,
                numbers: x.e.count, ...x.at, lat: round(x.at.lat), lng: round(x.at.lng),
            }));
}
