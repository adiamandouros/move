import { lastPosition, locationPermission, onLocation, onLocationProblem, restartLocation, startLocation } from '/js/core/location.js';
import { icon } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { decodeStops, distanceMeters, nearestStops } from './stops.js';
import { message, patchStop, stopItem } from './render.js';
import { countDown, elapsedMinutes, refreshEvery as refreshFor } from './timing.js';

// How often the page checks which stops are due, and counts the minutes down
const TICK_MS = 1_000;
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
    // Per stop code: when its last answer came in (its minutes count down from
    // then), when it was last asked for, answered or not (its refreshes are
    // timed from then), and how many minutes it had been counted down by
    // when last drawn
    fetched: {},
    asked: {},
    drawnElapsed: {},
    // Stops being asked for, and the ones on screen (only those are refreshed)
    asking: new Set(),
    onScreen: new Set(),
    lastInteraction: Date.now(),
    paused: false,
    hideEmpty: false,
    // The stop list couldn't be loaded: its message stays, whatever the location does
    loadFailed: false,
};

// ── Rendering ───────────────────────────────────────────────────────────────

function renderStops() {
    // The keyboard was on a message (e.g. after "Use my location"): move it to the first stop
    const hadFocus = $('bus-message').contains(document.activeElement);
    $('bus-message').innerHTML = '';
    accordion.innerHTML = state.stops.map(stopItem).join('');
    $('bus-actions').hidden = false;
    observer.disconnect();
    state.onScreen.clear();
    accordion.querySelectorAll('.stop-item').forEach(item => observer.observe(item));
    patchAll();
    if (hadFocus) /** @type {HTMLElement | null} */ (accordion.querySelector('.stop-toggle'))?.focus();
}

function patchAll() {
    for (const stop of state.stops) {
        const item = accordion.querySelector(`[data-stop="${stop.code}"]`);
        if (item) patchStop(item, stop, shown(stop.code));
        state.drawnElapsed[stop.code] = elapsed(stop.code);
    }
    applyFilter();
    renderStatus();
}

function applyFilter() {
    /** @type {NodeListOf<HTMLElement>} */ (accordion.querySelectorAll('.stop-item')).forEach(item => {
        item.classList.toggle('d-none', state.hideEmpty && item.dataset.hasArrivals !== 'true');
    });
    const btn = $('toggle-empty-btn');
    btn.setAttribute('aria-pressed', String(state.hideEmpty));
    btn.querySelector('.bi').outerHTML = icon(state.hideEmpty ? 'eye' : 'eye-slash', 'me-2');
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
        showMessage('bus-front', t('buses.no-stops'));
        return;
    }
    renderStops();
}

// Whole minutes since a stop's answer came in
const elapsed = code => elapsedMinutes(state.fetched[code], Date.now());

// A stop's answer, counted down to now (between refreshes it can be 2 minutes old)
const shown = code => countDown(state.results[code], elapsed(code));

const itemOf = code => accordion.querySelector(`[data-stop="${code}"]`);

// How long a stop's answer is good for (timing.js)
const refreshEvery = code => refreshFor(shown(code), { opened: Boolean(itemOf(code)?.querySelector('.stop-toggle[aria-expanded="true"]')) });

// Which stops are on screen: only those are refreshed (and asked for at once
// when they scroll into view)
const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
        const code = /** @type {HTMLElement} */ (entry.target).dataset.stop;
        if (entry.isIntersecting) state.onScreen.add(code);
        else state.onScreen.delete(code);
    }
    poll();
});

// Ask for the stops that are due: on screen (or hidden by "Hide empty stops",
// so they come back when a bus is on its way) and past their refresh time
function poll() {
    if (state.paused || document.hidden || !state.stops.length) return;
    for (const stop of state.stops) {
        const { code } = stop;
        const eligible = state.onScreen.has(code) || itemOf(code)?.classList.contains('d-none');
        if (!eligible || state.asking.has(code)) continue;
        if (Date.now() - (state.asked[code] ?? 0) >= refreshEvery(code)) ask(stop);
    }
}

