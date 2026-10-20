import { lastPosition, locationPermission, onLocation, onLocationProblem, restartLocation, startLocation } from '/js/core/location.js';
import { format, html, icon, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { decodeStops, distanceMeters, nearestStops } from './stops.js';
import { findLines, findStops, lineKey } from './search.js';
import { backLink, distance, lineHeader, message, nearestNote, patchStop, searchResults, searchStatus, stopItem } from './render.js';
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
// Stops listed at a time when searching
const RESULTS_SIZE = 20;

const $ = id => document.getElementById(id);
const accordion = $('stops-accordion');
const header = $('view-header');
const input = /** @type {HTMLInputElement} */ ($('bus-search-input'));

// What the page shows, from its address: the stops nearby (/buses), one stop
// (?stop=10341) or a line's stops in order (?line=040, &dir=1 the other way)
function readView() {
    const params = new URLSearchParams(location.search);
    if (params.get('stop')) return { kind: 'stop', code: params.get('stop') };
    if (params.get('line')) return { kind: 'line', line: params.get('line'), direction: params.get('dir') === '1' ? 1 : 0 };
    return { kind: 'nearby' };
}

const state = {
    view: readView(),
    allStops: null,
    byCode: new Map(),
    // bus-lines.json, loaded when first needed (a search or a line)
    lines: null,
    linesLoad: null,
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
    // The location: the browser's permission, whether it's being followed,
    // and what went wrong last (shown when the nearby stops are)
    permission: null,
    locating: false,
    problem: null,
    shownResults: RESULTS_SIZE,
    // Each view drawn gets a number, so a line that loads late is drawn only if it's still wanted
    drawn: 0,
};

// ── Rendering ───────────────────────────────────────────────────────────────

// Draw these stops. open: each shown opened (one stop)
function renderStops(stops, { open = false } = {}) {
    state.stops = stops;
    // The keyboard was on a message (e.g. after "Use my location"): move it to the first stop
    const hadFocus = $('bus-message').contains(document.activeElement);
    setHtml($('bus-message'), '');
    setHtml(accordion, html`${stops.map((stop, i) => stopItem(stop, i, { open }))}`);
    $('bus-actions').hidden = state.view.kind !== 'nearby';
    $('nearby-heading').hidden = state.view.kind !== 'nearby';
    observer.disconnect();
    state.onScreen.clear();
    accordion.querySelectorAll('.stop-item').forEach(item => observer.observe(item));
    patchAll();
    if (hadFocus) /** @type {HTMLElement | null} */ (accordion.querySelector('.stop-toggle'))?.focus();
}

function clearStops() {
    state.stops = [];
    setHtml(accordion, '');
    observer.disconnect();
    state.onScreen.clear();
    $('bus-actions').hidden = true;
    $('nearby-heading').hidden = true;
    renderStatus();
}

// On a stop or a line, a stop that isn't opened isn't asked for: no answer is on its way
const waiting = code => state.view.kind === 'nearby' || isOpen(code);

function patchAll() {
    for (const stop of state.stops) {
        const item = itemOf(stop.code);
        if (item) patchStop(item, stop, shown(stop.code), { waiting: waiting(stop.code) });
        state.drawnElapsed[stop.code] = elapsed(stop.code);
    }
    applyFilter();
    renderStatus();
}

function applyFilter() {
    const hide = state.hideEmpty && state.view.kind === 'nearby';
    /** @type {NodeListOf<HTMLElement>} */ (accordion.querySelectorAll('.stop-item')).forEach(item => {
        item.classList.toggle('d-none', hide && item.dataset.hasArrivals !== 'true');
    });
    const btn = $('toggle-empty-btn');
    btn.setAttribute('aria-pressed', String(state.hideEmpty));
    const swap = document.createElement('span');
    setHtml(swap, icon(state.hideEmpty ? 'eye' : 'eye-slash', 'me-2'));
    btn.querySelector('.bi').replaceWith(swap.firstElementChild);
    btn.querySelector('span').textContent = t(state.hideEmpty ? 'buses.show-all' : 'buses.hide-empty');
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

// A stop with how far it is, when the location is known
const withMeters = stop => state.coords ? { ...stop, meters: distanceMeters(state.coords.lat, state.coords.lng, stop.lat, stop.lng) } : stop;

function pickStops() {
    const { lat, lng } = state.coords;
    state.pickedAt = { lat, lng };
    const stops = nearestStops(state.allStops, lat, lng, {
        limit: state.limit,
        radius: state.limit > PAGE_SIZE ? WIDER_RADIUS_M : RADIUS_M,
    });
    if (!stops.length) {
        clearStops();
        showMessage('bus-front', t('buses.no-stops'));
        return;
    }
    renderStops(stops);
}

// The lines, loaded once; null if they couldn't be
function loadLines() {
    state.linesLoad ??= fetch('/data/bus-lines.json')
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then(data => { state.lines = data.lines; return state.lines; })
        .catch(() => { state.linesLoad = null; return null; });
    return state.linesLoad;
}

// Whole minutes since a stop's answer came in
const elapsed = code => elapsedMinutes(state.fetched[code], Date.now());

// A stop's answer, counted down to now (between refreshes it can be 2 minutes old)
const shown = code => countDown(state.results[code], elapsed(code));

const itemOf = code => accordion.querySelector(`[data-stop="${code}"]`);
const isOpen = code => Boolean(itemOf(code)?.querySelector('.stop-toggle[aria-expanded="true"]'));

// How long a stop's answer is good for (timing.js)
const refreshEvery = code => refreshFor(shown(code), { opened: isOpen(code) });

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

// Which stops may be asked for. Nearby: those on screen (or hidden by "Hide
// empty stops", so they come back when a bus is on its way). A stop or a
// line: only the opened ones, so scrolling down a line asks OASA nothing.
function eligible(code) {
    if (state.view.kind !== 'nearby') return isOpen(code);
    return state.onScreen.has(code) || itemOf(code)?.classList.contains('d-none');
}

// Ask for the stops that are due: those that may be asked for, past their
// refresh time. Nothing while a search covers them.
function poll() {
    if (state.paused || document.hidden || !state.stops.length || $('bus-view').hidden) return;
    for (const stop of state.stops) {
        const { code } = stop;
        if (!eligible(code) || state.asking.has(code)) continue;
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
    patchStop(item, stop, shown(stop.code), { waiting: waiting(stop.code) });
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

// ── Views ───────────────────────────────────────────────────────────────────

// Draw the view the address asks for. focus: move the keyboard to it (after
// following a link, not when the page opens)
async function showView({ focus = false } = {}) {
    const drawn = ++state.drawn;
    clearStops();
    setHtml($('bus-message'), '');
    const { view } = state;
    header.hidden = view.kind === 'nearby';
    setHtml(header, view.kind === 'nearby' ? '' : backLink());
    if (state.loadFailed) {
        showMessage('wifi-off', t('buses.data-error'));
        return;
    }
    if (!state.allStops) return; // drawn once the stop list is in

    if (view.kind === 'nearby') {
        if (state.coords) pickStops();
        else nearbyWithoutPosition();
        if (focus) /** @type {HTMLElement | null} */ (accordion.querySelector('.stop-toggle') ?? $('bus-message').firstElementChild)?.focus();
        return;
    }

    if (view.kind === 'stop') {
        const stop = state.byCode.get(view.code);
        if (!stop) {
            showMessage('bus-front', format(t('buses.stop-not-found'), { code: view.code }));
            return;
        }
        renderStops([withMeters(stop)], { open: true });
        if (focus) /** @type {HTMLElement | null} */ (accordion.querySelector('.stop-toggle'))?.focus();
        poll();
        return;
    }

    showMessage('arrow-repeat spin', t('buses.loading-lines'));
    const lines = await loadLines();
    if (drawn !== state.drawn) return; // another view since
    if (!lines) {
        showMessage('wifi-off', t('buses.lines-error'));
        return;
    }
    // ?line=x95 finds the Χ95 too
    const line = lines.find(l => l.line === view.line) ?? lines.find(l => lineKey(l.line) === lineKey(view.line));
    if (!line) {
        showMessage('bus-front', format(t('buses.line-not-found'), { line: view.line }));
        return;
    }
    const direction = Math.min(view.direction, line.directions.length - 1);
    setHtml(header, lineHeader(line, direction));
    renderStops(line.directions[direction].stops.map(code => state.byCode.get(code)).filter(Boolean).map(withMeters));
    if (focus) /** @type {HTMLElement} */ (header.querySelector('.line-heading')).focus();
    markNearest();
}

// On a line, mark the stop nearest to you, once the location is known, and
// scroll to it unless a stop has been opened meanwhile
function markNearest() {
    if (state.view.kind !== 'line' || !state.coords || !state.stops.length || accordion.querySelector('.stop-nearest')) return;
    const item = itemOf(state.stops.reduce((a, b) => (b.meters < a.meters ? b : a)).code);
    item.classList.add('stop-nearest');
    setHtml(item.querySelector('.stop-nearest-note'), nearestNote());
    if (!accordion.querySelector('.stop-toggle[aria-expanded="true"]')) item.scrollIntoView({ block: 'center' });
}

// Follow a link to another view without loading the page again
function go(href) {
    history.pushState(null, '', href);
    state.view = readView();
    input.value = '';
    search();
    showView({ focus: true });
}

// Another of a line's directions: the same line, so Back still leaves it
function showDirection(direction) {
    const params = new URLSearchParams(location.search);
    params.set('dir', String(direction));
    history.replaceState(null, '', `${location.pathname}?${params}`);
    state.view = readView();
    showView().then(() => /** @type {HTMLElement | null} */ (header.querySelector(`[data-direction="${direction}"]`))?.focus());
}

// On a stop or a line, a new position updates how far the stops are
function patchDistances() {
    state.stops = state.stops.map(withMeters);
    for (const stop of state.stops) {
        const el = itemOf(stop.code)?.querySelector('.stop-distance');
        if (el) setHtml(el, distance(stop.meters));
    }
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

// A message in place of the stops, with an optional button ({ label, run }).
// If the keyboard was on the old message's button, it moves to the new message.
function showMessage(symbol, title, subtitle = '', action = null) {
    const box = $('bus-message');
    const hadFocus = box.contains(document.activeElement);
    setHtml(box, message(symbol, title, subtitle, action?.label));
    const button = box.querySelector('.message-action');
    button?.addEventListener('click', action.run);
    if (hadFocus) /** @type {HTMLElement} */ (button ?? box.firstElementChild).focus();
}

function locate(again = false) {
    state.locating = true;
    state.problem = null;
    showMessage('arrow-repeat spin', t('buses.getting-location'));
    (again ? restartLocation : startLocation)();
}

const retry = { label: t('location.try-again'), run: () => locate(true) };

// The first time, the browser asks for the location after a tap here, where
// it's clear what it's for
function askForLocation() {
    showMessage('geo-alt', t('buses.ask-title'), t('buses.ask-text'), { label: t('location.use'), run: () => locate() });
}

// The stops nearby, before there's a position: why not, or the way to give one
function nearbyWithoutPosition() {
    if (state.problem) locationProblem(state.problem);
    else if (state.locating) showMessage('arrow-repeat spin', t('buses.getting-location'));
    else if (state.permission === 'denied') locationProblem('denied');
    else if (state.permission) askForLocation();
    else showMessage('arrow-repeat spin', t('buses.getting-location'));
}

// A new position: pick the stops near it, unless they were picked from about
// here; on a stop or a line, say how far they are now
function located({ lat, lng }) {
    state.coords = { lat, lng };
    state.problem = null;
    if (state.loadFailed) return;
    if (!state.allStops) {
        if (state.view.kind === 'nearby') showMessage('arrow-repeat spin', t('buses.finding-stops'));
        return; // picked once the stop list is in
    }
    if (state.view.kind !== 'nearby') {
        patchDistances();
        markNearest();
        return;
    }
    if (state.pickedAt && distanceMeters(state.pickedAt.lat, state.pickedAt.lng, lat, lng) < MOVE_THRESHOLD_M) return;
    pickStops();
    poll();
}

// Until there are stops nearby to show, say what's wrong with the location
function locationProblem(problem) {
    state.problem = problem;
    if (state.view.kind !== 'nearby' || state.stops.length || state.loadFailed) return;
    if (problem === 'denied') showMessage('geo-alt', t('location.denied'), t('location.denied-hint'));
    else if (problem === 'unavailable') showMessage('geo-alt', t('location.unavailable'), '', retry);
    else if (problem === 'slow') showMessage('geo-alt', t('location.slow'), t('location.slow-hint'), retry);
    else showMessage('geo-alt', t('location.unsupported'));
}

// ── Start ───────────────────────────────────────────────────────────────────

// Nothing waits for the location: a recent one (from this page or an earlier
// one) is used at once, and new positions update the stops as they come. A
// stop or a line needs none, so the browser isn't asked for one there.
async function start() {
    onLocation(located);
    onLocationProblem(locationProblem);

    const last = lastPosition();
    if (last) state.coords = { lat: last.lat, lng: last.lng };
    if (state.view.kind === 'nearby') showMessage('arrow-repeat spin', t(last ? 'buses.finding-stops' : 'buses.getting-location'));
    else showMessage('arrow-repeat spin', t('buses.finding-stops'));

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

    $('show-more-btn').addEventListener('click', () => {
        state.limit += PAGE_SIZE;
        pickStops();
        poll();
    });

    $('toggle-empty-btn').addEventListener('click', () => {
        state.hideEmpty = !state.hideEmpty;
        applyFilter();
    });

    // Links to a stop or a line (results, a stop's lines, the way back) change
    // the view in place; with a modifier key they open as links do
    document.addEventListener('click', e => {
        const link = /** @type {HTMLElement} */ (e.target).closest?.('a[data-view]');
        if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(link.getAttribute('href'));
    });
    window.addEventListener('popstate', () => {
        state.view = readView();
        input.value = '';
        search();
        showView({ focus: true });
    });
    header.addEventListener('click', e => {
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
