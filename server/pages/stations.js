// @ts-check
import { readFileSync, statSync } from 'fs';

/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/pages.js').Lang} Lang */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { escapeHtml, format } from '../../public/js/core/html.js';
import { lineBadge, trainDiagram } from '../../public/js/core/metro.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { LANGS, localPath } from './i18n.js';
import { siteUrl, structuredData } from './seo.js';

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


// Seconds since midnight → "05:31" (trains after midnight belong to the day before)
const clock = s => {
    const m = Math.floor((s % DAY) / 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

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
    const own = Object.fromEntries(LANGS.map(l => [l, { ...STRINGS[l], ...tools.find(t => t.id === 'subway')?.strings[l] }]));
    const s = key => own[lang][key] ?? own.en[key] ?? key;
    const name = id => rail.stations[id].name[lang] ?? rail.stations[id].name.en;
    const href = id => `${STATIONS_PATH}/${id}`;
    const badge = line => lineBadge(rail.lines[line]);
    const days = list => list.length > 2
        ? `${s(`stations.day.${list[0]}`)}–${s(`stations.day.${list.at(-1)}`)}`
        : list.map(d => s(`stations.day.${d}`)).join(', ');
    const [y, m, d] = rail.feed.validTo.split('-');
    const validTo = `${d}/${m}/${y}`;
    return { own, s, name, href, badge, days, validTo };
}

function directionCard(rail, w, lineId, dirId, id, n) {
    const { s, name, href } = w;
    const direction = rail.lines[lineId].directions[dirId];
    const index = direction.stops.findIndex(stop => stop.station === id);
    const stop = direction.stops[index];
    const previous = direction.stops[index - 1]?.station;
    const next = direction.stops[index + 1]?.station;
    const toward = direction.toward[w.lang] ?? direction.toward.en;
    const headingId = `${lineId}-${dirId}-${n}`.toLowerCase();
    const neighbours = [
        previous && `<li>${s('stations.previous')}: <a href="${href(previous)}">${escapeHtml(name(previous))}</a></li>`,
        next ? `<li>${s('stations.next')}: <a href="${href(next)}">${escapeHtml(name(next))}</a></li>` : `<li>${s('stations.terminus')}</li>`,
    ].filter(Boolean).join('');

    // Arriving here: where to ride for the exit and for each connection
    const arriving = previous ? `
            <h4 class="station-subheading">${s('stations.exit-heading')}</h4>
            ${stop.exits.length ? `<p class="small mb-2">${s('stations.exit-text')}</p>${trainDiagram(rail.positions, stop.exits, stop.elevators ?? [], s)}` : `<p class="text-secondary fst-italic small">${s('subway.no-position-data')}</p>`}
            ${stop.centralPlatform ? `<p class="central-platform-badge d-inline-block mt-2"><i class="bi bi-symmetry-horizontal me-1" aria-hidden="true"></i>${s('subway.exit-left')}</p>` : ''}
            ${Object.entries(stop.transfers ?? {}).map(([to, where]) => {
                const [line, dir] = to.split('/');
                const target = rail.lines[line]?.directions[dir];
                if (!target || !where.length) return '';
                return `<p class="small mt-2 mb-0"><i class="bi bi-arrow-left-right me-1" aria-hidden="true"></i>${escapeHtml(format(s('stations.transfer'), {
                    line: rail.lines[line].name, name: target.toward[w.lang] ?? target.toward.en, where: where.map(p => s(`subway.pos.${p}`)).join(', '),
                }))}</p>`;
            }).join('')}
            ${stop.note ? `<div class="stop-note mt-3"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${escapeHtml(stop.note)}</div>` : ''}` : '';

    // Leaving from here: first and last trains
    const times = next ? firstAndLast(direction.timetable, index) : [];
    const timetable = times.length ? `
            <h4 class="station-subheading">${s('stations.times-heading')}</h4>
            <table class="table table-sm station-times mb-0">
                <caption class="sr-only">${escapeHtml(format(s('stations.times-caption'), { name: name(id), toward }))}</caption>
                <thead><tr><th scope="col">${s('stations.days')}</th><th scope="col">${s('stations.first')}</th><th scope="col">${s('stations.last')}</th></tr></thead>
                <tbody>${times.map(t => `<tr><th scope="row">${w.days(t.days)}</th><td>${t.first === null ? s('stations.all-night') : clock(t.first)}</td><td>${t.last === null ? s('stations.all-night') : clock(t.last)}</td></tr>`).join('')}</tbody>
            </table>` : '';

    return `
        <div class="result-card station-direction" role="group" aria-labelledby="${headingId}">
            <h3 class="leg-title" id="${headingId}"><span aria-hidden="true">→ </span>${escapeHtml(format(s('stations.toward'), { name: toward }))}</h3>
            <ul class="list-unstyled small station-neighbours">${neighbours}</ul>${arriving}${timetable}
        </div>`;
}

/** @param {Rail} rail @param {string} id @param {Lang} lang @param {import('../../types/pages.js').Tool[]} tools */
export function stationContent(rail, id, lang, tools) {
    const w = { ...createWriter(rail, lang, tools), lang };
    const { s, name, badge } = w;
    const station = rail.stations[id];
    const [lat, lng] = station.coords;
    const expired = athensDate() > rail.feed.validTo;
    let n = 0;
    const lines = station.lines.map(lineId => `
    <section class="station-section" aria-labelledby="line-${lineId.toLowerCase()}">
        <h2 class="station-line-title" id="line-${lineId.toLowerCase()}">${badge(lineId)} ${escapeHtml(format(s('stations.line'), { n: lineId.replace(/^\D+/, '') }))}</h2>
        ${Object.keys(rail.lines[lineId].directions)
            .filter(dir => rail.lines[lineId].directions[dir].stops.some(stop => stop.station === id))
            .map(dir => directionCard(rail, w, lineId, dir, id, n++)).join('')}
    </section>`).join('');

    return `<div class="station-view">
    <nav aria-label="${s('stations.breadcrumb')}">
        <ol class="breadcrumb small mb-2">
            <li class="breadcrumb-item"><a href="/subway">${s('stations.subway')}</a></li>
            <li class="breadcrumb-item"><a href="${STATIONS_PATH}">${s('stations.title')}</a></li>
            <li class="breadcrumb-item active" aria-current="page">${escapeHtml(name(id))}</li>
        </ol>
    </nav>
    <h1 class="fs-3 fw-semibold mb-1">${escapeHtml(name(id))}</h1>
    <p class="text-secondary mb-3">${s('stations.lines-here')} ${station.lines.map(badge).join(' ')}</p>
    <div class="station-actions d-flex flex-wrap gap-2 mb-4">
        <a class="btn btn-sm btn-outline-primary rounded-pill" href="/subway?from=${id}"><i class="bi bi-signpost-split me-1" aria-hidden="true"></i>${s('stations.plan-from')}</a>
        <a class="btn btn-sm btn-outline-primary rounded-pill" href="/subway?to=${id}"><i class="bi bi-geo-alt me-1" aria-hidden="true"></i>${s('stations.plan-to')}</a>
        <a class="btn btn-sm btn-outline-secondary rounded-pill" href="https://www.google.com/maps/dir/?api=1&amp;destination=${lat},${lng}&amp;travelmode=walking" target="_blank" rel="noopener"><i class="bi bi-person-walking me-1" aria-hidden="true"></i>${s('stations.walk')} <span class="sr-only" data-i18n="shell.new-tab">(opens in a new tab)</span></a>
    </div>${lines}
    <p class="schedule-disclaimer"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${format(s(expired ? 'stations.timetable-old' : 'stations.timetable'), { date: w.validTo })}</p>
</div>`;
}

/** @param {Rail} rail @param {Lang} lang @param {import('../../types/pages.js').Tool[]} tools */
export function indexContent(rail, lang, tools) {
    const { s, name, href, badge } = { ...createWriter(rail, lang, tools) };
    const lines = Object.entries(rail.lines).map(([lineId, line]) => {
        const stops = Object.values(line.directions)[0].stops.map(stop => stop.station);
        return `
    <section class="station-section" aria-labelledby="line-${lineId.toLowerCase()}">
        <h2 class="station-line-title" id="line-${lineId.toLowerCase()}">${badge(lineId)} ${escapeHtml(format(s('stations.line'), { n: lineId.replace(/^\D+/, '') }))}</h2>
        <ol class="station-stops">${stops.map(id => {
            const others = rail.stations[id].lines.filter(l => l !== lineId);
            return `<li><a href="${href(id)}">${escapeHtml(name(id))}</a>${others.length ? ` <span class="station-change">· ${escapeHtml(format(s('stations.interchange'), { lines: others.join(', ') }))}</span>` : ''}</li>`;
        }).join('')}</ol>
    </section>`;
    }).join('');
    return `<div class="station-view">
    <nav aria-label="${s('stations.breadcrumb')}">
        <ol class="breadcrumb small mb-2">
            <li class="breadcrumb-item"><a href="/subway">${s('stations.subway')}</a></li>
            <li class="breadcrumb-item active" aria-current="page">${s('stations.title')}</li>
        </ol>
    </nav>
    <h1 class="fs-3 fw-semibold mb-2">${s('stations.title')}</h1>
    <p class="text-secondary">${s('stations.index-intro')}</p>${lines}
</div>`;
}

// Structured data: the station with its location, and where it sits in the site
function stationData(rail, id, lang, s) {
    const origin = siteUrl();
    const url = path => origin + localPath(path, lang);
    const name = rail.stations[id].name[lang] ?? rail.stations[id].name.en;
    const [latitude, longitude] = rail.stations[id].coords;
    const graph = [
        { '@type': 'SubwayStation', name, ...(origin && { url: url(`${STATIONS_PATH}/${id}`) }), geo: { '@type': 'GeoCoordinates', latitude, longitude } },
        ...(origin ? [{ '@type': 'BreadcrumbList', itemListElement: [
            [s('stations.subway'), '/subway'], [s('stations.title'), STATIONS_PATH], [name, `${STATIONS_PATH}/${id}`],
        ].map(([itemName, path], i) => ({ '@type': 'ListItem', position: i + 1, name: itemName, item: url(path) })) }] : []),
    ];
    return structuredData({ '@context': 'https://schema.org', '@graph': graph });
}

// One station's page (or the index, for id null) with the site's layout
/**
 * @param {Rail} rail @param {string | null} id @param {Lang} lang
 * @param {{ render: (page: import('../../types/pages.js').RenderOptions) => string, tools: import('../../types/pages.js').Tool[] }} options
 */
export function renderStationPage(rail, id, lang, { render, tools }) {
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
        head: stationData(rail, id, lang, s),
        content: stationContent(rail, id, lang, tools),
    });
}

// → { router, paths() }. render is the layout's (layout.js createRenderer);
// paths() lists the English paths for the sitemap.
/** @param {{ railFile: string, render: (page: import('../../types/pages.js').RenderOptions) => string, tools: import('../../types/pages.js').Tool[] }} options */
export function createStationPages({ railFile, render, tools }) {
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
        if (!rail || (id && !rail.stations[id])) return null;
        const cacheKey = `${lang} ${id ?? ''}`;
        if (!html.has(cacheKey)) html.set(cacheKey, renderStationPage(rail, id, lang, { render, tools }));
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