// One request per stop, so each stop shows as soon as its arrivals are in: the
// server asks OASA for stops it hasn't cached one after another (about 2 a
// second), so a single request for all of them waited for the slowest.
async function ask(stop) {
    state.asking.add(stop.code);
    try {
        const res = await fetch(`/api/arrivals?stops=${stop.code}`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        Object.assign(state.results, (await res.json()).stops);
        state.fetched[stop.code] = Date.now();
    } catch {
        // Offline or server trouble: keep the last answer, counting down from
        // when it came and marked as possibly old; with none, live times are
        // unavailable
        const last = state.results[stop.code];
        if (last && !last.unavailable) {
            state.results[stop.code] = { ...last, stale: true };
        } else {
            state.results[stop.code] = { arrivals: [], unavailable: true };
            state.fetched[stop.code] = Date.now();
        }
    }
    state.asked[stop.code] = Date.now();
    state.asking.delete(stop.code);
    const item = itemOf(stop.code);
    if (!item) return; // the stops changed meanwhile
    patchStop(item, stop, shown(stop.code));
    state.drawnElapsed[stop.code] = elapsed(stop.code);
    applyFilter();
    renderStatus();
}

function tick() {
    if (document.hidden || state.paused) return;
    if (Date.now() - state.lastInteraction > IDLE_MS) {
        state.paused = true;
        renderStatus();
        return;
    }
    poll();
    // A minute has passed for a stop: count its arrivals down
    if (state.stops.some(stop => elapsed(stop.code) !== state.drawnElapsed[stop.code])) patchAll();
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

// ── Location ────────────────────────────────────────────────────────────────

// A message in place of the stops, with an optional button ({ label, run }).
// If the keyboard was on the old message's button, it moves to the new message.
function showMessage(icon, title, subtitle = '', action = null) {
    const box = $('bus-message');
    const hadFocus = box.contains(document.activeElement);
    box.innerHTML = message(icon, title, subtitle, action?.label);
    const button = box.querySelector('.message-action');
    button?.addEventListener('click', action.run);
    if (hadFocus) /** @type {HTMLElement} */ (button ?? box.firstElementChild).focus();
}

const retry = { label: t('location.try-again'), run: () => { showMessage('arrow-repeat spin', t('buses.getting-location')); restartLocation(); } };

// The first time, the browser asks for the location after a tap here, where
// it's clear what it's for
function askForLocation() {
    showMessage('geo-alt', t('buses.ask-title'), t('buses.ask-text'), {
        label: t('location.use'),
        run: () => { showMessage('arrow-repeat spin', t('buses.getting-location')); startLocation(); },
    });
}

// A new position: pick the stops near it, unless they were picked from about here
function located({ lat, lng }) {
    state.coords = { lat, lng };
    if (state.loadFailed) return;
    if (!state.allStops) {
        showMessage('arrow-repeat spin', t('buses.finding-stops'));
        return; // picked once the stop list is in
    }
    if (state.pickedAt && distanceMeters(state.pickedAt.lat, state.pickedAt.lng, lat, lng) < MOVE_THRESHOLD_M) return;
    pickStops();
    poll();
}

// Until there are stops to show, say what's wrong with the location
function locationProblem(problem) {
    if (state.stops.length || state.loadFailed) return;
    if (problem === 'denied') showMessage('geo-alt', t('location.denied'), t('location.denied-hint'));
    else if (problem === 'unavailable') showMessage('geo-alt', t('location.unavailable'), '', retry);
    else if (problem === 'slow') showMessage('geo-alt', t('location.slow'), t('location.slow-hint'), retry);
    else showMessage('geo-alt', t('location.unsupported'));
}

// ── Start ───────────────────────────────────────────────────────────────────

// Nothing waits for the location: a recent one (from this page or an earlier
// one) is used at once, and new positions update the stops as they come.
async function start() {
    onLocation(located);
    onLocationProblem(locationProblem);

    const last = lastPosition();
    if (last) state.coords = { lat: last.lat, lng: last.lng };
    showMessage('arrow-repeat spin', t(last ? 'buses.finding-stops' : 'buses.getting-location'));

    // Follow the location if the browser won't need to ask; otherwise ask first
    locationPermission().then(permission => {
        if (permission === 'granted') startLocation();
        else if (permission === 'denied') locationProblem('denied');
        else if (!state.coords) askForLocation();
    });

    try {
        const res = await fetch('/data/bus-stops.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.allStops = decodeStops(await res.json());
    } catch {
        state.loadFailed = true;
        showMessage('wifi-off', t('buses.data-error'));
        return;
    }
    if (state.coords) {
        pickStops();
        poll();
    }

    setInterval(tick, TICK_MS);

    document.addEventListener('pointerdown', interact, { passive: true });
    document.addEventListener('keydown', interact);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        interact();
        tick();
    });
    // An opened stop is refreshed every 30 s: catch up at once if it's older
    accordion.addEventListener('shown.bs.collapse', () => poll());

    $('show-more-btn').addEventListener('click', () => {
        state.limit += PAGE_SIZE;
        pickStops();
        poll();
    });

    $('toggle-empty-btn').addEventListener('click', () => {
        state.hideEmpty = !state.hideEmpty;
        applyFilter();
    });
}

start();
