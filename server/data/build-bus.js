import { STOP_CODE } from './check-output.js';

// Build bus-stops.json and bus-lines.json from today's network, as OASA's live
// API gives it (oasa-network.js).
//
// bus-stops.json: every stop on a route today, so the browser can find stops
// near you or by name without calling OASA:
// {
//   schema, fetched,
//   fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'],
//   stops:  [['10361', 37.97491, 23.73488, 'ΣΥΝΤΑΓΜΑ', 'SYNTAGMA', ['024', '035', …]], …]
// }
// `code` is the stop code the live API uses; `lines` every line whose routes
// call there today (night lines, short workings and diversions included).
//
// bus-lines.json: each line's stops in order, one list per direction:
// {
//   schema, fetched,
//   lines: [{ line: '040', name: { el, en },
//             directions: [{ to: { el: 'ΣΥΝΤΑΓΜΑ', en: 'SYNTAGMA' }, stops: ['…', …] }, …] }, …]
// }
// A line number can have several line codes (the Α10 and its short working
// "from Karavos"): its own is the one with the most routes (the lowest code
// if tied). Its directions are its routes there (type 1) and back (type 2):
// the plain one of each, not a variant with a note in brackets
// ("[22:00-06:00]") unless there's only that. A circular line has one.

export const BUS_SCHEMA = 2;
export const BUS_LINES_SCHEMA = 2;

const MIN_STOPS = 1000;

const byNumber = (a, b) => a.localeCompare(b, 'el', { numeric: true });
const round = n => Math.round(n * 1e5) / 1e5;

// A day's network that can't be built from (never fetched): the build keeps the last files
function needNetwork(network) {
    if (!network) throw new Error('no bus network from OASA yet');
    return network;
}

/** @param {any} network @returns {{ data: import('../../types/data.js').BusStops, warnings: string[] }} */
export function buildBusStops(network) {
    const { lines, routes, stops: routeStops, fetched } = needNetwork(network);
    const lineOf = new Map(lines.flatMap(l => (routes[l.code] ?? []).map(r => [r.code, l.line])));

    /** @type {Map<string, { stop: any, lines: Set<string> }>} */
    const stops = new Map();
    const badCodes = new Set();
    for (const [route, { stops: list }] of Object.entries(routeStops)) {
        for (const stop of list) {
            // The live times only take numeric codes
            if (!STOP_CODE.test(stop.code)) { badCodes.add(stop.code); continue; }
            if (!stops.has(stop.code)) stops.set(stop.code, { stop, lines: new Set() });
            if (lineOf.has(route)) stops.get(stop.code).lines.add(lineOf.get(route));
        }
    }
    /** @type {import('../../types/data.js').BusStops['stops']} */
    const rows = [...stops.values()]
        .filter(({ lines: served }) => served.size)
        .map(({ stop, lines: served }) => /** @type {[string, number, number, string, string, string[]]} */ ([stop.code, round(stop.lat), round(stop.lng), stop.el, stop.en, [...served].sort(byNumber)]))
        .sort((a, b) => a[0].localeCompare(b[0]));
    if (rows.length < MIN_STOPS) throw new Error(`OASA's network has only ${rows.length} stops (expected at least ${MIN_STOPS})`);

    const warnings = badCodes.size ? [`${badCodes.size} bus stops have codes the live times can't use and were left out: ${[...badCodes].join(', ')}`] : [];
    return { data: { schema: BUS_SCHEMA, fetched, fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'], stops: rows }, warnings };
}

// Where a route goes, from its name ("ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ [ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ
// ΕΡΓΩΝ]" → "ΠΕΙΡΑΙΑΣ"): its last part, without notes in brackets
/** @param {string} name */
export function towardName(name) {
    return name.replace(/\s*\[[^\]]*\]/g, '').split(' - ').at(-1).trim();
}

const variant = route => /\[/.test(route.name.el);

/** @param {any} network @returns {{ data: import('../../types/data.js').BusLines, warnings: string[] }} */
export function buildBusLines(network) {
    const { lines: codes, routes, stops, fetched } = needNetwork(network);

    // Each line number's own code: the most routes, then the lowest code
    /** @type {Map<string, any>} */
    const own = new Map();
    for (const l of codes) {
        const best = own.get(l.line);
        const count = c => (routes[c.code] ?? []).length;
        if (!count(l)) continue;
        if (!best || count(l) > count(best) || (count(l) === count(best) && Number(l.code) < Number(best.code))) own.set(l.line, l);
    }

    const lines = [];
    for (const [line, l] of own) {
        const directions = [];
        for (const type of ['1', '2']) {
            const candidates = routes[l.code].filter(r => r.type === type && (stops[r.code]?.stops ?? []).length >= 2);
            const route = candidates.find(r => !variant(r)) ?? candidates[0];
            if (!route) continue;
            directions.push({
                to: { el: towardName(route.name.el), en: towardName(route.name.en) || towardName(route.name.el) },
                stops: stops[route.code].stops.map(s => s.code).filter(code => STOP_CODE.test(code)),
            });
        }
        if (directions.length) lines.push({ line, name: { el: l.name.el, en: l.name.en || l.name.el }, directions });
    }
    lines.sort((a, b) => byNumber(a.line, b.line));
    if (!lines.length) throw new Error('OASA\'s network has no lines with stops');

    return { data: { schema: BUS_LINES_SCHEMA, fetched, lines }, warnings: [] };
}
