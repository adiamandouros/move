import { externalLink, format, formatHtml, html, icon, localName, notice, walkingUrl } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { liftNotice, liftSummary, metroStations, ridePlatforms, stepFreeGaps } from '/js/core/lifts.js';
import { busPlate, linePill, pillList } from '/js/core/lines.js';
import { clockTime, diagramLegend, diagramSymbols } from '/js/core/metro.js';
import { latinName } from '/js/core/text.js';
import { aboutTime, minutesBadge, minutesMark, minutesWords } from '/js/core/times.js';
import { legPositions } from '/tools/subway/network.js';
import { arrivalRows, headerBadge, nextBus, stopRow } from '/tools/buses/render.js';
import { legCard } from '/tools/subway/render.js';
import { asLate, wayLegs } from './legs.js';

const stationName = (rail, id) => localName(rail.stations[id].name, language);
// A stop of the city's search (buses.js): a station by its name, a bus stop
// in Greek, or in Latin letters where OASA's English is just that
const ON_THE_ROAD = new Set(['bus', 'trolley']);
const stopName = (rail, stop) => stop.station ? stationName(rail, stop.station) : cityName(stop.names);
const cityName = names => localName({ el: names.el, en: names.en || latinName(names.el) }, language);

// What a place found is called, with its house number
export const placeTitle = found => found.n ? `${found.name} ${found.n}` : found.name;

// How exact a place found is, in words, or null when there's nothing to say.
// warn: only the street is known. The answer is only as good as the map.
export function howExact(found) {
    if (found.type === 'place') {
        const kind = { metro: 'trip.kind-metro', tram: 'trip.kind-tram', airport: 'trip.kind-airport' }[found.placeKind];
        return kind ? { words: t(kind) } : null;
    }
    if (found.n === null) return null;
    if (found.kind === 'between') return { words: format(t('trip.exact-between'), { lo: found.lo, hi: found.hi }) };
    if (found.kind === 'beyond') return { words: format(t('trip.exact-beyond'), { near: found.near }) };
    if (found.kind === 'nearest') return { words: format(t('trip.exact-nearest'), { near: found.near }) };
    if (found.kind === 'street') return { words: t('trip.exact-street'), warn: true };
    return null;
}

function exactLine(found) {
    const exact = howExact(found);
    return exact && html`<span class="trip-exact${exact.warn ? ' trip-exact-warn' : ''}">${exact.words}</span>`;
}

// One place found, as a row of the list
export function placeOption(found, index, rail, listId) {
    const lines = found.placeKind === 'metro' ? found.lineNames : [];
    return html`<li id="${listId}-${index}" role="option" aria-selected="false" class="suggestion-item" tabindex="-1" data-index="${index}">
        <span class="suggestion-names">
            <span class="suggestion-name-gr">${placeTitle(found)}</span>
            ${found.town && html`<span class="suggestion-name-en">${found.town}</span>`}
            ${exactLine(found)}
        </span>
        ${lines.length > 0 && html`<span class="suggestion-lines" aria-hidden="true">${lines.map(line => linePill(line, rail.lines[line]?.name ?? line, 's'))}</span>`}
    </li>`;
}

function distance(meters) {
    const rounded = Math.round(meters / 50) * 50;
    return rounded < 1000 ? format(t('trip.walk-meters'), { meters: rounded }) : format(t('trip.walk-km'), { km: (rounded / 1000).toFixed(1) });
}

// A walk's minutes, an estimate: "~16'"
const walkMinutes = minutes => minutesMark(minutes, t, { about: true });

// One step of a way: on the left a ride's clock time, strong, or a walk's
// minutes, quiet (when, and how long); then what to do; and at the far right,
// for a walk, its walking directions
const step = (when, content, { leaves = false, directions = null } = {}) =>
    html`<li class="trip-step"><span class="trip-step-when${leaves ? ' trip-step-leaves' : ''}">${when}</span><div class="trip-step-what">${content}</div>${directions}</li>`;

