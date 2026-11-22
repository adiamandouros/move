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

/** @typedef {import('../../../types/data.js').Rail} Rail */
/** @typedef {import('../../../types/data.js').Trains} Trains */
/**
 * A part of the Maps section: the ids of its section, its map and its list
 * of stations, drawn from rail.json and trains.json (`trains`: needed, used
 * if it can be had, or not at all)
 * @typedef {{ part: string, map: string, list: string, trains?: 'needed' | 'if-any', draw: (el: HTMLElement, rail: Rail, trains: Trains | null) => void, stations: (rail: Rail, trains: Trains | null) => import('/js/core/html.js').Html }} MapPart
 */

// The metro's map goes without the railway's stubs when trains.json can't be
// had; the tram's is never drawn without rail.json's tram (createTramMap
// throws), nor the railway's without trains.json (needed)
/** @type {MapPart[]} */
const MAPS = [
    { part: 'metro', map: 'metro-map', list: 'station-list', trains: 'if-any', draw: (el, rail, trains) => createMetroMap(el, rail, trains, metroLayout), stations: (rail, trains) => stationList(rail, { link: subwayLink, changes: metroStationChanges(rail, trains) }) },
    { part: 'tram', map: 'tram-map', list: 'tram-stop-list', draw: (el, rail) => createTramMap(el, rail, tramLayout), stations: rail => stationList(/** @type {import('../../../types/data.js').Tram} */ (rail.tram), { changes: metroChanges(rail) }) },
    { part: 'suburban', map: 'suburban-map', list: 'suburban-station-list', trains: 'needed', draw: (el, rail, trains) => createSuburbanMap(el, rail, /** @type {Trains} */ (trains), suburbanLayout), stations: (rail, trains) => stationList(suburbanNetwork(/** @type {Trains} */ (trains)), { link: suburbanLink(rail), changes: metroChangesOfRailway(rail, /** @type {Trains} */ (trains)), shown: id => !!suburbanLayout.STATIONS[id] }) },
];

const files = new Map();
/** @param {string} name @returns {Promise<unknown>} */
const load = name => files.get(name) ?? files.set(name, fetch(`/data/${name}`).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}).catch(err => { files.delete(name); throw err; })).get(name);

const mapsSection = /** @type {HTMLElement} */ (document.getElementById('sec-map'));

// A map is drawn the first time it's shown (it needs to be visible to be measured)
/** @param {MapPart} mapPart */
async function openMap({ part, map, list, trains: needs, draw, stations }) {
    const body = /** @type {HTMLElement} */ (document.getElementById(part));
    const container = /** @type {HTMLElement} */ (document.getElementById(map));
    if (!mapsSection.classList.contains('show') || !body.classList.contains('show') || container.dataset.loaded) return;
    container.dataset.loaded = 'true';
    try {
        const [rail, trains] = /** @type {[Rail, Trains | null]} */ (await Promise.all([load('rail.json'), needs === 'needed' ? load('trains.json') : needs ? load('trains.json').catch(() => null) : null]));
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
