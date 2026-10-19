import { html, icon, localName, setHtml, walkingUrl } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';

// What the bus page draws, with html`` (every value escaped: stop names,
// lines and destinations come from OASA)

const local = pair => localName(pair, language);

function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function arrivalBadge(minutes) {
    const cls = minutes <= 3 ? 'arrival-soon' : minutes <= 8 ? 'arrival-close' : 'arrival-later';
    const label = minutes <= 3 ? `${minutes} ${t('buses.arriving-soon')}` : `${minutes} ${t('buses.minutes')}`;
    return html`<span class="badge arrival-badge ${cls}"><span aria-hidden="true">${minutes} ${t('buses.min')}</span><span class="sr-only">${label}</span></span>`;
}

const lineLabel = a => a.line ?? '?';
const destination = a => a.to ? local(a.to) : t('buses.unknown-line');

// One collapsible row per stop: a heading with a button (so screen reader users
// can jump from stop to stop), named by its visible text. Arrivals are filled
// in by patchStop().
export function stopItem(stop, index) {
    return html`
    <div class="accordion-item stop-item" data-stop="${stop.code}" data-has-arrivals="false">
        <div class="stop-header d-flex align-items-stretch">
            <h2 class="stop-heading d-flex flex-grow-1">
            <button class="accordion-button stop-toggle collapsed d-flex align-items-center gap-3 flex-grow-1 p-0"
                    type="button" data-bs-toggle="collapse" data-bs-target="#stop-${index}"
                    aria-expanded="false" aria-controls="stop-${index}">
                <span class="stop-label d-flex flex-column align-items-center justify-content-center text-center">
                    <span class="stop-name">${local(stop.name)}</span>
                    <span class="stop-distance"><span class="sr-only">, </span>${formatDistance(stop.meters)}</span>
                </span>
                <span class="stop-next-bus d-flex align-items-center gap-2 flex-grow-1"></span>
            </button>
            </h2>
            <div class="stop-header-fixed d-flex align-items-center">
                <span class="header-badge-wrap" aria-hidden="true"></span>
                <a class="directions-btn d-flex align-items-center justify-content-center" href="${walkingUrl(stop.lat, stop.lng)}" target="_blank" rel="noopener"
                   aria-label="${t('buses.walking-directions-to')} ${local(stop.name)} ${t('shell.new-tab')}">
                    ${icon('signpost-2-fill')}
                </a>
            </div>
        </div>
        <div id="stop-${index}" class="accordion-collapse collapse">
            <div class="accordion-body stop-body">
                <ul class="stop-arrivals list-unstyled mb-0" aria-label="${t('buses.all-arrivals-for')} ${local(stop.name)}"></ul>
                <p class="stop-lines mb-0">${t('buses.lines')}: ${stop.lines.join(', ')}</p>
            </div>
        </div>
    </div>`;
}

// Fill in one stop's arrivals. `result` is undefined until the first answer arrives.
export function patchStop(item, stop, result) {
    item.dataset.hasArrivals = String((result?.arrivals ?? []).length > 0);
    setHtml(item.querySelector('.stop-next-bus'), nextBus(result));
    setHtml(item.querySelector('.header-badge-wrap'), headerBadge(result));
    setHtml(item.querySelector('.stop-arrivals'), arrivalRows(result));
}

// The rest of the stop button's name: the next bus, or why there's none. The
// button's name is its text: stop, distance, then this (the minutes badge
// sits outside the button, so they're repeated for screen readers).
export function nextBus(result) {
    const first = result?.arrivals?.[0];
    if (first) return html`<span class="sr-only">. ${t('buses.next-bus-line')} </span><span class="next-bus-line">${lineLabel(first)}</span><span class="sr-only">, </span><span class="next-bus-dest">${destination(first)}</span><span class="sr-only">, ${first.minutes} ${t('buses.minutes')}</span>`;
    return result
        ? html`<span class="next-bus-dest text-body-secondary fst-italic"><span class="sr-only">. </span>${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals-short')}</span>`
        : html`<span class="next-bus-dest text-body-secondary">${icon('arrow-repeat', 'spin')}<span class="sr-only">. ${t('buses.finding-stops')}</span></span>`;
}

// The next bus's minutes, beside the button
export function headerBadge(result) {
    const first = result?.arrivals?.[0];
    return first ? arrivalBadge(first.minutes) : html``;
}

// Every arrival, inside the opened stop
export function arrivalRows(result) {
    const arrivals = result?.arrivals ?? [];
    if (!arrivals.length) return result ? html`<li class="text-body-secondary small">${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals')}</li>` : html``;
    return html`${arrivals.map(a => html`
            <li class="arrival-row d-flex align-items-center justify-content-between py-2 border-bottom border-secondary-subtle">
                <span class="d-flex align-items-center gap-2">
                    <span class="line-pill"><span class="sr-only">${t('buses.line')} </span>${lineLabel(a)}</span>
                    <span class="arrival-dest"><span class="sr-only">, </span>${destination(a)}<span class="sr-only">, </span></span>
                </span>
                ${arrivalBadge(a.minutes)}
            </li>`)}`;
}

// A message in place of the stops, with an optional button (its label).
// symbol: the icon's name, and "spin" after it to turn it while loading.
// tabindex="-1" lets the page move the keyboard to it.
export function message(symbol, title, subtitle = '', action = '') {
    const [name, ...extra] = symbol.split(' ');
    return html`
        <div class="bus-message-body d-flex flex-column align-items-center justify-content-center text-body-secondary" tabindex="-1" style="height: 60dvh;">
            ${icon(name, ['fs-1 mb-3', ...extra].join(' '))}
            <p class="fs-5 mb-1 text-center px-4">${title}</p>
            ${subtitle && html`<p class="small text-body-secondary text-center px-4">${subtitle}</p>`}
            ${action && html`<button type="button" class="btn btn-primary rounded-pill px-4 mt-2 message-action">${action}</button>`}
        </div>`;
}
