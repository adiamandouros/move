import '/js/core/announcements.js';
import { html, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { createMetroMap, createSuburbanMap, createTramMap, metroChanges, metroChangesOfRailway, metroStationChanges, stationList, suburbanLink, suburbanNetwork, subwayLink } from './map.js';
import * as metroLayout from './map-layout.js';
import * as suburbanLayout from './suburban-layout.js';
import * as tramLayout from './tram-layout.js';

// The info page is static apart from the announcements (filled in by
// /js/core/announcements.js) and the maps, drawn from rail.json (and
// trains.json, the railway's) the first time their part of the Maps section
// is opened. The sections are a
// Bootstrap accordion: a heading with a button that shows or hides its
// content, which screen readers handle well, and the sections show up in
// their list of headings.

// ── Maps ─────────────────────────────────────────────────────────────────────

// The metro's map goes without the railway's stubs when trains.json can't be had
const MAPS = [
    { part: 'metro', map: 'metro-map', list: 'station-list', trains: 'if-any', draw: (el, rail, trains) => createMetroMap(el, rail, trains, metroLayout), stations: (rail, trains) => stationList(rail, { link: subwayLink, changes: metroStationChanges(rail, trains) }) },
    { part: 'tram', map: 'tram-map', list: 'tram-stop-list', draw: (el, rail) => createTramMap(el, rail, tramLayout), stations: rail => stationList(rail.tram, { changes: metroChanges(rail) }) },
    { part: 'suburban', map: 'suburban-map', list: 'suburban-station-list', trains: 'needed', draw: (el, rail, trains) => createSuburbanMap(el, rail, trains, suburbanLayout), stations: (rail, trains) => stationList(suburbanNetwork(trains), { link: suburbanLink(rail), changes: metroChangesOfRailway(rail, trains), shown: id => !!suburbanLayout.STATIONS[id] }) },
];

const files = new Map();
const load = name => files.get(name) ?? files.set(name, fetch(`/data/${name}`).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}).catch(err => { files.delete(name); throw err; })).get(name);

const mapsSection = /** @type {HTMLElement} */ (document.getElementById('sec-map'));

// A map is drawn the first time it's shown (it needs to be visible to be measured)
async function openMap({ part, map, list, trains: needs, draw, stations }) {
    const body = /** @type {HTMLElement} */ (document.getElementById(part));
    const container = /** @type {HTMLElement} */ (document.getElementById(map));
    if (!mapsSection.classList.contains('show') || !body.classList.contains('show') || container.dataset.loaded) return;
    container.dataset.loaded = 'true';
    try {
        const [rail, trains] = await Promise.all([load('rail.json'), needs === 'needed' ? load('trains.json') : needs ? load('trains.json').catch(() => null) : null]);
        draw(container, rail, trains);
        setHtml(/** @type {HTMLElement} */ (document.getElementById(list)), stations(rail, trains));
    } catch {
        setHtml(container, html`<p class="text-body-secondary">${t('info.map-error')}</p>`);
        delete container.dataset.loaded;
    }
}

const openMaps = () => MAPS.forEach(openMap);
mapsSection.addEventListener('shown.bs.collapse', openMaps);
openMaps();
