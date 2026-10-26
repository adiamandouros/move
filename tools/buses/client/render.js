import { favouriteButton, isFavourite, lineFavourite } from '/js/core/favourites.js';
import { externalLink, format, html, icon, localName, setHtml, walkingUrl } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { busPlate, pillList } from '/js/core/lines.js';
import { soonTier, timeBadge } from '/js/core/times.js';

// What the bus page draws, with html`` (every value escaped: stop names,
// lines and destinations come from OASA)

const local = pair => localName(pair, language);

function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

// The address of a view of the bus page: viewHref({ stop: '10341' }), viewHref({ line: '040' })
const viewHref = params => `${localHref('/buses')}?${new URLSearchParams(params)}`;

// A line's plate, for a screen reader "Line 040"
const plate = (line, size) => busPlate(line, size, t('buses.line'));

// How far a stop is, when the location is known (beside its code)
export const distance = meters => meters === undefined ? html`` : html`<span class="sr-only">, </span>${formatDistance(meters)}`;

function arrivalBadge(minutes) {
    const tier = soonTier(minutes);
    const label = tier === 'due' ? `${minutes} ${t('buses.arriving-soon')}` : `${minutes} ${t('buses.minutes')}`;
    return timeBadge(tier, html`<span aria-hidden="true">${minutes} ${t('buses.min')}</span><span class="sr-only">${label}</span>`);
}

const lineLabel = a => a.line ?? '?';
const destination = a => a.to ? local(a.to) : t('buses.unknown-line');

// One collapsible row per stop: a heading with a button (so screen reader users
// can jump from stop to stop), named by its visible text: name, code (what
// tells same-named stops apart, as on its sign) and distance. Arrivals are
// filled in by patchStop(). open: shown opened; nearest: marked as the
// nearest (on a line); id: the start of its parts' ids (the favourites have
// their own, as a stop can be listed twice).
export function stopItem(stop, index, { open = false, nearest = false, id = 'stop' } = {}) {
    return html`
    <div class="accordion-item stop-item${nearest ? ' stop-nearest' : ''}" data-stop="${stop.code}" data-has-arrivals="false">
        <div class="stop-header d-flex align-items-stretch">
            <h2 class="stop-heading d-flex flex-grow-1">
            <button class="accordion-button stop-toggle${open ? '' : ' collapsed'} d-flex align-items-center gap-3 flex-grow-1 p-0"
                    type="button" data-bs-toggle="collapse" data-bs-target="#${id}-${index}"
                    aria-expanded="${String(open)}" aria-controls="${id}-${index}">
                <span class="stop-label d-flex flex-column align-items-center justify-content-center text-center">
                    <span class="stop-name">${local(stop.name)}</span>
                    <span class="stop-code"><span class="sr-only">, ${t('buses.code')} </span>${stop.code}</span>
                    <span class="stop-distance">${distance(stop.meters)}</span>
                    <span class="stop-nearest-note">${nearest ? nearestNote() : ''}</span>
                </span>
                <span class="stop-next-bus d-flex align-items-center gap-2 flex-grow-1"></span>
            </button>
            </h2>
            <div class="stop-header-fixed d-flex align-items-center">
                <span class="header-badge-wrap" aria-hidden="true"></span>
                ${favouriteButton({ kind: 'stop', key: stop.code, on: isFavourite('stop', stop.code), label: `${t('favourites.star')}: ${local(stop.name)} ${stop.code}`, cls: 'stop-favourite' })}
                ${externalLink({ class: 'directions-btn d-flex align-items-center justify-content-center', href: walkingUrl(stop.lat, stop.lng) },
                    html`${icon('walk')}<span class="sr-only">${t('buses.walking-directions-to')} ${local(stop.name)}</span>`, t('shell.new-tab'))}
            </div>
        </div>
        <div id="${id}-${index}" class="accordion-collapse collapse${open ? ' show' : ''}">
            <div class="accordion-body stop-body">
                <ul class="stop-arrivals list-unstyled mb-0" aria-label="${t('buses.all-arrivals-for')} ${local(stop.name)}"></ul>
                <p class="stop-lines mb-0">${t('buses.lines')}: ${lineLinks(stop.lines)}</p>
            </div>
        </div>
    </div>`;
}

// On a line, under the stop nearest to you
export const nearestNote = () => html`<span class="sr-only">, </span>${t('buses.nearest')}`;

