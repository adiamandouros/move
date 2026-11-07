import { restartLocation, startLocation } from '/js/core/location.js';
import { favourites } from '/js/core/favourites.js';
import { distanceMeters } from '/js/core/geo.js';
import { announce, html, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { nearestStops } from '../stops.js';
import { favouriteLine, stopItem } from '../render.js';
import { $, accordion, applyFilter, clearStops, input, loadLines, observe, PAGE_SIZE, patchAll, patchDistances, poll, renderStops, showMessage, state, withMeters } from '../page.js';

// The stops nearby (/buses): the starred stops and lines, then the stops
// closest to you, picked again as you walk; or why there's no location yet.

// Re-pick the nearby stops after walking this far
const MOVE_THRESHOLD_M = 40;
const RADIUS_M = 500;
const WIDER_RADIUS_M = 1500;

function pickStops() {
    const { lat, lng } = state.coords;
    state.pickedAt = { lat, lng };
    const stops = nearestStops(state.allStops, lat, lng, {
        limit: state.limit,
        radius: state.limit > PAGE_SIZE ? WIDER_RADIUS_M : RADIUS_M,
    });
    if (!stops.length) {
        clearStops();
        showMessage('bus', t('buses.no-stops'));
        return;
    }
    renderStops(stops);
}

export function showNearby({ focus = false } = {}) {
    if (state.coords) pickStops();
    else nearbyWithoutPosition();
    if (focus) /** @type {HTMLElement | null} */ (accordion.querySelector('.stop-toggle') ?? $('bus-message').firstElementChild)?.focus();
}

// The starred stops and lines, above the stops nearby (only there, and once
// the stop list is in). A starred stop shows its live times as the stops
// nearby do: asked for while it's on screen. A starred line links to its
// stops in the direction it was starred, once the lines are in.
export async function renderFavourites() {
    const shown = state.view.kind === 'nearby' && state.allStops ? favourites() : { stop: [], line: [] };
    state.favouriteStops = shown.stop.map(code => state.byCode.get(code)).filter(Boolean).map(withMeters);
    // The ones opened stay open
    const opened = new Set([...$('favourite-stops').querySelectorAll('.stop-toggle[aria-expanded="true"]')].map(toggle => toggle.closest('.stop-item').getAttribute('data-stop')));
    setHtml($('favourite-stops'), html`${state.favouriteStops.map((stop, i) => stopItem(stop, i, { id: 'fav-stop', open: opened.has(stop.code) }))}`);
    setHtml($('favourite-lines'), '');
    $('favourites').hidden = !state.favouriteStops.length && !shown.line.length;
    observe();
    patchAll();
    if (!shown.line.length) return;
    const drawn = state.drawn;
    const lines = await loadLines();
    if (drawn !== state.drawn) return; // another view since
    const rows = shown.line.flatMap(key => {
        const dir = Number(key.slice(key.lastIndexOf('/') + 1));
        const line = lines?.find(l => l.line === key.slice(0, key.lastIndexOf('/')));
        return line?.directions[dir] ? [favouriteLine(line, dir)] : [];
    });
    setHtml($('favourite-lines'), html`${rows}`);
    $('favourites').hidden = !state.favouriteStops.length && !rows.length;
}

// ── Location ────────────────────────────────────────────────────────────────

function locate(again = false) {
    state.locating = true;
    state.problem = null;
    showMessage('loading spin', t('buses.getting-location'));
    (again ? restartLocation : startLocation)();
}

const retry = { label: t('location.try-again'), run: () => locate(true) };

// The first time, the browser asks for the location after a tap here, where
// it's clear what it's for
export function askForLocation() {
    showMessage('nearest', t('buses.ask-title'), t('buses.ask-text'), { label: t('location.use'), run: () => locate() });
}

// The stops nearby, before there's a position: why not, or the way to give one
function nearbyWithoutPosition() {
    if (state.problem) locationProblem(state.problem);
    else if (state.locating) showMessage('loading spin', t('buses.getting-location'));
    else if (state.permission === 'denied') locationProblem('denied');
    else if (state.permission) askForLocation();
    else showMessage('loading spin', t('buses.getting-location'));
}

// A new position: pick the stops near it, unless they were picked from about here
export function nearbyLocated({ lat, lng }) {
    patchDistances();
    if (state.pickedAt && distanceMeters(state.pickedAt.lat, state.pickedAt.lng, lat, lng) < MOVE_THRESHOLD_M) return;
    pickStops();
    poll();
}

// Until there are stops nearby to show, say what's wrong with the location
export function locationProblem(problem) {
    state.problem = problem;
    if (state.view.kind !== 'nearby' || state.stops.length || state.loadFailed) return;
    if (problem === 'denied') showMessage('nearest', t('location.denied'), t('location.denied-hint'));
    else if (problem === 'unavailable') showMessage('nearest', t('location.unavailable'), '', retry);
    else if (problem === 'slow') showMessage('nearest', t('location.slow'), t('location.slow-hint'), retry);
    else showMessage('nearest', t('location.unsupported'));
}

// ── Controls ────────────────────────────────────────────────────────────────

export function wireNearby() {
    $('favourite-stops').addEventListener('shown.bs.collapse', () => poll());

    // Starred or unstarred anywhere on the page: the favourites are drawn
    // again, so a stop unstarred leaves them at once. Unstarred in the
    // favourites, the keyboard moves to the closest thing left: the next
    // stop, else the one before, else a starred line, else the stops nearby.
    document.addEventListener('favourites-change', async e => {
        if (state.view.kind !== 'nearby') return;
        const { source } = /** @type {CustomEvent} */ (e).detail;
        const row = $('favourites').contains(source) ? source.closest('.stop-item') : null;
        const index = row ? [...$('favourite-stops').children].indexOf(row) : -1;
        const name = row?.querySelector('.stop-name').textContent;
        await renderFavourites();
        if (!row) return;
        const stops = $('favourite-stops').querySelectorAll('.stop-toggle');
        const nearby = $('nearby-heading');
        nearby.tabIndex = -1;
        /** @type {HTMLElement} */ (stops[index] ?? stops[index - 1] ?? $('favourite-lines').querySelector('a') ?? (nearby.hidden ? input : nearby)).focus();
        announce(`${name}: ${t('favourites.removed')}`);
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
}
