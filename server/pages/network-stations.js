/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/data.js').Trains} Trains */
/** @typedef {import('../../types/data.js').Timetable} Timetable */
/** @typedef {import('../../types/pages.js').Lang} Lang */
import { format, formatDate, localName, walkingUrl } from '../../public/js/core/html.js';
import { favouriteButton } from '../../public/js/core/favourites.js';
import { linePill, pillList, stationSign } from '../../public/js/core/lines.js';
import { clockTime, STATION_PAGES } from '../../public/js/core/metro.js';
import { athensDate, suburbanId, withSuburban, withTram } from '../../tools/subway/client/network.js';
import { mergeStrings, stringGetter } from './i18n.js';
import { railReader } from './rail-file.js';
import { stationChanges, stationWalks } from './station-changes.js';
import { daysText, directionCard, firstAndLast, lineNumber, placeData, seeAlso, STATION_STRINGS, stationRouter } from './stations.js';
import { view } from './templates.js';

// A page for every tram stop and every suburban railway station, and an
// index of each, in English and Greek, beside the metro's (stations.js): one
// page per network, Syntagma the tram stop apart from Syntagma the metro
// station, joined by the walk between them (decision 55). They show what the
// data has: the stops either side, the walks to other stations, and first
// and last trains. No exits or lifts are recorded for them, so nothing about
// step-free access is claimed.
//   /tram/stops, /tram/stops/<id>: rail.json's tram, by its timetable's typical week
//   /suburban/stations, /suburban/stations/<id>: trains.json, by date, for the days it holds

const TRAM_PATH = STATION_PAGES.tram;
const SUBURBAN_PATH = STATION_PAGES.suburban;

// A date's weekday (0 = Sunday)
const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();

// First and last train leaving stop `index` on one direction on each of
// `dates` ('YYYY-MM-DD'), from a timetable by date (timetable.dates, as
// withSuburban builds the railway's): [{ date, first, last }], times in
// seconds since that day's midnight; first and last null on a date with no
// trains from here.
/** @param {Timetable} timetable @param {number} index @param {string[]} dates */
export function firstAndLastByDate(timetable, index, dates) {
    return dates.map(date => {
        const pattern = timetable.dates?.[date];
        const times = (pattern === undefined ? [] : timetable.patterns[pattern]).flatMap(([start, p]) => {
            const { stops, offsets } = timetable.profiles[p];
            const i = stops.indexOf(index);
            // Only trains that go on from here
            return i !== -1 && i < stops.length - 1 ? [start + offsets[i]] : [];
        });
        return times.length ? { date, first: Math.min(...times), last: Math.max(...times) } : { date, first: null, last: null };
    });
}

// "Today, Sun 15/11", or "Mon 16/11"
/** @param {string} date @param {string} today @param {(key: string) => string} s */
function dateText(date, today, s) {
    const [, m, d] = date.split('-');
    const day = `${s(`stations.day.${weekday(date)}`)} ${d}/${m}`;
    return date === today ? `${s('stations.today')}, ${day}` : day;
}

// The cards of a station on a network (rail.json's shape): one per direction
// of each of its lines that leaves from there, with its neighbours (link(id))
// and the first and last trains from here (times(direction, index), table
// rows). None for a direction that ends here: with no exits recorded, its
// card would only say the stop before, which the other direction's names.
function directionCards(network, id, lang, s, link, times) {
    let n = 0;
    return network.stations[id].lines.map(lineId => {
        const line = network.lines[lineId];
        return {
            key: lineId.toLowerCase(),
            badge: linePill(lineId, line.name),
            directions: Object.entries(line.directions)
                .filter(([, direction]) => direction.stops.slice(0, -1).some(stop => stop.station === id))
                .map(([dirId, direction]) => {
                    const index = direction.stops.findIndex(stop => stop.station === id);
                    const next = direction.stops[index + 1]?.station;
                    return {
                        ...directionCard({
                            n: n++, lineId, lineName: line.name, dirId, end: localName(direction.toward, lang),
                            previous: link(direction.stops[index - 1]?.station), next: link(next), s,
                        }),
                        arriving: null,
                        times: times(direction, index),
                        timesToward: localName(direction.toward, lang),
                        others: [],
                        fromStasy: false,
                    };
                }),
        };
    });
}

// ── The tram ────────────────────────────────────────────────────────────────

// The subway planner's id for tram stop `id`: "-tram" where a metro station has its id (withTram)
// The tram's pages are drawn only from a rail.json with the tram (their ids are its stops)
/** @param {Rail} rail */
const tramOf = rail => /** @type {NonNullable<Rail['tram']>} */ (rail.tram);

