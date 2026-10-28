import { readFileSync } from 'fs';

/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/pages.js').Lang} Lang */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { favouriteButton } from '../../public/js/core/favourites.js';
import { format, formatDate, localName, walkingUrl } from '../../public/js/core/html.js';
import { linePill, pillList, stationSign } from '../../public/js/core/lines.js';
import { centralPlatformBadge, clockTime, diagramLegend, diagramSymbols, exitDiagram, lineEnd, liftCaution, stopNote } from '../../public/js/core/metro.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { sendFresh } from '../http.js';
import { LANGS, localPath, mergeStrings, stringGetter } from './i18n.js';
import { railReader } from './rail-file.js';
import { view } from './templates.js';

// A page for every metro station, and an index of them, in English and Greek:
// which carriage to ride for the exit, connections and first and last trains.
// They're written from rail.json, so they're rendered on request (and kept
// until rail.json changes) rather than at startup like the pages in
// registry.js, and follow its weekly rebuild without a restart.
//   /subway/stations, /subway/stations/<station id>, and the same under /el

// The station pages' own strings; they use the subway page's too
export const STATION_STRINGS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'views', 'stations.json'), 'utf8'));
export const STATIONS_PATH = '/subway/stations';
// Before the first data build there's no rail.json: the pages can't be drawn
// yet, which isn't the same as there being no such page (errors.js: 503)
const NOT_BUILT_YET = Object.assign(new Error('rail.json is not built yet'), { status: 503, retryAfter: 300 });
const DAY = 86_400;
const ALL_NIGHT_GAP = 3600;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
// Monday first, for grouping days like "Mon–Fri"
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// First and last train leaving stop `index` on one direction, for each run of
// days that look the same: [{ days: [1, 2, 3, 4, 5], first, last }], times in
// seconds since that day's midnight, or null when the trains run all night
// (the next day's first train comes less than ALL_NIGHT_GAP after the day's
// last, like line 3 from Saturday into Sunday).
/**
 * @param {import('../../types/data.js').Timetable} timetable @param {number} index
 * @returns {{ days: number[], first: number | null, last: number | null }[]}
 */
export function firstAndLast(timetable, index) {
    const day = weekday => {
        const times = timetable.patterns[timetable.days[weekday]].flatMap(([start, p]) => {
            const { stops, offsets } = timetable.profiles[p];
            const i = stops.indexOf(index);
            // Only trains that go on from here
            return i !== -1 && i < stops.length - 1 ? [start + offsets[i]] : [];
        });
        return times.length ? { first: Math.min(...times), last: Math.max(...times) } : null;
    };
    const service = EVERY_DAY.map(day);
    const intoNext = weekday => {
        const today = service[weekday];
        const tomorrow = service[(weekday + 1) % 7];
        return Boolean(today && tomorrow && DAY + tomorrow.first - today.last < ALL_NIGHT_GAP);
    };
    return groupDays(service.map((times, weekday) => times && {
        first: intoNext((weekday + 6) % 7) ? null : times.first,
        last: intoNext(weekday) ? null : times.last,
    }));
}

// Each weekday's { first, last } (null: no trains that day), as runs of days
// that look the same, Monday first: [{ days: [1, 2, 3, 4, 5], first, last }]
/** @param {({ first: number | null, last: number | null } | null)[]} service */
export function groupDays(service) {
    const groups = [];
    for (const weekday of WEEK) {
        const times = service[weekday];
        if (!times) continue;
        const group = groups.at(-1);
        if (group && group.first === times.first && group.last === times.last && group.days.at(-1) === WEEK[WEEK.indexOf(weekday) - 1]) group.days.push(weekday);
        else groups.push({ days: [weekday], first: times.first, last: times.last });
    }
    return groups;
}

// Of STASY's destinations from stop `index` (its `hours`), the one most of
// its trains go to: each train counts for the furthest of them it reaches.
// Doukissis at Dimotiko Theatro (the airport trains are fewer), Kifisia at
// Piraeus (fewer go only as far as Omonia).
/**
 * @param {import('../../types/data.js').Hours[]} hours @param {import('../../types/data.js').Direction} direction @param {number} index
 * @returns {import('../../types/data.js').Hours}
 */
