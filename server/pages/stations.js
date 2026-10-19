import { readFileSync, statSync } from 'fs';

/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/pages.js').Lang} Lang */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { format, html, icon, localName, walkingUrl } from '../../public/js/core/html.js';
import { clockTime, feedDate, lineBadge, trainDiagram } from '../../public/js/core/metro.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { LANGS, localPath, pageStrings } from './i18n.js';
import { structuredData } from './seo.js';

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

/** @param {Rail} rail @param {Lang} lang @param {import('../../types/pages.js').Tool[]} tools */
function createWriter(rail, lang, tools) {
    // The pages' strings (the shell's, with English for any not translated),
    // the station pages' own and the subway page's
    const own = Object.fromEntries(LANGS.map(l => [l, { ...STRINGS[l], ...tools.find(t => t.id === 'subway')?.strings[l] }]));
    const strings = pageStrings(tools)(lang, own);
    const s = key => strings[key] ?? key;
    const name = id => localName(rail.stations[id].name, lang);
    const href = id => `${STATIONS_PATH}/${id}`;
    const badge = line => lineBadge(rail.lines[line]);
    const days = list => list.length > 2
        ? `${s(`stations.day.${list[0]}`)}–${s(`stations.day.${list.at(-1)}`)}`
        : list.map(d => s(`stations.day.${d}`)).join(', ');
    return { own, s, name, href, badge, days, validTo: feedDate(rail.feed.validTo) };
}

function directionCard(rail, w, lineId, dirId, id, n) {
    const { s, name, href } = w;
    const direction = rail.lines[lineId].directions[dirId];
    const index = direction.stops.findIndex(stop => stop.station === id);
    const stop = direction.stops[index];
    const previous = direction.stops[index - 1]?.station;
    const next = direction.stops[index + 1]?.station;
    const toward = localName(direction.toward, w.lang);
    const headingId = `${lineId}-${dirId}-${n}`.toLowerCase();
    const neighbours = html`${previous && html`<li>${s('stations.previous')}: <a href="${href(previous)}">${name(previous)}</a></li>`}${next
        ? html`<li>${s('stations.next')}: <a href="${href(next)}">${name(next)}</a></li>`
        : html`<li>${s('stations.terminus')}</li>`}`;

    // Arriving here: where to ride for the exit and for each connection
    const arriving = previous && html`
            <h4 class="station-subheading">${s('stations.exit-heading')}</h4>
            ${stop.exits.length ? html`<p class="small mb-2">${s('stations.exit-text')}</p>${trainDiagram(rail.positions, stop.exits, stop.elevators ?? [], s)}` : html`<p class="text-body-secondary fst-italic small">${s('subway.no-position-data')}</p>`}
            ${stop.centralPlatform && html`<p class="central-platform-badge d-inline-block mt-2">${icon('symmetry-horizontal', 'me-1')}${s('subway.exit-left')}</p>`}
            ${Object.entries(stop.transfers ?? {}).map(([to, where]) => {
                const [line, dir] = to.split('/');
                const target = rail.lines[line]?.directions[dir];
                if (!target || !where.length) return '';
                return html`<p class="small mt-2 mb-0">${icon('arrow-left-right', 'me-1')}${format(s('stations.transfer'), {
                    line: rail.lines[line].name, name: localName(target.toward, w.lang), where: where.map(p => s(`subway.pos.${p}`)).join(', '),
                })}</p>`;
            })}
            ${stop.note && html`<div class="stop-note mt-3">${icon('info-circle', 'me-1')}${stop.note}</div>`}`;

    // Leaving from here: first and last trains
    const times = next ? firstAndLast(direction.timetable, index) : [];
    const timetable = times.length > 0 && html`
            <h4 class="station-subheading">${s('stations.times-heading')}</h4>
            <table class="table table-sm station-times mb-0">
                <caption class="sr-only">${format(s('stations.times-caption'), { name: name(id), toward })}</caption>
                <thead><tr><th scope="col">${s('stations.days')}</th><th scope="col">${s('stations.first')}</th><th scope="col">${s('stations.last')}</th></tr></thead>
                <tbody>${times.map(t => html`<tr><th scope="row">${w.days(t.days)}</th><td>${t.first === null ? s('stations.all-night') : clockTime(t.first)}</td><td>${t.last === null ? s('stations.all-night') : clockTime(t.last)}</td></tr>`)}</tbody>
            </table>`;

    return html`
        <div class="card result-card station-direction" role="group" aria-labelledby="${headingId}"><div class="card-body">
            <h3 class="leg-title" id="${headingId}"><span aria-hidden="true">→ </span>${format(s('stations.toward'), { name: toward })}</h3>
            <ul class="list-unstyled small station-neighbours">${neighbours}</ul>${arriving}${timetable}
        </div></div>`;
}

