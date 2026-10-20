import { DAY_NAMES } from './calendar.js';
import { HOURS_LEEWAY } from './build-rail.js';
import { readDays } from './stasy.js';

// What each night's build checks in the metro timetable it made (rail.json)
// against STASY's own tables, since the GTFS can't be trusted to stay as it
// was (agreed 2026-10-20, item 20). Two kinds:
//   - problems: what the timetable code relies on no longer holds. They fail
//     /api/health, so they're emailed. Data the code can't use at all already
//     fails the build (check-output.js), and the site keeps the last timetable.
//   - notes: the GTFS and STASY disagree, or the build worked around the GTFS.
//     They show on /admin/diagnostics.
// Neither changes the timetable.
//
// Problems: a stop trains leave from without STASY's first and last trains
// (on a line STASY's copy has), as only those keep depot runs out there.
// Notes: a first or last train more than HOURS_LEEWAY off STASY's (trains
// the GTFS is missing, like the late airport ones were); how often trains run
// against STASY's frequency tables; the dates with their own trains (a
// holiday); and the build's own (`notes`: dates laid over twice).

// Frequencies are compared over STASY's hours of at least an hour, and differ
// when the GTFS's average gap there is more than FREQUENCY_TOLERANCE of
// STASY's off, and at least a minute
const MIN_WINDOW = 3600;
const FREQUENCY_TOLERANCE = 0.15;
const DAY = 86_400;

/**
 * rail: rail.json; frequencies: STASY's frequency tables by line (stasy.js,
 * extractFrequencies), or null; notes: the build's own.
 * @param {import('../../types/data.js').Rail} rail
 * @param {{ frequencies?: Record<string, string[][]> | null, notes?: string[] }} [options]
 * @returns {{ problems: string[], notes: string[] }}
 */
export function checkRail(rail, { frequencies = null, notes = [] } = {}) {
    return {
        problems: rail.hours ? missingHours(rail) : [],
        notes: [
            ...(rail.hours ? firstAndLastNotes(rail) : []),
            ...(frequencies ? frequencyNotes(rail, frequencies) : []),
            ...datesNotes(rail),
            ...notes,
        ],
    };
}

// Stops trains leave from without STASY's times, on lines it has times for
function missingHours(rail) {
    const problems = [];
    for (const [lineId, { directions }] of Object.entries(rail.lines)) {
        const all = Object.values(directions).flatMap(d => d.stops.slice(0, -1));
        if (!all.some(s => s.hours)) {
            problems.push(`${lineId}: no first and last trains from STASY at any stop, so its depot runs aren't left out`);
            continue;
        }
        for (const [dirKey, { stops }] of Object.entries(directions)) {
            const without = stops.slice(0, -1).filter(s => !s.hours).map(s => name(rail, s.station));
            if (without.length) problems.push(`${lineId}/${dirKey}: no first and last trains from STASY at ${without.join(', ')}, so depot runs aren't left out there`);
        }
    }
    return problems;
}

// The timetable's first and last trains from each stop, against STASY's: a
// later first train or an earlier last one means the GTFS misses trains.
// One note per direction, destination and kind, at the first stop it happens.
function firstAndLastNotes(rail) {
    const found = new Map();
    for (const [lineId, { directions }] of Object.entries(rail.lines)) {
        for (const [dirKey, { stops, timetable }] of Object.entries(directions)) {
            const at = new Map(stops.map((s, i) => [s.station, i]));
            stops.forEach((stop, i) => {
                for (const h of stop.hours ?? []) {
                    for (let wd = 0; wd < 7; wd++) {
                        // Trains leaving here that reach `to`, at least
                        const times = departuresFrom(timetable, wd, i, at.get(h.to));
                        const first = times.length ? Math.min(...times) : null;
                        const last = times.length ? Math.max(...times) : null;
                        for (const [kind, stasy, gtfs, late] of [['first', h.first[wd], first, first !== null && first - h.first[wd] > HOURS_LEEWAY],
                            ['last', h.last[wd], last, last !== null && h.last[wd] - last > HOURS_LEEWAY]]) {
                            if (stasy === null || !(gtfs === null || late)) continue;
                            const key = `${lineId}/${dirKey}|${h.to}|${kind}`;
                            if (!found.has(key)) found.set(key, { where: `${lineId}/${dirKey}`, to: h.to, kind, station: stop.station, stasy, gtfs, days: new Set(), stops: new Set() });
                            const f = found.get(key);
                            f.days.add(wd);
                            f.stops.add(stop.station);
                        }
                    }
                }
            });
        }
    }
    return [...found.values()].map(f => {
        const more = f.stops.size > 1 ? `, and at ${f.stops.size - 1} more stops` : '';
        const gtfs = f.gtfs === null ? 'none' : clock(f.gtfs);
        return `${f.where}: the ${f.kind} train to ${name(rail, f.to)} from ${name(rail, f.station)} is ${gtfs} in the GTFS, ${clock(f.stasy)} in STASY's table (${dayList([...f.days])})${more}: the GTFS misses trains`;
    });
}

// Departure times from stop index `from` on weekday `wd`'s trains that reach stop index `to` or further
function departuresFrom(timetable, wd, from, to) {
    return timetable.patterns[timetable.days[wd]].flatMap(([start, p]) => {
        const { stops, offsets } = timetable.profiles[p];
        const k = stops.indexOf(from);
        return k !== -1 && k < stops.length - 1 && stops.at(-1) >= to ? [start + offsets[k]] : [];
    });
}

