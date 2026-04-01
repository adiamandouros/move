import { getCoords, subscribeToLocation } from '../location.js';
import { t } from '../i18n.js';
import { getLanguage, onLanguageChange } from '../settings.js';

// ── Screen reader announcer ─────────────────────────────────────────────────

function announce(message) {
    const el = document.getElementById('sr-announcer');
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
}

// ── Language-aware field accessors ──────────────────────────────────────────

const routeDescr = a => getLanguage() === 'el' ? a.RouteDescr  : a.RouteDescrEng;
const stopDescr  = s => getLanguage() === 'el' ? s.StopDescr   : s.StopDescrEng;

// ── Helpers ────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLng / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function renderArrivalBadge(minutes) {
    const m = Number(minutes);
    if (m <= 3) return `<span class="badge arrival-badge arrival-soon" aria-label="${m} ${t('buses.arriving-soon')}">${m} min</span>`;
    if (m <= 8) return `<span class="badge arrival-badge arrival-close" aria-label="${m} ${t('buses.minutes')}">${m} min</span>`;
    return `<span class="badge arrival-badge arrival-later" aria-label="${m} ${t('buses.minutes')}">${m} min</span>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderArrivalRows(arrivals) {
    if (!arrivals.length) return `<p class="text-muted small mb-0">${t('buses.no-arrivals')}</p>`;
    return arrivals.map(a => `
        <div class="arrival-row d-flex align-items-center justify-content-between py-2 border-bottom border-secondary-subtle"
             role="row">
            <div class="d-flex align-items-center gap-2">
                <span class="line-pill" aria-hidden="true">${a.LineID}</span>
                <span class="arrival-dest">${routeDescr(a)}</span>
            </div>
            ${renderArrivalBadge(a.btime2)}
        </div>`).join('');
}

function stopButtonLabel(stop) {
    const first = stop.arrivals[0];
    const busInfo = first
        ? `${t('buses.next-bus-line')} ${first.LineID} to ${routeDescr(first)}, ${first.btime2} ${t('buses.minutes')}`
        : t('buses.no-upcoming');
    return `${stopDescr(stop)}, ${stop.distance} away. ${busInfo}. ${t('buses.tap-expand')}`;
}

function renderStop(stop, index) {
    const first = stop.arrivals[0];

    const mainContent = first
        ? `<span class="next-bus-line" aria-hidden="true">${first.LineID}</span>
           <span class="next-bus-dest" aria-hidden="true">${routeDescr(first)}</span>`
        : `<span class="next-bus-dest text-muted fst-italic" aria-hidden="true">${t('buses.no-arrivals-short')}</span>`;

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.StopLat},${stop.StopLng}&travelmode=walking`;

    return `
    <div class="accordion-item stop-item" data-stopcode="${stop.StopCode}" data-has-arrivals="${stop.arrivals.length > 0}">
        <div class="stop-header d-flex align-items-stretch">
            <button class="accordion-button stop-toggle collapsed d-flex align-items-center gap-3 flex-grow-1 p-0"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#stop-${index}"
                    aria-expanded="false"
                    aria-controls="stop-${index}"
                    aria-label="${stopButtonLabel(stop)}">

                <div class="stop-label d-flex flex-column align-items-center justify-content-center text-center" aria-hidden="true">
                    <span class="stop-name">${stopDescr(stop)}</span>
                    <span class="stop-distance">${stop.distance}</span>
                </div>

                <div class="stop-next-bus d-flex align-items-center gap-2 flex-grow-1" aria-hidden="true">
                    ${mainContent}
                </div>
            </button>

            <div class="stop-header-fixed d-flex align-items-center">
                <span class="header-badge-wrap" aria-hidden="true">${first ? renderArrivalBadge(first.btime2) : ''}</span>
                <a class="directions-btn d-flex align-items-center justify-content-center"
                   href="${mapsUrl}" target="_blank" rel="noopener"
                   aria-label="${t('buses.walking-directions-to')} ${stopDescr(stop)}">
                    <i class="bi bi-signpost-2-fill" aria-hidden="true"></i>
                </a>
            </div>
        </div>

        <div id="stop-${index}" class="accordion-collapse collapse">
            <div class="accordion-body stop-body" role="table" aria-label="${t('buses.all-arrivals-for')} ${stopDescr(stop)}">
                ${renderArrivalRows(stop.arrivals)}
            </div>
        </div>
    </div>`;
}

function renderMessage(icon, title, subtitle = '') {
    return `
        <div class="d-flex flex-column align-items-center justify-content-center text-muted" style="height: 60dvh;">
            <i class="bi bi-${icon} fs-1 mb-3" aria-hidden="true"></i>
            <p class="fs-5 mb-1">${title}</p>
            ${subtitle ? `<p class="small text-secondary text-center px-4">${subtitle}</p>` : ''}
        </div>`;
}

// ── Empty-stop filter ────────────────────────────────────────────────────────

let hideEmpty = false;

function applyFilter() {
    document.querySelectorAll('.stop-item').forEach(item => {
        const hasArrivals = item.dataset.hasArrivals === 'true';
        item.classList.toggle('d-none', hideEmpty && !hasArrivals);
    });

    const btn = document.getElementById('toggle-empty-btn');
    if (!btn) return;
    if (hideEmpty) {
        btn.innerHTML = `<i class="bi bi-eye me-2" aria-hidden="true"></i>${t('buses.show-all')}`;
        btn.classList.replace('btn-outline-secondary', 'btn-outline-primary');
    } else {
        btn.innerHTML = `<i class="bi bi-eye-slash me-2" aria-hidden="true"></i>${t('buses.hide-empty')}`;
        btn.classList.replace('btn-outline-primary', 'btn-outline-secondary');
    }
}

