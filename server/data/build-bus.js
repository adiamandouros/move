import { existsSync } from 'fs';
import { join } from 'path';
import { readCsv, readCsvAll } from './csv.js';
import { isoDate, serviceDates } from './calendar.js';
import { STOP_CODE } from './check-output.js';

// Build bus-stops.json and bus-lines.json from OASA's bus feed. The feed is
// read once (readBusFeed) for both; stop_times.txt alone is 220 MB.
//
// bus-stops.json: a compact index of every bus/trolley stop, so the browser
// can find stops near you or by name without calling OASA:
// {
//   schema, generated,
//   feed:   { validFrom, validTo },
//   fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'],
//   stops:  [['10361', 37.97491, 23.73488, 'ΣΥΝΤΑΓΜΑ', 'SYNTAGMA', ['024', '035', …]], …]
// }
// `code` is the GTFS stop_id, which is the stop code the telematics API uses.
// `en` comes from OASA's separate stop table and may be empty.
//
// bus-lines.json: each line's stops in order, one list per direction:
// {
//   schema, generated, feed,
//   lines: [{ line: '040', name: 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ',
//             directions: [{ to: 'ΠΕΙΡΑΙΑΣ', stops: ['10341', …] }, { to: 'ΣΥΝΤΑΓΜΑ', stops: […] }] }, …]
// }
// OASA files every trip under direction 0, so a line's directions are its
// trips' stop sequences: the one most trips follow, and the one most trips
// follow back the other way (it starts nearer where the first ends than where
// it starts). A circular line has just one. A line number with several GTFS
// routes (short workings such as "ΑΠΟ ΣΤΑΣΗ ΚΑΡΑΒΟΣ") is its busiest route.

export const BUS_SCHEMA = 1;
export const BUS_LINES_SCHEMA = 1;

const MIN_STOPS = 1000;
const MIN_LINES = 1;

/**
 * Everything both files need from the feed, read in one pass over stop_times.txt
 * @param {string} dir
 */
export async function readBusFeed(dir) {
    const file = name => join(dir, name);

    /** @type {Map<string, { line: string, name: string }>} */
    const routes = new Map();
    for (const r of await readCsvAll(file('routes.txt'), { required: ['route_id', 'route_short_name'] })) {
        routes.set(r.route_id, { line: r.route_short_name, name: (r.route_long_name ?? '').replace(/\s+/g, ' ').trim() });
    }

    /** @type {Map<string, { route: string, headsign: string }>} */
    const trips = new Map();
    for await (const t of readCsv(file('trips.txt'), { required: ['route_id', 'trip_id'] })) {
        if (routes.has(t.route_id)) trips.set(t.trip_id, { route: t.route_id, headsign: (t.trip_headsign ?? '').replace(/\s+/g, ' ').trim() });
    }

    // Per stop, the lines that call there; per route, how many trips follow
    // each sequence of stops, and their headsigns. stop_times.txt lists each
    // trip's stops together, so one trip is held at a time.
    /** @type {Map<string, Set<string>>} */
    const stopLines = new Map();
    /** @type {Map<string, Map<string, { stops: string[], trips: number, headsigns: Map<string, number> }>>} */
    const patterns = new Map();
    const done = new Set();
    let ungrouped = null;
    /** @type {{ id: string, calls: [number, string][] } | null} */
    let current = null;
    const finish = () => {
        if (!current) return;
        const trip = trips.get(current.id);
        done.add(current.id);
        const stops = current.calls.sort((a, b) => a[0] - b[0]).map(c => c[1]);
        const key = stops.join(' ');
        if (!patterns.has(trip.route)) patterns.set(trip.route, new Map());
        const byKey = patterns.get(trip.route);
        if (!byKey.has(key)) byKey.set(key, { stops, trips: 0, headsigns: new Map() });
        const pattern = byKey.get(key);
        pattern.trips++;
        pattern.headsigns.set(trip.headsign, (pattern.headsigns.get(trip.headsign) ?? 0) + 1);
    };
    for await (const st of readCsv(file('stop_times.txt'), { required: ['trip_id', 'stop_id', 'stop_sequence'] })) {
        const trip = trips.get(st.trip_id);
        if (!trip) continue;
        const line = routes.get(trip.route).line;
        if (!stopLines.has(st.stop_id)) stopLines.set(st.stop_id, new Set());
        stopLines.get(st.stop_id).add(line);
        if (current?.id !== st.trip_id) {
            finish();
            if (done.has(st.trip_id)) ungrouped ??= st.trip_id;
            current = { id: st.trip_id, calls: [] };
        }
        current.calls.push([Number(st.stop_sequence), st.stop_id]);
    }
    finish();

    const stops = await readCsvAll(file('stops.txt'), { required: ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'] });
    const optional = async name => existsSync(file(name)) ? readCsvAll(file(name)) : [];
    const dates = [...serviceDates(await optional('calendar.txt'), await optional('calendar_dates.txt')).keys()].sort();

    return {
        routes, stopLines, stops, dates,
        // Each line's directions can't be told from a feed whose trips are mixed up
        patterns: ungrouped ? null : patterns,
        patternError: ungrouped && `stop_times.txt doesn't list each trip's stops together (trip ${ungrouped})`,
    };
}

/** @typedef {Awaited<ReturnType<typeof readBusFeed>>} BusFeed */

/** @param {BusFeed} feed @param {string} today @param {string[]} warnings */
function feedDates(feed, today, warnings) {
    const { dates } = feed;
    if (!dates.length) throw new Error('Bus feed has no service dates');
    if (dates.at(-1) < today) warnings.push(`Bus feed expired on ${isoDate(dates.at(-1))}`);
    return { validFrom: isoDate(dates[0]), validTo: isoDate(dates.at(-1)) };
}

const byNumber = (a, b) => a.localeCompare(b, 'el', { numeric: true });

/**
 * @param {{ dir: string, stopTablePath?: string, today: string, feed?: BusFeed }} options
 * @returns {Promise<{ data: import('../../types/data.js').BusStops, warnings: string[] }>}
 */
export async function buildBus({ dir, stopTablePath, today, feed }) {
    feed ??= await readBusFeed(dir);
    const warnings = [];

    const latinName = new Map();
    if (stopTablePath) {
        for (const s of await readCsvAll(stopTablePath, { required: ['stop_code', 'stop_desr_matrix'] })) {
            if (s.stop_desr_matrix) latinName.set(s.stop_code, s.stop_desr_matrix);
        }
    } else {
        warnings.push('No OASA stop table; English stop names will be empty');
    }

    const stops = [];
    let unserved = 0;
    const badCodes = [];
    for (const s of feed.stops) {
        // The telematics API and ours only take numeric codes (OASA's feed has had a "-2")
        if (!STOP_CODE.test(s.stop_id)) { badCodes.push(s.stop_id); continue; }
        const lines = [...(feed.stopLines.get(s.stop_id) ?? [])].sort(byNumber);
        if (!lines.length) { unserved++; continue; }
        stops.push([s.stop_id, round(+s.stop_lat, 5), round(+s.stop_lon, 5), s.stop_name.replace(/\s+/g, ' '), latinName.get(s.stop_id) ?? '', lines]);
    }
    if (stops.length < MIN_STOPS) throw new Error(`Bus feed has only ${stops.length} served stops (expected at least ${MIN_STOPS})`);
    if (unserved) warnings.push(`${unserved} bus stops have no trips and were left out`);
    if (badCodes.length) warnings.push(`${badCodes.length} bus stops have codes the live times can't use and were left out: ${badCodes.join(', ')}`);

    return {
        data: {
            schema: BUS_SCHEMA,
            generated: new Date().toISOString(),
            feed: feedDates(feed, today, warnings),
            fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'],
            stops,
        },
        warnings,
    };
}

// Where a direction goes, from its trips' headsign ("ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ
// (ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)" → "ΠΕΙΡΑΙΑΣ"): its last part, without notes about
// works or hours; or the last stop's name
/** @param {string} headsign @param {string} lastStop */
export function towardName(headsign, lastStop) {
    const plain = headsign.replace(/\s*\([^)]*(ΠΡΟΣΩΡΙΝ|ΕΡΓΩΝ|\d\d:\d\d)[^)]*\)/giu, '').trim();
    return plain.split(' - ').at(-1).trim() || lastStop;
}