// STASY's frequency rows → [{ days, from, to, every }] (seconds; `to` after
// midnight is past DAY). Its day names in full ("Δευτέρα - Πέμπτη") are read
// as stasy.js reads them short ("ΔΕΥ-ΠΕΜ"); the first frequency column is the
// line's (line 3's second is the airport trains')
export function readFrequencies(rows) {
    const out = [];
    let days = null;
    // A period's rows run in time order: one starting earlier than the row
    // before is after midnight (Saturday's "00:20 - 05:30" is that night's)
    let previous = 0;
    for (const [period, hours, every] of rows) {
        const range = /^(\d\d?):(\d\d)\s*-\s*(\d\d?):(\d\d)$/.exec(hours ?? '');
        if (!range) continue;
        if (period) {
            days = readDays(period.replace(/\p{L}+/gu, word => word.slice(0, 3)));
            if (!days) throw new Error(`unknown days "${period}"`);
            previous = 0;
        }
        if (!days) throw new Error(`hours ${hours} before any days`);
        // 7' 30" (minutes and seconds), written with apostrophes or primes
        const gap = /^(\d+)\s*['′’΄]\s*(?:(\d+)\s*["″”]?)?$/.exec(every ?? '');
        if (!gap) throw new Error(`unknown frequency "${every}"`);
        let from = +range[1] * 3600 + +range[2] * 60;
        if (from < previous) from += DAY;
        let to = +range[3] * 3600 + +range[4] * 60;
        while (to <= from) to += DAY;
        previous = from;
        out.push({ days, from, to, every: +gap[1] * 60 + +(gap[2] ?? 0) });
    }
    if (!out.length) throw new Error('no rows with hours');
    return out;
}

// How often trains run in the timetable, at the stop most trains call at
// (the middle of the line), against STASY's table, for each direction
function frequencyNotes(rail, frequencies) {
    const notes = [];
    for (const [lineId, rows] of Object.entries(frequencies)) {
        const line = rail.lines[lineId];
        if (!line || !rows?.length) continue;
        let periods;
        try { periods = readFrequencies(rows); } catch (err) {
            notes.push(`${lineId}: STASY's frequency table couldn't be read (${err.message}), so it isn't compared`);
            continue;
        }
        for (const { stops, timetable, toward } of Object.values(line.directions)) {
            const at = busiestStop(timetable, stops.length);
            const differ = new Map();
            for (const { days, from, to, every } of periods) {
                if (to - from < MIN_WINDOW) continue;
                for (const wd of days) {
                    // With the night before's trains after midnight (Saturday's all-night ones on Sunday morning)
                    const times = [...departuresFrom(timetable, (wd + 6) % 7, at, at).map(t => t - DAY), ...departuresFrom(timetable, wd, at, at)]
                        .filter(t => t >= from && t < to).sort((a, b) => a - b);
                    if (times.length < 3) continue;
                    // On average: a branch's trains in between make the gaps uneven (line 3's airport trains)
                    const gap = Math.round((times.at(-1) - times[0]) / (times.length - 1));
                    if (Math.abs(gap - every) <= Math.max(60, every * FREQUENCY_TOLERANCE)) continue;
                    const key = `${from}|${to}|${gap}|${every}`;
                    if (!differ.has(key)) differ.set(key, { from, to, gap, every, days: [] });
                    differ.get(key).days.push(wd);
                }
            }
            for (const d of differ.values()) {
                notes.push(`${lineId} toward ${toward.en}, ${dayList(d.days)} ${clock(d.from)}–${clock(d.to)}: a train every ${minutes(d.gap)} in the GTFS, ${minutes(d.every)} in STASY's table (at ${name(rail, stops[at].station)})`);
            }
        }
    }
    return notes;
}

// The stop index the most trains leave from in the typical week
function busiestStop(timetable, stopCount) {
    const count = Array(stopCount).fill(0);
    for (const wd of timetable.days) {
        for (const [, p] of timetable.patterns[wd]) for (const s of timetable.profiles[p].stops.slice(0, -1)) count[s]++;
    }
    return count.reduce((best, n, i) => n > count[best] || (n === count[best] && Math.abs(i - stopCount / 2) < Math.abs(best - stopCount / 2)) ? i : best, 0);
}

// The dates the timetable has its own trains for (a holiday), with the lines
function datesNotes(rail) {
    const lines = new Map();
    for (const [lineId, { directions }] of Object.entries(rail.lines)) {
        for (const { timetable } of Object.values(directions)) {
            for (const date of Object.keys(timetable.dates ?? {})) lines.set(date, new Set([...(lines.get(date) ?? []), lineId]));
        }
    }
    return [...lines].sort().map(([date, ids]) => `${date}: ${[...ids].sort().join(', ')} run${ids.size === 1 ? 's' : ''} trains of their own that day (a holiday?), from the GTFS`);
}

const name = (rail, station) => rail.stations[station]?.name.en ?? station;
const clock = s => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
const minutes = s => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, '0')}"`;
const dayList = days => days.length === 7 ? 'every day' : [...new Set(days)].sort().map(d => DAY_NAMES[d]).join(', ');
