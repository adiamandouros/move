import { externalLink, format, formatHtml, html, localName, notice, walkingUrl } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { busPlate, linePill, pillList } from '/js/core/lines.js';
import { clockTime, lineEnd } from '/js/core/metro.js';
import { latinName } from '/js/core/text.js';
import { soonTier, timeBadge } from '/js/core/times.js';

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

const step = (when, content) => html`<li class="trip-step"><span class="trip-step-when">${when}</span><div class="trip-step-what">${content}</div></li>`;

// A walk to `place`: from the door, or between two stations or stops, whose
// minutes are the tram's walks (decision 28) and have no distance. note: what
// the way needs saying, a suburban station's change (decision 41)
function walkStep(walk, words, place, note = null) {
    return step(`${walk.minutes}′`, html`${externalLink({ href: walkingUrl(place.lat, place.lng) }, words, t('shell.new-tab'))}
        ${walk.meters !== undefined && html`<div class="trip-step-note">${distance(walk.meters)}</div>`}
        ${note && html`<div class="trip-step-note">${localName(note, language)}</div>`}`);
}

function legStep(rail, leg) {
    const stops = leg.toIndex - leg.fromIndex;
    const place = stationName(rail, leg.to);
    const end = stationName(rail, lineEnd(rail, leg.line, leg.dir));
    return step(clockTime(leg.departures[0].departs), html`
        <div>${linePill(leg.line, rail.lines[leg.line].name, 's')} ${format(t('trip.towards'), { end })}</div>
        <div class="trip-step-note">${stops === 1 ? format(t('trip.stop'), { place }) : format(t('trip.stops'), { count: stops, place })}</div>`);
}

const stationPlace = (rail, id) => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1] });
const walkToStation = (rail, id, minutes) => walkStep({ minutes }, format(t('trip.walk-to'), { place: stationName(rail, id) }), stationPlace(rail, id));

// The walk to where the first ride leaves: to the station, and on to a stop
// beside it, if the trip starts there
const walkToFirst = o => o.city ? o.firstWalk?.minutes ?? 0 : (o.start.walk?.minutes ?? 0) + (o.plan.walkFirst ?? 0);
export const hasBus = o => o.city && o.rides.some(ride => ON_THE_ROAD.has(ride.mode));
// A way with a suburban train (decision 41), whose times come from railway.gov.gr
export const hasTrain = o => o.city && o.rides.some(ride => ride.mode === 'suburban');

// Whole minutes from `now` to `at` (seconds from midnight), as a live time counts down
const minutesTo = (at, now) => Math.max(0, Math.floor((at - now) / 60));

// A bus OASA has coming, in its minutes, as on the Buses page (DESIGN.md, "Time badge")
function minutesBadge(at, now) {
    const minutes = minutesTo(at, now);
    const tier = soonTier(minutes);
    const label = format(t(tier === 'due' ? 'trip.live-soon' : 'trip.live-minutes'), { minutes });
    return timeBadge(tier, html`<span aria-hidden="true">${minutes}'</span><span class="sr-only">${label}</span>`);
}

// A ride of a way with a bus: a bus's time is the timetable's, an estimate
// (decision 11), so it says "~", unless OASA has the bus coming (decision
// 35): then its time, its minutes and the next one's. A suburban train to or
// from a station OASA's ticket doesn't cover says it needs Hellenic Train's
// (decision 41), and one whose lateness is known says it (trainLate). `now`:
// seconds from midnight, for the minutes
function rideStep(rail, ride, now) {
    const bus = ON_THE_ROAD.has(ride.mode);
    const place = stopName(rail, ride.alight);
    const live = ride.live && 'at' in ride.live ? ride.live : null;
    const beyond = [ride.board, ride.alight].find(stop => stop.oasaTicket === false);
    const caught = ride.late?.timetable !== undefined;
    return step((bus && !live) || caught ? `~${clockTime(ride.boards)}` : clockTime(ride.boards), html`
        <div>${pill(rail, ride)}${ride.lines.length === 1 && html` ${format(t('trip.towards'), { end: cityName(ride.toward) })}`}</div>
        ${ride.late && trainLate(ride.late)}
        ${live && html`<div class="trip-live">${minutesBadge(live.at, now)}${live.next !== null && html`<span class="trip-step-note">${format(t('trip.live-next'), { minutes: minutesTo(live.next, now) })}</span>`}</div>`}
        ${ride.live && 'none' in ride.live && html`<div class="trip-step-note">${t('trip.live-none')}</div>`}
        <div class="trip-step-note">${ride.stops === 1 ? format(t('trip.stop'), { place }) : format(t('trip.stops'), { count: ride.stops, place })}</div>
        ${beyond && html`<div class="trip-step-note">${format(t('trip.train-ticket'), { station: stopName(rail, beyond) })}</div>`}`);
}
// A rail line's pill: the metro's and the tram's are in rail.json; the
// suburban railway's are named as their ids, A1 to A4 (decision 41)
const railPill = (rail, line, mode) => linePill(line, mode === 'suburban' ? line : rail.lines[line].name, 's');
// Every bus line that rides it, the first to come first
const pill = (rail, ride) => ON_THE_ROAD.has(ride.mode) ? pillList(ride.lines.map(line => busPlate(line, 's'))) : railPill(rail, ride.line, ride.mode);