// ── DOM patching (no full re-render) ────────────────────────────────────────

function patchArrivals(stops) {
    stops.forEach(stop => {
        const item = document.querySelector(`.stop-item[data-stopcode="${stop.StopCode}"]`);
        if (!item) return;

        const first = stop.arrivals[0];

        item.dataset.hasArrivals = String(stop.arrivals.length > 0);

        item.querySelector('.stop-toggle').setAttribute('aria-label', stopButtonLabel(stop));

        item.querySelector('.stop-next-bus').innerHTML = first
            ? `<span class="next-bus-line" aria-hidden="true">${first.LineID}</span>
               <span class="next-bus-dest" aria-hidden="true">${routeDescr(first)}</span>`
            : `<span class="next-bus-dest text-muted fst-italic" aria-hidden="true">${t('buses.no-arrivals-short')}</span>`;

        item.querySelector('.header-badge-wrap').innerHTML =
            first ? renderArrivalBadge(first.btime2) : '';

        item.querySelector('.stop-body').innerHTML =
            renderArrivalRows(stop.arrivals);
    });

    applyFilter();
    announce(t('buses.updated'));
}

// ── Data fetching ───────────────────────────────────────────────────────────

async function fetchNearbyStops(lat, lng) {
    const res = await fetch(`/api/localInfo?x=${lat}&y=${lng}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

// ── Arrivals polling ─────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 20_000;
const LOCATION_THRESHOLD_M = 40;

let pollTimer = null;
let unsubscribeLocation = null;
let unsubscribeLanguage = null;

function stopPolling() {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function startPolling(coordsRef) {
    stopPolling();
    pollTimer = setInterval(async () => {
        try {
            const stops = await fetchNearbyStops(coordsRef.lat, coordsRef.lng);
            if (stops?.length) patchArrivals(stops);
        } catch {
            // Silent fail — stale data is better than an error flash
        }
    }, POLL_INTERVAL_MS);
}

async function renderStopList(container, coords) {
    let stops;
    try {
        stops = await fetchNearbyStops(coords.lat, coords.lng);
    } catch (err) {
        container.innerHTML = renderMessage('wifi-off', t('buses.server-error'), err.message);
        return false;
    }

    if (!stops || stops.length === 0) {
        container.innerHTML = renderMessage('bus-front', t('buses.no-stops'));
        return false;
    }

    stops.forEach(stop => {
        stop._meters = haversineMeters(coords.lat, coords.lng, Number(stop.StopLat), Number(stop.StopLng));
        stop.distance = formatDistance(stop._meters);
    });

    stops.sort((a, b) => a._meters - b._meters);

    container.innerHTML = `
        <div class="nearby-buses-view">
            <div class="accordion accordion-flush" id="stops-accordion">
                ${stops.map((s, i) => renderStop(s, i)).join('')}
            </div>
            <div class="filter-bar">
                <button id="toggle-empty-btn" class="btn btn-sm btn-outline-secondary rounded-pill px-4">
                    <i class="bi bi-eye-slash me-2" aria-hidden="true"></i>${t('buses.hide-empty')}
                </button>
            </div>
        </div>`;

    container.querySelector('#toggle-empty-btn').addEventListener('click', () => {
        hideEmpty = !hideEmpty;
        applyFilter();
    });

    applyFilter();
    return true;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function loadNearbyBuses(container) {
    hideEmpty = false;
    stopPolling();
    if (unsubscribeLocation) { unsubscribeLocation(); unsubscribeLocation = null; }
    if (unsubscribeLanguage) { unsubscribeLanguage(); unsubscribeLanguage = null; }

    unsubscribeLanguage = onLanguageChange(() => loadNearbyBuses(container));

    container.innerHTML = renderMessage('arrow-repeat spin', t('buses.getting-location'));

    let coords;
    try {
        coords = await getCoords();
    } catch (err) {
        const denied = err.code === 1;
        container.innerHTML = renderMessage(
            'geo-alt',
            denied ? t('buses.location-denied') : t('buses.location-error'),
            denied ? t('buses.location-denied-hint') : err.message
        );
        return;
    }

    container.innerHTML = renderMessage('arrow-repeat spin', t('buses.finding-stops'));

    const coordsRef = { lat: coords.lat, lng: coords.lng };
    let fetchCoords = { lat: coords.lat, lng: coords.lng };

    const ok = await renderStopList(container, coordsRef);
    if (!ok) return;

    startPolling(coordsRef);

    // Subscribe to shared location updates from location.js
    unsubscribeLocation = subscribeToLocation(async ({ lat, lng }) => {
        coordsRef.lat = lat;
        coordsRef.lng = lng;

        const moved = haversineMeters(fetchCoords.lat, fetchCoords.lng, lat, lng);
        if (moved >= LOCATION_THRESHOLD_M) {
            fetchCoords = { lat, lng };
            stopPolling();
            await renderStopList(container, coordsRef);
            startPolling(coordsRef);
        }
    });
}

export function unloadNearbyBuses() {
    stopPolling();
    if (unsubscribeLocation) { unsubscribeLocation(); unsubscribeLocation = null; }
    if (unsubscribeLanguage) { unsubscribeLanguage(); unsubscribeLanguage = null; }
}