// Walking directions to `place`, `name`, as on a bus stop's row (DESIGN.md,
// "Walking directions"): the walking figure, the words for screen readers
const directionsTo = (place, name) => externalLink({ class: 'directions-btn d-flex align-items-center justify-content-center', href: walkingUrl(place.lat, place.lng) },
    html`${icon('walk')}<span class="sr-only">${format(t('trip.walking-directions-to'), { place: name })}</span>`, t('shell.new-tab'));

// A walk to `place`, `name`: from the door, or between two stations or stops,
// whose minutes are the tram's walks (decision 28) and have no distance.
// note: what the way needs saying, a suburban station's change (decision 41)
function walkStep(walk, name, place, note = null) {
    return step(walkMinutes(walk.minutes), html`<div>${format(t('trip.walk-to'), { place: name })}</div>
        ${walk.meters !== undefined && html`<div class="trip-step-note">${distance(walk.meters)}</div>`}
        ${note && html`<div class="trip-step-note">${localName(note, language)}</div>`}`, { directions: directionsTo(place, name) });
}

// A ride's heading: its line and where it goes, then its badges at the right end
/** @param {unknown} line @param {string | false} toward @param {unknown} [badges] */
const rideHead = (line, toward, badges = '') => html`<div class="trip-step-head"><span>${line}${toward && html` ${format(t('trip.towards'), { end: toward })}`}</span>${badges}</div>`;

// A metro, tram or suburban ride: the Subway page's card in its place, with
// nothing on the left (decisions 46 and 47). Its badges count from `now`
// (seconds from the midnight its trains count from), clock times for the
// morning's first trains; it says its ride's minutes always, as the trip's
// are door to door; its stations on the way are open as the rider left them
// (`stations`, by the leg's key)
function railCard(rail, { leg, next }, now, morning, stations) {
    const key = `${leg.line}/${leg.dir}/${leg.from}/${leg.to}`;
    return html`<li class="trip-leg">${legCard(rail, leg, next, { seconds: now }, 3, morning, true, key, Boolean(stations[key]))}</li>`;
}

// Under the way shown in full, what its trains show, in words: only the
// symbols they show, open as the rider last left a legend (`open`, DESIGN.md
// "Icons"). `when`: the cards' trains' (legs.js)
function legend(rail, o, when, open) {
    const symbols = [...new Set(wayLegs(rail, o, when).filter(Boolean)
        .map(({ leg, next }) => legPositions(rail, leg, next))
        .filter(where => where.exits.length).flatMap(diagramSymbols))];
    return symbols.length > 0 && diagramLegend(symbols, t, open);
}

const stationPlace = (rail, id) => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1] });
const walkToStation = (rail, id, minutes) => walkStep({ minutes }, stationName(rail, id), stationPlace(rail, id));

// The walk to where the first ride leaves: to the station, and on to a stop
// beside it, if the trip starts there
const walkToFirst = o => o.city ? o.firstWalk?.minutes ?? 0 : (o.start.walk?.minutes ?? 0) + (o.plan.walkFirst ?? 0);
export const hasBus = o => o.city && o.rides.some(ride => ON_THE_ROAD.has(ride.mode));
// A way with a suburban train (decision 41), whose times come from railway.gov.gr
export const hasTrain = o => o.city && o.rides.some(ride => ride.mode === 'suburban');

// Whole minutes from `now` to `at` (seconds from midnight), as a live time counts down
const minutesTo = (at, now) => Math.max(0, Math.floor((at - now) / 60));

// Past an hour, a bus's minutes are no use: its clock time says it
const HOUR_MINUTES = 60;

// A bus's badge and the next one's, at the right end of its heading
// (DESIGN.md, "The Trip page"): OASA's when it has the bus coming (decision
// 35), marked trip-live, or else the timetable's, counted from `now`
function busBadges(ride, now) {
    const live = ride.live && 'at' in ride.live ? ride.live : null;
    const soon = [live ? live.at : ride.boards, (live ? live.next : ride.next) ?? null]
        .filter(at => at !== null)
        .map(at => minutesTo(at, now))
        .filter(minutes => minutes < HOUR_MINUTES);
    return soon.length > 0 && html`<span class="trip-step-badges${live ? ' trip-live' : ''}">${soon.map((minutes, i) => minutesBadge(minutes, t, { said: i ? t('trip.next-in') : undefined }))}</span>`;
}

