import { escapeHtml, icon } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';

const local = pair => escapeHtml(pair?.[language] || pair?.en || '');

function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function arrivalBadge(minutes) {
    const cls = minutes <= 3 ? 'arrival-soon' : minutes <= 8 ? 'arrival-close' : 'arrival-later';
    const label = minutes <= 3 ? `${minutes} ${t('buses.arriving-soon')}` : `${minutes} ${t('buses.minutes')}`;
    return `<span class="badge arrival-badge ${cls}"><span aria-hidden="true">${minutes} min</span><span class="sr-only">${escapeHtml(label)}</span></span>`;
}

const lineLabel = a => escapeHtml(a.line ?? '?');
const destination = a => a.to ? local(a.to) : escapeHtml(t('buses.unknown-line'));

// One collapsible row per stop: a heading with a button (so screen reader users
// can jump from stop to stop), named by its visible text. Arrivals are filled
// in by patchStop().
export function stopItem(stop, index) {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=walking`;
    return `
    <div class="accordion-item stop-item" data-stop="${escapeHtml(stop.code)}" data-has-arrivals="false">
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
                <a class="directions-btn d-flex align-items-center justify-content-center" href="${mapsUrl}" target="_blank" rel="noopener"
                   aria-label="${escapeHtml(`${t('buses.walking-directions-to')} ${stop.name[language] || stop.name.en} ${t('shell.new-tab')}`)}">
                    ${icon('signpost-2-fill')}
                </a>
            </div>
        </div>
        <div id="stop-${index}" class="accordion-collapse collapse">
            <div class="accordion-body stop-body">
                <ul class="stop-arrivals list-unstyled mb-0" aria-label="${escapeHtml(`${t('buses.all-arrivals-for')} ${stop.name[language] || stop.name.en}`)}"></ul>
                <p class="stop-lines mb-0">${t('buses.lines')}: ${stop.lines.map(escapeHtml).join(', ')}</p>
            </div>
        </div>
    </div>`;
}

// Fill in one stop's arrivals. `result` is undefined until the first answer arrives.
export function patchStop(item, stop, result) {
    const arrivals = result?.arrivals ?? [];
    const first = arrivals[0];
    item.dataset.hasArrivals = String(arrivals.length > 0);

    // The button's name is its text: stop, distance, then the next bus (the
    // minutes badge sits outside the button, so they're repeated for screen readers)
    item.querySelector('.stop-next-bus').innerHTML = first
        ? `<span class="sr-only">. ${t('buses.next-bus-line')} </span><span class="next-bus-line">${lineLabel(first)}</span><span class="sr-only">, </span><span class="next-bus-dest">${destination(first)}</span><span class="sr-only">, ${first.minutes} ${t('buses.minutes')}</span>`
        : result
            ? `<span class="next-bus-dest text-muted fst-italic"><span class="sr-only">. </span>${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals-short')}</span>`
            : `<span class="next-bus-dest text-muted">${icon('arrow-repeat', 'spin')}<span class="sr-only">. ${t('buses.finding-stops')}</span></span>`;

    item.querySelector('.header-badge-wrap').innerHTML = first ? arrivalBadge(first.minutes) : '';

    item.querySelector('.stop-arrivals').innerHTML = arrivals.length
        ? arrivals.map(a => `
            <li class="arrival-row d-flex align-items-center justify-content-between py-2 border-bottom border-secondary-subtle">
                <span class="d-flex align-items-center gap-2">
                    <span class="line-pill"><span class="sr-only">${t('buses.line')} </span>${lineLabel(a)}</span>
                    <span class="arrival-dest"><span class="sr-only">, </span>${destination(a)}<span class="sr-only">, </span></span>
                </span>
                ${arrivalBadge(a.minutes)}
            </li>`).join('')
        : result ? `<li class="text-muted small">${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals')}</li>` : '';
}

// A message in place of the stops, with an optional button (its label).
// symbol: the icon's name, and "spin" after it to turn it while loading.
// tabindex="-1" lets the page move the keyboard to it.
export function message(symbol, title, subtitle = '', action = '') {
    const [name, ...extra] = symbol.split(' ');
    return `
        <div class="bus-message-body d-flex flex-column align-items-center justify-content-center text-muted" tabindex="-1" style="height: 60dvh;">
            ${icon(name, ['fs-1 mb-3', ...extra].join(' '))}
            <p class="fs-5 mb-1 text-center px-4">${escapeHtml(title)}</p>
            ${subtitle ? `<p class="small text-secondary text-center px-4">${escapeHtml(subtitle)}</p>` : ''}
            ${action ? `<button type="button" class="btn btn-primary rounded-pill px-4 mt-2 message-action">${escapeHtml(action)}</button>` : ''}
        </div>`;
}