// How many of the stops a way's last bus can be caught at are shown before
// "N more stops"
const STOPS_SHOWN = 3;

// The stops a way's last bus can be caught at, nearest first, each with the
// walk to it and its lines: any of them will do, so no time by the clock
// (decision 33). With OASA's live times (decision 35), those with a bus the
// rider can catch first, by when it comes, each line with its minutes.
// `change`: after a ride, rather than from the door. `now`: seconds from
// midnight, for the minutes
function busStops(rail, stops, change, now) {
    const stopStep = ({ stop, walk, lines, buses = null }) => step(walk ? `${walk.minutes}′` : '', html`
        ${externalLink({ href: walkingUrl(stop.lat, stop.lng) }, stopName(rail, stop), t('shell.new-tab'))}
        ${buses?.length
            ? html`<div class="trip-live">${pillList([
                ...buses.map(bus => html`<span class="trip-live-bus">${busPlate(bus.line, 's')} ${minutesBadge(bus.at, now)}</span>`),
                ...lines.filter(line => !buses.some(bus => bus.line === line)).map(line => busPlate(line, 's')),
            ])}</div>`
            : html`<div>${pillList(lines.map(line => busPlate(line, 's')))}</div>`}
        ${buses?.length === 0 && html`<div class="trip-step-note">${t('trip.live-none')}</div>`}`);
    const more = stops.slice(STOPS_SHOWN);
    return html`${step('', t(change ? 'trip.any-bus-then' : 'trip.any-bus'))}
        ${stops.slice(0, STOPS_SHOWN).map(stopStep)}
        ${more.length > 0 && html`<li><details class="trip-more">
            <summary>${format(t(more.length === 1 ? 'trip.more-stop' : 'trip.more-stops'), { count: more.length })}</summary>
            <ol class="trip-steps">${more.map(stopStep)}</ol>
        </details></li>`}`;
}

// A way of the city's search, step by step: its walks and rides, and for a
// way of the half hour whose last bus can be any of several, the stops.
// live: the way timed with OASA's live times (buses.js liveWay), at `now`
function citySteps(rail, o, to, row = null, live = null) {
    const walkTo = (walk, stop, note = null) => walk && walkStep(walk, format(t('trip.walk-to'), { place: stopName(rail, stop) }), stop, note);
    const rides = row?.bundle ? o.rides.slice(0, -1) : o.rides;
    return html`<ol class="trip-steps">
        ${rides.length > 0 && walkTo(o.firstWalk, o.rides[0].board)}
        ${rides.map((ride, i) => html`${i > 0 && walkTo(ride.walkBefore, ride.board, ride.walkNote)}${rideStep(rail, ride, live?.now)}`)}
        ${row?.bundle && busStops(rail, live?.way.stops ?? row.stops, rides.length > 0, live?.now)}
        ${o.lastWalk && walkStep(o.lastWalk, format(t('trip.walk-to'), { place: to.title }), to)}
    </ol>`;
}