// A bus ride of a way, or a suburban train's until its card can be drawn
// (legs.js): a bus's time is the timetable's, an estimate (decision 11), so
// it says "~", unless OASA has the bus coming (decision 35); its badge and
// the next one's beside its heading. A train's is when it actually leaves,
// as late as it runs, `trains` by number (decision 47); one to or from a
// station OASA's ticket doesn't cover says it needs Hellenic Train's
// (decision 41). `now`: seconds from midnight, for the minutes
function rideStep(rail, ride, { now, trains }) {
    const bus = ON_THE_ROAD.has(ride.mode);
    const place = stopName(rail, ride.alight);
    const live = ride.live && 'at' in ride.live;
    const beyond = [ride.board, ride.alight].find(stop => stop.oasaTicket === false);
    return step(!bus ? clockTime(asLate(trains, ride.train, ride.timetable)) : live ? clockTime(ride.boards) : aboutTime(clockTime(ride.boards), t), html`
        ${rideHead(pill(rail, ride), ride.lines.length === 1 && cityName(ride.toward), bus && busBadges(ride, now))}
        ${ride.live && 'none' in ride.live && html`<div class="trip-step-note">${t('trip.live-none')}</div>`}
        <div class="trip-step-note">${ride.stops === 1 ? format(t('trip.stop'), { place }) : format(t('trip.stops'), { count: ride.stops, place })}</div>
        ${beyond && html`<div class="trip-step-note">${format(t('trip.train-ticket'), { station: stopName(rail, beyond) })}</div>`}`, { leaves: true });
}
// A rail line's pill: the metro's and the tram's are in rail.json; the
// suburban railway's are named as their ids, A1 to A4 (decision 41). Medium,
// as in a heading or a sentence (DESIGN.md)
const railPill = (rail, line, mode) => linePill(line, mode === 'suburban' ? line : rail.lines[line].name, 'm');
// Every bus line that rides it, the first to come first
const pill = (rail, ride) => ON_THE_ROAD.has(ride.mode) ? pillList(ride.lines.map(line => busPlate(line, 'm'))) : railPill(rail, ride.line, ride.mode);

// How many of the stops a way's last bus can be caught at are shown before
// "N more stops"
const STOPS_SHOWN = 3;

// The stops a way's last bus can be caught at, nearest first: any of them
// will do, so no time by the clock (decision 33). With OASA's live times
// (decision 35), those with a bus the rider can catch first, by when it
// comes. Each is the Buses page's stop row (decision 48): the walk to it
// beside its code, the next bus of the rider's lines, and opened, every bus
// of them the rider can catch there; not yet on live times, its lines.
// `change`: after a ride, rather than from the door. `now`: seconds from
// midnight, for the minutes; `opened`: the stops the rider opened, by code
function busStops(rail, stops, change, now, opened) {
    const stopStep = ({ stop, walk, lines, buses = null, arrivals = [] }, i) => {
        const code = stop.id.slice('bus:'.length);
        const name = stopName(rail, stop);
        const plates = size => pillList(lines.map(line => busPlate(line, size)));
        // As the Buses page has a stop's answer, each bus's minutes from now
        const result = { arrivals: arrivals.map(bus => ({ line: bus.line, to: bus.to, minutes: minutesTo(bus.at, now) })) };
        // With none of them on OASA's live times, its lines, and that it has none
        const next = arrivals.length ? nextBus(result) : html`<span class="sr-only">. ${t('buses.lines')}: </span>${plates('m')}${buses && html`<span class="next-bus-dest text-body-secondary fst-italic"><span class="sr-only">. </span>${t('trip.live-none')}</span>`}`;
        // Marked trip-live with buses from OASA's live times, as a ride's badges are
        return html`<li class="trip-stop${arrivals.length ? ' trip-live' : ''}">${stopRow({ code, name: { el: name, en: name }, lat: stop.lat, lng: stop.lng }, i, {
            id: 'trip-stop', star: false, open: opened?.has(code) ?? false,
            away: walk && html`<span class="sr-only">, </span>${minutesMark(walk.minutes, t, { about: true, said: t('trip.walk-short') })}`,
            next, badge: headerBadge(result), arrivals: arrivals.length > 0 && arrivalRows(result), lines: plates('s'),
            heard: format(t('trip.stop-buses'), { stop: name }),
        })}</li>`;
    };
    const more = stops.slice(STOPS_SHOWN);
    return html`<li>${t(change ? 'trip.any-bus-then' : 'trip.any-bus')}</li>
        ${stops.slice(0, STOPS_SHOWN).map(stopStep)}
        ${more.length > 0 && html`<li><details class="trip-more">
            <summary>${format(t(more.length === 1 ? 'trip.more-stop' : 'trip.more-stops'), { count: more.length })}</summary>
            <ol class="trip-steps">${more.map((stop, i) => stopStep(stop, STOPS_SHOWN + i))}</ol>
        </details></li>`}`;
}

