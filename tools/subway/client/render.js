import { getLanguage } from '/js/core/settings.js';
import { format, t } from '/js/core/i18n.js';
import { legPositions } from './network.js';

const lang = () => getLanguage();

export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const stationName = (rail, id) => escapeHtml(rail.stations[id].name[lang()] ?? rail.stations[id].name.en);

function trainDiagram(rail, exits, elevators) {
    const label = p => t(`subway.pos.${p}`);
    const described = [
        ...exits.map(label),
        ...elevators.map(p => `${label(p)} (${t('subway.elevator')})`),
    ].join(', ');
    const cls = p => `${exits.includes(p) ? ' highlighted' : ''}${elevators.includes(p) ? ' has-elevator' : ''}`;
    return `
        <div class="train-diagram" role="img" aria-label="${escapeHtml(`${t('subway.diagram-label')} ${described}`)}">
            <div class="train-label" aria-hidden="true">${t('subway.train-back')}</div>
            <div class="train-cars-wrap" aria-hidden="true">
                <div class="train-cars">
                    ${rail.positions.map(p => `
                        <div class="train-car${cls(p)}">
                            ${exits.includes(p) ? '<i class="bi bi-person-walking"></i>' : ''}
                            ${elevators.includes(p) ? '<i class="bi bi-arrow-up-square"></i>' : ''}
                        </div>`).join('')}
                </div>
                <div class="position-labels">
                    ${rail.positions.map(p => `<div class="position-label${cls(p)}">${label(p)}</div>`).join('')}
                </div>
            </div>
            <div class="train-label" aria-hidden="true">${t('subway.train-front')}</div>
        </div>`;
}

function departureChips(departures, now) {
    if (!departures.length) return `<span class="schedule-label">${t('subway.no-trains')}</span>`;
    const chips = departures.map(d => {
        const minutes = Math.max(0, Math.floor((d.departs - now.seconds) / 60));
        const note = d.isLast ? t('subway.last-train') : d.isSecondLast ? t('subway.second-last-train') : '';
        const cls = d.isLast ? ' schedule-chip--last' : d.isSecondLast ? ' schedule-chip--second-last' : '';
        return `<span class="schedule-chip${cls}"${note ? ` title="${note}"` : ''}>${minutes}'${note ? `<span class="sr-only"> (${note})</span>` : ''}</span>`;
    }).join('');
    return `<span class="schedule-label">${t('subway.schedule-in')}</span><span class="schedule-chips">${chips}</span>`;
}

function legCard(rail, leg, next, now) {
    const line = rail.lines[leg.line];
    const direction = line.directions[leg.dir];
    const toward = escapeHtml(direction.toward[lang()] ?? direction.toward.en);
    const { stop, exits, elevators } = legPositions(rail, leg, next);
    const first = leg.departures[0];
    const ride = first ? ` <span class="text-secondary">· ${format(t('subway.ride'), { min: Math.round((first.arrives - first.departs) / 60) })}</span>` : '';
    const action = next
        ? `<i class="bi bi-arrow-left-right me-2" aria-hidden="true"></i>${t('subway.transfer-at')} <strong>${stationName(rail, leg.to)}</strong>`
        : `<i class="bi bi-door-open me-2" aria-hidden="true"></i>${t('subway.exit-at')} <strong>${stationName(rail, leg.to)}</strong>`;

    return `
        <div class="result-card">
            <div class="result-header d-flex align-items-center gap-2 mb-2">
                <span class="line-badge" style="background-color: ${line.color}">${line.name}</span>
                <span class="direction-text"><span aria-hidden="true">→ </span><span class="sr-only">${t('subway.toward')} </span>${toward}</span>
                <div class="schedule-section ms-auto">${departureChips(leg.departures, now)}</div>
            </div>
            <div class="leg-action mb-3">
                ${action}${ride}
                ${stop.centralPlatform ? `<span class="central-platform-badge ms-2"><i class="bi bi-symmetry-horizontal me-1" aria-hidden="true"></i>${t('subway.exit-left')}</span>` : ''}
            </div>
            ${exits.length
                ? trainDiagram(rail, exits, elevators)
                : `<p class="text-muted fst-italic small">${t('subway.no-position-data')}</p>`}
            ${stop.note ? `<div class="stop-note mt-3"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${escapeHtml(stop.note)}</div>` : ''}
        </div>`;
}

function routeBlock(rail, route, index, total, now) {
    const header = total > 1
        ? `<p class="route-option-label">${t('subway.option')} ${index + 1}${route.via ? ` · ${t('subway.transfer-at')} ${stationName(rail, route.via)}` : ''}</p>`
        : '';
    return header + route.legs.map((leg, i) => {
        const next = route.legs[i + 1] ?? null;
        const connector = next ? `
            <div class="transfer-connector" aria-hidden="true">
                <i class="bi bi-arrow-down-circle-fill"></i>
                <span>${t('subway.change-to')} ${rail.lines[next.line].name}</span>
            </div>` : '';
        return legCard(rail, leg, next, now) + connector;
    }).join('');
}

export function renderResult(rail, plans, now, { expired }) {
    if (!plans.length) return `<p class="text-muted small mt-3">${t('subway.no-route')}</p>`;
    const [y, m, d] = rail.feed.validTo.split('-');
    const notice = expired
        ? `<p class="timetable-notice"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>${format(t('subway.timetable-old'), { date: `${d}/${m}/${y}` })}</p>`
        : '';
    return `${notice}
        <div class="routes-wrap">${plans.map((r, i) => routeBlock(rail, r, i, plans.length, now)).join('<hr class="route-divider">')}</div>
        <p class="schedule-disclaimer"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${t('subway.schedule-disclaimer')}</p>`;
}

export function renderMessage(key) {
    return `<p class="text-muted small mt-3">${t(key)}</p>`;
}
