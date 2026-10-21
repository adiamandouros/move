import '/js/core/announcements.js';
import { html, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { createMetroMap, createTramMap, metroChanges, stationList, subwayLink, tramChanges } from './map.js';
import * as metroLayout from './map-layout.js';
import * as tramLayout from './tram-layout.js';

// The info page is static apart from the announcements (filled in by
// /js/core/announcements.js) and the maps, drawn from rail.json the first
// time their part of the Maps section is opened. The sections are a
// Bootstrap accordion: a heading with a button that shows or hides its
// content, which screen readers handle well, and the sections show up in
// their list of headings.

// ── Maps ─────────────────────────────────────────────────────────────────────

const MAPS = [
    { part: 'metro', map: 'metro-map', list: 'station-list', draw: (el, rail) => createMetroMap(el, rail, metroLayout), stations: rail => stationList(rail, { link: subwayLink, changes: tramChanges(rail) }) },
    { part: 'tram', map: 'tram-map', list: 'tram-stop-list', draw: (el, rail) => createTramMap(el, rail, tramLayout), stations: rail => stationList(rail.tram, { changes: metroChanges(rail) }) },
];

let railFile = null;
const loadRail = () => railFile ??= fetch('/data/rail.json').then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}).catch(err => { railFile = null; throw err; });

const mapsSection = document.getElementById('sec-map');

// A map is drawn the first time it's shown (it needs to be visible to be measured)
async function openMap({ part, map, list, draw, stations }) {
    const body = document.getElementById(part);
    const container = document.getElementById(map);
    if (!mapsSection.classList.contains('show') || !body.classList.contains('show') || container.dataset.loaded) return;
    container.dataset.loaded = 'true';
    try {
        const rail = await loadRail();
        draw(container, rail);
        setHtml(document.getElementById(list), stations(rail));
    } catch {
        setHtml(container, html`<p class="text-body-secondary">${t('info.map-error')}</p>`);
        delete container.dataset.loaded;
    }
}

const openMaps = () => MAPS.forEach(openMap);
mapsSection.addEventListener('shown.bs.collapse', openMaps);
openMaps();