// A way of the city's search, step by step: its walks and rides, and for a
// way of the half hour whose last bus can be any of several, the stops.
// live: the way timed with OASA's live times (buses.js liveWay). `drawn`:
// `now`, seconds from midnight, for the minutes; the weekday and date, and
// how late the trains run when the way is timed with it, for its trains
// (legs.js); `stations`: the cards' stations on the way the rider opened;
// `stops`: the bus stops they opened
function citySteps(rail, o, to, drawn, row = null, live = null) {
    const walkTo = (walk, stop, note = null) => walk && walkStep(walk, stopName(rail, stop), stop, note);
    const rides = row?.bundle ? o.rides.slice(0, -1) : o.rides;
    const cards = wayLegs(rail, o, drawn);
    return html`<ol class="trip-steps">
        ${rides.length > 0 && walkTo(o.firstWalk, o.rides[0].board)}
        ${rides.map((ride, i) => html`${i > 0 && walkTo(ride.walkBefore, ride.board, ride.walkNote)}${cards[i] ? railCard(rail, cards[i], drawn.now, false, drawn.stations) : rideStep(rail, ride, drawn)}`)}
        ${row?.bundle && busStops(rail, live?.way.stops ?? row.stops, rides.length > 0, drawn.now, drawn.stops)}
        ${o.lastWalk && walkStep(o.lastWalk, to.title, to)}
    </ol>`;
}

// How long a way takes, door to door: "~25'"
const totalMinutes = o => minutesMark(o.minutes, t, { about: true });

// A way of the city's search, step by step
function cityCard(rail, o, to, drawn) {
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            <h2 class="trip-total">${totalMinutes(o)}</h2>
            <span class="trip-arrives">${format(t('trip.arrive'), { time: clockTime(o.arrives) })}</span>
        </div>
        ${citySteps(rail, o, to, drawn)}
    </div>`;
}

function when(o) {
    const time = clockTime(o.arrives);
    if (!o.morning) return format(t('trip.arrive'), { time });
    const leave = clockTime(o.plan.legs[0].departures[0].departs - walkToFirst(o) * 60);
    return format(t('trip.morning'), { leave, time });
}

// The best way, step by step. `drawn`: when, and the stations on the way
// the rider opened (citySteps)
function tripCard(rail, o, to, drawn) {
    if (o.city) return cityCard(rail, o, to, drawn);
    const cards = wayLegs(rail, o, drawn);
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            ${!o.morning && html`<h2 class="trip-total">${totalMinutes(o)}</h2>`}
            <span class="trip-arrives">${when(o)}</span>
        </div>
        <ol class="trip-steps">
            ${o.start.walk && walkStep(o.start.walk, stationName(rail, o.start.station), stationPlace(rail, o.start.station))}
            ${o.plan.walkFirst && walkToStation(rail, o.plan.legs[0].from, o.plan.walkFirst)}
            ${o.plan.legs.map((leg, i) => {
                const before = o.plan.legs[i - 1];
                return html`${before && before.to !== leg.from && walkToStation(rail, leg.from, rail.walks[before.to][leg.from])}${railCard(rail, cards[i], drawn.now - o.dayStart, o.morning, drawn.stations)}`;
            })}
            ${o.plan.walkLast && walkToStation(rail, o.end.station, o.plan.walkLast)}
            ${o.end.walk && walkStep(o.end.walk, to.title, to)}
        </ol>
    </div>`;
}

