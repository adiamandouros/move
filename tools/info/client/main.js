import '/js/core/announcements.js';
import { t } from '/js/core/i18n.js';
import { onLanguageChange } from '/js/core/settings.js';
import { createMetroMap } from './map.js';

// The info page is static apart from the announcements (filled in by
// /js/core/announcements.js) and the metro map, drawn from rail.json the
// first time its section is opened and redrawn when the language changes.

// ── Metro map ────────────────────────────────────────────────────────────────

const mapSection = document.getElementById('map-section');
const mapContainer = document.getElementById('metro-map');
let metroMap = null;

async function openMap() {
    if (!mapSection.open || mapContainer.dataset.loaded) return;
    mapContainer.dataset.loaded = 'true';
    try {
        const res = await fetch('/data/rail.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        metroMap = createMetroMap(mapContainer, await res.json());
    } catch {
        mapContainer.innerHTML = `<p class="text-secondary">${t('info.map-error')}</p>`;
        delete mapContainer.dataset.loaded;
    }
}

mapSection.addEventListener('toggle', openMap);
openMap();
onLanguageChange(() => metroMap?.redraw());
