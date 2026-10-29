import { format, formatHtml, html, icon, localName } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { busPlate, linePill, pillList } from '/js/core/lines.js';
import { arrivalBadge, distance } from './render.js';
import { walkMinutes } from './trips.js';

// What the trip finder draws (views/trip.js), with html`` (stop names and
// destinations come from OASA). No DOM access, so it's tested in Node
// (bus-trip-render.test.js).

/** @typedef {import('./trips.js').TripOption} TripOption */
/** @typedef {import('./trips.js').TripBus} TripBus */
/**
 * Where a trip goes to or starts from: a stop (key: its code) or a metro
 * station (key: "station:<id>", with its lines' pills)
 * @typedef {{ key: string, name: import('../../../types/data.js').Names, lat: number, lng: number,
 *   code?: string, lines?: { id: string, name: string }[] }} Place
 */

const local = pair => localName(pair, language);

// Closer than this, the stop is where you are: no walk to speak of
const HERE_M = 50;

// The address of the trip finder: ?trip, and where to, where from, or which of them is being picked
/** @param {{ to?: string | null, from?: string | null, pick?: string | null }} params */
export function tripHref({ to = null, from = null, pick = null } = {}) {
    const params = new URLSearchParams({ trip: '' });
    if (to) params.set('to', to);
    if (from) params.set('from', from);
    if (pick) params.set('pick', pick);
    return `${localHref('/buses')}?${params}`;
}

// A place's name with its code (a stop: what tells same-named stops apart) or its lines' pills
/** @param {Place} place */
export const placeName = place => place.lines
    ? html`${pillList(place.lines.map(l => linePill(l.id, l.name, 'm')))} ${local(place.name)}`
    : html`${local(place.name)} <span class="trip-code"><span class="sr-only">, ${t('buses.code')}</span> ${place.code}</span>`;

const resultArrow = () => icon('more', 'search-result-arrow');

// What was found for a field: metro stations (only for where to), then
// stops; each a link that picks it, keeping what's already chosen
/**
 * @param {{ stations: Place[], stops: (import('./stops.js').BusStop & { meters?: number })[],
 *   href: (key: string) => string }} found
 */
export function placeResults({ stations, stops, href }) {
    return html`
        ${stations.length ? html`<h2 class="search-heading">${t('buses.trip-stations')}</h2>
        <ul class="list-group list-group-flush search-list">${stations.map(s => html`
            <li class="list-group-item p-0">
                <a class="list-group-item-action d-flex align-items-center gap-2 px-3 py-2 search-result" href="${href(s.key)}" data-view>
                    <span class="search-result-text flex-grow-1">
                        <span class="fw-semibold">${pillList(s.lines.map(l => linePill(l.id, l.name, 's')))} ${local(s.name)}</span>
                        <span class="d-block search-result-meta"><span class="sr-only">, </span>${t('buses.trip-station-area')}</span>
                    </span>${resultArrow()}
                </a>
            </li>`)}</ul>` : ''}
        ${stops.length ? html`<h2 class="search-heading">${t('buses.stops')}</h2>
        <ul class="list-group list-group-flush search-list">${stops.map(stop => html`
            <li class="list-group-item p-0">
                <a class="list-group-item-action d-flex align-items-center gap-2 px-3 py-2 search-result" href="${href(stop.code)}" data-view>
                    <span class="search-result-text flex-grow-1">
                        <span class="fw-semibold">${local(stop.name)}</span>
                        <span class="search-result-meta"><span class="sr-only">, ${t('buses.code')}</span> ${stop.code}${stop.meters === undefined ? '' : html`<span aria-hidden="true"> ·</span> ${distance(stop.meters)}`}</span>
                    </span>${resultArrow()}
                </a>
            </li>`)}</ul>` : ''}`;
}

// What a field's search found, for the status line read out as it changes
/** @param {string} query @param {number} stations @param {number} stops */
export function placeStatus(query, stations, stops) {
    if (!stations && !stops) return format(t('buses.trip-nothing-found'), { query: query.trim() });
    return [stations && format(t('buses.found-stations'), { count: stations }), stops && format(t('buses.found-stops'), { count: stops })].filter(Boolean).join(' · ');
}

// A place already chosen in the form, with the way to change it
/** @param {string} label @param {import('/js/core/html.js').Html} what @param {string} change */
export const chosenPlace = (label, what, change) => html`
    <div class="trip-field">
        <span class="trip-label">${label}</span>
        <div class="trip-chosen"><span class="trip-chosen-name">${what}</span><a href="${change}" data-view>${t('buses.trip-change')}<span class="sr-only">: ${label}</span></a></div>
    </div>`;