// A stop's lines, each a link to its stops in order
const lineLinks = lines => pillList(lines.map(line => html`<a class="plate-link" href="${viewHref({ line })}" data-view>${busPlate(line, 's')}</a>`));

// Fill in one stop's arrivals. `result` is undefined until the first answer
// arrives; waiting: false when none is on its way (a line's stop, until it's opened).
export function patchStop(item, result, { waiting = true } = {}) {
    item.dataset.hasArrivals = String((result?.arrivals ?? []).length > 0);
    setHtml(item.querySelector('.stop-next-bus'), nextBus(result, { waiting }));
    setHtml(item.querySelector('.header-badge-wrap'), headerBadge(result));
    setHtml(item.querySelector('.stop-arrivals'), arrivalRows(result));
}

// The rest of the stop button's name: the next bus, or why there's none. The
// button's name is its text: stop, distance, then this (the minutes badge
// sits outside the button, so they're repeated for screen readers).
export function nextBus(result, { waiting = true } = {}) {
    const first = result?.arrivals?.[0];
    if (first) return html`<span class="sr-only">. ${t('buses.next-bus-line')} </span><span class="next-bus-line">${busPlate(lineLabel(first), 'l')}</span><span class="sr-only">, </span><span class="next-bus-dest">${destination(first)}</span><span class="sr-only">, ${first.minutes} ${t('buses.minutes')}</span>`;
    if (result) return html`<span class="next-bus-dest text-body-secondary fst-italic"><span class="sr-only">. </span>${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals-short')}</span>`;
    return waiting
        ? html`<span class="next-bus-dest text-body-secondary">${icon('loading', 'spin')}<span class="sr-only">. ${t('buses.finding-stops')}</span></span>`
        : html`<span class="next-bus-dest text-body-secondary"><span class="sr-only">. </span>${t('buses.open-for-times')}</span>`;
}

// The next bus's minutes, beside the button
export function headerBadge(result) {
    const first = result?.arrivals?.[0];
    return first ? arrivalBadge(first.minutes) : html``;
}

// One arrival: the line, where it goes and in how many minutes
export function arrivalRow(a) {
    return html`
            <li class="arrival-row d-flex align-items-center justify-content-between py-2">
                <span class="d-flex align-items-center gap-2">
                    ${plate(lineLabel(a), 'm')}
                    <span class="arrival-dest"><span class="sr-only">, </span>${destination(a)}<span class="sr-only">, </span></span>
                </span>
                ${arrivalBadge(a.minutes)}
            </li>`;
}

// Every arrival, inside the opened stop
export function arrivalRows(result) {
    const arrivals = result?.arrivals ?? [];
    if (!arrivals.length) return result ? html`<li class="text-body-secondary small">${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals')}</li>` : html``;
    return html`${arrivals.map(arrivalRow)}`;
}

// A message in place of the stops, with an optional button (its label).
// symbol: the icon's name, and "spin" after it to turn it while loading.
// tabindex="-1" lets the page move the keyboard to it.
export function message(symbol, title, subtitle = '', action = '') {
    const [name, ...extra] = symbol.split(' ');
    return html`
        <div class="bus-message-body d-flex flex-column align-items-center justify-content-center text-body-secondary" tabindex="-1">
            ${icon(name, ['icon-message mb-3', ...extra].join(' '))}
            <p class="bus-message-title mb-1 text-center px-4">${title}</p>
            ${subtitle && html`<p class="small text-body-secondary text-center px-4">${subtitle}</p>`}
            ${action && html`<button type="button" class="btn btn-primary rounded-pill px-4 mt-2 message-action">${action}</button>`}
        </div>`;
}

// ── Search and lines ────────────────────────────────────────────────────────

// At the end of every result, so it looks like something to tap
const resultArrow = () => icon('more', 'search-result-arrow');

// Above the results: what tapping one does
function searchHint(lines, stops) {
    const key = lines.length && stops.length ? 'buses.pick-either' : lines.length ? 'buses.pick-line' : 'buses.pick-stop';
    return html`<p class="search-hint">${t(key)}</p>`;
}

// A line found by its number: a link to its stops
export function lineResult(line) {
    return html`
        <li class="list-group-item p-0">
            <a class="list-group-item-action d-flex align-items-center gap-2 px-3 py-2 search-result" href="${viewHref({ line: line.line })}" data-view>
                ${plate(line.line, 'm')}<span class="search-result-text flex-grow-1"><span class="sr-only">, </span>${local(line.name)}</span>${resultArrow()}
            </a>
        </li>`;
}