export function mainDestination(hours, direction, index) {
    const order = direction.stops.map(stop => stop.station);
    const ends = hours.map(h => order.indexOf(h.to));
    const trains = hours.map(() => 0);
    const { profiles, patterns, days } = direction.timetable;
    for (const day of days) {
        for (const [, p] of patterns[day]) {
            const { stops } = profiles[p];
            if (!stops.includes(index) || stops.at(-1) === index) continue;
            const reached = ends.reduce((found, end, k) => end <= stops.at(-1) ? k : found, -1);
            if (reached !== -1) trains[reached]++;
        }
    }
    return hours[trains.indexOf(Math.max(...trains))];
}

// "Mon–Fri", or "Sat, Sun", for a run of days (0 = Sunday)
const daysText = (list, s) => list.length > 2
    ? `${s(`stations.day.${list[0]}`)}–${s(`stations.day.${list.at(-1)}`)}`
    : list.map(d => s(`stations.day.${d}`)).join(', ');

// Trains from a stop to another destination than the table's, as a sentence:
// "To Airport: first 05:30, last 22:54, every day." for one further on, or
// "Only as far as Omonia: last 00:30, every day." for one before it (their
// first train is the table's). None for one that adds nothing: a nearer
// destination whose last train is never later than the table's (or the
// table's trains run all night).
function otherDestination(hours, main, further, name, time, s) {
    if (!further && hours.last.every((last, wd) => main.last[wd] === null || (last !== null && last <= main.last[wd]))) return null;
    const groups = groupDays(EVERY_DAY.map(wd => ({ first: further ? hours.first[wd] : 0, last: hours.last[wd] })));
    const timesText = g => further
        ? format(s('stations.other-first-last'), { first: time(g.first), last: time(g.last) })
        : format(s('stations.other-last'), { last: time(g.last) });
    const times = groups.length === 1
        ? format(s('stations.other-every-day'), { times: timesText(groups[0]) })
        : groups.map(g => format(s('stations.other-days'), { days: daysText(g.days, s), times: timesText(g) })).join('; ');
    return format(s(further ? 'stations.other-further' : 'stations.other-shorter'), { name: name(hours.to), times });
}

const lineNumber = lineId => lineId.replace(/^\D+/, '');

// Where a station's page (or the index, for id null) sits in the site:
// [{ name, path }] from the subway page to itself. Its view's breadcrumb and
// its structured data both show it.
/** @param {Rail} rail @param {string | null} id @param {Lang} lang @param {(key: string) => string} s */
export function breadcrumb(rail, id, lang, s) {
    return [
        { name: s('stations.subway'), path: '/subway' },
        { name: s('stations.title'), path: STATIONS_PATH },
        ...(id ? [{ name: localName(rail.stations[id].name, lang), path: `${STATIONS_PATH}/${id}` }] : []),
    ];
}

// What a station's page shows, as data for server/views/stations/station.hbs:
// its lines, and per direction the stops on either side, where to ride when
// arriving here and the first and last trains from here. s(key) gives the
// page's strings, for the texts that are put together here.
/**
 * @param {Rail} rail @param {string} id @param {Lang} lang @param {(key: string) => string} s
 */
