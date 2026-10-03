import { escapeHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { getLanguage } from '/js/core/settings.js';

const local = pair => escapeHtml(pair?.[getLanguage()] || pair?.en || '');

function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function arrivalBadge(minutes) {
    const cls = minutes <= 3 ? 'arrival-soon' : minutes <= 8 ? 'arrival-close' : 'arrival-later';
    const label = minutes <= 3 ? `${minutes} ${t('buses.arriving-soon')}` : `${minutes} ${t('buses.minutes')}`;
    return `<span class="badge arrival-badge ${cls}" aria-label="${escapeHtml(label)}">${minutes} min</span>`;
}

const lineLabel = a => escapeHtml(a.line ?? '?');
const destination = a => a.to ? local(a.to) : escapeHtml(t('buses.unknown-line'));

// One collapsible row per stop. Arrivals are filled in by patchStop().
export function stopItem(stop, index) {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=walking`;
    return `
    <div class="accordion-item stop-item" data-stop="${escapeHtml(stop.code)}" data-has-arrivals="false">
        <div class="stop-header d-flex align-items-stretch">
            <button class="accordion-button stop-toggle collapsed d-flex align-items-center gap-3 flex-grow-1 p-0"
                    type="button" data-bs-toggle="collapse" data-bs-target="#stop-${index}"
                    aria-expanded="false" aria-controls="stop-${index}">
                <div class="stop-label d-flex flex-column align-items-center justify-content-center text-center" aria-hidden="true">
                    <span class="stop-name">${local(stop.name)}</span>
                    <span class="stop-distance">${formatDistance(stop.meters)}</span>
                </div>
                <div class="stop-next-bus d-flex align-items-center gap-2 flex-grow-1" aria-hidden="true"></div>
            </button>
            <div class="stop-header-fixed d-flex align-items-center">
                <span class="header-badge-wrap" aria-hidden="true"></span>
                <a class="directions-btn d-flex align-items-center justify-content-center" href="${mapsUrl}" target="_blank" rel="noopener"
                   aria-label="${escapeHtml(`${t('buses.walking-directions-to')} ${stop.name[getLanguage()] || stop.name.en}`)}">
                    <i class="bi bi-signpost-2-fill" aria-hidden="true"></i>
                </a>
            </div>
        </div>
        <div id="stop-${index}" class="accordion-collapse collapse">
            <div class="accordion-body stop-body">
                <div class="stop-arrivals" role="table" aria-label="${escapeHtml(`${t('buses.all-arrivals-for')} ${stop.name[getLanguage()] || stop.name.en}`)}"></div>
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

    const name = stop.name[getLanguage()] || stop.name.en;
    const summary = first
        ? `${t('buses.next-bus-line')} ${first.line ?? '?'}, ${first.to?.[getLanguage()] || first.to?.en || ''}, ${first.minutes} ${t('buses.minutes')}`
        : result ? t(result.unavailable ? 'buses.unavailable' : 'buses.no-upcoming') : t('buses.finding-stops');
    item.querySelector('.stop-toggle').setAttribute('aria-label', `${name}, ${formatDistance(stop.meters)}. ${summary}. ${t('buses.tap-expand')}`);

    item.querySelector('.stop-next-bus').innerHTML = first
        ? `<span class="next-bus-line">${lineLabel(first)}</span><span class="next-bus-dest">${destination(first)}</span>`
        : result
            ? `<span class="next-bus-dest text-muted fst-italic">${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals-short')}</span>`
            : '<span class="next-bus-dest text-muted"><i class="bi bi-arrow-repeat spin"></i></span>';

    item.querySelector('.header-badge-wrap').innerHTML = first ? arrivalBadge(first.minutes) : '';

    item.querySelector('.stop-arrivals').innerHTML = arrivals.length
        ? arrivals.map(a => `
            <div class="arrival-row d-flex align-items-center justify-content-between py-2 border-bottom border-secondary-subtle" role="row">
                <div class="d-flex align-items-center gap-2">
                    <span class="line-pill" aria-hidden="true">${lineLabel(a)}</span>
                    <span class="arrival-dest">${destination(a)}</span>
                </div>
                ${arrivalBadge(a.minutes)}
            </div>`).join('')
        : result ? `<p class="text-muted small mb-0">${t(result.unavailable ? 'buses.unavailable' : 'buses.no-arrivals')}</p>` : '';
}

export function message(icon, title, subtitle = '') {
    return `
        <div class="d-flex flex-column align-items-center justify-content-center text-muted" style="height: 60dvh;">
            <i class="bi bi-${icon} fs-1 mb-3" aria-hidden="true"></i>
            <p class="fs-5 mb-1">${escapeHtml(title)}</p>
            ${subtitle ? `<p class="small text-secondary text-center px-4">${escapeHtml(subtitle)}</p>` : ''}
        </div>`;
}
