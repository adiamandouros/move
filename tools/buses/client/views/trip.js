import { distanceMeters } from '/js/core/geo.js';
import { format, html, icon, notice, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { athensNow } from '/tools/subway/network.js';
import { matchStations } from '/tools/subway/search.js';
import { findStops } from '../search.js';
import { message } from '../render.js';
import { betaNote, betaTag, chosenPlace, noTrip, placeName, placeResults, placeStatus, tripHeader, tripHref, tripOption } from '../trip-render.js';
import { findTrips, rankTrips, tripBuses, tripStops, walkMinutes } from '../trips.js';
import { $, elapsed, hooks, loadLines, poll, shown, state } from '../page.js';
import { locate } from './nearby.js';

// The trip finder (?trip): where to (a stop or a metro station) and from
// where (your location, or a stop), then the direct buses between them with
// live times (trips.js). The form shows until both are known, and while the
// start is being changed (&pick=from).

/** @typedef {import('../trip-render.js').Place} Place */

// Results listed under a field as it's typed
const RESULTS = 8;
// Look for options again after walking this far (as the stops nearby)
const MOVE_THRESHOLD_M = 40;

const view = $('trip-view');

// rail.json, for the metro stations: loaded once, when first needed; null if it couldn't be
let railLoad = null;
const loadRail = () => (railLoad ??= fetch('/data/rail.json')
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .catch(() => { railLoad = null; return null; }));
let rail = null;

// Where the options were found from, and for which trip ("to|from|options");
// whether the buses wait for a location to start from
let searchedAt = null;
let searched = '';
let waitingForStart = false;

/** @param {any} station @param {string} id @returns {Place} */
const stationPlace = (station, id) => ({
    key: `station:${id}`, name: station.name, lat: station.coords[0], lng: station.coords[1],
    lines: station.lines.filter(l => rail.lines[l]).map(l => ({ id: l, name: rail.lines[l].name })),
});
/** @param {any} stop @returns {Place} */
const stopPlace = stop => ({ key: stop.code, code: stop.code, name: stop.name, lat: stop.lat, lng: stop.lng });

// A place from the address: a stop's code or "station:<id>"; null if there's none such
async function placeOf(key) {
    if (!key) return null;
    if (key.startsWith('station:')) {
        rail = await loadRail();
        const id = key.slice('station:'.length);
        return rail && Object.hasOwn(rail.stations, id) ? stationPlace(rail.stations[id], id) : null;
    }
    const stop = state.byCode.get(key);
    return stop ? stopPlace(stop) : null;
}

// The location can't be had: turned off, or failed
const locationOff = () => !state.coords && (state.permission === 'denied' || ['denied', 'unavailable', 'unsupported'].includes(state.problem));

// ── The form ────────────────────────────────────────────────────────────────

const field = (kind, label) => html`
    <form class="trip-field trip-search" role="search" data-field="${kind}">
        <label class="trip-label" for="trip-${kind}-input">${label}</label>
        <input id="trip-${kind}-input" type="search" class="form-control" autocomplete="off" spellcheck="false" enterkeyhint="search">
        <p id="trip-${kind}-status" class="search-status" role="status"></p>
        <div id="trip-${kind}-results" class="search-results"></div>
    </form>`;

function drawForm(to, from, { focus }) {
    const { pick } = state.view;
    const pickFrom = pick === 'from' || (!from && locationOff());
    const fromPart = pickFrom
        ? html`${locationOff() ? notice('info', 'nearest', t('buses.trip-location-off'), 'mb-0') : ''}
            ${field('from', t('buses.trip-from-stop'))}
            ${!locationOff() && (from || pick) ? html`<p class="trip-use-location"><a href="${tripHref({ to: to?.key })}" data-view>${icon('nearest', 'me-1')}${t('location.use')}</a></p>` : ''}`
        : chosenPlace(t('buses.trip-from'), from ? placeName(from) : html`${icon('nearest', 'me-1')}${t('buses.trip-your-location')}`, tripHref({ to: to?.key, from: from?.code, pick: 'from' }));
    const toPart = to && pick === 'from'
        ? chosenPlace(t('buses.trip-to'), placeName(to), tripHref({ from: from?.code }))
        : field('to', t('buses.trip-to'));
    setHtml(view, html`<h2 class="trip-title" tabindex="-1">${t('buses.where-to')} ${betaTag()}</h2>${betaNote()}${fromPart}${toPart}`);
    if (focus) /** @type {HTMLElement | null} */ (view.querySelector(pickFrom ? '#trip-from-input' : '#trip-to-input') ?? view.querySelector('.trip-title'))?.focus();
}

// What's typed in a field, found in our own data as it's typed
async function search(kind) {
    const input = /** @type {HTMLInputElement} */ ($(`trip-${kind}-input`));
    const query = input.value;
    const results = $(`trip-${kind}-results`);
    const status = $(`trip-${kind}-status`);
    if (!query.trim()) {
        setHtml(results, '');
        status.textContent = '';
        return;
    }
    const { to, from } = state.view;
    if (kind === 'to' && !rail) rail = await loadRail();
    if (input.value !== query) return; // typed on meanwhile
    const stationIds = kind === 'to' && rail ? matchStations(rail.stations, query).slice(0, RESULTS) : [];
    const stations = stationIds.map(id => stationPlace(rail.stations[id], id));
    const stops = findStops(state.allStops, query, state.coords, language).slice(0, RESULTS);
    const href = kind === 'to' ? key => tripHref({ to: key, from }) : key => tripHref({ to, from: key });
    setHtml(results, html`${kind === 'to' && !rail ? notice('warn', 'warning', t('buses.trip-rail-error')) : ''}${placeResults({ stations, stops, href })}`);
    status.textContent = placeStatus(query, stations.length, stops.length);
}

// ── The buses ───────────────────────────────────────────────────────────────

// Where the trip starts: the stop picked, or where you are
const origin = from => from ? { lat: from.lat, lng: from.lng, picked: true } : state.coords;

async function drawResults(to, from, { focus }) {
    const back = tripHref({ from: from?.code });
    const header = tripHeader(to, from, back);
    const start = origin(from);
    waitingForStart = !start;
    if (!start) {
        // No location yet: wait for it, or the way to pick a stop instead
        const off = locationOff();
        setHtml(view, html`${header}<div class="trip-body">${off
            ? message('nearest', t('buses.trip-locate-title'), t('location.denied-hint'))
            : state.locating ? message('loading spin', t('buses.getting-location'))
                : message('nearest', t('buses.trip-locate-title'), t('buses.trip-locate-text'), t('location.use'))}
            <p class="text-center"><a href="${tripHref({ to: to.key, pick: 'from' })}" data-view>${t('buses.trip-pick-stop')}</a></p></div>`);
        view.querySelector('.message-action')?.addEventListener('click', () => locate());
        if (focus) /** @type {HTMLElement} */ (view.querySelector('.trip-title')).focus();
        return;
    }
    const drawn = state.drawn;
    setHtml(view, html`${header}<div class="trip-body">${message('loading spin', t('buses.loading-lines'))}</div>`);
    if (focus) /** @type {HTMLElement} */ (view.querySelector('.trip-title')).focus();
    const lines = await loadLines();
    if (drawn !== state.drawn) return; // another view since
    if (!lines) {
        setHtml(view.querySelector('.trip-body'), message('no-connection', t('buses.lines-error')));
        return;
    }
    findOptions(to, from, lines);
}

// The options from where the trip starts now; a new search (and its first
// request, counted as such) only when they change
function findOptions(to, from, lines) {
    const start = origin(from);
    searchedAt = { lat: start.lat, lng: start.lng };
    const options = findTrips(state.allStops, lines, start, to);
    const key = `${to.key}|${from?.code ?? ''}|${options.map(o => `${o.line}:${o.board.code}:${o.alight.code}`).join(',')}`;
    if (key !== searched) state.trip = { options, started: false };
    searched = key;
    const body = view.querySelector('.trip-body');
    if (!options.length) {
        setHtml(body, noTrip(to));
        return;
    }
    setHtml(body, html`<div class="trip-options"></div>`);
    drawTrip();
    poll();
}

// Each option's buses, from the answers so far, in the order to show them
function drawTrip() {
    const list = view.querySelector('.trip-options');
    if (!list) return;
    const trips = state.trip.options.map(option => ({
        option,
        buses: tripBuses(option, shown(option.board.code), shown(option.alight.code), walkMinutes(option.board.meters)).slice(0, 2),
    }));
    const nowSeconds = athensNow().seconds;
    setHtml(list, html`${rankTrips(trips).map(({ option, buses }) => tripOption(option, buses, {
        waiting: !state.results[option.board.code],
        unavailable: !!state.results[option.board.code]?.unavailable,
        nowSeconds,
    }))}`);
    for (const code of tripStops(state.trip.options)) state.drawnElapsed[code] = elapsed(code);
}
hooks.drawTrip = drawTrip;

// ── The view ────────────────────────────────────────────────────────────────

export async function showTrip({ focus = false } = {}) {
    state.trip = { options: [], started: false };
    searched = '';
    searchedAt = null;
    waitingForStart = false;
    const drawn = state.drawn;
    const [to, from] = await Promise.all([placeOf(state.view.to), placeOf(state.view.from)]);
    if (drawn !== state.drawn) return; // another view since
    if (state.view.to && !to) {
        setHtml(view, html`<div class="trip-body">${message('bus', format(t('buses.trip-not-found'), { to: state.view.to }))}</div>`);
        return;
    }
    if (!to || state.view.pick === 'from') drawForm(to, from, { focus });
    else await drawResults(to, from, { focus });
}

// A new position: the options again if it's moved far enough (the stops may
// be others). The form only changes if it was asking for a stop because the
// location was off, and the buses only if they were waiting for a location:
// positions come every second or so, and what's being typed must stay.
export function tripLocated() {
    const { to, from, pick } = state.view;
    if (from || pick === 'from') return;
    if (!to) {
        if (view.querySelector('#trip-from-input')) showTrip();
        return;
    }
    if (waitingForStart) {
        showTrip();
        return;
    }
    if (!searchedAt) return; // the lines are loading
    if (searchedAt && distanceMeters(searchedAt.lat, searchedAt.lng, state.coords.lat, state.coords.lng) < MOVE_THRESHOLD_M) return;
    Promise.all([placeOf(to), loadLines()]).then(([place, lines]) => { if (place && lines && state.view.kind === 'trip') findOptions(place, null, lines); });
}

export function wireTrip() {
    view.addEventListener('input', e => {
        const form = /** @type {HTMLElement} */ (e.target).closest('[data-field]');
        if (form) search(/** @type {HTMLElement} */ (form).dataset.field);
    });
    // Enter picks the first result
    view.addEventListener('submit', e => {
        e.preventDefault();
        /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).querySelector('a[data-view]'))?.click();
    });
}
