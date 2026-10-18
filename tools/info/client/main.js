import '/js/core/announcements.js';
import { t } from '/js/core/i18n.js';
import { createMetroMap, stationList } from './map.js';

// The info page is static apart from the announcements (filled in by
// /js/core/announcements.js) and the metro map, drawn from rail.json the
// first time its section is opened.

// ── Sections ─────────────────────────────────────────────────────────────────

// Each section is a heading with a button that shows or hides its content
// (the accordion pattern, which screen readers handle well, and the sections
// show up in their list of headings)
document.addEventListener('click', e => {
    const button = e.target.closest('.info-toggle');
    if (!button) return;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
    if (button.id === 'toggle-map') openMap();
});

// ── Metro map ────────────────────────────────────────────────────────────────

const mapBody = document.getElementById('sec-map');
const mapContainer = document.getElementById('metro-map');
const stationsContainer = document.getElementById('station-list');

// Drawn the first time the section is opened (it needs to be visible to be measured)
async function openMap() {
    if (mapBody.hidden || mapContainer.dataset.loaded) return;
    mapContainer.dataset.loaded = 'true';
    try {
        const res = await fetch('/data/rail.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rail = await res.json();
        createMetroMap(mapContainer, rail);
        stationsContainer.innerHTML = stationList(rail);
    } catch {
        mapContainer.innerHTML = `<p class="text-secondary">${t('info.map-error')}</p>`;
        delete mapContainer.dataset.loaded;
    }
}

openMap();
