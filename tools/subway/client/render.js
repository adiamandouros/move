import { language, localHref, t } from '/js/core/i18n.js';
import { format, formatDate, formatHtml, html, icon, localName, notice, walkingUrl as walkingTo } from '/js/core/html.js';
import { liftNotice, liftSummary, stationPlatforms, stepFreeGaps } from '/js/core/lifts.js';
import { linePill, pillList, stationSign } from '/js/core/lines.js';
import { soonTier, timeBadge } from '/js/core/times.js';
import { centralPlatformBadge, clockTime, diagramLegend, diagramSymbols, exitDiagram, lineEnd, stopNote } from '/js/core/metro.js';
import { legPositions, tripTime } from './network.js';

// What the subway page draws, with html`` (every value escaped)

const stationName = (rail, id) => localName(rail.stations[id].name, language);

// A station's name, linked to its own page (server/pages/stations.js); tram
// stops have none
const stationLink = (rail, id) => rail.stations[id].tram ? stationName(rail, id) : html`<a href="${localHref(`/subway/stations/${id}`)}">${stationName(rail, id)}</a>`;

// "At Syntagma:", above each leg, with the station linked
function boardAt(rail, id) {
    const [before, after = ''] = t('subway.board-at').split('{station}');
    return html`${before}${stationLink(rail, id)}${after}`;
}

// Every station the trips start, change or end at, for the lifts out of service there
const tripStations = plans => plans.flatMap(r => [r.legs[0].from, ...r.legs.map(leg => leg.to)]);
// The platforms they use there, for those with steps only
const tripGaps = (rail, plans) => stepFreeGaps(rail, plans.flatMap(r => r.legs.flatMap(leg => [leg.from, leg.to].map(station => ({ line: leg.line, dir: leg.dir, station })))));

// Google Maps walking directions to a station
export function walkingUrl(rail, id) {
    const [lat, lng] = rail.stations[id].coords;
    return walkingTo(lat, lng);
}

const HOUR = 3600;

// What a leg's trains are called, or its trams: in Greek a metro stop is a
// «σταθμός», a tram's a «στάση»
const TRAIN_WORDS = { last: 'subway.last-train', secondLast: 'subway.second-last-train', none: 'subway.no-trains', stop: 'subway.stop-count', stops: 'subway.stops-count', stations: 'subway.leg-stations' };
const TRAM_WORDS = { last: 'subway.last-tram', secondLast: 'subway.second-last-tram', none: 'subway.no-trams', stop: 'subway.tram-stop-count', stops: 'subway.tram-stops-count', stations: 'subway.tram-leg-stations' };
const wordsFor = (rail, leg) => rail.lines[leg.line].tram ? TRAM_WORDS : TRAIN_WORDS;

// Minutes as on the station boards: "12'" on screen, "12 minutes" for screen readers
const minutesMark = minutes => html`<span aria-hidden="true">${minutes}'</span><span class="sr-only">${minutes} ${t('subway.minutes')}</span>`;

// Times shown as clock times rather than minutes from now: tomorrow's trains,
// and trains over an hour away (after midnight, the first ones of the morning)
const asClock = (departures, now, tomorrow) => tomorrow || departures[0].departs - now.seconds > HOUR;

// One train: in how many minutes it leaves, or at what time (clock), marked
// when it's the last or second to last
export function departureChip(d, now, clock, words = TRAIN_WORDS) {
    const minutes = Math.max(0, Math.floor((d.departs - now.seconds) / 60));
    const note = d.isLast ? t(words.last) : d.isSecondLast ? t(words.secondLast) : '';
    const tier = d.isLast ? 'last' : d.isSecondLast ? 'second-last' : clock ? 'later' : soonTier(minutes);
    // "12'" on screen, "12 minutes" for screen readers; or "05:32" for both
    const time = clock
        ? html`${clockTime(d.departs)}<span class="sr-only">${note && ` (${note})`},</span>`
        : html`<span aria-hidden="true">${minutes}'</span><span class="sr-only">${minutes} ${t('subway.minutes')}${note && ` (${note})`},</span>`;
    return timeBadge(tier, time, note);
}