// The walk to where a way's first ride leaves, on its line: "Walk ~5'"
const walkShort = o => formatHtml(t('trip.walk-short'), { minutes: walkMinutes(walkToFirst(o)) });

// Another way, on one line
function otherCard(rail, o) {
    const pills = o.city ? o.rides.map(ride => pill(rail, ride)) : o.plan.legs.map(leg => linePill(leg.line, rail.lines[leg.line].name, 'm'));
    const from = o.city ? stopName(rail, o.rides[0].board) : stationName(rail, o.plan.legs[0].from);
    return html`<div class="trip-card">
        <div class="trip-card-head">
            ${!o.morning && html`<h3 class="trip-total trip-total-small">${totalMinutes(o)}</h3>`}
            <span class="trip-arrives">${when(o)}</span>
        </div>
        <p class="trip-other">${walkToFirst(o) > 0 && html`${walkShort(o)} · `}${pills} ${format(t('trip.from-station'), { station: from })}</p>
    </div>`;
}

function walkCard(walk, to) {
    return html`<div class="trip-card">
        <div class="trip-card-head"><h2 class="trip-total">${formatHtml(t('trip.on-foot'), { minutes: walkMinutes(walk.minutes) })}</h2></div>
        <p class="trip-other">${t('trip.walk-quicker')}</p>
        ${externalLink({ href: walkingUrl(to.lat, to.lng) }, t('trip.walking-directions'), t('shell.new-tab'))}
    </div>`;
}

// For a screen reader, and for naming a card
export const routeSummary = o => format(t('trip.summary'), { minutes: minutesWords(o.minutes, t), time: clockTime(o.arrives) });

// Where a way's rides board and get off, by line and direction: a metro or
// tram ride's stations (a suburban train's stations and a bus's stops have
// no lift status or step-free data)
const wayPlatforms = o => ridePlatforms(o.city
    ? o.rides.filter(ride => ride.board.station && ride.alight.station).map(ride => ({ line: ride.line, dir: ride.dir, from: ride.board.station, to: ride.alight.station }))
    : o.plan.legs);

// For the step-free notice of the ways shown: their metro stations, for the
// lifts out of service there, and their platforms with steps only
function access(rail, ways) {
    const platforms = ways.flatMap(wayPlatforms);
    return { ids: metroStations(rail, platforms.map(p => p.station)), gaps: stepFreeGaps(rail, platforms) };
}

// Above the answer, after its messages, the step-free notice (DESIGN.md):
// every station the ways shown use that can't be reached step-free or has
// lifts out, and an error when the lift status is unavailable. lifts:
// watchLifts() in /js/core/lifts.js, or null; open: liftsOpen() in metro.js
function stepFree(rail, ways, lifts, open) {
    const { ids, gaps } = access(rail, ways);
    return liftNotice(lifts, ids, id => stationName(rail, id), gaps, open);
}

// The same in words, for a screen reader, after the answer's summary: '' when there's none
/** @param {import('../../../types/data.js').Rail} rail @param {any[]} ways @param {any} lifts */
export function stepFreeSummary(rail, ways, lifts) {
    const { ids, gaps } = access(rail, ways);
    return liftSummary(lifts, ids, id => stationName(rail, id), gaps);
}

// Above the answer, what it's missing (decision 43): the buses' times, or
// the suburban railway's for today (decision 41). An error; but a newer
// Wayhop waiting to take over ('updated', main.js) is how to read it, about
// the buses
function missing(noBuses, noTrains) {
    return html`${noBuses && (noBuses === 'updated' ? notice('info', 'bus', t('trip.updated'), 'mb-3') : notice('danger', 'error', t('trip.buses-error'), 'mb-3'))}
        ${noTrains && notice('danger', 'error', t('trip.no-trains-today'), 'mb-3')}`;
}

