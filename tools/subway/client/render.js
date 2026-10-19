import { language, t } from '/js/core/i18n.js';
import { format, html, icon, localName, walkingUrl as walkingTo } from '/js/core/html.js';
import { clockTime, feedDate, lineBadge, trainDiagram } from '/js/core/metro.js';
import { legPositions } from './network.js';

// What the subway page draws, with html`` (every value escaped)

const stationName = (rail, id) => localName(rail.stations[id].name, language);

// Google Maps walking directions to a station
export function walkingUrl(rail, id) {
    const [lat, lng] = rail.stations[id].coords;
    return walkingTo(lat, lng);
}

const HOUR = 3600;

// Times shown as clock times rather than minutes from now: tomorrow's trains,
// and trains over an hour away (after midnight, the first ones of the morning)
const asClock = (departures, now, tomorrow) => tomorrow || departures[0].departs - now.seconds > HOUR;

function departureChips(departures, now, tomorrow) {
    if (!departures.length) return html`<span class="schedule-label">${t('subway.no-trains')}</span>`;
    const clock = asClock(departures, now, tomorrow);
    const chips = departures.map(d => {
        const minutes = Math.max(0, Math.floor((d.departs - now.seconds) / 60));
        const note = d.isLast ? t('subway.last-train') : d.isSecondLast ? t('subway.second-last-train') : '';
        const cls = d.isLast ? ' schedule-chip--last' : d.isSecondLast ? ' schedule-chip--second-last' : '';
        // "12'" on screen, "12 minutes" for screen readers; or "05:32" for both
        const time = clock
            ? html`${clockTime(d.departs)}<span class="sr-only">${note && ` (${note})`},</span>`
            : html`<span aria-hidden="true">${minutes}'</span><span class="sr-only">${minutes} ${t('subway.minutes')}${note && ` (${note})`},</span>`;
        return html`<span class="schedule-chip${cls}"${note && html` title="${note}"`}>${time}</span>`;
    });
    return html`<span class="schedule-label">${t(clock ? 'subway.schedule-at' : 'subway.schedule-in')}</span><span class="schedule-chips">${chips}</span>`;
}

function legCard(rail, leg, next, now, level, tomorrow) {
    const line = rail.lines[leg.line];
    const direction = line.directions[leg.dir];
    const toward = localName(direction.toward, language);
    const { stop, exits, elevators } = legPositions(rail, leg, next);
    const first = leg.departures[0];
    const ride = first && html` <span class="text-body-secondary">· ${format(t('subway.ride'), { min: Math.round((first.arrives - first.departs) / 60) })}</span>`;
    const action = next
        ? html`${icon('arrow-left-right', 'me-2')}${t('subway.transfer-at')} <strong>${stationName(rail, leg.to)}</strong>`
        : html`${icon('door-open', 'me-2')}${t('subway.exit-at')} <strong>${stationName(rail, leg.to)}</strong>`;
    // h2 or h3: a number, never data
    const heading = `h${Number(level)}`;

    return html`
        <div class="card result-card"><div class="card-body">
            <div class="result-header d-flex align-items-center gap-2 mb-2">
                <${heading} class="leg-title">
                    ${lineBadge(line)}
                    <span class="direction-text"><span aria-hidden="true">→ </span><span class="sr-only">${t('subway.toward')} </span>${toward}</span>
                </${heading}>
                <div class="schedule-section ms-auto">${departureChips(leg.departures, now, tomorrow)}</div>
            </div>
            <div class="leg-action mb-3">
                ${action}${ride}
                ${stop.centralPlatform && html`<span class="central-platform-badge ms-2">${icon('symmetry-horizontal', 'me-1')}${t('subway.exit-left')}</span>`}
            </div>
            ${exits.length
                ? trainDiagram(rail.positions, exits, elevators, t)
                : html`<p class="text-body-secondary fst-italic small">${t('subway.no-position-data')}</p>`}
            ${stop.note && html`<div class="stop-note mt-3">${icon('info-circle', 'me-1')}${stop.note}</div>`}
        </div></div>`;
}

function routeBlock(rail, route, index, total, now, tomorrow) {
    // Headings: one per option when there are several, then one per leg
    const header = total > 1 && html`<h2 class="route-option-label">${t('subway.option')} ${index + 1}${route.via && html` · ${t('subway.transfer-at')} ${stationName(rail, route.via)}`}</h2>`;
    const level = total > 1 ? 3 : 2;
    return html`${header}${route.legs.map((leg, i) => {
        const next = route.legs[i + 1] ?? null;
        const connector = next && html`
            <div class="transfer-connector" aria-hidden="true">
                ${icon('arrow-down-circle-fill')}
                <span>${t('subway.change-to')} ${rail.lines[next.line].name}</span>
            </div>`;
        return html`${legCard(rail, leg, next, now, level, tomorrow)}${connector}`;
    })}`;
}

// tomorrow: the plans are for tomorrow's first trains (planTrip in network.js)
export function renderResult(rail, plans, now, { expired, tomorrow = false }) {
    if (!plans.length) return html`<p class="text-body-secondary small mt-3">${t('subway.no-route')}</p>`;
    const notice = expired && html`<p class="timetable-notice">${icon('exclamation-triangle', 'me-1')}${format(t('subway.timetable-old'), { date: feedDate(rail.feed.validTo) })}</p>`;
    const tomorrowNotice = tomorrow && html`<p class="tomorrow-notice">${icon('moon-stars', 'me-1')}${t('subway.tomorrow')}</p>`;
    const routes = plans.map((r, i) => html`${i > 0 && html`<hr class="route-divider">`}${routeBlock(rail, r, i, plans.length, now, tomorrow)}`);
    return html`${notice}${tomorrowNotice}
        <div class="routes-wrap">${routes}</div>
        <p class="schedule-disclaimer">${icon('info-circle', 'me-1')}${t('subway.schedule-disclaimer')}</p>`;
}

export function renderMessage(key) {
    return html`<p class="text-body-secondary small mt-3">${t(key)}</p>`;
}

// A one-sentence version of the result for screen readers, announced when the
// stations change (the result itself isn't a live region: it refreshes every 30 s).
// Plain text, for textContent.
export function routeSummary(rail, plans, now, tomorrow = false) {
    if (!plans.length) return t('subway.no-route');
    const leg = plans[0].legs[0];
    const line = rail.lines[leg.line];
    const toward = localName(line.directions[leg.dir].toward, language);
    const first = leg.departures[0];
    const when = !first ? ''
        : asClock(leg.departures, now, tomorrow) ? `, ${t('subway.schedule-at').toLowerCase()} ${clockTime(first.departs)}`
        : `, ${t('subway.schedule-in').toLowerCase()} ${Math.max(0, Math.floor((first.departs - now.seconds) / 60))} ${t('subway.minutes')}`;
    const options = plans.length > 1 ? `${plans.length} ${t('subway.options')}. ${t('subway.option')} 1: ` : '';
    return `${tomorrow ? `${t('subway.tomorrow')} ` : ''}${options}${line.name} ${t('subway.toward')} ${toward}${when}.`;
}
