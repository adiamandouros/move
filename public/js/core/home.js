import { favourites } from './favourites.js';
import { closableNotice, externalLink, format, formatDate, html, icon, localName, setHtml, walkingUrl } from './html.js';
import { language, localHref, t } from './i18n.js';
import { linePill, stationSign } from './lines.js';
import { lastPosition, locationPermission, onLocation, onLocationProblem, restartLocation, startLocation } from './location.js';
import { lineEnd } from './metro.js';
import { nearestBusStop, nearestStation, stationTrains, starredStations } from './near.js';
import { countBadges, keyedMinutes, markChanges } from './times.js';
import { distanceMeters } from './geo.js';
import { athensClock, isTimetableExpired, withTram } from '/tools/subway/network.js';
import { departureChip } from '/tools/subway/render.js';
import { decodeStops } from '/tools/buses/stops.js';
import { arrivalRows, distance } from '/tools/buses/render.js';
import { countDown, elapsedMinutes, isIdle, refreshEvery } from '/tools/buses/timing.js';

// Home (decision 81): the starred stations, each a trip to it, and "Near
// you": the next trains at the station nearest the rider, from the
// timetable, and the next buses at the bus stop nearest them, from OASA.
// Nothing asks for the location here unless the button is pressed: a
// position kept from another page shows at once, and the location is
// followed if the browser already allows it. The bus stop is asked for on
// the Buses page's tiers (timing.js refreshEvery), only while Home is in
// sight and was touched in the past 10 minutes, its requests said
// &for=home. What's worked out is in near.js.

/** @typedef {import('/tools/subway/network.js').Rail} Rail */
/** @typedef {import('/tools/buses/timing.js').StopResult} StopResult */
/** @typedef {{ lat: number, lng: number }} Spot */

// Picked again after walking this far, as on the Buses page
const MOVE_M = 40;
// The nearest stop's lines and where they go, at most
const BUS_ROWS = 4;
const TICK_MS = 1_000;
// The trains drawn again this often, so a train gone gives way to the next
const TRAINS_MS = 30_000;
const HOUR = 3600;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const stars = $('home-stars');
const near = $('near-you');

/** @param {string} url */
async function loadJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

const state = {
    /** @type {import('../../../types/data.js').Rail | null} */
    metro: null,
    /** @type {Rail | null} */
    rail: null,
    /** @type {import('/tools/buses/stops.js').BusStop[] | null} */
    stops: null,
    stopsFailed: false,
    /** @type {Spot | null} where "Near you" was picked from */
    picked: null,
    /** @type {{ id: string, meters: number } | null} */
    station: null,
    /** @type {(import('/tools/buses/stops.js').BusStop & { meters: number }) | null} */
    stop: null,
    /** @type {StopResult | undefined} */
    result: undefined,
    fetched: 0,
    asked: 0,
    asking: false,
    lastTouch: Date.now(),
    trainsAt: 0,
    /** @type {import('./location.js').Problem | null} */
    problem: null,
    locating: false,
};

// ── The starred stations ────────────────────────────────────────────────────

// Each a link to the Trip page with it as To (/trip?to=, link.js there);
// a suburban station's once trains.json is in
/** @param {import('../../../types/data.js').Trains | null} trains */
function drawStars(trains) {
    if (!state.metro) return;
    const shown = starredStations(state.metro, trains, favourites().station, language);
    setHtml(stars, html`${shown.map(({ key, name }) => html`<li><a class="star-chip" href="${localHref('/trip')}?to=${encodeURIComponent(key)}">${icon('favourite', '', { filled: true })}<span class="sr-only">${t('near.trip-to')} </span>${name}</a></li>`)}`);
    stars.hidden = !shown.length;
    return shown.length < favourites().station.length;
}

// ── Near you ────────────────────────────────────────────────────────────────

// A message in place of the cards, with a button where one helps
/** @param {string} text @param {{ hint?: string, action?: { label: string, run: () => void }, busy?: boolean }} [options] */
function message(text, { hint = '', action, busy = false } = {}) {
    setHtml(near, html`<div class="near-message">
        <p class="mb-1">${busy && icon('loading', 'spin me-2')}${text}</p>
        ${hint && html`<p class="small text-body-secondary mb-0">${hint}</p>`}
        ${action && html`<button type="button" class="btn btn-primary btn-sm rounded-pill px-4 mt-2 near-action">${icon('nearest', 'me-1')}${action.label}</button>`}
    </div>`);
    if (action) near.querySelector('.near-action')?.addEventListener('click', action.run);
}