// The answer: what `doorToDoor` found, drawn, with nothing under it
// (decision 43) but the legend of what its trains show. noBuses: the buses'
// times couldn't be loaded, so it's by metro and tram alone; 'updated': nor
// the searches, with a newer Wayhop waiting to take over (main.js).
// noTrains: the suburban railway has no times for today. checking: the next
// half hour is being worked out, and may take its place (renderHalf). lifts,
// liftsOpen: for the step-free notice. `now`: seconds from midnight, for the
// minutes; `weekday` (0 = Sunday) and `date` in Athens, for the trains of
// the cards (legs.js), by the timetable, as this answer isn't timed with how
// late they run; stations: the cards' stations on the way the rider opened
// (by key); legend: whether the legend is open (legendOpen() in metro.js).
// `rail`: with the day's suburban trains joined for their cards (decision
// 47), or without them, when their rides are rows
/**
 * @param {import('../../../types/data.js').Rail} rail @param {ReturnType<typeof import('./plan.js').doorToDoor>} trip
 * @param {import('./plan.js').Place} to
 * @param {{ now: number, weekday: number, date: string, expired?: boolean, noBuses?: boolean | 'updated', noTrains?: boolean, checking?: boolean, lifts?: any, liftsOpen?: boolean, stations?: Record<string, boolean>, legend?: boolean }} shown
 */
export function renderTrip(rail, { options, walk, walkFirst, longWalk }, to, { now, weekday, date, expired = false, noBuses = false, noTrains = false, checking = false, lifts = null, liftsOpen = true, stations = {}, legend: legendShown = true }) {
    const [best, ...others] = options;
    const trainsStopped = best?.morning;
    const drawn = { now, weekday, date, stations };
    return html`
        ${missing(noBuses, noTrains)}
        ${expired && notice('warn', 'warning', t('trip.timetable-ended'), 'mb-3')}
        ${trainsStopped && notice('info', 'night', t('trip.no-trains'), 'mb-3')}
        ${stepFree(rail, options, lifts, liftsOpen)}
        ${walkFirst && !trainsStopped && walkCard(walk, to)}
        ${best && (walkFirst && !trainsStopped
            ? html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>${otherCard(rail, best)}`
            : html`${tripCard(rail, best, to, drawn)}${legend(rail, best, drawn, legendShown)}`)}
        ${checking && html`<p class="trip-other" id="trip-checking">${t('trip.half-checking')}</p>`}
        ${longWalk && !walkFirst && longWalkNotice()}
        ${others.length > 0 && !(walkFirst && !trainsStopped) && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}
        ${others.map(o => otherCard(rail, o))}`;
}

const longWalkNotice = () => notice('info', 'bus', html`${t('trip.long-walk')} <a href="${localHref('/buses')}">${t('trip.look-for-buses')}</a>`, 'mb-3');

// ── The next half hour's answer (decision 33) ───────────────────────────────

// A departure tried up to a minute ago still counts: the page redraws each minute
const LATE_SECONDS = 60;

// A way's minutes over the half hour, the quickest and slowest tenth left
// out: "16–19'", or as a way's total when they're the same, "~17'"; and in
// words, for a screen reader
/** @param {{ range: [number, number] }} row @returns {import('/js/core/times.js').Minutes} */
const rangeOf = ({ range: [low, high] }) => low === high ? low : [low, high];
const rangeMark = row => minutesMark(rangeOf(row), t, { about: !Array.isArray(rangeOf(row)) });
export const rangeText = row => minutesWords(rangeOf(row), t, !Array.isArray(rangeOf(row)));

// Each way the half hour's answer shows, as it is for the next departure
// tried at `now` (seconds from midnight) or the first after it that has it,
// and which departure that is
/** @param {import('./buses.js').HalfView} view @param {number} now */
export function halfWays(view, now) {
    const next = view.departures.findIndex(at => at >= now - LATE_SECONDS);
    if (next < 0) return [];
    return view.rows.map(row => {
        const departure = row.options.findIndex((o, d) => d >= next && o);
        return { row, o: row.options[departure], departure };
    }).filter(({ o }) => o);
}

// The way the half hour stands for, step by step, with its range. best: it's
// the clear way. live: the way timed with OASA's live times, in its place.
// taken: it's the quicker way the rider took, with the way back to the
// directions. The heading can take the keyboard after a choice (main.js).
// `drawn`: when, and the stations on the way the rider opened (citySteps)
function halfCard(rail, { row, o }, to, drawn, best, live, taken = false) {
    const shown = live?.way.option ?? o;
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            <h2 class="trip-total" tabindex="-1">${rangeMark(row)}</h2>
            ${best && html`<span class="trip-arrives">${t('trip.half-best')}</span>`}
            ${taken && html`<span class="trip-arrives">${t('trip.quicker-taken')}</span>`}
        </div>
        ${citySteps(rail, shown, to, drawn, row, live)}
        ${taken && html`<button type="button" id="trip-quicker-back" class="btn btn-sm locate-btn trip-stand">${t('trip.quicker-back')}</button>`}
    </div>`;
}

