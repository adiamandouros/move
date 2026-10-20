import { mkdirSync } from 'fs';
import { join } from 'path';
import { readJson, writeFileAtomic } from '../files.js';
import { decode } from '../info/announcements.js';

// STASY's own first and last trains for metro lines 1–3, from its timetable
// pages (fetched by server/stasy.js, directly or through the relays). The
// open-data GTFS has trains STASY doesn't publish (depot runs) and misses
// some it does (the last airport trains), so rail.json's stops carry these
// times (applyHours, called by build-rail.js).
//
// Fetched by the nightly data build, gently (approved 2026-10-20):
//   - at most every STASY_MAX_AGE_MS (14 days: STASY changes them about
//     twice a year)
//   - the 3 pages, one at a time, PACE_MS apart
//   - no retries: a failed fetch keeps the last copy, and the next build
//     tries again (at most 3 requests a night while it fails)
// A fetch replaces the kept copy only when every page can be read (readLine),
// so a change on STASY's side keeps the last good copy, and is reported in
// rawDir/stasy/last-fetch.json (shown by /admin/diagnostics and /api/health).
//
// The kept copy, rawDir/stasy/tables.json, is just the tables, as text:
// { fetched: ISO time, lines: { M1: [{ header: [...], rows: [[...], ...], notes: [...] }, ...] },
//   frequencies: { M1: [[period, hours, every, ...], ...] } }   ← how often trains run (rail-checks.js; copies from before 2026-10-21 have none)
// They're read at every build, so a change to the reading rules needs no new fetch.

export const STASY_MAX_AGE_MS = 14 * 86_400_000;
export const PACE_MS = 1000;
// rail.json's line → the number of STASY's page for it
export const STASY_LINES = /** @type {const} */ ({ M1: 1, M2: 2, M3: 3 });
// The last fetch: { at, ok, route?, error?, unreadable? } (unreadable: the pages came, but changed)
export const stasyFetchFile = rawDir => join(rawDir, 'stasy', 'last-fetch.json');
const tablesFile = rawDir => join(rawDir, 'stasy', 'tables.json');

const DAY = 86_400;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Reading the pages ───────────────────────────────────────────────────────

// Upper case without accents, with Latin letters that look Greek made Greek
// (STASY writes "NIKAIA" and "ΜΕΤAΞΟΥΡΓΕΙΟ")
const LOOKALIKES = { A: 'Α', B: 'Β', E: 'Ε', Z: 'Ζ', H: 'Η', I: 'Ι', K: 'Κ', M: 'Μ', N: 'Ν', O: 'Ο', P: 'Ρ', T: 'Τ', Y: 'Υ', X: 'Χ' };
const upper = text => text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[ABEZHIKMNOPTYX]/g, c => LOOKALIKES[c]);
// A station name as a key: letters and digits only ("Κ.Α.Τ." → "ΚΑΤ"); validate.js
// uses it too, so no two stations share a name
export const stasyNameKey = text => upper(text).replace(/[^\p{L}\p{N}]/gu, '');