// Above the buses: where to, and from where (with the way to change each)
/** @param {Place} to @param {Place | null} from picked stop, or null: your location @param {string} backHref */
export function tripHeader(to, from, backHref) {
    return html`
        <a class="btn btn-sm btn-link px-0 back-link" href="${backHref}" data-view>${icon('back', 'me-1')}${t('buses.where-to')}</a>
        <h2 class="trip-title" tabindex="-1">${t('buses.trip-title')} ${placeName(to)}</h2>
        <p class="trip-from">${from ? format(t('buses.trip-from-named'), { stop: local(from.name) }) : t('buses.trip-from-location')}<span aria-hidden="true"> · </span><a href="${tripHref({ to: to.key, from: from?.code, pick: 'from' })}" data-view>${t('buses.trip-change')}<span class="sr-only">: ${t('buses.trip-from')}</span></a></p>
        <p class="trip-hint">${t('buses.trip-hint')}</p>`;
}

// "18:48" for a number of minutes from now (seconds since midnight in Athens)
const clockIn = (nowSeconds, minutes) => {
    const total = Math.floor(nowSeconds / 60 + minutes) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// One bus of an option: when it comes, and when you're off it (or that OASA
// doesn't predict it there yet)
/** @param {TripBus} bus @param {number} nowSeconds */
function busRow(bus, nowSeconds) {
    return html`
        <li class="trip-bus">
            ${arrivalBadge(bus.minutes)}
            ${bus.ride === null
                ? html`<span class="trip-wait">${t('buses.trip-not-predicted')}</span>`
                : html`<span>${formatHtml(t('buses.trip-off-at'), { time: html`<b>${clockIn(nowSeconds, bus.arrives)}</b>`, minutes: bus.ride })}</span>`}
        </li>`;
}

// One line's option: the walk to its stop, its next buses, where to get off
/**
 * @param {TripOption} option @param {TripBus[]} buses
 * @param {{ waiting: boolean, unavailable: boolean, nowSeconds: number }} live
 */
export function tripOption(option, buses, { waiting, unavailable, nowSeconds }) {
    const stop = s => html`<b>${local(s.name)}</b>`;
    const walkTo = option.board.meters < HERE_M
        ? formatHtml(t('buses.trip-board-at'), { stop: stop(option.board) })
        : formatHtml(t('buses.trip-walk-to'), { minutes: walkMinutes(option.board.meters), stop: stop(option.board) });
    const getOff = formatHtml(t(option.stops === 1 ? 'buses.trip-get-off-one' : 'buses.trip-get-off'), { stop: stop(option.alight), count: option.stops });
    const status = buses.length ? ''
        : waiting ? html`<p class="trip-wait">${icon('loading', 'spin me-1')}${t('buses.trip-asking')}</p>`
            : html`<p class="trip-wait">${t(unavailable ? 'buses.unavailable' : 'buses.trip-no-bus-now')}</p>`;
    return html`
        <article class="trip-option" data-line="${option.line}">
            <h3 class="trip-option-head">${busPlate(option.line, 'l', t('buses.line'))}<span class="trip-option-to"><span class="sr-only">, </span>${t('buses.toward')} ${local(option.to)}</span></h3>
            <p class="trip-leg">${icon('walk', 'me-1')}<span>${walkTo}</span></p>
            ${buses.length ? html`<ul class="trip-buses list-unstyled mb-0">${buses.map(b => busRow(b, nowSeconds))}</ul>` : status}
            <p class="trip-leg">${icon('get-off', 'me-1')}<span>${getOff}${option.alight.meters < HERE_M ? '' : html` · ${format(t('buses.trip-then-walk'), { minutes: walkMinutes(option.alight.meters) })}`}</span></p>
        </article>`;
}

// No line goes there from here: say so, and offer the metro for a station
/** @param {Place} to */
export function noTrip(to) {
    const station = to.key.startsWith('station:') ? to.key.slice('station:'.length) : null;
    return html`
        <div class="bus-message-body d-flex flex-column align-items-center justify-content-center text-body-secondary trip-none" tabindex="-1">
            ${icon('bus', 'icon-message mb-3')}
            <p class="bus-message-title mb-1 text-center px-4">${t('buses.trip-none-title')}</p>
            <p class="small text-body-secondary text-center px-4">${format(t('buses.trip-none-text'), { name: local(to.name) })}</p>
            ${station && html`<a class="btn btn-primary rounded-pill px-4 mt-2" href="${localHref('/subway')}?${new URLSearchParams({ to: station })}">${t('buses.trip-subway')}</a>`}
        </div>`;
}