// A line in a sentence: a train's pill or a bus's plate
const linePlate = (rail, { line, mode }) => ON_THE_ROAD.has(mode) ? busPlate(line, 'm') : railPill(rail, line, mode);

// How much sooner the quicker way gets there: its heading, and in words for a screen reader
/** @param {import('./buses.js').Offer} offer */
const quickerTitle = offer => formatHtml(t('trip.quicker-title'), { minutes: minutesMark(Math.floor(offer.sooner / 60), t) });
/** @param {import('./buses.js').Offer} offer */
export const quickerSummary = offer => format(t('trip.quicker-title'), { minutes: minutesWords(Math.floor(offer.sooner / 60), t) });

// The quicker way offered on a decision (decision 36), under the directions,
// as OASA has its bus coming in time: how much sooner, where to get off the
// first ride for which bus, and the rider's choice. The directions stay as
// they are unless it's taken
/** @param {import('./buses.js').Offer} offer */
function quickerCard(rail, offer) {
    const off = formatHtml(t(offer.ride.mode === 'metro' ? 'trip.quicker-off-station' : 'trip.quicker-off'), {
        ride: linePlate(rail, offer.ride), change: stopName(rail, offer.change),
    });
    const bus = formatHtml(t(offer.walk ? 'trip.quicker-bus' : 'trip.quicker-bus-here'), {
        bus: busPlate(offer.line, 'm'), stop: stopName(rail, offer.stop), time: clockTime(offer.at), minutes: offer.walk && walkMinutes(offer.walk.minutes),
    });
    return html`<div class="trip-card" id="trip-quicker">
        <h2 class="trip-total trip-total-small">${quickerTitle(offer)}</h2>
        <p class="trip-quicker-what">${off} ${bus}</p>
        <div class="trip-quicker-actions">
            <button type="button" id="trip-quicker-take" class="btn btn-primary btn-sm rounded-pill px-4">${t('trip.quicker-take')}</button>
            <button type="button" id="trip-quicker-keep" class="btn btn-sm locate-btn">${t('trip.quicker-keep')}</button>
        </div>
    </div>`;
}

// Another way of the half hour, on one line: a last bus that can be any of
// several shows them all, and one caught from the door says so
function halfOther(rail, { row, o }) {
    const rides = row.bundle ? o.rides.slice(0, -1) : o.rides;
    const pills = [...rides.map(ride => pill(rail, ride)), row.bundle && pillList(row.lines.map(line => busPlate(line, 'm')))];
    const fromDoor = row.bundle && !rides.length;
    return html`<div class="trip-card">
        <div class="trip-card-head"><h3 class="trip-total trip-total-small">${rangeMark(row)}</h3></div>
        <p class="trip-other">${!fromDoor && walkToFirst(o) > 0 && html`${walkShort(o)} · `}${pills} ${fromDoor ? t('trip.from-stops-nearby') : format(t('trip.from-station'), { station: stopName(rail, o.rides[0].board) })}</p>
    </div>`;
}