// The first-and-last tables of a timetable page: [{ header, rows, notes }],
// every cell as plain text. Such a table's headings start with "ΑΠΟ ΣΤΑΘΜΟ"
// (from station) and include a first or last train; its rows starting with
// "Σημείωση" or "*" are notes.
/** @param {string} html */
export function extractTables(html) {
    const cells = row => [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(m => decode(m[1]));
    return [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].flatMap(([table]) => {
        const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(([row]) => cells(row));
        const at = rows.findIndex(r => stasyNameKey(r[0] ?? '') === 'ΑΠΟΣΤΑΘΜΟ');
        if (at === -1 || !rows[at].slice(1).some(h => /^(ΠΡΩΤ|ΤΕΛΕΥΤΑΙ)/.test(upper(h)))) return [];
        const body = rows.slice(at + 1).filter(r => r.some(Boolean));
        const isNote = r => /^(ΣΗΜΕΙΩΣΗ|\*)/.test(upper(r[0]));
        return [{ header: rows[at], rows: body.filter(r => !isNote(r)), notes: body.filter(isNote).map(r => r.filter(Boolean).join(' ')) }];
    });
}

// The rows of a timetable page's frequency table (ΣΥΧΝΟΤΗΤΑ), every cell as
// plain text: the period ("ΔΕΥΤΕΡΑ - ΠΑΡΑΣΚΕΥΗ", only on its first row), the
// hours ("05:30 - 07:00") and how often ("7' 30\""), with the heading rows;
// read by rail-checks.js
/** @param {string} html @returns {string[][]} */
export function extractFrequencies(html) {
    const cells = row => [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(m => decode(m[1]));
    const table = [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map(([t]) => t).find(t => /ΣΥΧΝΟΤΗΤΑ/.test(upper(decode(t))));
    return table ? [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(([row]) => cells(row)).filter(r => r.some(Boolean)) : [];
}

// stations.json's stations → Map(name key → station id), from each one's
// Greek name and its "stasy" names (how STASY writes it, if that differs)
export function stationNames(stations) {
    const names = new Map();
    for (const [id, s] of Object.entries(stations)) for (const name of [s.name.el, ...(s.stasy ?? [])]) names.set(stasyNameKey(name), id);
    return names;
}

const DAY_NAMES = { ΚΥΡ: 0, ΔΕΥ: 1, ΤΡΙ: 2, ΤΕΤ: 3, ΠΕΜ: 4, ΠΑΡ: 5, ΣΑΒ: 6 };

// "ΔΕΥ-ΠΑΡ" → [1, 2, 3, 4, 5], "ΔΕΥ - ΠΕΜ & ΚΥΡ" → [0, 1, 2, 3, 4], "Σ/Κ" → [0, 6];
// null when it isn't days
export function readDays(text) {
    const days = [];
    for (const part of upper(text).replace(/\s/g, '').split(/[&,]/)) {
        if (part === 'Σ/Κ') { days.push(6, 0); continue; }
        const [from, to = from, ...more] = part.split('-');
        if (more.length || !(from in DAY_NAMES) || !(to in DAY_NAMES)) return null;
        for (let d = DAY_NAMES[from]; ; d = (d + 1) % 7) {
            days.push(d);
            if (d === DAY_NAMES[to]) break;
        }
    }
    return days.sort();
}

// A column's heading → { kind: 'first' | 'last', days }, or null for one that
// isn't used ("ΔΕΥΤΕΡΟ (ΑΕΡΟΔΡΟΜΙΟ)", the second airport train). In brackets:
// the days (none: every day), or a station, which only labels the column.
function readHeading(text, names) {
    const word = upper(text.replace(/[([][^)\]]*[)\]]/g, '')).replace(/[\s*]/g, '');
    const kind = /^ΠΡΩΤΟΣ?$/.test(word) ? 'first' : /^ΤΕΛΕΥΤΑΙΟΣ?$/.test(word) ? 'last' : /^ΔΕΥΤΕΡΟΣ?$/.test(word) ? null : undefined;
    if (kind === undefined) throw new Error(`unknown column "${text}"`);
    let days = null;
    for (const [, group] of text.matchAll(/[([]([^)\]]*)[)\]]/g)) {
        const groupDays = readDays(group);
        if (groupDays && !days) days = groupDays;
        else if (groupDays || !names.has(stasyNameKey(upper(group).replace(/^\s*ΕΩΣ\s*(ΣΤ\.)?/, '')))) throw new Error(`unknown column "${text}"`);
    }
    return kind && { kind, days: days ?? EVERY_DAY };
}

// The note under M2's and M3's tables: "Κάθε Σάββατο υπάρχει 24ωρη λειτουργία
// στις Γραμμές 2 και 3 … εξαιρούνται τα δρομολόγια … από και προς το
// Αεροδρόμιο" → { lines: ['M2', 'M3'], except: ['airport'] }, or null
function readAllNight(notes, names) {
    const text = upper(notes.join(' '));
    const found = text.match(/ΚΑΘΕ ΣΑΒΒΑΤΟ ΥΠΑΡΧΕΙ 24ΩΡΗ ΛΕΙΤΟΥΡΓΙΑ ΣΤΙΣ ΓΡΑΜΜΕΣ ([\d\s,ΚΑΙ]+)/);
    if (!found) {
        if (/24ΩΡΗ/.test(text)) throw new Error(`unknown note "${notes.join(' ')}"`);
        return null;
    }
    const except = [];
    if (/ΕΞΑΙΡΟΥΝΤΑΙ/.test(text)) {
        const name = text.match(/ΑΠΟ ΚΑΙ ΠΡΟΣ (?:ΤΟ |ΤΗΝ |ΤΟΝ )?([^\s(,.]+)/)?.[1];
        const id = name && names.get(stasyNameKey(name));
        if (!id) throw new Error(`unknown note "${notes.join(' ')}": which trains it leaves out`);
        except.push(id);
    }
    return { lines: found[1].match(/\d+/g).map(n => `M${n}`), except };
}

// "05:30" → seconds since midnight; a last train before 04:00 leaves after midnight
function readTime(text, kind) {
    const hm = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!hm || +hm[1] > 23 || +hm[2] > 59) throw new Error(`unknown time "${text}"`);
    const seconds = +hm[1] * 3600 + +hm[2] * 60;
    return kind === 'last' && seconds < 4 * 3600 ? seconds + DAY : seconds;
}