/** @param {Rail} rail @param {string} id */
const tramPlannerId = (rail, id) => Object.hasOwn(rail.stations, id) ? `${id}-tram` : id;

/** @param {Rail} rail @param {string | null} id @param {Lang} lang @param {(key: string) => string} s */
function tramBreadcrumb(rail, id, lang, s) {
    return [
        { name: s('stations.subway'), path: '/subway' },
        { name: s('stations.tram-title'), path: TRAM_PATH },
        ...(id ? [{ name: localName(tramOf(rail).stations[id].name, lang), path: `${TRAM_PATH}/${id}` }] : []),
    ];
}

// What a tram stop's page shows, as data for server/views/stations/station.hbs
/**
 * @param {Rail} rail @param {string} id @param {Lang} lang @param {(key: string) => string} s
 * @param {Trains | null} [trains] for the walks to the suburban railway
 */
export function tramStopView(rail, id, lang, s, trains = null) {
    const tram = tramOf(rail);
    const stop = tram.stations[id];
    const name = localName(stop.name, lang);
    const link = stopId => stopId ? { href: `${TRAM_PATH}/${stopId}`, name: localName(tram.stations[stopId].name, lang) } : null;
    const time = seconds => seconds === null ? s('stations.all-night') : clockTime(seconds);
    const row = t => ({ days: daysText(t.days, s), first: time(t.first), last: time(t.last) });
    const lines = directionCards({ stations: tram.stations, lines: tram.lines }, id, lang, s, link, (direction, index) => firstAndLast(direction.timetable, index).map(row));
    const plannerId = tramPlannerId(rail, id);
    const [lat, lng] = stop.coords;
    return {
        id,
        plannerId,
        name,
        sign: stationSign(name, stop.lines, 'l'),
        here: s('stations.tram-lines-here'),
        crumbs: tramBreadcrumb(rail, id, lang, s),
        changes: stationChanges(rail, trains, `tram:${id}`, lang, s),
        lines,
        walking: walkingUrl(lat, lng),
        favourite: favouriteButton({ kind: 'station', key: plannerId, text: s('favourites.star'), cls: 'btn btn-sm btn-outline-secondary rounded-pill', hidden: true }),
        // The tram's timetable is the metro's feed
        timetable: { gtfs: lines.some(line => line.directions.some(d => d.times.length)) ? { old: athensDate() > rail.feed.validTo, date: formatDate(rail.feed.validTo) } : null },
    };
}

// The index of every tram stop by line
/** @param {Rail} rail @param {Lang} lang @param {(key: string) => string} s */
export function tramIndexView(rail, lang, s) {
    const tram = tramOf(rail);
    return {
        crumbs: tramBreadcrumb(rail, null, lang, s),
        title: s('stations.tram-title'),
        intro: s('stations.tram-index-intro'),
        seeAlso: seeAlso('tram', s),
        lines: Object.entries(tram.lines).map(([lineId, line]) => ({
            key: lineId.toLowerCase(),
            heading: linePill(lineId, line.name, 'l'),
            number: lineNumber(lineId),
            // The direction with the most stops (T7's loop at Piraeus is one way only)
            stops: longest(line).map(id => {
                const stop = tram.stations[id];
                const others = [
                    ...stop.lines.filter(l => l !== lineId).map(l => linePill(l, tram.lines[l].name, 's')),
                    ...(stop.metro?.lines ?? []).map(l => linePill(l, rail.lines[l]?.name ?? l, 's')),
                ];
                return { href: `${TRAM_PATH}/${id}`, name: localName(stop.name, lang), changes: others.length ? pillList(others) : null };
            }),
        })),
    };
}

// A line's stops in the order of its direction with the most of them, each once
const longest = line => [...new Set(Object.values(line.directions).reduce((a, b) => b.stops.length > a.stops.length ? b : a).stops.map(stop => stop.station))];

/**
 * @param {Rail} rail @param {string | null} id
 * @param {{ tools: import('../../types/pages.js').Tool[], origin?: string, trains?: Trains | null }} options
 * @returns {import('../../types/pages.js').Page}
 */
