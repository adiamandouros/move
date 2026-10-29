import { lastPosition, locationPermission, onLocation, onLocationProblem, startLocation } from '/js/core/location.js';
import { setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { remember } from '/js/core/remember.js';
import { decodeStops } from './stops.js';
import { findLines, findStops } from './search.js';
import { backLink, searchResults, searchStatus } from './render.js';
import { $, accordion, clearStops, header, input, interact, lineBar, loadLines, patchAll, patchDistances, poll, readView, RESULTS_SIZE, showMessage, state, tick } from './page.js';
import { askForLocation, locationProblem, nearbyLocated, renderFavourites, showNearby, wireNearby } from './views/nearby.js';
import { showStop } from './views/stop.js';
import { markNearest, showLine } from './views/line.js';

// The bus page: which view the address asks for (views/), the search over
// them, and the location. What the views share is in page.js.

// How often the page checks which stops are due, and counts the minutes down
const TICK_MS = 1_000;

// Show what the address now asks for, and keep it for coming back to the
// page (the nearby stops forget the stop or line)
function setView() {
    state.view = readView();
    remember('buses', location.search);
}

// ── Pinned and docked bars ──────────────────────────────────────────────────

// A line's bar is pinned at the top while its stops scroll, and the buttons
// (more stops, hide the empty ones, more results) are docked at the bottom:
// whatever the keyboard moves to scrolls clear of both (WCAG 2.4.11). A line
// bar taller than a third of the screen (long names at large text sizes)
// isn't pinned, so the stops keep room.
function fitBars() {
    const content = $('app-content');
    const tall = lineBar.offsetHeight > content.clientHeight / 3;
    lineBar.classList.toggle('line-bar-unpinned', tall);
    content.style.setProperty('--pinned-top', `${lineBar.hidden || tall ? 0 : lineBar.offsetHeight}px`);
    const docked = [.../** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.nearby-buses-view .filter-bar'))].find(bar => bar.getClientRects().length);
    content.style.setProperty('--docked-bottom', `${docked?.offsetHeight ?? 0}px`);
}

function watchBars() {
    // Measured on the next frame: the observer would be set off again inside
    // its own callback (WebKit reports that as an error)
    const observer = new ResizeObserver(() => requestAnimationFrame(fitBars));
    for (const el of [$('app-content'), lineBar, $('bus-actions'), $('search-results')]) observer.observe(el);
}

// ── Views ───────────────────────────────────────────────────────────────────

// Draw the view the address asks for. focus: move the keyboard to it (after
// following a link, not when the page opens)
async function showView({ focus = false } = {}) {
    ++state.drawn;
    clearStops();
    renderFavourites();
    setHtml($('bus-message'), '');
    const { view } = state;
    header.hidden = view.kind === 'nearby';
    setHtml(header, view.kind === 'nearby' ? '' : backLink());
    lineBar.hidden = true;
    setHtml(lineBar, '');
    if (state.loadFailed) {
        showMessage('no-connection', t('buses.data-error'));
        return;
    }
    if (!state.allStops) return; // drawn once the stop list is in

    if (view.kind === 'nearby') showNearby({ focus });
    else if (view.kind === 'stop') showStop({ focus });
    else await showLine({ focus });
}

// Follow a link to another view without loading the page again
function go(href) {
    history.pushState(null, '', href);
    setView();
    input.value = '';
    search();
    showView({ focus: true });
}

// Another of a line's directions: the same line, so Back still leaves it
function showDirection(direction) {
    const params = new URLSearchParams(location.search);
    params.set('dir', String(direction));
    history.replaceState(null, '', `${location.pathname}?${params}`);
    setView();
    showView().then(() => /** @type {HTMLElement | null} */ (lineBar.querySelector(`[data-direction="${direction}"]`))?.focus());
}

// ── Search ──────────────────────────────────────────────────────────────────

// What's typed, found in our own data as it's typed; the results cover the view
function search() {
    const query = input.value;
    const active = query.trim() !== '';
    const results = $('search-results');
    results.hidden = !active;
    $('bus-view').hidden = active;
    if (!active || !state.allStops) {
        setHtml(results, '');
        $('search-status').textContent = '';
        if (!active) poll();
        return;
    }
    const lines = state.lines ? findLines(state.lines, query) : [];
    const stops = findStops(state.allStops, query, state.coords, language);
    setHtml(results, searchResults(lines, stops, state.shownResults));
    $('search-status').textContent = searchStatus(query, lines, stops);
}

// ── Location ────────────────────────────────────────────────────────────────

// A new position: the stops nearby are picked again if you've moved; on a
// stop or a line, it says how far they are now
function located({ lat, lng }) {
    state.coords = { lat, lng };
    state.problem = null;
    if (state.loadFailed) return;
    if (!state.allStops) {
        if (state.view.kind === 'nearby') showMessage('loading spin', t('buses.finding-stops'));
        return; // picked once the stop list is in
    }
    if (state.view.kind !== 'nearby') {
        patchDistances();
        markNearest();
        return;
    }
    nearbyLocated({ lat, lng });
}

// ── Start ───────────────────────────────────────────────────────────────────

// Nothing waits for the location: a recent one (from this page or an earlier
// one) is used at once, and new positions update the stops as they come. A
// stop or a line needs none, so the browser isn't asked for one there.
async function start() {
    remember('buses', location.search);
    watchBars();
    onLocation(located);
    onLocationProblem(locationProblem);

    const last = lastPosition();
    if (last) state.coords = { lat: last.lat, lng: last.lng };
    if (state.view.kind === 'nearby') showMessage('loading spin', t(last ? 'buses.finding-stops' : 'buses.getting-location'));
    else showMessage('loading spin', t('buses.finding-stops'));

    // Follow the location if the browser won't need to ask; otherwise ask
    // first, on the nearby stops
    locationPermission().then(permission => {
        state.permission = permission;
        if (permission === 'granted') {
            state.locating = true;
            startLocation();
        } else if (state.view.kind === 'nearby' && !state.stops.length && !state.loadFailed) {
            if (permission === 'denied') locationProblem('denied');
            else if (!state.coords) askForLocation();
        }
    });

    try {
        const res = await fetch('/data/bus-stops.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.allStops = decodeStops(await res.json());
        state.byCode = new Map(state.allStops.map(s => [s.code, s]));
    } catch {
        state.loadFailed = true;
    }
    showView();
    if (state.loadFailed) return;
    poll();

    setInterval(tick, TICK_MS);

    document.addEventListener('pointerdown', interact, { passive: true });
    document.addEventListener('keydown', interact);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        interact();
        tick();
    });
    // An opened stop is refreshed every 30 s: catch up at once if it's older
    // (on a stop or a line, it's asked for when opened, and waits for it)
    accordion.addEventListener('shown.bs.collapse', () => {
        if (state.view.kind !== 'nearby') patchAll();
        poll();
    });
    wireNearby();

    // Links to a stop or a line (results, a stop's lines, the way back) change
    // the view in place; with a modifier key they open as links do
    document.addEventListener('click', e => {
        const link = /** @type {HTMLElement} */ (e.target).closest?.('a[data-view]');
        if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(link.getAttribute('href'));
    });
    window.addEventListener('popstate', () => {
        setView();
        input.value = '';
        search();
        showView({ focus: true });
    });
    lineBar.addEventListener('click', e => {
        const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.('[data-direction]'));
        if (button) showDirection(Number(button.dataset.direction));
    });

    // The lines are loaded when someone starts searching
    input.addEventListener('focus', () => loadLines().then(() => { if (input.value.trim()) search(); }), { once: true });
    input.addEventListener('input', () => {
        state.shownResults = RESULTS_SIZE;
        search();
    });
    $('search-results').addEventListener('click', e => {
        if (!(/** @type {HTMLElement} */ (e.target).closest('.more-results'))) return;
        const before = state.shownResults;
        state.shownResults += RESULTS_SIZE;
        search();
        // The keyboard goes on to the first stop that wasn't shown before
        /** @type {HTMLElement | undefined} */ ($('search-results').querySelectorAll('.search-list:last-of-type a')[before])?.focus();
    });
    // Enter follows the first result
    $('bus-search').addEventListener('submit', e => {
        e.preventDefault();
        const first = $('search-results').querySelector('a[data-view]');
        if (first) go(first.getAttribute('href'));
    });
}

start();