/**
 * One line's tables (extractTables) → each direction, in the page's order:
 * { stations: [station ids, in travel order], hours: Map(station → [{ to, first, last }]) }.
 * A column's trains run from each row that has a time to its last such row,
 * where they end. "to X" counts every train going at least as far as X; each
 * of `first` and `last` has a value for every day (index 0 = Sunday), in
 * seconds since midnight, null when the trains run all night. Throws when
 * anything on the page can't be read.
 * @param {string} lineId @param {{ header: string[], rows: string[][], notes: string[] }[]} tables
 * @param {Map<string, string>} names (stationNames)
 */
export function readLine(lineId, tables, names) {
    if (tables.length !== 2) throw new Error(`${tables.length} first-and-last tables, not one for each direction`);
    const allNight = readAllNight(tables.flatMap(t => t.notes), names);
    return tables.map(table => readDirection(table, names, allNight?.lines.includes(lineId) ? allNight.except : null));
}

// `allNightExcept`: Saturday's trains run all night, except to and from these stations (null: they don't)
function readDirection({ header, rows }, names, allNightExcept) {
    const stations = rows.map(([name]) => {
        const id = names.get(stasyNameKey(upper(name).replace(/^\s*ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ\s*/, '')));
        if (!id) throw new Error(`unknown station "${name}" (add how STASY writes it to the station's "stasy" names in stations.json)`);
        return id;
    });
    if (new Set(stations).size !== stations.length) throw new Error(`a station is listed twice: ${stations.join(', ')}`);

    // Each column's departures: [row, to (row), kind, days, seconds, allNight]
    const departures = [];
    header.forEach((heading, col) => {
        const column = col > 0 && readHeading(heading, names);
        if (!column) return;
        const filled = rows.flatMap((row, i) => row[col] ? [i] : []);
        const to = filled.at(-1);
        const allNight = allNightExcept !== null && !allNightExcept.includes(stations[filled[0]]) && !allNightExcept.includes(stations[to]);
        for (const i of filled.slice(0, -1)) departures.push({ row: i, to, ...column, seconds: readTime(rows[i][col], column.kind), allNight });
    });

    const hours = new Map();
    stations.forEach((station, row) => {
        const here = departures.filter(d => d.row === row);
        const entries = [...new Set(here.map(d => d.to))].sort((a, b) => a - b).map(to => {
            const going = here.filter(d => d.to >= to);
            const day = (kind, pick) => EVERY_DAY.map(wd => {
                const times = going.filter(d => d.kind === kind && d.days.includes(wd)).map(d => d.seconds);
                return times.length ? pick(...times) : undefined;
            });
            const first = day('first', Math.min);
            const last = day('last', Math.max);
            // Trains that run all night: no last on Saturday, no first on Sunday
            if (going.some(d => d.allNight)) [last[6], first[0]] = [null, null];
            for (const [kind, values] of [['first', first], ['last', last]]) {
                const missing = EVERY_DAY.filter(wd => values[wd] === undefined);
                if (missing.length) throw new Error(`no ${kind} train from ${station} to ${stations[to]} on day ${missing.join(', ')} (0 = Sunday)`);
            }
            return { to: stations[to], first, last };
        });
        if (entries.length) hours.set(station, entries);
    });
    return { stations, hours };
}

// ── rail.json ───────────────────────────────────────────────────────────────