export function tramStopPage(rail, id, { tools, origin = '', trains = null }) {
    const common = commonPage(tools);
    if (!id) {
        return {
            ...common, path: TRAM_PATH, title: 'stations.tram-title', description: 'stations.tram-index-description',
            content: (lang, strings) => view('server/views/stations/index.hbs')(tramIndexView(rail, lang, stringGetter(strings, lang)), { lang, strings }),
        };
    }
    const stop = tramOf(rail).stations[id];
    return {
        ...common,
        path: `${TRAM_PATH}/${id}`,
        title: 'stations.tram-station-title',
        description: 'stations.tram-description',
        values: lang => ({ name: localName(stop.name, lang), lines: stop.lines.join(', ') }),
        structuredData: (lang, s) => placeData({ type: 'LightRailStation', name: localName(stop.name, lang), coords: stop.coords, crumbs: tramBreadcrumb(rail, id, lang, s) }, lang, origin),
        content: (lang, strings) => view('server/views/stations/station.hbs')(tramStopView(rail, id, lang, stringGetter(strings, lang), trains), { lang, strings }),
    };
}

// ── The suburban railway ────────────────────────────────────────────────────

// trains.json as rail.json's shape (withSuburban), by trains.json's own
// station ids: a direction for each station its trains end at, with every
// date's trains. null when it holds no trains.
/** @param {Trains} trains */
export function suburbanNetwork(trains) {
    const date = Object.keys(trains.dates ?? {}).find(d => trains.dates[d].length);
    if (!date) return null;
    return withSuburban(/** @type {Rail} */ ({ stations: {}, lines: {} }), trains, date);
}

// The suburban railway's pages are drawn only when it has trains (createNetworkStationPages)
/** @param {Trains} trains */
const networkOf = trains => /** @type {NonNullable<ReturnType<typeof suburbanNetwork>>} */ (suburbanNetwork(trains));

/** @param {Trains} trains @param {string | null} id @param {Lang} lang @param {(key: string) => string} s */
function suburbanBreadcrumb(trains, id, lang, s) {
    const [, , el = '', en = ''] = id ? trains.stations[id] : [];
    return [
        { name: s('stations.subway'), path: '/subway' },
        { name: s('stations.suburban-title'), path: SUBURBAN_PATH },
        ...(id ? [{ name: lang === 'el' ? el : en || el, path: `${SUBURBAN_PATH}/${id}` }] : []),
    ];
}

// What a suburban station's page shows, as data for server/views/stations/station.hbs.
// today: Athens' date, the first of the dates shown
/**
 * @param {Rail} rail @param {Trains} trains @param {string} id @param {Lang} lang @param {(key: string) => string} s
 * @param {string} [today]
 */
export function suburbanStationView(rail, trains, id, lang, s, today = athensDate()) {
    const network = networkOf(trains);
    const station = network.stations[id];
    const name = localName(station.name, lang);
    const link = stationId => stationId ? { href: `${SUBURBAN_PATH}/${stationId}`, name: localName(network.stations[stationId].name, lang) } : null;
    const dates = Object.keys(trains.dates).filter(date => date >= today).sort();
    const row = t => ({ days: dateText(t.date, today, s), first: t.first === null ? '' : clockTime(t.first), last: t.last === null ? '' : clockTime(t.last), none: t.first === null ? s('stations.no-trains') : null });
    const lines = directionCards(network, id, lang, s, link, (direction, index) => firstAndLastByDate(direction.timetable, index, dates).map(row));
    const plannerId = suburbanId(withTram(rail), id);
    const [lat, lng] = station.coords;
    return {
        id,
        plannerId,
        name,
        sign: stationSign(name, station.lines, 'l'),
        here: s('stations.suburban-lines-here'),
        crumbs: suburbanBreadcrumb(trains, id, lang, s),
        changes: stationChanges(rail, trains, `suburban:${id}`, lang, s),
        // Beyond OASA's ticket: a Hellenic Train ticket, as the planner says
        ticket: station.oasaTicket === false ? format(s('subway.train-ticket'), { station: name }) : null,
        lines,
        walking: walkingUrl(lat, lng),
        favourite: favouriteButton({ kind: 'station', key: plannerId, text: s('favourites.star'), cls: 'btn btn-sm btn-outline-secondary rounded-pill', hidden: true }),
        timetable: { suburban: lines.some(line => line.directions.some(d => d.times.length)) },
    };
}

