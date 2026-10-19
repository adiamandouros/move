import '/js/core/announcements.js';
import { html, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { createMetroMap, stationList } from './map.js';

// The info page is static apart from the announcements (filled in by
// /js/core/announcements.js) and the metro map, drawn from rail.json the
// first time its section is opened. The sections are a Bootstrap accordion:
// a heading with a button that shows or hides its content, which screen
// readers handle well, and the sections show up in their list of headings.

// ── Metro map ────────────────────────────────────────────────────────────────

const mapBody = document.getElementById('sec-map');
const mapContainer = document.getElementById('metro-map');
const stationsContainer = document.getElementById('station-list');

// Drawn the first time the section is opened (it needs to be visible to be measured)
mapBody.addEventListener('shown.bs.collapse', e => e.target === mapBody && openMap());
async function openMap() {
    if (!mapBody.classList.contains('show') || mapContainer.dataset.loaded) return;
    mapContainer.dataset.loaded = 'true';
    try {
        const res = await fetch('/data/rail.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rail = await res.json();
        createMetroMap(mapContainer, rail);
        setHtml(stationsContainer, stationList(rail));
    } catch {
        setHtml(mapContainer, html`<p class="text-body-secondary">${t('info.map-error')}</p>`);
        delete mapContainer.dataset.loaded;
    }
}

openMap();
