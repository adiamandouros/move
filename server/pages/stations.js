import { readFileSync, statSync } from 'fs';

/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/pages.js').Lang} Lang */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { formatDate, localName, walkingUrl } from '../../public/js/core/html.js';
import { centralPlatformBadge, clockTime, exitDiagram, lineBadge, stopNote } from '../../public/js/core/metro.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { sendFresh } from '../http.js';
import { LANGS, localPath, mergeStrings, stringGetter } from './i18n.js';
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
const DAY = 86_400;
// Monday first, for grouping days like "Mon–Fri"
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// First and last train leaving stop `index` on one direction, for each run of
// days that look the same: [{ days: [1, 2, 3, 4, 5], first, last }], times in
// seconds since that day's midnight, or null when the trains run all night
// (the day's service runs into the next day's, like line 3 on Saturdays).
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
    const service = [0, 1, 2, 3, 4, 5, 6].map(day);
    const intoNext = weekday => {
        const today = service[weekday];
        const tomorrow = service[(weekday + 1) % 7];
        return Boolean(today && tomorrow && today.last >= DAY + tomorrow.first);
    };
    const groups = [];
    for (const weekday of WEEK) {
        if (!service[weekday]) continue;
        const first = intoNext((weekday + 6) % 7) ? null : service[weekday].first;
        const last = intoNext(weekday) ? null : service[weekday].last;
        const group = groups.at(-1);
        if (group && group.first === first && group.last === last && group.days.at(-1) === WEEK[WEEK.indexOf(weekday) - 1]) group.days.push(weekday);
        else groups.push({ days: [weekday], first, last });
    }
    return groups;
}

// "Mon–Fri", or "Sat, Sun", for a run of days (0 = Sunday)
const daysText = (list, s) => list.length > 2
    ? `${s(`stations.day.${list[0]}`)}–${s(`stations.day.${list.at(-1)}`)}`
    : list.map(d => s(`stations.day.${d}`)).join(', ');

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
        badge: lineBadge(lineId, rail.lines[lineId].name),
        number: lineNumber(lineId),
        directions: Object.entries(rail.lines[lineId].directions)
            .filter(([, direction]) => direction.stops.some(stop => stop.station === id))
            .map(([dirId, direction]) => {
                const index = direction.stops.findIndex(stop => stop.station === id);
                const stop = direction.stops[index];
                const previous = direction.stops[index - 1]?.station;
                const next = direction.stops[index + 1]?.station;
                return {
                    headingId: `${lineId}-${dirId}-${n++}`.toLowerCase(),
                    toward: localName(direction.toward, lang),
                    previous: link(previous),
                    next: link(next),
                    // Arriving here (not at the first stop): where to ride for the exit and for each connection
                    arriving: previous ? {
                        exitsKnown: stop.exits.length > 0,
                        diagram: exitDiagram(rail.positions, stop.exits, stop.elevators ?? [], s),
                        centralPlatform: stop.centralPlatform ? centralPlatformBadge(s) : null,
                        transfers: Object.entries(stop.transfers ?? {}).flatMap(([to, where]) => {
                            const [line, dir] = to.split('/');
                            const target = rail.lines[line]?.directions[dir];
                            if (!target || !where.length) return [];
                            return [{ line: rail.lines[line].name, toward: localName(target.toward, lang), where: where.map(p => s(`subway.pos.${p}`)).join(', ') }];
                        }),
                        note: stopNote(stop.note),
                    } : null,
                    // Leaving from here (not at the last stop): first and last trains
                    times: (next ? firstAndLast(direction.timetable, index) : [])
                        .map(t => ({ days: daysText(t.days, s), first: time(t.first), last: time(t.last) })),
                };
            }),
    }));
    const [lat, lng] = station.coords;
    return {
        id,
        name: name(id),
        crumbs: breadcrumb(rail, id, lang, s),
        lines,
        walking: walkingUrl(lat, lng),
        timetable: { old: athensDate() > rail.feed.validTo, date: formatDate(rail.feed.validTo) },
    };
}

// The index of every station by line, as data for server/views/stations/index.hbs
/** @param {Rail} rail @param {Lang} lang @param {(key: string) => string} s */
export function indexView(rail, lang, s) {
    return {
        crumbs: breadcrumb(rail, null, lang, s),
        lines: Object.entries(rail.lines).map(([lineId, line]) => ({
            key: lineId.toLowerCase(),
            badge: lineBadge(lineId, line.name),
            number: lineNumber(lineId),
            stops: Object.values(line.directions)[0].stops.map(({ station: id }) => ({
                href: `${STATIONS_PATH}/${id}`,
                name: localName(rail.stations[id].name, lang),
                // The other lines here, if any
                changes: rail.stations[id].lines.filter(l => l !== lineId).join(', ') || null,
            })),
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
    let loaded = { mtime: null, rail: null, html: new Map() };

    // rail.json as it is now; rendered pages are kept until it changes (or the day does,
    // since the timetable notice depends on the date)
    function current() {
        try {
            const mtime = statSync(railFile).mtimeMs;
            const key = `${mtime} ${athensDate()}`;
            if (key !== loaded.mtime) loaded = { mtime: key, rail: JSON.parse(readFileSync(railFile, 'utf8')), html: new Map() };
        } catch { /* keep what we had; null until the first build */ }
        return loaded;
    }

    function page(id, lang) {
        const { rail, html } = current();
        // Object.hasOwn: "constructor" or "__proto__" in the address isn't a station
        if (!rail || (id && !Object.hasOwn(rail.stations, id))) return null;
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