/** @param {Rail} rail @param {string} id @param {Lang} lang @param {import('../../types/pages.js').Tool[]} tools */
export function stationContent(rail, id, lang, tools) {
    const w = { ...createWriter(rail, lang, tools), lang };
    const { s, name, badge } = w;
    const station = rail.stations[id];
    const [lat, lng] = station.coords;
    const expired = athensDate() > rail.feed.validTo;
    let n = 0;
    const lines = station.lines.map(lineId => html`
    <section class="station-section" aria-labelledby="line-${lineId.toLowerCase()}">
        <h2 class="station-line-title" id="line-${lineId.toLowerCase()}">${badge(lineId)} ${format(s('stations.line'), { n: lineId.replace(/^\D+/, '') })}</h2>
        ${Object.keys(rail.lines[lineId].directions)
            .filter(dir => rail.lines[lineId].directions[dir].stops.some(stop => stop.station === id))
            .map(dir => directionCard(rail, w, lineId, dir, id, n++))}
    </section>`);

    return html`<div class="station-view">
    <nav aria-label="${s('stations.breadcrumb')}">
        <ol class="breadcrumb small mb-2">
            <li class="breadcrumb-item"><a href="/subway">${s('stations.subway')}</a></li>
            <li class="breadcrumb-item"><a href="${STATIONS_PATH}">${s('stations.title')}</a></li>
            <li class="breadcrumb-item active" aria-current="page">${name(id)}</li>
        </ol>
    </nav>
    <h1 class="fs-3 fw-semibold mb-1">${name(id)}</h1>
    <p class="text-body-secondary mb-3">${s('stations.lines-here')} ${station.lines.map((line, i) => html`${i > 0 && ' '}${badge(line)}`)}</p>
    <div class="station-actions d-flex flex-wrap gap-2 mb-4">
        <a class="btn btn-sm btn-outline-primary rounded-pill" href="/subway?from=${id}">${icon('signpost-split', 'me-1')}${s('stations.plan-from')}</a>
        <a class="btn btn-sm btn-outline-primary rounded-pill" href="/subway?to=${id}">${icon('geo-alt', 'me-1')}${s('stations.plan-to')}</a>
        <a class="btn btn-sm btn-outline-secondary rounded-pill" href="${walkingUrl(lat, lng)}" target="_blank" rel="noopener">${icon('person-walking', 'me-1')}${s('stations.walk')} <span class="sr-only">${s('shell.new-tab')}</span></a>
    </div>${lines}
    <p class="schedule-disclaimer">${icon('info-circle', 'me-1')}${format(s(expired ? 'stations.timetable-old' : 'stations.timetable'), { date: w.validTo })}</p>
</div>`;
}

/** @param {Rail} rail @param {Lang} lang @param {import('../../types/pages.js').Tool[]} tools */
export function indexContent(rail, lang, tools) {
    const { s, name, href, badge } = { ...createWriter(rail, lang, tools) };
    const lines = Object.entries(rail.lines).map(([lineId, line]) => {
        const stops = Object.values(line.directions)[0].stops.map(stop => stop.station);
        return html`
    <section class="station-section" aria-labelledby="line-${lineId.toLowerCase()}">
        <h2 class="station-line-title" id="line-${lineId.toLowerCase()}">${badge(lineId)} ${format(s('stations.line'), { n: lineId.replace(/^\D+/, '') })}</h2>
        <ol class="station-stops">${stops.map(id => {
            const others = rail.stations[id].lines.filter(l => l !== lineId);
            return html`<li><a href="${href(id)}">${name(id)}</a>${others.length > 0 && html` <span class="station-change">· ${format(s('stations.interchange'), { lines: others.join(', ') })}</span>`}</li>`;
        })}</ol>
    </section>`;
    });
    return html`<div class="station-view">
    <nav aria-label="${s('stations.breadcrumb')}">
        <ol class="breadcrumb small mb-2">
            <li class="breadcrumb-item"><a href="/subway">${s('stations.subway')}</a></li>
            <li class="breadcrumb-item active" aria-current="page">${s('stations.title')}</li>
        </ol>
    </nav>
    <h1 class="fs-3 fw-semibold mb-2">${s('stations.title')}</h1>
    <p class="text-body-secondary">${s('stations.index-intro')}</p>${lines}
</div>`;
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
    return structuredData({ '@context': 'https://schema.org', '@graph': graph });
}

// One station's page (or the index, for id null) with the site's layout.
// origin: the public address (SITE_URL), for the structured data.
/**
 * @param {Rail} rail @param {string | null} id @param {Lang} lang
 * @param {{ render: (page: import('../../types/pages.js').RenderOptions) => string, tools: import('../../types/pages.js').Tool[], origin?: string }} options
 */
export function renderStationPage(rail, id, lang, { render, tools, origin = '' }) {
    const { s, name } = createWriter(rail, lang, tools);
    const common = { lang, active: 'subway', ad: 'station' };
    if (!id) {
        return render({ ...common, title: s('stations.title'), path: STATIONS_PATH, description: s('stations.index-description'), content: indexContent(rail, lang, tools) });
    }
    return render({
        ...common,
        title: format(s('stations.station-title'), { name: name(id) }),
        path: `${STATIONS_PATH}/${id}`,
        description: format(s('stations.description'), { name: name(id), lines: rail.stations[id].lines.map(l => rail.lines[l].name).join(', ') }),
        head: stationData(rail, id, lang, s, origin),
        content: stationContent(rail, id, lang, tools),
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