function departureChips(departures, now, tomorrow, words) {
    if (!departures.length) return html`<span class="schedule-label">${t(words.none)}</span>`;
    const clock = asClock(departures, now, tomorrow);
    const chips = departures.map(d => departureChip(d, now, clock, words));
    return html`<span class="schedule-label">${t(clock ? 'subway.schedule-at' : 'subway.schedule-in')}</span><span class="schedule-chips">${chips}</span>`;
}

// The last trains in words, on a line of their own under the line and its
// times: "Last train 23:57". The chips say the same to screen readers, so
// this is for the eyes.
export function lastTrainWords(departures, words = TRAIN_WORDS) {
    const marked = departures.filter(d => d.isLast || d.isSecondLast);
    if (!marked.length) return '';
    return html`<p class="last-trains" aria-hidden="true">${marked.map(d => html`<span class="last-train last-train-${d.isLast ? 'last' : 'second-last'}">${icon('warning')}${t(d.isLast ? words.last : words.secondLast)} ${clockTime(d.departs)}</span>`)}</p>`;
}

// How many stops the train makes until the leg's last: "3 stops"
export function stopCount(leg, words = TRAIN_WORDS) {
    const count = leg.toIndex - leg.fromIndex;
    return format(t(count === 1 ? words.stop : words.stops), { count });
}

// Names a leg of a route through the 30-second refresh, to keep its
// stations open or closed as the user left them
export const legKey = (route, i) => `${routeKey(route)}#${i}`;

// The stations a leg goes through, in order, from where it boards to where
// it gets off, each linked to its page, with the other lines at the
// interchanges: under the card, on a strip in the line's colour.
// id: the list's, for its button. open: whether it starts open.
function legStations(rail, leg, id, open) {
    const stops = rail.lines[leg.line].directions[leg.dir].stops.slice(leg.fromIndex, leg.toIndex + 1);
    return html`<ol class="leg-stations strip-${leg.line.toLowerCase()}" id="${id}" aria-label="${t(wordsFor(rail, leg).stations)}"${!open && html` hidden`}>
        ${stops.map(({ station }) => {
            const others = rail.stations[station].lines.filter(line => line !== leg.line && rail.lines[line]);
            return html`<li>${stationLink(rail, station)}${others.length > 0 && html` ${pillList(others.map(line => linePill(line, rail.lines[line].name, 's')))}`}</li>`;
        })}
    </ol>`;
}

