import { readFileSync } from 'fs';

/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/pages.js').Lang} Lang */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { favouriteButton } from '../../public/js/core/favourites.js';
import { format, formatDate, localName, walkingUrl } from '../../public/js/core/html.js';
import { linePill, pillList, stationSign } from '../../public/js/core/lines.js';
import { centralPlatformBadge, clockTime, diagramLegend, diagramSymbols, exitDiagram, lineEnd, liftCaution, STATION_PAGES, stopNote } from '../../public/js/core/metro.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { sendFresh } from '../http.js';
import { LANGS, localPath, mergeStrings, stringGetter } from './i18n.js';
import { railReader } from './rail-file.js';
import { stationChanges } from './station-changes.js';
import { view } from './templates.js';

// A page for every metro station, and an index of them, in English and Greek:
// which carriage to ride for the exit, connections and first and last trains.
// They're written from rail.json, so they're rendered on request (and kept
// until rail.json changes) rather than at startup like the pages in
// registry.js, and follow its weekly rebuild without a restart.
//   /subway/stations, /subway/stations/<station id>, and the same under /el

// The station pages' own strings; they use the subway page's too
export const STATION_STRINGS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'views', 'stations.json'), 'utf8'));
export const STATIONS_PATH = STATION_PAGES.metro;
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
            const reached = ends.reduce((found, end, k) => end <= stops[stops.length - 1] ? k : found, -1);
            if (reached !== -1) trains[reached]++;
        }
    }
    return hours[trains.indexOf(Math.max(...trains))];
}

// "Mon–Fri", or "Sat, Sun", for a run of days (0 = Sunday)
export const daysText = (list, s) => list.length > 2
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

export const lineNumber = lineId => lineId.replace(/^\D+/, '');

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

// What every station page's card for one direction starts with
// (station-direction.hbs): its heading, the line and the sign of where it
// goes; the stops on either side, as { href, name } (null: none); and this
// direction's platform from the street: how without steps, steps only, or
// not known yet (stepFree undefined). n numbers the page's cards.
/**
 * @param {{ n: number, lineId: string, lineName: string, dirId: string, end: string,
 *   previous: { href: string, name: string } | null, next: { href: string, name: string } | null,
 *   stepFree?: import('../../types/data.js').StepFree, s: (key: string) => string }} card
 */
export function directionCard({ n, lineId, lineName, dirId, end, previous, next, stepFree, s }) {
    return {
        headingId: `${lineId}-${dirId}-${n}`.toLowerCase(),
        lineBadge: linePill(lineId, lineName, 'l'),
        endSign: stationSign(end, [lineId]),
        previous,
        next,
        stepFree: { text: s(`stations.step-free.${stepFree ?? 'unknown'}`), none: stepFree === 'no' },
    };
}

// What a station's page shows, as data for server/views/stations/station.hbs:
// its lines, and per direction the stops on either side, where to ride when
// arriving here and the first and last trains from here. s(key) gives the
// page's strings, for the texts that are put together here.
/**
 * @param {Rail} rail @param {string} id @param {Lang} lang @param {(key: string) => string} s
 * @param {import('../../types/data.js').Trains | null} [trains] for the walks to the suburban railway
 */
export function stationView(rail, id, lang, s, trains = null) {
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
                    ...directionCard({ n: n++, lineId, lineName: rail.lines[lineId].name, dirId, end: name(lineEnd(rail, lineId, dirId)), previous: link(previous), next: link(next), stepFree: stop.stepFree, s }),
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
                    others: main ? (stop.hours ?? []).filter(h => h !== main)
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
        // The subway planner's id for it, for planning a trip from or to here
        plannerId: id,
        name: name(id),
        // The title: the station's sign, as at its entrances
        sign: stationSign(name(id), station.lines, 'l'),
        here: s('stations.lines-here'),
        // Its lifts out of service, from STASY
        lifts: true,
        crumbs: breadcrumb(rail, id, lang, s),
        lines,
        // The walks to the tram and the suburban railway (station-changes.js)
        changes: stationChanges(rail, trains, `metro:${id}`, lang, s),
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
        title: s('stations.title'),
        intro: s('stations.index-intro'),
        seeAlso: seeAlso('metro', s),
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

// The other networks' indexes, for the foot of a network's index
/** @param {'metro' | 'tram' | 'suburban'} network @param {(key: string) => string} s */
export const seeAlso = (network, s) => Object.entries({ metro: 'stations.title', tram: 'stations.tram-title', suburban: 'stations.suburban-title' })
    .filter(([other]) => other !== network)
    .map(([other, key]) => ({ href: STATION_PAGES[other], name: s(key) }));

// Structured data: the station with its location, and where it sits in the
// site (origin: the public address, SITE_URL)
function stationData(rail, id, lang, s, origin) {
    return placeData({ type: 'SubwayStation', name: localName(rail.stations[id].name, lang), coords: rail.stations[id].coords, crumbs: breadcrumb(rail, id, lang, s) }, lang, origin);
}

// Any station page's structured data: the station of schema.org's `type`
// with its location, and its breadcrumb (the last crumb is the page itself)
/**
 * @param {{ type: string, name: string, coords: [number, number], crumbs: { name: string, path: string }[] }} place
 * @param {Lang} lang @param {string} origin
 */
export function placeData({ type, name, coords: [latitude, longitude], crumbs }, lang, origin) {
    const url = path => origin + localPath(path, lang);
    const graph = [
        { '@type': type, name, ...(origin && { url: url(crumbs[crumbs.length - 1].path) }), geo: { '@type': 'GeoCoordinates', latitude, longitude } },
        ...(origin ? [{ '@type': 'BreadcrumbList', itemListElement: crumbs
            .map((crumb, i) => ({ '@type': 'ListItem', position: i + 1, name: crumb.name, item: url(crumb.path) })) }] : []),
    ];
    return { '@context': 'https://schema.org', '@graph': graph };
}

// One station's page, or the index for id null, as a page of the site
// (registry.js lists the fields). origin: the public address (SITE_URL), for
// the structured data.
/**
 * @param {Rail} rail @param {string | null} id
 * @param {{ tools: import('../../types/pages.js').Tool[], origin?: string, trains?: import('../../types/data.js').Trains | null }} options
 * @returns {import('../../types/pages.js').Page}
 */
export function stationPage(rail, id, { tools, origin = '', trains = null }) {
    const common = { active: 'subway', ad: 'station', readyBuses: true, strings: mergeStrings(STATION_STRINGS, tools.find(t => t.id === 'subway')?.strings ?? {}) };
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
        content: (lang, strings) => view('server/views/stations/station.hbs')(stationView(rail, id, lang, stringGetter(strings, lang), trains), { lang, strings }),
    };
}

