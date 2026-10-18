import { lastPosition, locationPermission, onLocation, onLocationProblem, startLocation } from '/js/core/location.js';
import { language, t } from '/js/core/i18n.js';
import { athensNow, closestStation, isTimetableExpired, planTrip } from './network.js';
import { stationSearch } from './search.js';
import { renderMessage, renderResult, routeSummary } from './render.js';

// Keeps the "in N minutes" chips current while the page is open
const REFRESH_MS = 30_000;

const result = document.getElementById('subway-result');

// rail.json is precached by the service worker, so this works offline
async function loadRail() {
    try {
        const res = await fetch('/data/rail.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch {
        result.innerHTML = renderMessage('subway.data-error');
        return null;
    }
}

function announce(message) {
    const el = document.getElementById('sr-announcer');
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
}

function start(rail) {
    const params = new URLSearchParams(location.search);

    // `speak`: also tell screen readers, when the user changed the stations
    // (not on the 30-second refresh)
    const render = ({ speak = false } = {}) => {
        const origin = from.get();
        const destination = to.get();
        if (!origin || !destination) { result.innerHTML = ''; return; }
        if (origin === destination) {
            result.innerHTML = renderMessage('subway.same-station');
            if (speak) announce(t('subway.same-station'));
            return;
        }
        const today = athensNow();
        // After the last train, tomorrow's first ones
        const { plans, now, tomorrow } = planTrip(rail, origin, destination, today);
        result.innerHTML = renderResult(rail, plans, now, { expired: isTimetableExpired(rail, today), tomorrow });
        if (speak) announce(routeSummary(rail, plans, now, tomorrow));
    };

    // The selection lives in the URL (?from=syntagma&to=airport) so routes can be bookmarked and shared
    const syncUrl = () => {
        const query = new URLSearchParams();
        if (from.get()) query.set('from', from.get());
        if (to.get()) query.set('to', to.get());
        const search = query.toString();
        history.replaceState(null, '', search ? `${location.pathname}?${search}` : location.pathname);
    };

    const changed = () => { syncUrl(); render({ speak: true }); };

    // Without a station in the address, the boarding station follows the
    // user's location until they pick one themselves
    let followLocation = !params.has('from');

    const from = stationSearch({
        input: document.getElementById('stop-search-from'),
        list: document.getElementById('stop-suggestions-from'),
        rail,
        onChange: () => { followLocation = false; changed(); },
    });
    document.getElementById('stop-search-from').addEventListener('input', () => { followLocation = false; });
    const to = stationSearch({
        input: document.getElementById('stop-search-to'),
        list: document.getElementById('stop-suggestions-to'),
        rail,
        onChange: changed,
    });

    from.set(params.get('from'), { notify: false });
    to.set(params.get('to'), { notify: false });
    changed();

    document.getElementById('subway-form').addEventListener('submit', e => e.preventDefault());

    document.getElementById('swap-stations').addEventListener('click', () => {
        followLocation = false;
        const origin = from.get();
        from.set(to.get(), { notify: false });
        to.set(origin, { notify: false });
        changed();
    });

    setInterval(render, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // ── The nearest station ──
    // Set at once from a recent position (even offline, underground), then
    // from new ones while followLocation lasts. The "Nearest station" button
    // asks for it (the browser asks for the location the first time).
    const status = document.getElementById('locate-status');
    let requested = false;

    const setNearest = ({ lat, lng }, { always = false } = {}) => {
        status.textContent = '';
        const id = closestStation(rail, lat, lng);
        if (id !== from.get()) from.set(id);
        else if (!always) return;
        followLocation = true;
        const name = rail.stations[id].name[language] ?? rail.stations[id].name.en;
        announce(`${t('subway.location-prefix')} ${name} ${t('subway.location-suffix')}`);
    };

    onLocation(position => {
        if (requested) {
            requested = false;
            setNearest(position, { always: true });
        } else if (followLocation) {
            setNearest(position);
        }
    });

    const deniedText = () => `${t('location.denied')}. ${t('location.denied-hint')}`;

    // Only said when someone pressed the button and is waiting for it
    onLocationProblem(problem => {
        if (!requested) return;
        if (problem !== 'slow') requested = false;
        status.textContent = problem === 'denied' ? deniedText() : t(`location.${problem}`);
    });

    document.getElementById('locate-btn').addEventListener('click', async () => {
        followLocation = true;
        const last = lastPosition();
        if (last) {
            setNearest(last, { always: true });
        } else if (await locationPermission() === 'denied') {
            // The browser won't ask, and browsers report this differently when asked anyway
            status.textContent = deniedText();
            return;
        } else {
            requested = true;
            status.textContent = t('subway.locating');
        }
        startLocation();
    });

    if (followLocation) {
        const last = lastPosition();
        if (last) setNearest(last);
        // Only if the browser won't ask: here it asks when the button is pressed
        locationPermission().then(permission => { if (permission === 'granted') startLocation(); });
    }
}

const rail = await loadRail();
if (rail) start(rail);