export function stationView(rail, id, lang, s) {
    const station = rail.stations[id];
    const name = stationId => localName(rail.stations[stationId].name, lang);
    const link = stationId => stationId ? { href: `${STATIONS_PATH}/${stationId}`, name: name(stationId) } : null;
    const time = seconds => seconds === null ? s('stations.all-night') : clockTime(seconds);
    let n = 0;
    const lines = station.lines.map(lineId => ({
        key: lineId.toLowerCase(),
        // In the sentence under the name
        badge: linePill(lineId, rail.lines[lineId].name),
        directions: Object.entries(rail.lines[lineId].directions)
            .filter(([, direction]) => direction.stops.some(stop => stop.station === id))
            .map(([dirId, direction]) => {
                const index = direction.stops.findIndex(stop => stop.station === id);
                const stop = direction.stops[index];
                const previous = direction.stops[index - 1]?.station;
                const next = direction.stops[index + 1]?.station;
                // Leaving from here (not at the last stop): STASY's first and last trains, or the timetable's
                const main = next && stop.hours ? mainDestination(stop.hours, direction, index) : null;
                const order = direction.stops.map(s => s.station);
                const row = t => ({ days: daysText(t.days, s), first: time(t.first), last: time(t.last) });
                return {
                    headingId: `${lineId}-${dirId}-${n++}`.toLowerCase(),
                    // The card's heading: the line, and the sign of where it goes
                    lineBadge: linePill(lineId, rail.lines[lineId].name, 'l'),
                    endSign: stationSign(name(lineEnd(rail, lineId, dirId)), [lineId]),
                    previous: link(previous),
                    next: link(next),
                    // This direction's platform from the street: how without steps, steps only, or not known yet
                    stepFree: { text: s(`stations.step-free.${stop.stepFree ?? 'unknown'}`), none: stop.stepFree === 'no' },
                    // Arriving here (not at the first stop): where to ride for the exit and for each connection
                    arriving: previous ? {
                        exitsKnown: stop.exits.length > 0,
                        diagram: exitDiagram(rail.positions, stop, s),
                        centralPlatform: stop.centralPlatform ? centralPlatformBadge(s) : null,
                        transfers: Object.entries(stop.transfers ?? {}).flatMap(([to, where]) => {
                            const [line, dir] = to.split('/');
                            const target = rail.lines[line]?.directions[dir];
                            if (!target || !where.length) return [];
                            return [{ line: linePill(line, rail.lines[line].name), toward: name(lineEnd(rail, line, dir)), where: where.map(p => s(`subway.pos.${p}`)).join(', ') }];
                        }),
                        note: stopNote(stop.note),
                    } : null,
                    times: main
                        ? groupDays(EVERY_DAY.map(wd => ({ first: main.first[wd], last: main.last[wd] }))).map(row)
                        : (next ? firstAndLast(direction.timetable, index) : []).map(row),
                    // Where the table's trains go, for its caption
                    timesToward: main ? name(main.to) : localName(direction.toward, lang),
                    others: main ? stop.hours.filter(h => h !== main)
                        .map(h => otherDestination(h, main, order.indexOf(h.to) > order.indexOf(main.to), name, time, s))
                        .filter(Boolean) : [],
                    fromStasy: Boolean(main),
                };
            }),
    }));
    const [lat, lng] = station.coords;
    const directions = lines.flatMap(line => line.directions).filter(d => d.times.length);
    // Whether one of its platforms can be reached from the street without steps
    const stepFree = station.lines.some(lineId => Object.values(rail.lines[lineId].directions)
        .some(direction => direction.stops.some(stop => stop.station === id && stop.stepFree && stop.stepFree !== 'no')));
    // What the trains on the page show, in words, under them
    const symbols = [...new Set(station.lines.flatMap(lineId => Object.values(rail.lines[lineId].directions))
        .flatMap(direction => direction.stops.filter((stop, i) => i > 0 && stop.station === id && stop.exits.length))
        .flatMap(diagramSymbols))];
    return {
        id,
        name: name(id),
        // The title: the station's sign, as at its entrances
        sign: stationSign(name(id), station.lines, 'l'),
        crumbs: breadcrumb(rail, id, lang, s),
        lines,
        walking: walkingUrl(lat, lng),
        // Its star, shown and set by the page's script
        favourite: favouriteButton({ kind: 'station', key: id, text: s('favourites.star'), cls: 'btn btn-sm btn-outline-secondary rounded-pill', hidden: true }),
        legend: symbols.length ? diagramLegend(symbols, s) : null,
        // When it says a platform is step-free: that lifts can stop working
        liftCaution: stepFree ? liftCaution(lang, s) : null,
        // Where the first and last trains come from: STASY's copy, the timetable, or both
        timetable: {
            stasy: rail.hours && directions.some(d => d.fromStasy) ? formatDate(rail.hours.fetched) : null,
            gtfs: directions.some(d => !d.fromStasy) ? { old: athensDate() > rail.feed.validTo, date: formatDate(rail.feed.validTo) } : null,
        },
    };
}

// The index of every station by line, as data for server/views/stations/index.hbs
/** @param {Rail} rail @param {Lang} lang @param {(key: string) => string} s */
export function indexView(rail, lang, s) {
    return {
        crumbs: breadcrumb(rail, null, lang, s),
        lines: Object.entries(rail.lines).map(([lineId, line]) => ({
            key: lineId.toLowerCase(),
            heading: linePill(lineId, line.name, 'l'),
            number: lineNumber(lineId),
            stops: Object.values(line.directions)[0].stops.map(({ station: id }) => {
                // The other lines here, if any
                const others = rail.stations[id].lines.filter(l => l !== lineId);
                return {
                    href: `${STATIONS_PATH}/${id}`,
                    name: localName(rail.stations[id].name, lang),
                    changes: others.length ? pillList(others.map(l => linePill(l, rail.lines[l].name, 's'))) : null,
                };
            }),
        })),
    };
}