// changes: whether the route has more than one leg. Only then does each card
// say how long its ride is (a direct trip's is the total on the route's line).
// The stops it always says, on the right: "12' · 3 stops", a button that
// opens the stations on the way (legStations). key: legKey's; open: whether
// they're open. A tram has no train diagram: its platforms are in the street,
// open along their length, so you get off anywhere.
function legCard(rail, leg, next, now, level, tomorrow, changes, key, open) {
    const line = rail.lines[leg.line];
    const words = wordsFor(rail, leg);
    // Where the line goes, as the station's signs say
    const toward = stationName(rail, lineEnd(rail, leg.line, leg.dir));
    const where = legPositions(rail, leg, next);
    const { stop } = where;
    const first = leg.departures[0];
    const ride = changes && first && html`${minutesMark(Math.round((first.arrives - first.departs) / 60))} · `;
    const action = next
        ? html`${icon('change-trains', 'me-2')}${t('subway.transfer-at')} <strong>${stationLink(rail, leg.to)}</strong>`
        : html`${icon('get-off', 'me-2')}${t('subway.exit-at')} <strong>${stationLink(rail, leg.to)}</strong>`;
    // h2 or h3: a number, never data
    const heading = `h${Number(level)}`;
    const id = `stations-${key.replace(/[^a-z0-9]+/gi, '-')}`;

    // Where to ride first, then where to get off at the bottom, the doors
    // there under it
    return html`
        <div class="card result-card"><div class="card-body">
            <p class="leg-boarding">${boardAt(rail, leg.from)}</p>
            <div class="result-header d-flex align-items-center gap-2 mb-2">
                <${heading} class="leg-title">
                    ${linePill(leg.line, line.name, 'l')}
                    <span class="direction-text"><span aria-hidden="true">→ </span><span class="sr-only">${t('subway.toward')} </span>${stationSign(toward, [leg.line])}</span>
                </${heading}>
                <div class="schedule-section ms-auto">${departureChips(leg.departures, now, tomorrow, words)}</div>
            </div>
            ${lastTrainWords(leg.departures, words)}
            ${!line.tram && exitDiagram(rail.positions, where, t)}
            ${stopNote(stop.note)}
            <div class="leg-action mt-3">
                <span>${action}</span><span class="sr-only">, </span>
                <span class="leg-ride">${ride}<button type="button" class="leg-stops-toggle" data-leg="${key}" aria-expanded="${String(open)}" aria-controls="${id}">${stopCount(leg, words)}${icon('more', 'leg-stops-chevron')}</button></span>
            </div>
            ${legStations(rail, leg, id, open)}
            ${stop.centralPlatform && html`<p class="leg-doors text-center mt-2 mb-0">${centralPlatformBadge(t)}</p>`}
        </div></div>`;
}

// A walk at the start or end of a trip, in the place of a connector: "Walk to
// Neo Faliro ~7'", with "about 7 minutes" for screen readers
function walkTo(rail, id, minutes) {
    return html`<p class="transfer-connector mb-0">${icon('walk')}<span>${format(t('subway.walk-to'), { station: stationName(rail, id) })} <span aria-hidden="true">~</span><span class="sr-only">${t('subway.about')} </span>${minutesMark(minutes)}</span></p>`;
}

// When the trip gets you there and how long it takes (tripTime in network.js):
// "Arrive ~12:47 · 23'" on screen, "Arrive about 12:47 · 23 minutes" for
// screen readers
function tripTotal(time) {
    return time && html`${t('subway.arrive')} <span aria-hidden="true">~</span><span class="sr-only">${t('subway.about')} </span>${clockTime(time.arrives)} · ${minutesMark(time.minutes)}`;
}

// An option arriving more than this many minutes after the first starts
// closed, saying how much slower it is
export const SLOWER_MINUTES = 5;

// Names a route through the 30-second refresh, to keep it open or closed as
// the user left it
export const routeKey = route => route.legs.map(leg => `${leg.line}/${leg.dir}/${leg.from}/${leg.to}`).join('+');

