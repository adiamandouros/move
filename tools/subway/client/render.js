import { language, t } from '/js/core/i18n.js';
import { escapeHtml, format, icon } from '/js/core/html.js';
import { lineBadge, trainDiagram } from '/js/core/metro.js';
import { legPositions } from './network.js';

const stationName = (rail, id) => escapeHtml(rail.stations[id].name[language] ?? rail.stations[id].name.en);

function departureChips(departures, now) {
    if (!departures.length) return `<span class="schedule-label">${t('subway.no-trains')}</span>`;
    const chips = departures.map(d => {
        const minutes = Math.max(0, Math.floor((d.departs - now.seconds) / 60));
        const note = d.isLast ? t('subway.last-train') : d.isSecondLast ? t('subway.second-last-train') : '';
        const cls = d.isLast ? ' schedule-chip--last' : d.isSecondLast ? ' schedule-chip--second-last' : '';
        // "12'" on screen, "12 minutes" for screen readers
        return `<span class="schedule-chip${cls}"${note ? ` title="${note}"` : ''}><span aria-hidden="true">${minutes}'</span><span class="sr-only">${minutes} ${t('subway.minutes')}${note ? ` (${note})` : ''},</span></span>`;
    }).join('');
    return `<span class="schedule-label">${t('subway.schedule-in')}</span><span class="schedule-chips">${chips}</span>`;
}

function legCard(rail, leg, next, now, level) {
    const line = rail.lines[leg.line];
    const direction = line.directions[leg.dir];
    const toward = escapeHtml(direction.toward[language] ?? direction.toward.en);
    const { stop, exits, elevators } = legPositions(rail, leg, next);
    const first = leg.departures[0];
    const ride = first ? ` <span class="text-secondary">· ${format(t('subway.ride'), { min: Math.round((first.arrives - first.departs) / 60) })}</span>` : '';
    const action = next
        ? `${icon('arrow-left-right', 'me-2')}${t('subway.transfer-at')} <strong>${stationName(rail, leg.to)}</strong>`
        : `${icon('door-open', 'me-2')}${t('subway.exit-at')} <strong>${stationName(rail, leg.to)}</strong>`;

    return `
        <div class="result-card">
            <div class="result-header d-flex align-items-center gap-2 mb-2">
                <h${level} class="leg-title">
                    ${lineBadge(line)}
                    <span class="direction-text"><span aria-hidden="true">→ </span><span class="sr-only">${t('subway.toward')} </span>${toward}</span>
                </h${level}>
                <div class="schedule-section ms-auto">${departureChips(leg.departures, now)}</div>
            </div>
            <div class="leg-action mb-3">
                ${action}${ride}
                ${stop.centralPlatform ? `<span class="central-platform-badge ms-2">${icon('symmetry-horizontal', 'me-1')}${t('subway.exit-left')}</span>` : ''}
            </div>
            ${exits.length
                ? trainDiagram(rail.positions, exits, elevators, t)
                : `<p class="text-muted fst-italic small">${t('subway.no-position-data')}</p>`}
            ${stop.note ? `<div class="stop-note mt-3">${icon('info-circle', 'me-1')}${escapeHtml(stop.note)}</div>` : ''}
        </div>`;
}

function routeBlock(rail, route, index, total, now) {
    // Headings: one per option when there are several, then one per leg
    const header = total > 1
        ? `<h2 class="route-option-label">${t('subway.option')} ${index + 1}${route.via ? ` · ${t('subway.transfer-at')} ${stationName(rail, route.via)}` : ''}</h2>`
        : '';
    const level = total > 1 ? 3 : 2;
    return header + route.legs.map((leg, i) => {
        const next = route.legs[i + 1] ?? null;
        const connector = next ? `
            <div class="transfer-connector" aria-hidden="true">
                ${icon('arrow-down-circle-fill')}
                <span>${t('subway.change-to')} ${rail.lines[next.line].name}</span>
            </div>` : '';
        return legCard(rail, leg, next, now, level) + connector;
    }).join('');
}

export function renderResult(rail, plans, now, { expired }) {
    if (!plans.length) return `<p class="text-muted small mt-3">${t('subway.no-route')}</p>`;
    const [y, m, d] = rail.feed.validTo.split('-');
    const notice = expired
        ? `<p class="timetable-notice">${icon('exclamation-triangle', 'me-1')}${format(t('subway.timetable-old'), { date: `${d}/${m}/${y}` })}</p>`
        : '';
    return `${notice}
        <div class="routes-wrap">${plans.map((r, i) => routeBlock(rail, r, i, plans.length, now)).join('<hr class="route-divider">')}</div>
        <p class="schedule-disclaimer">${icon('info-circle', 'me-1')}${t('subway.schedule-disclaimer')}</p>`;
}

export function renderMessage(key) {
    return `<p class="text-muted small mt-3">${t(key)}</p>`;
}

// A one-sentence version of the result for screen readers, announced when the
// stations change (the result itself isn't a live region: it refreshes every 30 s)
export function routeSummary(rail, plans, now) {
    if (!plans.length) return t('subway.no-route');
    const leg = plans[0].legs[0];
    const line = rail.lines[leg.line];
    const toward = line.directions[leg.dir].toward[language] ?? line.directions[leg.dir].toward.en;
    const first = leg.departures[0];
    const when = first ? `, ${t('subway.schedule-in').toLowerCase()} ${Math.max(0, Math.floor((first.departs - now.seconds) / 60))} ${t('subway.minutes')}` : '';
    const options = plans.length > 1 ? `${plans.length} ${t('subway.options')}. ${t('subway.option')} 1: ` : '';
    return `${options}${line.name} ${t('subway.toward')} ${toward}${when}.`;
}