// Structured data: the station with its location, and where it sits in the
// site (origin: the public address, SITE_URL)
function stationData(rail, id, lang, s, origin) {
    const url = path => origin + localPath(path, lang);
    const name = localName(rail.stations[id].name, lang);
    const [latitude, longitude] = rail.stations[id].coords;
    const graph = [
        { '@type': 'SubwayStation', name, ...(origin && { url: url(`${STATIONS_PATH}/${id}`) }), geo: { '@type': 'GeoCoordinates', latitude, longitude } },
        ...(origin ? [{ '@type': 'BreadcrumbList', itemListElement: breadcrumb(rail, id, lang, s)
            .map((crumb, i) => ({ '@type': 'ListItem', position: i + 1, name: crumb.name, item: url(crumb.path) })) }] : []),
    ];
    return { '@context': 'https://schema.org', '@graph': graph };
}

// One station's page, or the index for id null, as a page of the site
// (registry.js lists the fields). origin: the public address (SITE_URL), for
// the structured data.
/**
 * @param {Rail} rail @param {string | null} id
 * @param {{ tools: import('../../types/pages.js').Tool[], origin?: string }} options
 * @returns {import('../../types/pages.js').Page}
 */
export function stationPage(rail, id, { tools, origin = '' }) {
    const common = { active: 'subway', ad: 'station', strings: mergeStrings(STATION_STRINGS, tools.find(t => t.id === 'subway')?.strings ?? {}) };
    if (!id) {
        return {
            ...common, path: STATIONS_PATH, title: 'stations.title', description: 'stations.index-description',
            content: (lang, strings) => view('server/views/stations/index.hbs')(indexView(rail, lang, stringGetter(strings, lang)), { lang, strings }),
        };
    }
    return {
        ...common,
        path: `${STATIONS_PATH}/${id}`,
        title: 'stations.station-title',
        description: 'stations.description',
        values: lang => ({ name: localName(rail.stations[id].name, lang), lines: rail.stations[id].lines.map(l => rail.lines[l].name).join(', ') }),
        structuredData: (lang, s) => stationData(rail, id, lang, s, origin),
        content: (lang, strings) => view('server/views/stations/station.hbs')(stationView(rail, id, lang, stringGetter(strings, lang)), { lang, strings }),
    };
}

// → { router, paths() }. renderPage puts a page in its language and the
// layout (index.js, renderPages); paths() lists the English paths for the sitemap.
/**
 * @param {{ railFile: string, renderPage: (page: import('../../types/pages.js').Page, lang: Lang) => string,
 *   tools: import('../../types/pages.js').Tool[], origin?: string }} options
 */
export function createStationPages({ railFile, renderPage, tools, origin = '' }) {
    const read = railReader(railFile);
    // Rendered pages are kept until rail.json changes (or the day does)
    let drawn = { key: null, html: new Map() };
    function current() {
        const { key, rail } = read();
        if (key !== drawn.key) drawn = { key, html: new Map() };
        return { rail, html: drawn.html };
    }

    function page(id, lang) {
        const { rail, html } = current();
        if (!rail) throw NOT_BUILT_YET;
        // Object.hasOwn: "constructor" or "__proto__" in the address isn't a station
        if (id && !Object.hasOwn(rail.stations, id)) return null;
        const cacheKey = `${lang} ${id ?? ''}`;
        if (!html.has(cacheKey)) html.set(cacheKey, renderPage(stationPage(rail, id, { tools, origin }), lang));
        return html.get(cacheKey);
    }

    const router = express.Router();
    for (const lang of LANGS) {
        const base = localPath(STATIONS_PATH, lang);
        const send = (res, next, html) => html ? sendFresh(res, 'html', html) : next();
        router.get(base, (_req, res, next) => send(res, next, page(null, lang)));
        router.get(`${base}/:id`, (req, res, next) => send(res, next, page(req.params.id, lang)));
    }

    return {
        router,
        paths: () => {
            const { rail } = current();
            return rail ? [STATIONS_PATH, ...Object.keys(rail.stations).map(id => `${STATIONS_PATH}/${id}`)] : [];
        },
    };
}