/**
 * Put STASY's times on rail.json's stops (stops[i].hours, see readLine). A
 * line the copy can't give times for keeps the GTFS's, with a warning.
 * Returns the date of the copy (YYYY-MM-DD), or null when no line got times.
 * @param {Record<string, import('../../types/data.js').Line>} lines rail.json's lines
 * @param {{ fetched: string, lines: Record<string, any> } | null} copy (stasyTables)
 * @param {Record<string, any>} stations stations.json's stations
 * @param {string[]} warnings
 */
export function applyHours(lines, copy, stations, warnings) {
    if (!copy) return null;
    const names = stationNames(stations);
    let used = false;
    for (const [lineId, line] of Object.entries(lines)) {
        try {
            if (!copy.lines[lineId]) throw new Error('not in the copy');
            const placed = readLine(lineId, copy.lines[lineId], names).map(({ stations: list, hours }) => {
                const found = Object.entries(line.directions).find(([, d]) => d.stops.at(-1).station === list.at(-1));
                if (!found) throw new Error(`a table ends at ${list.at(-1)}, where no direction ends`);
                const order = found[1].stops.map(s => s.station);
                list.forEach((station, i) => {
                    if (order.indexOf(station) <= (i ? order.indexOf(list[i - 1]) : -1)) throw new Error(`${found[0]}: ${station} isn't where the line has it`);
                });
                return { dirKey: found[0], hours };
            });
            if (placed[0].dirKey === placed[1].dirKey) throw new Error(`both tables are for ${placed[0].dirKey}`);
            for (const { dirKey, hours } of placed) {
                const stops = line.directions[dirKey].stops;
                for (const stop of stops) if (hours.has(stop.station)) stop.hours = hours.get(stop.station);
                const without = stops.slice(0, -1).filter(s => !s.hours).map(s => s.station);
                if (without.length) warnings.push(`STASY ${lineId}/${dirKey}: no first and last trains for ${without.join(', ')}; their GTFS times are used`);
            }
            used = true;
        } catch (err) {
            warnings.push(`STASY ${lineId}: ${err.message}; its first and last trains come from the GTFS`);
        }
    }
    return used ? copy.fetched.slice(0, 10) : null;
}

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * The kept copy of STASY's tables, fetched anew once it's STASY_MAX_AGE_MS old.
 * client: server/stasy.js's (none, or offline: only the kept copy);
 * stations: stations.json's stations, to check the pages can be read.
 * @returns {Promise<{ copy: { fetched: string, lines: Record<string, any> } | null, error?: string }>}
 */
export async function stasyTables({ rawDir, client = null, stations, offline = false, now = Date.now, sleep = realSleep, log = console.log }) {
    const kept = readJson(tablesFile(rawDir));
    const keep = error => kept ? { copy: kept } : { copy: null, error };
    if (offline || !client) return keep('STASY\'s timetables haven\'t been fetched yet');
    if (kept && now() - Date.parse(kept.fetched) < STASY_MAX_AGE_MS) return { copy: kept };

    const names = stationNames(stations);
    const at = new Date(now()).toISOString();
    const record = result => writeFileAtomic(stasyFetchFile(rawDir), JSON.stringify({ at, ...result }));
    mkdirSync(join(rawDir, 'stasy'), { recursive: true });
    let unreadable = false;
    try {
        const lines = {};
        const frequencies = {};
        for (const [lineId, page] of Object.entries(STASY_LINES)) {
            if (Object.keys(lines).length) await sleep(PACE_MS);
            const html = await client.timetable(page);
            const tables = extractTables(html);
            frequencies[lineId] = extractFrequencies(html);
            try { readLine(lineId, tables, names); } catch (err) {
                unreadable = true;
                throw new Error(`${lineId}: ${err.message}`, { cause: err });
            }
            lines[lineId] = tables;
        }
        const copy = { fetched: at, lines, frequencies };
        writeFileAtomic(tablesFile(rawDir), JSON.stringify(copy));
        record({ ok: true, route: client.route });
        log(`[data] Fetched STASY's timetables (${client.route})`);
        return { copy };
    } catch (err) {
        record({ ok: false, error: err.message, ...(unreadable ? { unreadable, route: client.route } : {}) });
        log(`[data] Couldn't ${unreadable ? 'read' : 'fetch'} STASY's timetables: ${err.message}${kept ? ` — using the copy from ${kept.fetched.slice(0, 10)}` : ''}`);
        return keep(err.message);
    }
}
