import { language, localHref, t } from '/js/core/i18n.js';
import { format, formatDate, html, icon, localName, walkingUrl as walkingTo } from '/js/core/html.js';
import { centralPlatformBadge, clockTime, exitDiagram, lineBadge, stopNote } from '/js/core/metro.js';
import { legPositions, tripTime } from './network.js';

// What the subway page draws, with html`` (every value escaped)

const stationName = (rail, id) => localName(rail.stations[id].name, language);

// A station's name, linked to its own page (server/pages/stations.js)
const stationLink = (rail, id) => html`<a href="${localHref(`/subway/stations/${id}`)}">${stationName(rail, id)}</a>`;

// "At Syntagma:", above each leg, with the station linked
function boardAt(rail, id) {
    const [before, after = ''] = t('subway.board-at').split('{station}');
    return html`${before}${stationLink(rail, id)}${after}`;
}

// Google Maps walking directions to a station
export function walkingUrl(rail, id) {
    const [lat, lng] = rail.stations[id].coords;
    return walkingTo(lat, lng);
}

const HOUR = 3600;

// Times shown as clock times rather than minutes from now: tomorrow's trains,
// and trains over an hour away (after midnight, the first ones of the morning)
const asClock = (departures, now, tomorrow) => tomorrow || departures[0].departs - now.seconds > HOUR;

// One train: in how many minutes it leaves, or at what time (clock), marked
// when it's the last or second to last
export function departureChip(d, now, clock) {
    const minutes = Math.max(0, Math.floor((d.departs - now.seconds) / 60));
    const note = d.isLast ? t('subway.last-train') : d.isSecondLast ? t('subway.second-last-train') : '';
    const cls = d.isLast ? ' schedule-chip--last' : d.isSecondLast ? ' schedule-chip--second-last' : '';
    // "12'" on screen, "12 minutes" for screen readers; or "05:32" for both
    const time = clock
        ? html`${clockTime(d.departs)}<span class="sr-only">${note && ` (${note})`},</span>`
        : html`<span aria-hidden="true">${minutes}'</span><span class="sr-only">${minutes} ${t('subway.minutes')}${note && ` (${note})`},</span>`;
    return html`<span class="schedule-chip${cls}"${note && html` title="${note}"`}>${time}</span>`;
}

function departureChips(departures, now, tomorrow) {
    if (!departures.length) return html`<span class="schedule-label">${t('subway.no-trains')}</span>`;
    const clock = asClock(departures, now, tomorrow);
    const chips = departures.map(d => departureChip(d, now, clock));
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
        ? html`${icon('arrow-left-right', 'me-2')}${t('subway.transfer-at')} <strong>${stationLink(rail, leg.to)}</strong>`
        : html`${icon('door-open', 'me-2')}${t('subway.exit-at')} <strong>${stationLink(rail, leg.to)}</strong>`;
    // h2 or h3: a number, never data
    const heading = `h${Number(level)}`;

    return html`
        <div class="card result-card"><div class="card-body">
            <p class="leg-boarding">${boardAt(rail, leg.from)}</p>
            <div class="result-header d-flex align-items-center gap-2 mb-2">
                <${heading} class="leg-title">
                    ${lineBadge(leg.line, line.name)}
                    <span class="direction-text"><span aria-hidden="true">→ </span><span class="sr-only">${t('subway.toward')} </span>${toward}</span>
                </${heading}>
                <div class="schedule-section ms-auto">${departureChips(leg.departures, now, tomorrow)}</div>
            </div>
            <div class="leg-action mb-3">
                ${action}${ride}
                ${stop.centralPlatform && centralPlatformBadge(t, 'ms-2')}
            </div>
            ${exitDiagram(rail.positions, exits, elevators, t)}
            ${stopNote(stop.note)}
        </div></div>`;
}

// When the trip gets you there and how long it takes (tripTime in network.js):
// "Arrive ~12:47 · 23'" on screen, "Arrive about 12:47 · 23 minutes" for
// screen readers
function tripTotal(rail, route, now) {
    const time = tripTime(rail, route, now);
    return time && html`${t('subway.arrive')} <span aria-hidden="true">~</span><span class="sr-only">${t('subway.about')} </span>${clockTime(time.arrives)} · <span aria-hidden="true">${time.minutes}'</span><span class="sr-only">${time.minutes} ${t('subway.minutes')}</span>`;
}

function routeBlock(rail, route, index, total, now, tomorrow) {
    // Headings: one per option when there are several, then one per leg.
    // The option's line has to fit a phone in one line in both languages:
    // "Via Monastiraki" on the left, "Arrive ~06:14 · 33'" on the right
    // ("Option 1" for screen readers only). With only one route: the arrival alone,
    // on the right too.
    const trip = tripTotal(rail, route, now);
    const via = route.via && html`${t('subway.via')} ${stationName(rail, route.via)}`;
    const header = total > 1
        ? html`<h2 class="route-option-label"><span class="sr-only">${t('subway.option')} ${index + 1}, </span>${via && html`<span>${via}</span>`}${via && trip && html`<span class="sr-only">, </span>`}${trip && html`<span class="route-total">${trip}</span>`}</h2>`
        : trip && html`<p class="route-option-label"><span class="route-total">${trip}</span></p>`;
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
    if (!plans.length) return renderMessage('subway.no-route');
    const notice = expired && html`<p class="timetable-notice">${icon('exclamation-triangle', 'me-1')}${format(t('subway.timetable-old'), { date: formatDate(rail.feed.validTo) })}</p>`;
    const tomorrowNotice = tomorrow && html`<p class="tomorrow-notice">${icon('moon-stars', 'me-1')}${t('subway.tomorrow')}</p>`;
    const routes = plans.map((r, i) => html`${i > 0 && html`<hr class="route-divider">`}${routeBlock(rail, r, i, plans.length, now, tomorrow)}`);
    return html`${notice}${tomorrowNotice}
        <div class="routes-wrap">${routes}</div>
        <p class="schedule-disclaimer">${icon('info-circle', 'me-1')}${t('subway.schedule-disclaimer')}</p>`;
}

// Why there's no trip to show, in the same yellow as the other warnings
export function renderMessage(key) {
    return html`<p class="subway-message mt-3">${icon('exclamation-triangle', 'me-1')}${t(key)}</p>`;
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
    const time = tripTime(rail, plans[0], now);
    const total = time ? ` ${t('subway.arrive')} ${t('subway.about')} ${clockTime(time.arrives)}, ${time.minutes} ${t('subway.minutes')}.` : '';
    return `${tomorrow ? `${t('subway.tomorrow')} ` : ''}${options}${line.name} ${t('subway.toward')} ${toward}${when}.${total}`;
}