// A way with a bus, step by step: there's no "where to stand" for it yet
function cityCard(rail, o, to) {
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            <h2 class="trip-total">${format(t('trip.minutes'), { minutes: o.minutes })}</h2>
            <span class="trip-arrives">${format(t('trip.arrive'), { time: clockTime(o.arrives) })}</span>
        </div>
        ${citySteps(rail, o, to)}
    </div>`;
}

const standHref = (start, end) => `${localHref('/subway')}?${new URLSearchParams({ from: start.station, to: end.station })}`;

function when(o) {
    const time = clockTime(o.arrives);
    if (!o.morning) return format(t('trip.arrive'), { time });
    const leave = clockTime(o.plan.legs[0].departures[0].departs - walkToFirst(o) * 60);
    return format(t('trip.morning'), { leave, time });
}

// The best way, step by step. Where to stand is for the metro: a tram has
// no front or back
function tripCard(rail, o, to) {
    if (o.city) return cityCard(rail, o, to);
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            ${!o.morning && html`<h2 class="trip-total">${format(t('trip.minutes'), { minutes: o.minutes })}</h2>`}
            <span class="trip-arrives">${when(o)}</span>
        </div>
        <ol class="trip-steps">
            ${o.start.walk && walkStep(o.start.walk, format(t('trip.walk-to'), { place: stationName(rail, o.start.station) }), stationPlace(rail, o.start.station))}
            ${o.plan.walkFirst && walkToStation(rail, o.plan.legs[0].from, o.plan.walkFirst)}
            ${o.plan.legs.map((leg, i) => {
                const before = o.plan.legs[i - 1];
                return html`${before && before.to !== leg.from && walkToStation(rail, leg.from, rail.walks[before.to][leg.from])}${legStep(rail, leg)}`;
            })}
            ${o.plan.walkLast && walkToStation(rail, o.end.station, o.plan.walkLast)}
            ${o.end.walk && walkStep(o.end.walk, format(t('trip.walk-to'), { place: to.title }), to)}
        </ol>
        ${o.plan.legs.some(leg => !rail.lines[leg.line].tram) && html`<a class="btn btn-sm locate-btn trip-stand" href="${standHref(o.start, o.end)}">${t('trip.where-to-stand')}</a>`}
    </div>`;
}

// Another way, on one line
function otherCard(rail, o) {
    const pills = o.city ? o.rides.map(ride => pill(rail, ride)) : o.plan.legs.map(leg => linePill(leg.line, rail.lines[leg.line].name, 's'));
    const from = o.city ? stopName(rail, o.rides[0].board) : stationName(rail, o.plan.legs[0].from);
    return html`<div class="trip-card">
        <div class="trip-card-head">
            ${!o.morning && html`<h3 class="trip-total trip-total-small">${format(t('trip.minutes'), { minutes: o.minutes })}</h3>`}
            <span class="trip-arrives">${when(o)}</span>
        </div>
        <p class="trip-other">${walkToFirst(o) > 0 && html`${format(t('trip.walk-short'), { minutes: walkToFirst(o) })} · `}${pills} ${format(t('trip.from-station'), { station: from })}</p>
    </div>`;
}

function walkCard(walk, to) {
    return html`<div class="trip-card">
        <div class="trip-card-head"><h2 class="trip-total">${format(t('trip.on-foot'), { minutes: walk.minutes })}</h2></div>
        <p class="trip-other">${t('trip.walk-quicker')}</p>
        ${externalLink({ href: walkingUrl(to.lat, to.lng) }, t('trip.walking-directions'), t('shell.new-tab'))}
    </div>`;
}

// For a screen reader, and for naming a card
export const routeSummary = o => format(t('trip.summary'), { minutes: o.minutes, time: clockTime(o.arrives) });

// How late a suburban train runs (decision 42): measured at a station, or
// at least so late on its way to the next; on time when measured under a
// minute, and nothing said of one only known to be at least on time. A
// train caught as it's late says its timetable's time too
/** @param {import('./trains.js').RideLate} late */
function trainLate({ minutes, exact, timetable }) {
    if (!minutes && !exact) return '';
    const said = !minutes ? t('trip.train-on-time') : format(t(exact ? 'trip.train-late' : 'trip.train-late-at-least'), { minutes });
    return html`<div class="trip-step-note trip-train-late">${said}${timetable !== undefined && html` · ${format(t('trip.train-timetable'), { time: clockTime(timetable) })}`}</div>`;
}