function locate(again = false) {
    state.locating = true;
    state.problem = null;
    message(t('buses.getting-location'), { busy: true });
    (again ? restartLocation : startLocation)();
}

// Before there's a position: why not, or the way to give one
/** @param {PermissionState} permission */
function withoutPosition(permission) {
    const retry = { label: t('location.try-again'), run: () => locate(true) };
    if (state.problem === 'denied' || (!state.locating && permission === 'denied')) message(t('location.denied'), { hint: t('location.denied-hint') });
    else if (state.problem === 'unavailable') message(t('location.unavailable'), { action: retry });
    else if (state.problem === 'slow') message(t('location.slow'), { hint: t('location.slow-hint'), action: retry });
    else if (state.problem === 'unsupported') message(t('location.unsupported'));
    else if (state.locating) message(t('buses.getting-location'), { busy: true });
    else message(t('near.near-ask'), { action: { label: t('location.use'), run: () => locate() } });
}

// The walking figure at a row's right, to a place
/** @param {number} lat @param {number} lng @param {string} name */
const walkTo = (lat, lng, name) => externalLink({ class: 'directions-btn d-flex align-items-center justify-content-center', href: walkingUrl(lat, lng) },
    html`${icon('walk')}<span class="sr-only">${t('buses.walking-directions-to')} ${name}</span>`, t('shell.new-tab'));

// The station's card: its sign, how far, and each line's next two trains
// one way, toward the station that way ends at; the old timetable's
// warning as one closed line, as on the Subway page
function stationCard() {
    const { rail, station } = state;
    if (!rail || !station) return '';
    const { name, lines, coords } = rail.stations[station.id];
    const now = athensClock();
    const rows = stationTrains(rail, station.id, now);
    const local = localName(name, language);
    const expired = isTimetableExpired(rail, now) && closableNotice('warn', 'warning', format(t('subway.timetable-old'), { date: formatDate(rail.feed.validTo) }),
        t('subway.timetable-old-more'), 'timetable-notice mb-2', false);
    return html`<section class="card near-card" aria-labelledby="near-station">
        <div class="near-head">
            <h3 class="near-title" id="near-station">${stationSign(local, lines)}<span class="near-away">${distance(station.meters)}</span></h3>
            ${walkTo(coords[0], coords[1], local)}
        </div>
        ${expired}
        ${rows.length ? html`<ul class="near-rows list-unstyled mb-0" aria-label="${format(t('near.trains-from'), { station: local })}">${rows.map(({ line, dir, departures }) => {
            const clock = departures[0].departs - now.seconds > HOUR;
            return html`<li class="near-row">
                ${linePill(line, rail.lines[line].name, 'l')}
                <span class="near-to"><span class="sr-only">, ${t('near.toward')} </span>${localName(rail.stations[lineEnd(rail, line, dir)].name, language)}<span class="sr-only">, </span></span>
                <span class="near-times" data-badges>${departures.map(d => departureChip(d, now, clock))}</span>
            </li>`;
        })}</ul>` : html`<p class="text-body-secondary small mb-0">${t('near.no-trains')}</p>`}
    </section>`;
}

// The bus stop's card: its name, how far, and its lines' next buses, as
// an opened stop on the Buses page draws them (decision 79); then the way
// to every stop near you, and its code
function stopCard() {
    const { stop } = state;
    if (state.stopsFailed) return html`<p class="text-body-secondary small">${t('near.no-stops')}</p>`;
    if (!stop) return '';
    const local = localName(stop.name, language);
    const shown = countDown(state.result, elapsedMinutes(state.fetched || undefined, Date.now()));
    const waiting = html`<li class="text-body-secondary small">${icon('loading', 'spin me-2')}${t('near.loading-buses')}</li>`;
    return html`<section class="card near-card" aria-labelledby="near-stop">
        <div class="near-head">
            <h3 class="near-title" id="near-stop"><a class="near-stop-link" href="${localHref('/buses')}?stop=${stop.code}">${local}<span class="sr-only">, ${t('buses.code')} ${stop.code}</span></a><span class="near-away">${distance(stop.meters)}</span></h3>
            ${walkTo(stop.lat, stop.lng, local)}
        </div>
        <ul class="stop-arrivals list-unstyled mb-0" aria-label="${t('buses.all-arrivals-for')} ${local}">${shown ? arrivalRows(shown, BUS_ROWS) : waiting}</ul>
        <div class="near-foot">
            <a href="${localHref('/buses')}">${t('near.all-stops')}</a>
            <span class="stop-code" aria-hidden="true">${format(t('buses.stop-code'), { code: stop.code })}</span>
        </div>
    </section>`;
}