// The index of every suburban station by line
/** @param {Rail} rail @param {Trains} trains @param {Lang} lang @param {(key: string) => string} s */
export function suburbanIndexView(rail, trains, lang, s) {
    const network = networkOf(trains);
    // The metro lines a short walk from each station
    const metro = {};
    for (const [a, b] of stationWalks(rail, trains)) {
        for (const [from, to] of [[a, b], [b, a]]) {
            if (from.startsWith('suburban:') && to.startsWith('metro:')) (metro[from.slice(9)] ??= []).push(...rail.stations[to.slice(6)]?.lines ?? []);
        }
    }
    return {
        crumbs: suburbanBreadcrumb(trains, null, lang, s),
        title: s('stations.suburban-title'),
        intro: s('stations.suburban-index-intro'),
        seeAlso: seeAlso('suburban', s),
        lines: Object.keys(network.lines).sort().map(lineId => ({
            key: lineId.toLowerCase(),
            heading: linePill(lineId, network.lines[lineId].name, 'l'),
            number: lineNumber(lineId),
            // Only the metro: the railway's lines share their track, so one beside another isn't a change
            stops: longest(network.lines[lineId]).map(id => {
                const others = [...new Set(metro[id] ?? [])].sort().map(l => linePill(l, rail.lines[l].name, 's'));
                return { href: `${SUBURBAN_PATH}/${id}`, name: localName(network.stations[id].name, lang), changes: others.length ? pillList(others) : null };
            }),
        })),
    };
}

/**
 * @param {Rail} rail @param {Trains} trains @param {string | null} id
 * @param {{ tools: import('../../types/pages.js').Tool[], origin?: string, today?: string }} options today: Athens' date (the tests')
 * @returns {import('../../types/pages.js').Page}
 */
export function suburbanStationPage(rail, trains, id, { tools, origin = '', today }) {
    const common = commonPage(tools);
    if (!id) {
        return {
            ...common, path: SUBURBAN_PATH, title: 'stations.suburban-title', description: 'stations.suburban-index-description',
            content: (lang, strings) => view('server/views/stations/index.hbs')(suburbanIndexView(rail, trains, lang, stringGetter(strings, lang)), { lang, strings }),
        };
    }
    const [lat, lng, el, en] = trains.stations[id];
    const name = lang => lang === 'el' ? el : en || el;
    return {
        ...common,
        path: `${SUBURBAN_PATH}/${id}`,
        title: 'stations.suburban-station-title',
        description: 'stations.suburban-description',
        values: lang => ({ name: name(lang), lines: networkOf(trains).stations[id].lines.join(', ') }),
        structuredData: (lang, s) => placeData({ type: 'TrainStation', name: name(lang), coords: [lat, lng], crumbs: suburbanBreadcrumb(trains, id, lang, s) }, lang, origin),
        content: (lang, strings) => view('server/views/stations/station.hbs')(suburbanStationView(rail, trains, id, lang, stringGetter(strings, lang), today), { lang, strings }),
    };
}

// ── The pages ───────────────────────────────────────────────────────────────

// What every station page shares (registry.js lists a page's fields)
const commonPage = tools => ({ active: 'subway', ad: 'station', readyBuses: true, strings: mergeStrings(STATION_STRINGS, tools.find(t => t.id === 'subway')?.strings ?? {}) });

// The tram's and the suburban railway's station pages: → [{ router, paths() }]
// (stationRouter). The tram's are drawn from rail.json, the railway's from
// trains.json and rail.json; each lists the walks to the others' stations.
/**
 * @param {{ railFile: string, trainsFile?: string, renderPage: (page: import('../../types/pages.js').Page, lang: Lang) => string,
 *   tools: import('../../types/pages.js').Tool[], origin?: string,
 *   opened?: (req: import('express').Request, lang: Lang) => void }} options
 */
export function createNetworkStationPages({ railFile, trainsFile, renderPage, tools, origin = '', opened }) {
    const rail = railReader(railFile);
    const trains = trainsFile ? railReader(trainsFile) : () => ({ key: null, rail: null });
    const both = () => {
        const [r, t] = [rail(), trains()];
        return { key: `${r.key} ${t.key}`, rail: r.rail, trains: /** @type {Trains | null} */ (/** @type {unknown} */ (t.rail)) };
    };
    return [
        stationRouter({
            base: TRAM_PATH,
            read: () => {
                const { key, rail, trains } = both();
                return { key, data: rail && { rail, trains } };
            },
            ids: ({ rail }) => Object.keys(rail.tram?.stations ?? {}),
            page: ({ rail, trains }, id) => tramStopPage(rail, id, { tools, origin, trains }),
            renderPage,
            opened,
        }),
        stationRouter({
            base: SUBURBAN_PATH,
            read: () => {
                const { key, rail, trains } = both();
                const network = rail && trains && suburbanNetwork(trains);
                return { key, data: network && { rail, trains, network } };
            },
            ids: ({ network }) => Object.keys(network.stations),
            page: ({ rail, trains }, id) => suburbanStationPage(rail, trains, id, { tools, origin }),
            renderPage,
            opened,
        }),
    ];
}