/**
 * @param {{ dir: string, today: string, feed?: BusFeed }} options
 * @returns {Promise<{ data: import('../../types/data.js').BusLines, warnings: string[] }>}
 */
export async function buildBusLines({ dir, today, feed }) {
    feed ??= await readBusFeed(dir);
    if (!feed.patterns) throw new Error(feed.patternError);
    const warnings = [];

    // The stops bus-stops.json has (numeric codes, in stops.txt), with where they are
    /** @type {Map<string, { lat: number, lng: number, name: string }>} */
    const known = new Map();
    for (const s of feed.stops) if (STOP_CODE.test(s.stop_id)) known.set(s.stop_id, { lat: +s.stop_lat, lng: +s.stop_lon, name: s.stop_name.replace(/\s+/g, ' ') });
    // Near enough to compare which end is closer
    const apart = (a, b) => Math.hypot(known.get(a).lat - known.get(b).lat, (known.get(a).lng - known.get(b).lng) * Math.cos(38 * Math.PI / 180));

    // Each line number's busiest route, with its sequences busiest first
    /** @type {Map<string, { route: string, trips: number, sequences: { stops: string[], trips: number, headsign: string }[] }>} */
    const busiest = new Map();
    for (const [route, byKey] of feed.patterns) {
        const sequences = [...byKey.values()]
            .map(p => ({ stops: p.stops.filter(code => known.has(code)), trips: p.trips, headsign: [...p.headsigns].sort((a, b) => b[1] - a[1])[0][0] }))
            .filter(p => p.stops.length >= 2)
            .sort((a, b) => b.trips - a.trips);
        if (!sequences.length) continue;
        const { line } = feed.routes.get(route);
        const trips = sequences.reduce((sum, p) => sum + p.trips, 0);
        if ((busiest.get(line)?.trips ?? 0) < trips) busiest.set(line, { route, trips, sequences });
    }

    const lines = [];
    for (const [line, { route, sequences }] of busiest) {
        const [first, ...rest] = sequences;
        const back = rest.find(p => apart(p.stops[0], first.stops.at(-1)) < apart(p.stops[0], first.stops[0]));
        lines.push({
            line,
            name: feed.routes.get(route).name,
            directions: [first, back].filter(Boolean).map(p => ({ to: towardName(p.headsign, known.get(p.stops.at(-1)).name), stops: p.stops })),
        });
    }
    lines.sort((a, b) => byNumber(a.line, b.line));
    if (lines.length < MIN_LINES) throw new Error('Bus feed has no lines with stops');

    return {
        data: { schema: BUS_LINES_SCHEMA, generated: new Date().toISOString(), feed: feedDates(feed, today, warnings), lines },
        warnings,
    };
}

function round(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