// time: tripTime's. closed: why the option starts closed ("9 min slower"),
// or '' when it doesn't. open: the options the user opened or closed
// (routeKey). stations: the legs whose stations are open (legKey). to: where
// the trip ends, for a walk there from the last leg.
function routeBlock(rail, route, index, total, now, tomorrow, { time, closed, open, stations, to }) {
    // Headings: one per option when there are several, then one per leg.
    // The option's line has to fit a phone in one line in both languages:
    // "Via Monastiraki" (or "No transfers") on the left, "Arrive ~06:14 · 33'"
    // on the right ("Option 1" for screen readers only). With only one route:
    // the same line, but not a heading. What doesn't fit ends in "…" on the
    // left (the card names the station too), never in the arrival.
    const trip = tripTotal(time);
    const changes = route.legs.slice(0, -1).map(leg => stationName(rail, leg.to));
    const via = changes.length ? `${t('subway.via')} ${changes.join(', ')}` : t('subway.no-transfers');
    const line = html`<span class="route-via">${via}</span>${trip && html`<span class="sr-only">, </span><span class="route-total">${trip}</span>`}`;
    const header = total > 1
        ? html`<h2 class="route-option-label"><span class="sr-only">${t('subway.option')} ${index + 1}, </span>${line}</h2>`
        : html`<p class="route-option-label">${line}</p>`;
    const level = total > 1 ? 3 : 2;
    const cards = route.legs.map((leg, i) => {
        const next = route.legs[i + 1] ?? null;
        // A change on foot is a walk to the next leg's stop, then the change
        const walk = next && next.from !== leg.to && rail.walks[leg.to][next.from];
        const connector = next && html`
            ${walk && walkTo(rail, next.from, walk)}
            <div class="transfer-connector" aria-hidden="true">
                ${icon('change-trains')}
                <span>${t('subway.change-to')} ${linePill(next.line, rail.lines[next.line].name)}</span>
            </div>`;
        const key = legKey(route, i);
        return html`${legCard(rail, leg, next, now, level, tomorrow, route.legs.length > 1, key, Boolean(stations[key]))}${connector}`;
    });
    // Walks at the ends: to where the first leg leaves, and on from where the last gets off to `to`
    const walkFirst = route.walkFirst && walkTo(rail, route.legs[0].from, route.walkFirst);
    const walkLast = route.walkLast && walkTo(rail, to, route.walkLast);
    if (!closed) return html`${header}${walkFirst}${cards}${walkLast}`;
    // A native disclosure: a button for screen readers and the keyboard
    const key = routeKey(route);
    return html`${header}<details class="route-details" data-route="${key}"${open[key] && html` open`}>
        <summary class="route-slower">${icon('more', 'route-chevron')}<span class="route-show">${t('subway.show-route')}</span><span class="route-hide">${t('subway.hide-route')}</span><span>· ${closed}</span></summary>
        ${walkFirst}${cards}${walkLast}
    </details>`;
}

// tomorrow: the plans are for tomorrow's first trains (planTrip in network.js)
// open: { [routeKey]: true/false }, options the user opened or closed
// stations: { [legKey]: true }, legs whose stations the user opened
// legend: whether the legend is open (legendOpen() in metro.js)
// lifts: the lifts out of service (watchLifts() in /js/core/lifts.js), or null
// liftsOpen: whether their notice is open (liftsOpen() in metro.js)
// to: where the trip ends, for a walk there from the last leg
export function renderResult(rail, plans, now, { expired, tomorrow = false, open = {}, stations = {}, legend = true, lifts = null, liftsOpen = true, to = null }) {
    if (!plans.length) return renderMessage('subway.no-route');
    const liftsNotice = liftNotice(lifts, tripStations(plans), id => stationName(rail, id), tripGaps(rail, plans), liftsOpen);
    const oldNotice = expired && notice('warn', 'warning', format(t('subway.timetable-old'), { date: formatDate(rail.feed.validTo) }), 'timetable-notice mb-3');
    const tomorrowNotice = tomorrow && notice('info', 'night', t('subway.tomorrow'), 'tomorrow-notice mb-3');
    const times = plans.map(r => tripTime(rail, r, now));
    const first = Math.min(...times.map(time => time ? Math.floor(time.arrives / 60) : Infinity));
    // Minutes after the first option, as the clock times shown differ. One
    // that misses its connection tonight (timed on tomorrow's trains) says so.
    const closed = (r, time) => {
        const slower = time ? Math.floor(time.arrives / 60) - first : 0;
        if (slower <= SLOWER_MINUTES) return '';
        return r.arrives === null && plans[0].arrives !== null ? t('subway.no-connection') : formatHtml(t('subway.slower'), { min: minutesMark(slower) });
    };
    const routes = plans.map((r, i) => html`${i > 0 && html`<hr class="route-divider">`}${routeBlock(rail, r, i, plans.length, now, tomorrow, { time: times[i], closed: closed(r, times[i]), open, stations, to })}`);
    // What the trains above show, in words: every symbol in any of them
    const symbols = [...new Set(plans.flatMap(r => r.legs.map((leg, i) => legPositions(rail, leg, r.legs[i + 1] ?? null)))
        .filter(where => where.exits.length).flatMap(diagramSymbols))];
    return html`${liftsNotice}${oldNotice}${tomorrowNotice}
        <div class="routes-wrap">${routes}</div>
        ${symbols.length > 0 && diagramLegend(symbols, t, legend)}
        <p class="schedule-disclaimer">${icon('info', 'me-1')}${t('subway.schedule-disclaimer')}</p>`;
}