// Drawn again, the timetable's line stays as it was left, open or closed,
// and the bus times that changed are marked (decision 82): `fresh`, by
// OASA's new answer (a ring), else counted down (a roll)
function drawNear(fresh = false) {
    if (!state.station && !state.stop) return;
    const open = /** @type {HTMLDetailsElement | null} */ (near.querySelector('.timetable-notice'))?.open ?? false;
    const before = keyedMinutes(near);
    setHtml(near, html`${stationCard()}${stopCard()}`);
    markChanges(near, before, fresh);
    if (open) near.querySelector('.timetable-notice')?.setAttribute('open', '');
    state.trainsAt = Date.now();
}

// A position: "Near you" picked again from it, unless picked from about here
/** @param {Spot} spot */
function located({ lat, lng }) {
    state.problem = null;
    state.locating = false;
    if (state.picked && distanceMeters(state.picked.lat, state.picked.lng, lat, lng) < MOVE_M) return;
    if (!state.rail) return;
    state.picked = { lat, lng };
    state.station = nearestStation(state.rail, lat, lng);
    const stop = state.stops ? nearestBusStop(state.stops, lat, lng) : null;
    if (stop?.code !== state.stop?.code) Object.assign(state, { result: undefined, fetched: 0, asked: 0 });
    state.stop = stop;
    drawNear();
    ask();
    if (!state.stops && !state.stopsFailed) loadStops();
}

async function loadStops() {
    try {
        state.stops = decodeStops(await loadJson('/data/bus-stops.json'));
    } catch {
        state.stopsFailed = true;
    }
    const at = state.picked;
    state.picked = null;
    if (at) located(at);
}

// ── The bus stop's live times ───────────────────────────────────────────────

// Asked when its answer is due (the Buses page's tiers), only while Home
// is in sight and was touched in the past 10 minutes
async function ask() {
    const { stop } = state;
    const now = Date.now();
    if (!stop || state.asking || document.hidden || isIdle(state.lastTouch, now)) return;
    const shown = countDown(state.result, elapsedMinutes(state.fetched || undefined, now));
    if (state.asked && now - state.asked < refreshEvery(shown)) return;
    state.asking = true;
    state.asked = now;
    try {
        const response = await fetch(`/api/arrivals?stops=${stop.code}&for=home`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { stops } = await response.json();
        if (state.stop?.code === stop.code) Object.assign(state, { result: stops[stop.code], fetched: Date.now() });
    } catch {
        if (state.stop?.code === stop.code && !state.result) state.result = { unavailable: true };
    } finally {
        state.asking = false;
    }
    if (state.stop?.code === stop.code) drawNear(true);
}

// ── Starting ────────────────────────────────────────────────────────────────

async function start() {
    try {
        state.metro = await loadJson('/data/rail.json');
    } catch {
        message(t('near.no-data'));
        return;
    }
    const metro = /** @type {import('../../../types/data.js').Rail} */ (state.metro);
    state.rail = withTram(metro);
    // A suburban star waits for trains.json
    if (drawStars(null)) loadJson('/data/trains.json').then(drawStars, () => {});

    onLocation(located);
    onLocationProblem(problem => {
        state.problem = problem;
        state.locating = false;
        if (!state.picked) withoutPosition('prompt');
    });
    const last = lastPosition();
    if (last) located(last);
    const permission = await locationPermission();
    if (permission === 'granted') {
        state.locating = !last;
        startLocation();
    }
    if (!last) withoutPosition(permission);
}

const touch = () => {
    const wasIdle = isIdle(state.lastTouch, Date.now());
    state.lastTouch = Date.now();
    if (wasIdle) ask();
};
document.addEventListener('pointerdown', touch, { passive: true });
document.addEventListener('keydown', touch);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    touch();
    drawNear();
    ask();
});
// Each second: the trains' badges count down, and the stop asked when due;
// the cards drawn again for a train gone, or a bus's minute passed
let drawnMinute = 0;
setInterval(() => {
    const now = Date.now();
    const minute = elapsedMinutes(state.fetched || undefined, now);
    const gone = countBadges(near, t);
    if (gone || now - state.trainsAt >= TRAINS_MS || minute !== drawnMinute) {
        drawnMinute = minute;
        if (!near.contains(document.activeElement) || document.activeElement === document.body) drawNear();
    }
    ask();
}, TICK_MS);

start();
