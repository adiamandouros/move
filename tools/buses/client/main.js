import { getCoords, subscribeToLocation } from '/js/core/location.js';
import { onLanguageChange } from '/js/core/settings.js';
import { t } from '/js/core/i18n.js';
import { decodeStops, distanceMeters, nearestStops } from './stops.js';
import { message, patchStop, stopItem } from './render.js';

// The server keeps each stop's arrivals for 30 s, so polling faster gains
// nothing. The extra 2 s make sure the previous answer has expired by the
// next poll; at exactly 30 s the poll could land just before and get the same data.
const POLL_MS = 32_000;
// Stop polling when nobody has touched the page for this long
const IDLE_MS = 10 * 60_000;
// Re-pick the nearby stops after walking this far
const MOVE_THRESHOLD_M = 40;
const PAGE_SIZE = 6;
const RADIUS_M = 500;
const WIDER_RADIUS_M = 1500;

const $ = id => document.getElementById(id);
const accordion = $('stops-accordion');

const state = {
    allStops: null,
    coords: null,
    pickedAt: null,
    limit: PAGE_SIZE,
    stops: [],
    results: {},
    lastPoll: 0,
    lastInteraction: Date.now(),
    paused: false,
    hideEmpty: false,
    polling: false,
};

// ── Rendering ───────────────────────────────────────────────────────────────

function renderStops() {
    $('bus-message').innerHTML = '';
    accordion.innerHTML = state.stops.map(stopItem).join('');
    $('bus-actions').hidden = false;
    patchAll();
}

function patchAll() {
    for (const stop of state.stops) {
        const item = accordion.querySelector(`[data-stop="${stop.code}"]`);
        if (item) patchStop(item, stop, state.results[stop.code]);
    }
    applyFilter();
    renderStatus();
}

function applyFilter() {
    accordion.querySelectorAll('.stop-item').forEach(item => {
        item.classList.toggle('d-none', state.hideEmpty && item.dataset.hasArrivals !== 'true');
    });
    const btn = $('toggle-empty-btn');
    btn.setAttribute('aria-pressed', String(state.hideEmpty));
    btn.querySelector('i').className = `bi bi-${state.hideEmpty ? 'eye' : 'eye-slash'} me-2`;
    const label = btn.querySelector('span');
    label.dataset.i18n = state.hideEmpty ? 'buses.show-all' : 'buses.hide-empty';
    label.textContent = t(label.dataset.i18n);
}

function renderStatus() {
    const el = $('bus-status');
    const results = state.stops.map(s => state.results[s.code]).filter(Boolean);
    el.replaceChildren();
    if (state.paused) {
        const resume = document.createElement('button');
        resume.type = 'button';
        resume.className = 'btn btn-link btn-sm p-0 align-baseline';
        resume.textContent = t('buses.resume');
        resume.addEventListener('click', () => interact());
        el.append(`${t('buses.paused')} `, resume);
    } else if (results.length && results.every(r => r.unavailable)) {
        el.append(t('buses.unavailable'));
    } else if (results.some(r => r.stale)) {
        el.append(t('buses.stale'));
    }
    el.hidden = !el.childNodes.length;
}

// ── Data ────────────────────────────────────────────────────────────────────

function pickStops() {
    const { lat, lng } = state.coords;
    state.pickedAt = { lat, lng };
    state.stops = nearestStops(state.allStops, lat, lng, {
        limit: state.limit,
        radius: state.limit > PAGE_SIZE ? WIDER_RADIUS_M : RADIUS_M,
    });
    if (!state.stops.length) {
        accordion.innerHTML = '';
        $('bus-actions').hidden = true;
        $('bus-message').innerHTML = message('bus-front', t('buses.no-stops'));
        return;
    }
    renderStops();
}

async function poll() {
    if (state.polling || state.paused || document.hidden || !state.stops.length) return;
    state.polling = true;
    try {
        const codes = state.stops.map(s => s.code).join(',');
        const res = await fetch(`/api/arrivals?stops=${codes}`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { stops } = await res.json();
        Object.assign(state.results, stops);
    } catch {
        // Offline or server trouble: keep what we have, but say live times are unavailable for stops with nothing yet
        for (const s of state.stops) state.results[s.code] ??= { arrivals: [], unavailable: true };
    } finally {
        state.polling = false;
        state.lastPoll = Date.now();
        patchAll();
    }
}

function tick() {
    if (document.hidden || state.paused) return;
    if (Date.now() - state.lastInteraction > IDLE_MS) {
        state.paused = true;
        renderStatus();
        return;
    }
    poll();
}

// Any tap or key press counts as someone looking at the page
function interact() {
    state.lastInteraction = Date.now();
    if (state.paused) {
        state.paused = false;
        renderStatus();
        poll();
    }
}

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
    $('bus-message').innerHTML = message('arrow-repeat spin', t('buses.getting-location'));

    const [stopsData, coords] = await Promise.allSettled([
        fetch('/data/bus-stops.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        getCoords(),
    ]);

    if (coords.status === 'rejected') {
        const denied = coords.reason?.code === 1;
        $('bus-message').innerHTML = message('geo-alt',
            t(denied ? 'buses.location-denied' : 'buses.location-error'),
            denied ? t('buses.location-denied-hint') : coords.reason?.message ?? '');
        return;
    }
    if (stopsData.status === 'rejected') {
        $('bus-message').innerHTML = message('wifi-off', t('buses.data-error'));
        return;
    }

    state.allStops = decodeStops(stopsData.value);
    state.coords = coords.value;
    pickStops();
    poll();

    setInterval(tick, POLL_MS);

    document.addEventListener('pointerdown', interact, { passive: true });
    document.addEventListener('keydown', interact);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        interact();
        if (Date.now() - state.lastPoll >= POLL_MS) poll();
    });

    subscribeToLocation(({ lat, lng }) => {
        state.coords = { lat, lng };
        if (distanceMeters(state.pickedAt.lat, state.pickedAt.lng, lat, lng) >= MOVE_THRESHOLD_M) {
            pickStops();
            poll();
        }
    });

    $('show-more-btn').addEventListener('click', () => {
        state.limit += PAGE_SIZE;
        pickStops();
        poll();
    });

    $('toggle-empty-btn').addEventListener('click', () => {
        state.hideEmpty = !state.hideEmpty;
        applyFilter();
    });

    onLanguageChange(() => { if (state.stops.length) renderStops(); });
}

start();
