import { readFileSync, statSync } from 'fs';

/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/pages.js').Lang} Lang */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { format, formatDate, localName, walkingUrl } from '../../public/js/core/html.js';
import { centralPlatformBadge, clockTime, exitDiagram, lineBadge, stopNote } from '../../public/js/core/metro.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { LANGS, localPath, pageStrings } from './i18n.js';
import { view } from './templates.js';

// A page for every metro station, and an index of them, in English and Greek:
// which carriage to ride for the exit, connections and first and last trains.
// They're written from rail.json, so they're rendered on request (and kept
// until rail.json changes) rather than at startup like the pages in
// registry.js, and follow its weekly rebuild without a restart.
//   /subway/stations, /subway/stations/<station id>, and the same under /el

const STRINGS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'views', 'stations.json'), 'utf8'));
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

// The station pages' strings in one language: the shell's (with English for
// any not translated), the station pages' own and the subway page's
/** @param {Lang} lang @param {import('../../types/pages.js').Tool[]} tools */
function stationStrings(lang, tools) {
    const own = Object.fromEntries(LANGS.map(l => [l, { ...STRINGS[l], ...tools.find(t => t.id === 'subway')?.strings[l] }]));
    return pageStrings(tools)(lang, own);
}

// "Mon–Fri", or "Sat, Sun", for a run of days (0 = Sunday)
const daysText = (list, s) => list.length > 2
    ? `${s(`stations.day.${list[0]}`)}–${s(`stations.day.${list.at(-1)}`)}`
    : list.map(d => s(`stations.day.${d}`)).join(', ');

const lineNumber = lineId => lineId.replace(/^\D+/, '');

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
        lines,
        walking: walkingUrl(lat, lng),
        timetable: { old: athensDate() > rail.feed.validTo, date: formatDate(rail.feed.validTo) },
    };
}

// The index of every station by line, as data for server/views/stations/index.hbs
/** @param {Rail} rail @param {Lang} lang */
export function indexView(rail, lang) {
    return {
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
        ...(origin ? [{ '@type': 'BreadcrumbList', itemListElement: [
            [s('stations.subway'), '/subway'], [s('stations.title'), STATIONS_PATH], [name, `${STATIONS_PATH}/${id}`],
        ].map(([itemName, path], i) => ({ '@type': 'ListItem', position: i + 1, name: itemName, item: url(path) })) }] : []),
    ];
    return { '@context': 'https://schema.org', '@graph': graph };
}

// One station's page (or the index, for id null) with the site's layout.
// origin: the public address (SITE_URL), for the structured data.
/**
 * @param {Rail} rail @param {string | null} id @param {Lang} lang
 * @param {{ render: (page: import('../../types/pages.js').RenderOptions) => string, tools: import('../../types/pages.js').Tool[], origin?: string }} options
 */
export function renderStationPage(rail, id, lang, { render, tools, origin = '' }) {
    const strings = stationStrings(lang, tools);
    const s = key => strings[key] ?? key;
    const common = { lang, active: 'subway', ad: 'station' };
    if (!id) {
        return render({
            ...common, title: s('stations.title'), path: STATIONS_PATH, description: s('stations.index-description'),
            content: view('stations/index')(indexView(rail, lang), { lang, strings }),
        });
    }
    const name = localName(rail.stations[id].name, lang);
    return render({
        ...common,
        title: format(s('stations.station-title'), { name }),
        path: `${STATIONS_PATH}/${id}`,
        description: format(s('stations.description'), { name, lines: rail.stations[id].lines.map(l => rail.lines[l].name).join(', ') }),
        structuredData: stationData(rail, id, lang, s, origin),
        content: view('stations/station')(stationView(rail, id, lang, s), { lang, strings }),
    });
}

// → { router, paths() }. render is the layout's (layout.js createRenderer);
// paths() lists the English paths for the sitemap.
/** @param {{ railFile: string, render: (page: import('../../types/pages.js').RenderOptions) => string, tools: import('../../types/pages.js').Tool[], origin?: string }} options */
export function createStationPages({ railFile, render, tools, origin = '' }) {
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
        if (!html.has(cacheKey)) html.set(cacheKey, renderStationPage(rail, id, lang, { render, tools, origin }));
        return html.get(cacheKey);
    }

    const router = express.Router();
    for (const lang of LANGS) {
        const base = localPath(STATIONS_PATH, lang);
        const send = (res, next, html) => html ? res.set('Cache-Control', 'no-cache').type('html').send(html) : next();
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