// Under the answer, what its times are: walks and the timetable's trains,
// then `bus`, what its buses' are, where it has any, and where it has
// suburban trains, theirs, with `trainsLate`, that a train's lateness is
// Wayhop's estimate (decision 42); when the suburban railway's times for today
// couldn't be had, that it's left out (decision 41); and with `range`, what
// the half hour's ranges are
const estimates = (options, { bus = null, noTrains = false, range = false, trainsLate = false }) => html`<p class="trip-estimates">${t('trip.estimates')}${bus && html` ${bus}`}${options.some(hasTrain) && html` ${t('trip.train-estimates')}`}${trainsLate && html` ${t('trip.train-late-estimates')}`}${noTrains && html` ${t('trip.no-trains-today')}`}${range && html` ${t('trip.range-note')}`}</p>`;

// The answer: what `doorToDoor` found, drawn. noBuses: the buses' times
// couldn't be loaded, so it's by metro and tram alone; 'updated': nor the
// searches, with a newer Wayhop waiting to take over (main.js). noTrains:
// the suburban railway has no times for today. checking: the next half hour
// is being worked out, and may take its place (renderHalf)
/**
 * @param {import('../../../types/data.js').Rail} rail @param {ReturnType<typeof import('./plan.js').doorToDoor>} trip
 * @param {import('./plan.js').Place} to @param {{ expired?: boolean, noBuses?: boolean | 'updated', noTrains?: boolean, checking?: boolean }} [shown]
 */
export function renderTrip(rail, { options, walk, walkFirst, longWalk }, to, { expired = false, noBuses = false, noTrains = false, checking = false } = {}) {
    const [best, ...others] = options;
    const trainsStopped = best?.morning;
    return html`
        ${expired && notice('warn', 'warning', t('trip.timetable-ended'))}
        ${noBuses && notice('info', 'bus', t(noBuses === 'updated' ? 'trip.updated' : 'trip.buses-error'))}
        ${trainsStopped && notice('info', 'night', t('trip.no-trains'))}
        ${walkFirst && !trainsStopped && walkCard(walk, to)}
        ${best && (walkFirst && !trainsStopped ? html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>${otherCard(rail, best)}` : tripCard(rail, best, to))}
        ${checking && html`<p class="trip-other" id="trip-checking">${t('trip.half-checking')}</p>`}
        ${longWalk && !walkFirst && longWalkNotice()}
        ${others.length > 0 && !(walkFirst && !trainsStopped) && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}
        ${others.map(o => otherCard(rail, o))}
        ${estimates(options, { bus: options.some(hasBus) && t('trip.bus-estimates'), noTrains })}`;
}

const longWalkNotice = () => notice('info', 'bus', html`${t('trip.long-walk')} <a href="${localHref('/buses')}">${t('trip.look-for-buses')}</a>`);

// ── The next half hour's answer (decision 33) ───────────────────────────────

// A departure tried up to a minute ago still counts: the page redraws each minute
const LATE_SECONDS = 60;

// A way's minutes over the half hour, the quickest and slowest tenth left out
export const rangeText = ({ range: [low, high] }) => low === high ? format(t('trip.minutes'), { minutes: low }) : format(t('trip.range'), { low, high });

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

// Where to stand is for a way by rail alone with a metro ride, as on tripCard
const standFor = o => o.rides.every(ride => ride.board.station && ride.alight.station) && o.rides.some(ride => ride.mode === 'metro')
    && standHref({ station: o.rides[0].board.station }, { station: o.rides.at(-1).alight.station });

// The way the half hour stands for, step by step, with its range. best: it's
// the clear way. live: the way timed with OASA's live times, in its place.
// taken: it's the quicker way the rider took, with the way back to the
// directions. The heading can take the keyboard after a choice (main.js)
function halfCard(rail, { row, o }, to, best, live, taken = false) {
    const shown = live?.way.option ?? o;
    const stand = standFor(shown);
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            <h2 class="trip-total" tabindex="-1">${rangeText(row)}</h2>
            ${best && html`<span class="trip-arrives">${t('trip.half-best')}</span>`}
            ${taken && html`<span class="trip-arrives">${t('trip.quicker-taken')}</span>`}
        </div>
        ${citySteps(rail, shown, to, row, live)}
        ${stand && html`<a class="btn btn-sm locate-btn trip-stand" href="${stand}">${t('trip.where-to-stand')}</a>`}
        ${taken && html`<button type="button" id="trip-quicker-back" class="btn btn-sm locate-btn trip-stand">${t('trip.quicker-back')}</button>`}
    </div>`;
}

