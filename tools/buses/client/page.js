import { distanceMeters } from '/js/core/geo.js';
import { html, icon, notice, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { distance, message, patchStop, stopItem } from './render.js';
import { countDown, dueStops, elapsedMinutes, isIdle } from './timing.js';

// What every view of the bus page shares (views/): the page's state, the
// stop list drawn in it and the polling that keeps its live times up to date.
// main.js picks the view and wires the page up.

export const PAGE_SIZE = 6;
// Stops listed at a time when searching
export const RESULTS_SIZE = 20;

/** @typedef {import('./stops.js').BusStop} BusStop */
/** @typedef {import('./search.js').BusLine} BusLine */
/** @typedef {import('./stops.js').ShownStop} ShownStop */
/** @typedef {import('./timing.js').StopResult & { stale?: boolean }} Result */
/** @typedef {'denied' | 'unavailable' | 'slow' | 'unsupported'} Problem */
/**
 * What the page shows (readView)
 * @typedef {{ kind: 'nearby' } | { kind: 'stop', code: string } | { kind: 'line', line: string, direction: 0 | 1 }} View
 */

// One of the page's own elements, always in its template
export const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
export const accordion = $('stops-accordion');
const busView = $('bus-view');
export const header = $('view-header');
export const lineBar = $('line-bar');
export const input = /** @type {HTMLInputElement} */ ($('bus-search-input'));

// What the page shows, from its address: the stops nearby (/buses), one stop
// (?stop=10341) or a line's stops in order (?line=040, &dir=1 the other way).
// A link to the trip finder (?trip, gone with decision 39) shows the stops nearby
/** @returns {View} */
export function readView() {
    const params = new URLSearchParams(location.search);
    const stop = params.get('stop');
    if (stop) return { kind: 'stop', code: stop };
    const line = params.get('line');
    if (line) return { kind: 'line', line, direction: params.get('dir') === '1' ? 1 : 0 };
    return { kind: 'nearby' };
}

export const state = {
    view: readView(),
    allStops: /** @type {BusStop[] | null} */ (null),
    /** @type {Map<string, BusStop>} */
    byCode: new Map(),
    // bus-lines.json, loaded when first needed (a search or a line)
    lines: /** @type {BusLine[] | null} */ (null),
    linesLoad: /** @type {Promise<BusLine[] | null> | null} */ (null),
    coords: /** @type {{ lat: number, lng: number } | null} */ (null),
    pickedAt: /** @type {{ lat: number, lng: number } | null} */ (null),
    limit: PAGE_SIZE,
    stops: /** @type {ShownStop[]} */ ([]),
    // The starred stops, above the stops nearby (only there)
    favouriteStops: /** @type {ShownStop[]} */ ([]),
    results: /** @type {Record<string, Result>} */ ({}),
    // Per stop code: when its last answer came in (its minutes count down from
    // then), when it was last asked for, answered or not (its refreshes are
    // timed from then), and how many minutes it had been counted down by
    // when last drawn
    fetched: /** @type {Record<string, number>} */ ({}),
    asked: /** @type {Record<string, number>} */ ({}),
    drawnElapsed: /** @type {Record<string, number>} */ ({}),
    // Stops being asked for (codes), and the stop rows on screen (only their
    // stops are refreshed)
    asking: /** @type {Set<string>} */ (new Set()),
    /** @type {Set<Element>} */
    onScreen: new Set(),
    lastInteraction: Date.now(),
    paused: false,
    hideEmpty: false,
    // The stop list couldn't be loaded: its message stays, whatever the location does
    loadFailed: false,
    // The location: the browser's permission, whether it's being followed,
    // and what went wrong last (shown when the nearby stops are)
    permission: /** @type {PermissionState | null} */ (null),
    locating: false,
    problem: /** @type {Problem | null} */ (null),
    shownResults: RESULTS_SIZE,
    // Each view drawn gets a number, so a line that loads late is drawn only if it's still wanted
    drawn: 0,
};

// ── Rendering ───────────────────────────────────────────────────────────────

// Draw these stops. open: each shown opened (one stop)
/** @param {ShownStop[]} stops @param {{ open?: boolean }} [options] */
export function renderStops(stops, { open = false } = {}) {
    state.stops = stops;
    // The keyboard was on a message (e.g. after "Use my location"): move it to the first stop
    const hadFocus = $('bus-message').contains(document.activeElement);
    setHtml($('bus-message'), '');
    setHtml(accordion, html`${stops.map((stop, i) => stopItem(stop, i, { open }))}`);
    $('bus-actions').hidden = state.view.kind !== 'nearby';
    $('nearby-heading').hidden = state.view.kind !== 'nearby';
    observe();
    patchAll();
    if (hadFocus) /** @type {HTMLElement | null} */ (accordion.querySelector('.stop-toggle'))?.focus();
}

export function clearStops() {
    state.stops = [];
    setHtml(accordion, '');
    observe();
    $('bus-actions').hidden = true;
    $('nearby-heading').hidden = true;
    renderStatus();
}

// On a stop or a line, a stop that isn't opened isn't asked for: no answer is on its way
const waiting = (/** @type {string} */ code) => state.view.kind === 'nearby' || isOpen(code);

export function patchAll() {
    for (const stop of listed()) {
        for (const item of itemsOf(stop.code)) patchStop(item, shown(stop.code), { waiting: waiting(stop.code) });
        state.drawnElapsed[stop.code] = elapsed(stop.code);
    }
    applyFilter();
    renderStatus();
}

export function applyFilter() {
    const hide = state.hideEmpty && state.view.kind === 'nearby';
    /** @type {NodeListOf<HTMLElement>} */ (accordion.querySelectorAll('.stop-item')).forEach(item => {
        item.classList.toggle('d-none', hide && item.dataset.hasArrivals !== 'true');
    });
    const btn = $('toggle-empty-btn');
    btn.setAttribute('aria-pressed', String(state.hideEmpty));
    const swap = document.createElement('span');
    setHtml(swap, icon(state.hideEmpty ? 'show-empty' : 'hide-empty', 'me-2'));
    /** @type {Element} */ (btn.querySelector('.icon')).replaceWith(/** @type {Element} */ (swap.firstElementChild));
    /** @type {Element} */ (btn.querySelector('span')).textContent = t(state.hideEmpty ? 'buses.show-all' : 'buses.hide-empty');
}

// The stops whose answers are on screen
const shownCodes = () => listed().map(s => s.code);

function renderStatus() {
    const el = $('bus-status');
    const results = shownCodes().map(code => state.results[code]).filter(Boolean);
    /** @type {import('/js/core/html.js').Html | ''} */
    let shown = '';
    if (state.paused) {
        shown = notice('warn', 'warning', html`${t('buses.paused')} <button type="button" class="btn btn-link btn-sm p-0 align-baseline">${t('buses.resume')}</button>`);
    } else if (results.length && results.every(r => r.unavailable)) {
        shown = notice('danger', 'error', t('buses.unavailable'));
    } else if (results.some(r => r.stale)) {
        shown = notice('warn', 'warning', t('buses.stale'));
    }
    setHtml(el, shown);
    el.querySelector('button')?.addEventListener('click', () => interact());
    el.hidden = !shown;
}

// A message in place of the stops, with an optional button ({ label, run }).
// If the keyboard was on the old message's button, it moves to the new message.
/**
 * @param {string} symbol @param {string} title @param {string} [subtitle]
 * @param {{ label: string, run: () => void } | null} [action]
 */
export function showMessage(symbol, title, subtitle = '', action = null) {
    const box = $('bus-message');
    const hadFocus = box.contains(document.activeElement);
    setHtml(box, message(symbol, title, subtitle, action?.label));
    const button = box.querySelector('.message-action');
    if (action) button?.addEventListener('click', action.run);
    if (hadFocus) /** @type {HTMLElement} */ (button ?? box.firstElementChild).focus();
}

// ── Data ────────────────────────────────────────────────────────────────────

// A stop with how far it is, when the location is known
/** @param {ShownStop} stop @returns {ShownStop} */
export const withMeters = stop => state.coords ? { ...stop, meters: distanceMeters(state.coords.lat, state.coords.lng, stop.lat, stop.lng) } : stop;

// The lines, loaded once; null if they couldn't be
export function loadLines() {
    state.linesLoad ??= fetch('/data/bus-lines.json')
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then(data => { state.lines = data.lines; return state.lines; })
        .catch(() => { state.linesLoad = null; return null; });
    return state.linesLoad;
}

// Whole minutes since a stop's answer came in
export const elapsed = (/** @type {string} */ code) => elapsedMinutes(state.fetched[code], Date.now());

// A stop's answer, counted down to now (between refreshes it can be 2 minutes old)
export const shown = (/** @type {string} */ code) => countDown(state.results[code], elapsed(code));

// Every stop shown, the starred ones first, once each (a starred stop can be nearby too)
const listed = () => [...new Map([...state.favouriteStops, ...state.stops].map(stop => [stop.code, stop])).values()];

// A stop's rows: one, or two when it's starred and nearby
const itemsOf = (/** @type {string} */ code) => [.../** @type {NodeListOf<HTMLElement>} */ (busView.querySelectorAll(`.stop-item[data-stop="${code}"]`))];
const isOpen = (/** @type {string} */ code) => itemsOf(code).some(item => item.querySelector('.stop-toggle[aria-expanded="true"]'));

// Which stops are on screen: only those are refreshed (and asked for at once
// when they scroll into view)
const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
        if (entry.isIntersecting) state.onScreen.add(entry.target);
        else state.onScreen.delete(entry.target);
    }
    poll();
});

