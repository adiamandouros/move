// ── Screen reader announcer ─────────────────────────────────────────────────

function announce(message) {
    const el = document.getElementById('sr-announcer');
    if (!el) return;
    // Clear first so repeated identical messages still fire
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
}

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
    if (m <= 3) return `<span class="badge arrival-badge arrival-soon" aria-label="${m} minutes, arriving soon">${m} min</span>`;
    if (m <= 8) return `<span class="badge arrival-badge arrival-close" aria-label="${m} minutes">${m} min</span>`;
    return `<span class="badge arrival-badge arrival-later" aria-label="${m} minutes">${m} min</span>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderArrivalRows(arrivals) {
    if (!arrivals.length) return `<p class="text-muted small mb-0">No upcoming arrivals.</p>`;
    return arrivals.map(a => `
        <div class="arrival-row d-flex align-items-center justify-content-between py-2 border-bottom border-secondary-subtle"
             role="row">
            <div class="d-flex align-items-center gap-2">
                <span class="line-pill" aria-hidden="true">${a.LineID}</span>
                <span class="arrival-dest">${a.RouteDescrEng}</span>
            </div>
            ${renderArrivalBadge(a.btime2)}
        </div>`).join('');
}

function stopButtonLabel(stop) {
    const first = stop.arrivals[0];
    const busInfo = first
        ? `Next bus: line ${first.LineID} to ${first.RouteDescrEng}, ${first.btime2} minutes`
        : 'No upcoming arrivals';
    return `${stop.StopDescrEng}, ${stop.distance} away. ${busInfo}. Tap to expand.`;
}

function renderStop(stop, index) {
    const first = stop.arrivals[0];

    const mainContent = first
        ? `<span class="next-bus-line" aria-hidden="true">${first.LineID}</span>
           <span class="next-bus-dest" aria-hidden="true">${first.RouteDescrEng}</span>`
        : `<span class="next-bus-dest text-muted fst-italic" aria-hidden="true">No arrivals</span>`;

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.StopLat},${stop.StopLng}&travelmode=walking`;

    return `
    <div class="accordion-item stop-item" data-stopcode="${stop.StopCode}">
        <div class="stop-header d-flex align-items-stretch">
            <button class="accordion-button stop-toggle collapsed d-flex align-items-center gap-3 flex-grow-1 p-0"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#stop-${index}"
                    aria-expanded="false"
                    aria-controls="stop-${index}"
                    aria-label="${stopButtonLabel(stop)}">

                <div class="stop-label d-flex flex-column align-items-center justify-content-center text-center" aria-hidden="true">
                    <span class="stop-name">${stop.StopDescrEng}</span>
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
                   aria-label="Walking directions to ${stop.StopDescrEng}">
                    <i class="bi bi-signpost-2-fill" aria-hidden="true"></i>
                </a>
            </div>
        </div>

        <div id="stop-${index}" class="accordion-collapse collapse">
            <div class="accordion-body stop-body" role="table" aria-label="All arrivals for ${stop.StopDescrEng}">
                ${renderArrivalRows(stop.arrivals)}
            </div>
        </div>
    </div>`;
}

function renderMessage(icon, title, subtitle = '') {
    return `
        <div class="d-flex flex-column align-items-center justify-content-center text-muted" style="height: 60dvh;">
            <i class="bi bi-${icon} fs-1 mb-3"></i>
            <p class="fs-5 mb-1">${title}</p>
            ${subtitle ? `<p class="small text-secondary text-center px-4">${subtitle}</p>` : ''}
        </div>`;
}

// ── DOM patching (no full re-render) ────────────────────────────────────────

function patchArrivals(stops) {
    stops.forEach(stop => {
        const item = document.querySelector(`.stop-item[data-stopcode="${stop.StopCode}"]`);
        if (!item) return;

        const first = stop.arrivals[0];

        // Update the accessible label on the toggle button
        item.querySelector('.stop-toggle').setAttribute('aria-label', stopButtonLabel(stop));

        // Update next bus line + destination in the header
        item.querySelector('.stop-next-bus').innerHTML = first
            ? `<span class="next-bus-line" aria-hidden="true">${first.LineID}</span>
               <span class="next-bus-dest" aria-hidden="true">${first.RouteDescrEng}</span>`
            : `<span class="next-bus-dest text-muted fst-italic" aria-hidden="true">No arrivals</span>`;

        // Update header badge
        item.querySelector('.header-badge-wrap').innerHTML =
            first ? renderArrivalBadge(first.btime2) : '';

        // Update expanded body rows
        item.querySelector('.stop-body').innerHTML =
            renderArrivalRows(stop.arrivals);
    });

    announce('Arrival times updated');
}

// ── Data fetching ───────────────────────────────────────────────────────────

function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            err => reject(err)
        );
    });
}

async function fetchNearbyStops(lat, lng) {
    const res = await fetch(`/api/localInfo?x=${lat}&y=${lng}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

// ── Arrivals polling ─────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 20_000;
// Minimum movement (metres) before re-fetching the stop list
const LOCATION_THRESHOLD_M = 40;

let pollTimer = null;
let locationWatchId = null;

function stopPolling() {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function stopLocationWatch() {
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

function startPolling(coordsRef) {
    // coordsRef is an object so the location watch can update it in place
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
        container.innerHTML = renderMessage('wifi-off', 'Could not reach the server', err.message);
        return false;
    }

    if (!stops || stops.length === 0) {
        container.innerHTML = renderMessage('bus-front', 'No stops found nearby');
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
        </div>`;

    return true;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function loadNearbyBuses(container) {
    stopPolling();
    stopLocationWatch();

    container.innerHTML = renderMessage('arrow-repeat spin', 'Getting your location…');

    let coords;
    try {
        coords = await getUserLocation();
    } catch (err) {
        const denied = err.code === 1;
        container.innerHTML = renderMessage(
            'geo-alt',
            denied ? 'Location access denied' : 'Could not get location',
            denied
                ? 'Please allow location access in your browser settings and try again.'
                : err.message
        );
        return;
    }

    container.innerHTML = renderMessage('arrow-repeat spin', 'Finding nearby stops…');

    // coordsRef is mutated in place by the location watch so polling always
    // uses the latest position without needing to restart the interval
    const coordsRef = { lat: coords.lat, lng: coords.lng };
    // fetchCoords tracks where the stop list was last fetched from,
    // so we can compare against the movement threshold
    let fetchCoords = { lat: coords.lat, lng: coords.lng };

    const ok = await renderStopList(container, coordsRef);
    if (!ok) return;

    startPolling(coordsRef);

    // Watch for location changes and re-fetch stop list if moved far enough
    locationWatchId = navigator.geolocation.watchPosition(async pos => {
        const newLat = pos.coords.latitude;
        const newLng = pos.coords.longitude;
        coordsRef.lat = newLat;
        coordsRef.lng = newLng;

        const moved = haversineMeters(fetchCoords.lat, fetchCoords.lng, newLat, newLng);
        if (moved >= LOCATION_THRESHOLD_M) {
            fetchCoords = { lat: newLat, lng: newLng };
            stopPolling();
            await renderStopList(container, coordsRef);
            startPolling(coordsRef);
        }
    }, null, { enableHighAccuracy: true });
}

export function unloadNearbyBuses() {
    stopPolling();
    stopLocationWatch();
}