// A network's station pages, as an express router: `base` (an index) and
// `base`/<id> in each language. read() → { key, data }: the data the pages
// are drawn from (null before the first build: 503), and a key that changes
// with it; rendered pages are kept until it does. ids(data): the stations
// with a page; page(data, id): one's page, or the index for id null, as a
// page of the site (registry.js lists the fields). renderPage puts a page in
// its language and the layout (index.js, renderPages); paths() lists the
// English paths for the sitemap. opened(req, lang): each page sent, for the
// count of pages opened (index.js).
/**
 * @template T
 * @param {{ base: string, read: () => { key: string | null, data: T | null }, ids: (data: T) => string[],
 *   page: (data: T, id: string | null) => import('../../types/pages.js').Page,
 *   renderPage: (page: import('../../types/pages.js').Page, lang: Lang) => string,
 *   opened?: (req: import('express').Request, lang: Lang) => void }} options
 */
export function stationRouter({ base, read, ids, page, renderPage, opened = () => {} }) {
    let drawn = /** @type {{ key: string | null, html: Map<string, string> }} */ ({ key: null, html: new Map() });
    function current() {
        const { key, data } = read();
        if (key !== drawn.key) drawn = { key, html: new Map() };
        return { data, html: drawn.html };
    }

    function html(id, lang) {
        const { data, html } = current();
        if (!data) throw NOT_BUILT_YET;
        // includes: "constructor" or "__proto__" in the address isn't a station
        if (id && !ids(data).includes(id)) return null;
        const cacheKey = `${lang} ${id ?? ''}`;
        if (!html.has(cacheKey)) html.set(cacheKey, renderPage(page(data, id), lang));
        return html.get(cacheKey);
    }

    const router = express.Router();
    for (const lang of LANGS) {
        const path = localPath(base, lang);
        const send = (req, res, next, sent) => {
            if (!sent) return next();
            opened(req, lang);
            sendFresh(res, 'html', sent);
        };
        router.get(path, (req, res, next) => send(req, res, next, html(null, lang)));
        router.get(`${path}/:id`, (req, res, next) => send(req, res, next, html(req.params.id, lang)));
    }

    return {
        router,
        paths: () => {
            const { data } = current();
            return data ? [base, ...ids(data).map(id => `${base}/${id}`)] : [];
        },
    };
}

// The metro's station pages: → { router, paths() } (stationRouter). They list
// the walks to the tram and the suburban railway, so they follow trains.json
// too (trainsFile; none: no walks to the railway).
/**
 * @param {{ railFile: string, trainsFile?: string, renderPage: (page: import('../../types/pages.js').Page, lang: Lang) => string,
 *   tools: import('../../types/pages.js').Tool[], origin?: string,
 *   opened?: (req: import('express').Request, lang: Lang) => void }} options
 */
export function createStationPages({ railFile, trainsFile, renderPage, tools, origin = '', opened }) {
    const rail = railReader(railFile);
    const trains = trainsFile ? railReader(trainsFile) : () => ({ key: null, rail: null });
    return stationRouter({
        base: STATIONS_PATH,
        read: () => {
            const [r, t] = [rail(), trains()];
            return { key: r.key && `${r.key} ${t.key}`, data: r.rail && { rail: r.rail, trains: /** @type {any} */ (t.rail) } };
        },
        ids: ({ rail }) => Object.keys(rail.stations),
        page: ({ rail, trains }, id) => stationPage(rail, id, { tools, origin, trains }),
        renderPage,
        opened,
    });
}