// A line on its own: a train's pill or a bus's plate
const linePlate = (rail, { line, mode }) => ON_THE_ROAD.has(mode) ? busPlate(line, 's') : railPill(rail, line, mode);

// How much sooner the quicker way gets there, in words, as its heading and for a screen reader
/** @param {import('./buses.js').Offer} offer */
export const quickerSummary = offer => format(t('trip.quicker-title'), { minutes: Math.floor(offer.sooner / 60) });

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
        bus: busPlate(offer.line, 's'), stop: stopName(rail, offer.stop), time: clockTime(offer.at), minutes: offer.walk?.minutes,
    });
    return html`<div class="trip-card" id="trip-quicker">
        <h2 class="trip-total trip-total-small">${quickerSummary(offer)}</h2>
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
    const pills = [...rides.map(ride => pill(rail, ride)), row.bundle && pillList(row.lines.map(line => busPlate(line, 's')))];
    const fromDoor = row.bundle && !rides.length;
    return html`<div class="trip-card">
        <div class="trip-card-head"><h3 class="trip-total trip-total-small">${rangeText(row)}</h3></div>
        <p class="trip-other">${!fromDoor && walkToFirst(o) > 0 && html`${format(t('trip.walk-short'), { minutes: walkToFirst(o) })} · `}${pills} ${fromDoor ? t('trip.from-stops-nearby') : format(t('trip.from-station'), { station: stopName(rail, o.rides[0].board) })}</p>
    </div>`;
}

// Whether the way shown has a bus on OASA's live times
const onLive = ({ way }) => way.option.rides.some(ride => ride.live && 'at' in ride.live) || way.stops.some(({ buses }) => buses?.length);

// The quicker way the rider took, for the departure shown: as OASA's live
// times have it, or until they do, the half hour's own for that departure or
// the first after it
/** @param {import('./buses.js').HalfRow} row @param {number} departure */
const takenOption = (row, departure) => row.options.find((o, d) => d >= departure && o) ?? row.options.find(Boolean);

// The next half hour's answer, in place of the answer for leaving now: the
// way it stands for first (the clear way, the directions that stay on, or
// the first by the weights when it depends), then the others. `ways`: from
// halfWays. longWalk: the first way's walk at either end is a long one.
// live: the first way timed with OASA's live times, at `now` (seconds from
// midnight), in its place (decision 35). On a decision (decision 36): with
// `offer`, the quicker way the live times have, under the directions; or
// `taken`, the quicker way's row, when the rider took it: in their place.
// noTrains: the suburban railway has no times for today (decision 41)
export function renderHalf(rail, kind, ways, to, { expired = false, longWalk = false, live = null, offer = false, taken = null, noTrains = false } = {}) {
    const [first, ...rest] = ways;
    const others = taken ? rest.filter(({ row }) => row !== taken) : rest;
    const busNote = live && onLive(live) ? t('trip.live-estimates') : t('trip.bus-estimates');
    return html`
        ${expired && notice('warn', 'warning', t('trip.timetable-ended'))}
        ${kind === 'depends' && html`<p class="trip-intro">${t('trip.half-depends-intro')}</p>`}
        ${taken
            ? halfCard(rail, { row: taken, o: takenOption(taken, first.departure) }, to, false, live, true)
            : halfCard(rail, first, to, kind === 'clear', live)}
        ${offer && live?.way.offer && quickerCard(rail, live.way.offer)}
        ${longWalk && longWalkNotice()}
        ${others.length > 0 && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}
        ${others.map(way => halfOther(rail, way))}
        ${estimates(ways.map(({ o }) => o), { bus: (taken || ways.some(({ o }) => hasBus(o))) && busNote, noTrains, range: true, trainsLate: Boolean(live?.way.option.rides.some(ride => ride.late)) })}`;
}

// What's said of the live times above the answer (live.js liveStatus), as on
// the Buses page; paused, with a button that asks again
/** @param {ReturnType<typeof import('./live.js').liveStatus>} status */
export function liveNotice(status) {
    if (status === 'paused') return notice('warn', 'warning', html`${t('trip.live-paused')} <button type="button" class="btn btn-link btn-sm p-0 align-baseline">${t('trip.live-resume')}</button>`);
    if (status === 'unavailable') return notice('danger', 'error', t('trip.live-unavailable'));
    if (status === 'trains-unavailable') return notice('warn', 'warning', t('trip.trains-live-unavailable'));
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
