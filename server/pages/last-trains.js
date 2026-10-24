import { formatDate, localName } from '../../public/js/core/html.js';
import { linePill } from '../../public/js/core/lines.js';
import { clockTime } from '../../public/js/core/metro.js';
import { firstAndLast } from './stations.js';

// The Info page's last metro trains (tools/info/page.hbs), from rail.json, so
// they're never older than STASY's copy. `spec` is the info tool's data.json
// "lastTrains": the table's rows and the facts its text mentions, each
// { line, from, to } (and `showTo` for a row that names where it goes,
// `first` for a fact about the first train). Each gets the trains from
// `from` going at least as far as `to`: STASY's (the stop's hours) or,
// without them, the timetable's. One that rail.json doesn't have is left out
// (a fact says "–"); test/last-trains.test.js checks the real one has them all.
//   rows:  [{ badge?: { key, name, rows }, name, times: [{ text, colspan? }] }]
//          its last train on Sundays to Thursdays, Fridays and Saturdays
//          (one cell across when they're the same); the badge on a line's first row
//   facts: { name: '22:54', … } on a Monday
//   stasy: the date of STASY's copy (dd/mm/yyyy) when the times are STASY's
// Before the first build (no rail.json): no rows, and "–" for each fact.

// Sunday to Thursday (as Monday), Friday, Saturday
const COLUMNS = [1, 5, 6];

// The first and last trains from `from` going at least as far as `to`, by weekday (null: no such trains)
function trains(rail, { line, from, to }) {
    const direction = Object.values(rail.lines[line]?.directions ?? {}).find(d => {
        const order = d.stops.map(s => s.station);
        return order.includes(from) && order.indexOf(to) > order.indexOf(from);
    });
    if (!direction) return null;
    const order = direction.stops.map(s => s.station);
    const [i, j] = [order.indexOf(from), order.indexOf(to)];
    const hours = direction.stops[i].hours?.find(h => order.indexOf(h.to) >= j);
    if (hours) return { first: hours.first, last: hours.last, stasy: true };
    // The timetable's, from its trains that go that far (firstAndLast: all night when one runs into the next day)
    const { timetable } = direction;
    const reaching = { ...timetable, patterns: timetable.patterns.map(p => p.filter(([, k]) => timetable.profiles[k].stops.at(-1) >= j)) };
    const first = Array(7).fill(undefined);
    const last = Array(7).fill(undefined);
    for (const group of firstAndLast(reaching, i)) for (const d of group.days) [first[d], last[d]] = [group.first, group.last];
    return { first, last, stasy: false };
}

/**
 * @param {import('../../types/data.js').Rail | null} rail
 * @param {{ table: any[], facts: Record<string, any> }} spec
 * @param {import('../../types/pages.js').Lang} lang @param {(key: string) => string} s
 */
export function lastTrains(rail, spec, lang, s) {
    if (!rail) return { rows: [], facts: Object.fromEntries(Object.keys(spec.facts).map(key => [key, '–'])), stasy: null };
    const time = seconds => seconds === null ? s('info.all-night') : seconds === undefined ? '–' : clockTime(seconds);
    const name = id => localName(rail.stations[id].name, lang);
    let stasy = true;
    const found = spec.table.map(row => ({ row, times: trains(rail, row) })).filter(r => r.times);
    const rows = found.map(({ row, times }, k) => {
        stasy &&= times.stasy;
        const texts = COLUMNS.map(d => time(times.last[d]));
        return {
            ...(found.findIndex(r => r.row.line === row.line) === k && {
                badge: { pill: linePill(row.line, rail.lines[row.line].name), rows: found.filter(r => r.row.line === row.line).length },
            }),
            name: row.showTo ? `${name(row.from)} → ${name(row.to)}` : name(row.from),
            times: texts.every(t => t === texts[0]) ? [{ text: texts[0], colspan: COLUMNS.length }] : texts.map(text => ({ text })),
        };
    });
    const facts = Object.fromEntries(Object.entries(spec.facts).map(([key, fact]) => {
        const times = trains(rail, fact);
        if (!times) return [key, '–'];
        stasy &&= times.stasy;
        return [key, time((fact.first ? times.first : times.last)[1])];
    }));
    return { rows, facts, stasy: stasy && rail.hours ? formatDate(rail.hours.fetched) : null };
}