// Watch every stop row drawn, the starred ones and the others
export function observe() {
    observer.disconnect();
    state.onScreen.clear();
    busView.querySelectorAll('.stop-item').forEach(item => observer.observe(item));
}

// A stop on screen, or hidden by "Hide empty stops"
const watched = (/** @type {string} */ code) => itemsOf(code).some(item => state.onScreen.has(item) || item.classList.contains('d-none'));

// Ask for the stops that are due (dueStops in timing.js). Nothing while
// paused, out of sight, or while a search covers them.
export function poll() {
    const codes = listed().map(stop => stop.code);
    if (state.paused || document.hidden || !codes.length || busView.hidden) return;
    const { asking, asked, fetched, results } = state;
    const due = dueStops({
        codes,
        view: state.view.kind,
        opened: new Set(codes.filter(isOpen)),
        watched: new Set(codes.filter(watched)),
        asking, asked, fetched, results,
    }, Date.now());
    for (const code of due) ask(code);
}

// One request per stop, so each stop shows as soon as its arrivals are in: the
// server asks OASA for stops it hasn't cached one after another (about 2 a
// second), so a single request for all of them waited for the slowest.
/** @param {string} code */
async function ask(code) {
    state.asking.add(code);
    try {
        const res = await fetch(`/api/arrivals?stops=${code}`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        Object.assign(state.results, (await res.json()).stops);
        state.fetched[code] = Date.now();
    } catch {
        // Offline or server trouble: keep the last answer, counting down from
        // when it came and marked as possibly old; with none, live times are
        // unavailable
        const last = state.results[code];
        if (last && !last.unavailable) {
            state.results[code] = { ...last, stale: true };
        } else {
            state.results[code] = { arrivals: [], unavailable: true };
            state.fetched[code] = Date.now();
        }
    }
    state.asked[code] = Date.now();
    state.asking.delete(code);
    const items = itemsOf(code);
    if (!items.length) return; // the stops changed meanwhile
    for (const item of items) patchStop(item, shown(code), { waiting: waiting(code) });
    state.drawnElapsed[code] = elapsed(code);
    applyFilter();
    renderStatus();
}

export function tick() {
    if (document.hidden || state.paused) return;
    if (isIdle(state.lastInteraction, Date.now())) {
        state.paused = true;
        renderStatus();
        return;
    }
    poll();
    // A minute has passed for a stop: count its arrivals down
    if (listed().some(stop => elapsed(stop.code) !== state.drawnElapsed[stop.code])) patchAll();
}

// Any tap or key press counts as someone looking at the page
export function interact() {
    state.lastInteraction = Date.now();
    if (state.paused) {
        state.paused = false;
        renderStatus();
        poll();
    }
}

// A new position updates how far the stops are (a stop's or a line's, and the
// starred ones). Only the ones that changed are redrawn: the phone sends
// positions often, and Safari moves the list when the element it keeps steady
// on screen is replaced, even with the same text
export function patchDistances() {
    state.stops = state.stops.map(withMeters);
    state.favouriteStops = state.favouriteStops.map(withMeters);
    for (const stop of listed()) {
        const view = distance(stop.meters);
        for (const item of itemsOf(stop.code)) {
            const el = item.querySelector('.stop-distance');
            if (el && el.innerHTML !== String(view)) setHtml(el, view);
        }
    }
}