// A starred line, in the direction it was starred: a link to its stops that way
export function favouriteLine(line, dir) {
    return html`
        <li class="list-group-item p-0">
            <a class="list-group-item-action d-flex align-items-center gap-2 px-3 py-2 search-result" href="${viewHref({ line: line.line, dir: String(dir) })}" data-view>
                ${plate(line.line, 'm')}<span class="search-result-text flex-grow-1"><span class="sr-only">, </span>${t('buses.toward')} ${local(line.directions[dir].to)}</span>${resultArrow()}
            </a>
        </li>`;
}

// A stop found by name or code: its name, code, distance and lines, all in
// the link, so each of eight "SYNTAGMA"s is told apart by what it says
export function stopResult(stop) {
    return html`
        <li class="list-group-item p-0">
            <a class="list-group-item-action d-flex align-items-center gap-2 px-3 py-2 search-result" href="${viewHref({ stop: stop.code })}" data-view>
                <span class="search-result-text flex-grow-1">
                    <span class="fw-semibold">${local(stop.name)}</span>
                    <span class="search-result-meta"><span class="sr-only">, ${t('buses.code')}</span> ${stop.code}${stop.meters === undefined ? '' : html`<span aria-hidden="true"> ·</span> ${distance(stop.meters)}`}</span>
                    <span class="d-block search-result-lines"><span class="sr-only">, </span>${t('buses.lines')}: ${pillList(stop.lines.map(line => busPlate(line, 's')))}</span>
                </span>${resultArrow()}
            </a>
        </li>`;
}

// What was found: lines first (few), then stops (the first `shown` of them)
export function searchResults(lines, stops, shown) {
    return html`
        ${lines.length || stops.length ? searchHint(lines, stops) : ''}
        ${lines.length ? html`<h2 class="search-heading">${t('buses.lines')}</h2>
        <ul class="list-group list-group-flush search-list">${lines.map(lineResult)}</ul>` : ''}
        ${stops.length ? html`<h2 class="search-heading">${t('buses.stops')}</h2>
        <ul class="list-group list-group-flush search-list">${stops.slice(0, shown).map(stopResult)}</ul>` : ''}
        ${stops.length > shown ? html`<div class="filter-bar"><button type="button" class="btn btn-sm btn-outline-secondary rounded-pill px-4 more-results">${t('buses.show-more')}</button></div>` : ''}`;
}

// What the search found, for the status line read out as it changes
export function searchStatus(query, lines, stops) {
    if (!lines.length && !stops.length) return format(t('buses.nothing-found'), { query: query.trim() });
    return [lines.length && format(t('buses.found-lines'), { count: lines.length }), stops.length && format(t('buses.found-stops'), { count: stops.length })].filter(Boolean).join(' · ');
}

// Above a stop or a line: the way back to the stops nearby
export function backLink() {
    return html`<a class="btn btn-sm btn-link px-0 back-link" href="${localHref('/buses')}" data-view>${icon('back', 'me-1')}${t('buses.nearby')}</a>`;
}

// Above a line's stops: its number and name, and a switch between its two
// directions (`direction`: the one shown), and a star for the line that
// way. The heading takes the keyboard when the line opens.
export function lineHeader(line, direction) {
    const switcher = line.directions.length > 1 && html`
        <div class="btn-group w-100 direction-switch" role="group" aria-label="${t('buses.direction')}">
            ${line.directions.map((d, i) => html`<button type="button" class="btn btn-sm btn-outline-secondary" data-direction="${i}" aria-pressed="${String(i === direction)}">${t('buses.toward')} ${local(d.to)}</button>`)}
        </div>`;
    return html`
        ${backLink()}
        <div class="line-title-row d-flex align-items-center gap-2">
            <h2 class="line-heading d-flex align-items-center gap-2 flex-grow-1" tabindex="-1">${plate(line.line, 'l')}<span><span class="sr-only">, </span>${local(line.name)}</span></h2>
            ${favouriteButton({ kind: 'line', key: lineFavourite(line.line, direction), on: isFavourite('line', lineFavourite(line.line, direction)), label: `${t('favourites.star')}: ${t('buses.line')} ${line.line}, ${t('buses.toward')} ${local(line.directions[direction].to)}`, cls: 'line-favourite' })}
        </div>
        ${switcher || html`<p class="line-toward">${t('buses.toward')} ${local(line.directions[0].to)}</p>`}`;
}