// What the planner shows, as bullets under the intro
const INTRO_POINTS = ['subway.intro-trains', 'subway.intro-arrival', 'subway.intro-carriage', 'subway.intro-changes', 'subway.intro-access'];

// Before there are two stations: what the page does, in a sentence, and
// what the trains will show (every symbol any stop has). legend: whether
// it's open (legendOpen() in metro.js). With one station picked
// (`picked`), its lifts out of service (`lifts`) and platforms with steps only, if any,
// their notice open or not (`liftsOpen`).
export function renderIntro(rail, legend = true, lifts = null, picked = [], liftsOpen = true) {
    const stops = Object.values(rail.lines).flatMap(line => Object.values(line.directions)).flatMap(direction => direction.stops);
    const symbols = [...new Set(stops.filter(stop => stop.exits.length).flatMap(diagramSymbols))];
    const gaps = stepFreeGaps(rail, picked.flatMap(id => stationPlatforms(rail, id)));
    return html`${liftNotice(lifts, picked, id => stationName(rail, id), gaps, liftsOpen)}<div class="subway-intro"><p>${t('subway.intro')}</p>
        <ul>${INTRO_POINTS.map(key => html`<li>${t(key)}</li>`)}</ul></div>
        ${symbols.length > 0 && diagramLegend(symbols, t, legend)}`;
}

// Why there's no trip to show, in the same yellow as the other warnings
export function renderMessage(key) {
    return notice('warn', 'warning', t(key), 'subway-message mt-3');
}

// Two stops a short walk apart: no ride to show, only the walk
export const walkOnly = minutes => format(t('subway.walk-only'), { minutes });
export const renderWalkOnly = minutes => notice('info', 'walk', walkOnly(minutes), 'subway-message mt-3');

// A one-sentence version of the result for screen readers, announced when the
// stations change (the result itself isn't a live region: it refreshes every 30 s).
// Plain text, for textContent. Then the platforms with steps only and the
// lifts out of service on the way, if any.
export function routeSummary(rail, plans, now, tomorrow = false, lifts = null) {
    if (!plans.length) return t('subway.no-route');
    const leg = plans[0].legs[0];
    const line = rail.lines[leg.line];
    const toward = stationName(rail, lineEnd(rail, leg.line, leg.dir));
    const first = leg.departures[0];
    const when = !first ? ''
        : asClock(leg.departures, now, tomorrow) ? `, ${t('subway.schedule-at').toLowerCase()} ${clockTime(first.departs)}`
        : `, ${t('subway.schedule-in').toLowerCase()} ${Math.max(0, Math.floor((first.departs - now.seconds) / 60))} ${t('subway.minutes')}`;
    const options = plans.length > 1 ? `${plans.length} ${t('subway.options')}. ${t('subway.option')} 1: ` : '';
    const time = tripTime(rail, plans[0], now);
    const total = time ? ` ${t('subway.arrive')} ${t('subway.about')} ${clockTime(time.arrives)}, ${time.minutes} ${t('subway.minutes')}.` : '';
    const access = liftSummary(lifts, tripStations(plans), id => stationName(rail, id), tripGaps(rail, plans));
    const walk = plans[0].walkFirst ? `${format(t('subway.walk-to'), { station: stationName(rail, leg.from) })}, ${t('subway.about')} ${plans[0].walkFirst} ${t('subway.minutes')}. ` : '';
    return `${tomorrow ? `${t('subway.tomorrow')} ` : ''}${options}${walk}${line.name} ${t('subway.toward')} ${toward}${when}.${total}${access ? ` ${access}` : ''}`;
}