// The quicker way the rider took, for the departure shown: as OASA's live
// times have it, or until they do, the half hour's own for that departure or
// the first after it
/** @param {import('./buses.js').HalfRow} row @param {number} departure */
const takenOption = (row, departure) => row.options.find((o, d) => d >= departure && o) ?? row.options.find(Boolean);

// The next half hour's answer, in place of the answer for leaving now: the
// way it stands for first (the clear way, the directions that stay on, or
// the first by the weights when it depends), then the others. `ways`: from
// halfWays. longWalk: the first way's walk at either end is a long one.
// live: the first way timed with OASA's live times, in its place (decision
// 35). On a decision (decision 36): with `offer`, the quicker way the live
// times have, under the directions; or `taken`, the quicker way's row, when
// the rider took it: in their place. noTrains: the suburban railway has no
// times for today (decision 41). lifts, liftsOpen: for the step-free notice,
// of every way shown. `trains`: how late the suburban trains run, by number,
// when the first way is timed with it (live), for its cards' badges
// (decision 47). `stops`: the bus stops the rider opened, by code (decision
// 48). `rail`, `now`, `weekday`, `date`, stations, legend: as
// renderTrip's. Nothing under it (decision 43) but the legend of what its
// trains show
export function renderHalf(rail, kind, ways, to, { now, weekday, date, expired = false, longWalk = false, live = null, offer = false, taken = null, noTrains = false, trains = null, lifts = null, liftsOpen = true, stations = {}, stops = new Set(), legend: legendShown = true }) {
    const [first, ...rest] = ways;
    const others = taken ? rest.filter(({ row }) => row !== taken) : rest;
    // The first card's way, as halfCard shows it
    const shown = live?.way.option ?? (taken ? takenOption(taken, first.departure) : first.o);
    const drawn = { now, weekday, date, trains: live && trains, stations, stops };
    return html`
        ${missing(false, noTrains)}
        ${expired && notice('warn', 'warning', t('trip.timetable-ended'), 'mb-3')}
        ${stepFree(rail, [shown, ...others.map(way => way.o)], lifts, liftsOpen)}
        ${kind === 'depends' && html`<p class="trip-intro">${t('trip.half-depends-intro')}</p>`}
        ${taken
            ? halfCard(rail, { row: taken, o: takenOption(taken, first.departure) }, to, drawn, false, live, true)
            : halfCard(rail, first, to, drawn, kind === 'clear', live)}
        ${offer && live?.way.offer && quickerCard(rail, live.way.offer)}
        ${legend(rail, shown, drawn, legendShown)}
        ${longWalk && longWalkNotice()}
        ${others.length > 0 && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}
        ${others.map(way => halfOther(rail, way))}`;
}

// What's said of the live times above the answer (live.js liveStatus), as on
// the Buses page: an error when the buses' or the trains' can't be had
// (decision 43); paused, with a button that asks again
/** @param {ReturnType<typeof import('./live.js').liveStatus>} status */
export function liveNotice(status) {
    if (status === 'paused') return notice('warn', 'warning', html`${t('trip.live-paused')} <button type="button" class="btn btn-link btn-sm p-0 align-baseline">${t('trip.live-resume')}</button>`);
    if (status === 'unavailable') return notice('danger', 'error', t('trip.live-unavailable'));
    if (status === 'trains-unavailable') return notice('danger', 'error', t('trip.trains-live-unavailable'));
    if (status === 'all-unavailable') return notice('danger', 'error', t('trip.all-live-unavailable'));
    if (status === 'stale') return notice('warn', 'warning', t('trip.live-stale'));
    return '';
}

// What's been chosen, above the answer
export function renderChosen(from, to) {
    const place = (label, chosen) => html`<div>
        <div class="route-option-label">${label}</div>
        <div class="trip-place-name">${chosen.title}</div>
        ${chosen.exact && html`<div class="trip-step-note">${chosen.exact}</div>`}
    </div>`;
    return html`<div class="trip-places">
        ${place(t('trip.from'), from)}
        ${place(t('trip.to'), to)}
        <button id="trip-change" type="button" class="btn btn-sm locate-btn">${t('trip.change')}</button>
    </div>`;
}
