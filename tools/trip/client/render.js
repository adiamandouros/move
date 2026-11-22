import { distanceMeters } from '/js/core/geo.js';
import { externalLink, format, formatHtml, html, icon, localName, notice, walkingUrl } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { liftNotice, liftSummary, metroStations, ridePlatforms, stepFreeGaps } from '/js/core/lifts.js';
import { busPlate, exitSign, linePill, pillList, stationSign } from '/js/core/lines.js';
import { clockTime, diagramLegend, diagramSymbols } from '/js/core/metro.js';
import { latinName } from '/js/core/text.js';
import { aboutTime, epochAt, minutesBadge, minutesLeft, minutesMark, minutesWords } from '/js/core/times.js';
import { legPositions } from '/tools/subway/network.js';
import { arrivalRows, headerBadge, nextBus, stopRow, viewHref } from '/tools/buses/render.js';
import { legCard } from '/tools/subway/render.js';
import { asLate, wayLegs } from './legs.js';
import { takenOption } from './half.js';
import { firstBusSaid, ON_THE_ROAD } from './live.js';

/** @typedef {import('/tools/subway/render.js').Rail} Rail the network the answer is drawn on, with the day's suburban trains joined or not */
/** @typedef {import('/tools/subway/city.js').Stop} Stop */
/** @typedef {import('/tools/subway/city.js').Names} Names */
/** @typedef {import('/js/core/lifts.js').Lifts} Lifts */
/** @typedef {import('./picker.js').Found} Found */
/** @typedef {import('./plan.js').TripOption} TripOption */
/** @typedef {import('./buses.js').BusOption} BusOption */
/** @typedef {import('./buses.js').Ride} Ride */
/** @typedef {import('./buses.js').Walk} Walk */
/** @typedef {import('./buses.js').HalfRow} HalfRow */
/** @typedef {import('./controller.js').Place} Place */
/** @typedef {{ lat: number, lng: number }} Point */
/** @typedef {{ seconds: number, epoch: number | null }} Clock what times count from: seconds from midnight, and the same moment since 1970 (none on the server) */
/**
 * What a way is drawn with (citySteps): `now`, seconds from midnight, for
 * the minutes, `epoch` the same moment since 1970; the weekday, date and the
 * trains' lateness for its cards (legs.js); the cards' stations on the way
 * the rider opened, by key; the bus stops they opened, by code
 * @typedef {import('./legs.js').When & { now: number, epoch: number | null, stations: Record<string, boolean>, stops?: Set<string> }} Drawn
 */

/** @param {Rail} rail @param {string} id */
const stationName = (rail, id) => localName(rail.stations[id].name, language);
// A stop of the city's search (buses.js): a station by its name, a bus stop
// in Greek, or in Latin letters where OASA's English is just that; a stop
// that isn't a station has its names (city.js)
/** @param {Rail} rail @param {Stop} stop */
const stopName = (rail, stop) => stop.station ? stationName(rail, stop.station) : cityName(/** @type {Names} */ (stop.names));
/** @param {Names} names */
const cityName = names => localName({ el: names.el, en: names.en || latinName(names.el) }, language);

// What a place found is called, with its house number
/** @param {Found} found */
export const placeTitle = found => found.n ? `${found.name} ${found.n}` : found.name;

// How exact a place found is, in words, or null when there's nothing to say.
// warn: only the street is known. The answer is only as good as the map.
/** @param {Found} found @returns {{ words: string, warn?: boolean } | null} */
export function howExact(found) {
    if (found.type === 'place') {
        const kind = /** @type {Partial<Record<string, string>>} */ ({ metro: 'trip.kind-metro', tram: 'trip.kind-tram', airport: 'trip.kind-airport' })[found.placeKind ?? ''];
        return kind ? { words: t(kind) } : null;
    }
    if (found.n === null) return null;
    if (found.kind === 'between') return { words: format(t('trip.exact-between'), { lo: found.lo, hi: found.hi }) };
    if (found.kind === 'beyond') return { words: format(t('trip.exact-beyond'), { near: found.near }) };
    if (found.kind === 'nearest') return { words: format(t('trip.exact-nearest'), { near: found.near }) };
    if (found.kind === 'street') return { words: t('trip.exact-street'), warn: true };
    return null;
}

/** @param {Found} found */
function exactLine(found) {
    const exact = howExact(found);
    return exact && html`<span class="trip-exact${exact.warn ? ' trip-exact-warn' : ''}">${exact.words}</span>`;
}

// One place found, as a row of the list
/** @param {Found} found @param {number} index @param {Rail} rail @param {string} listId */
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

/** @param {number} meters */
function distance(meters) {
    const rounded = Math.round(meters / 50) * 50;
    return rounded < 1000 ? format(t('trip.walk-meters'), { meters: rounded }) : format(t('trip.walk-km'), { km: (rounded / 1000).toFixed(1) });
}

// A walk's minutes, an estimate: "~16'"
/** @param {number} minutes */
const walkMinutes = minutes => minutesMark(minutes, t, { about: true });

// With the rider followed along the way (decision 50), where each step
// stands against theirs: done, the one they're on (said to a screen reader),
// or still to come. Each step's place in the way's order: the walk to ride
// i, waiting for it, riding it; the last walk; arrived
/** @typedef {{ kind: 'walk' | 'wait' | 'ride' | 'last' | 'arrived', ride?: number }} Following */
/** @typedef {{ cls: string, current: boolean, riding?: boolean }} Mark */
/** @type {Mark} */
const NONE = { cls: '', current: false };
/** @type {Mark} */
const DONE = { cls: ' trip-step-done', current: false };
/** @type {Mark} */
const NOW = { cls: ' trip-step-now', current: true };
// On the ride: the step they're on, its times no use to them now
/** @type {Mark} */
const RIDING = { ...NOW, riding: true };
const ORDER = { walk: 0, wait: 1, ride: 2 };
/** @param {Following} following @param {number} rides */
const placeOf = ({ kind, ride = 0 }, rides) => kind === 'arrived' ? rides * 3 + 1 : kind === 'last' ? rides * 3 : ride * 3 + ORDER[kind];
// A step's mark, by its place and how many places it spans (a ride's row
// stands for waiting for it and riding it)
/** @param {Following | null} following @param {number} rides */
const marker = (following, rides) => {
    const at = following ? placeOf(following, rides) : -1;
    return /** @param {number} place @param {number} [span] @returns {Mark} */ (place, span = 1) => at < place ? NONE : at < place + span ? (at > place ? RIDING : NOW) : DONE;
};
// A ride done or being ridden shows no times (decision 61, Road · 9)
/** @param {Mark} mark */
const noTimes = mark => mark === DONE || Boolean(mark.riding);
/** @param {Mark} mark */
const marked = mark => html`${mark.cls}"${mark.current && html` aria-current="step"`}`;

// One step of a way: on the left a ride's clock time, strong, or a walk's
// minutes, quiet (when, and how long); then what to do; and at the far right,
// for a walk, its walking directions. `mark`: where it stands against the
// rider's step
/** @param {unknown} when @param {unknown} content @param {{ leaves?: boolean, directions?: import('/js/core/html.js').Html | null, mark?: Mark }} [options] */
const step = (when, content, { leaves = false, directions = null, mark = NONE } = {}) =>
    html`<li class="trip-step${marked(mark)}><span class="trip-step-when${leaves ? ' trip-step-leaves' : ''}">${when}</span><div class="trip-step-what">${content}</div>${directions}</li>`;

// Walking directions to `place`, `name`, as on a bus stop's row (DESIGN.md,
// "Walking directions"): the walking figure, the words for screen readers
/** @param {Point} place @param {string} name */
const directionsTo = (place, name) => externalLink({ class: 'directions-btn d-flex align-items-center justify-content-center', href: walkingUrl(place.lat, place.lng) },
    html`${icon('walk')}<span class="sr-only">${format(t('trip.walking-directions-to'), { place: name })}</span>`, t('shell.new-tab'));

// A metro station's exit, by its place in the station's `exits`: its name,
// in the page's language or the other one, and where it is; none without a
// name (decision 51)
/** @param {import('../../../types/data.js').Exit[] | undefined} exits @param {number | undefined} i */
function exitOf(exits, i) {
    const exit = i === undefined ? null : exits?.[i];
    const name = exit?.name?.[language] || exit?.name?.el || exit?.name?.en;
    return exit && name ? { name, place: { lat: exit.at[0], lng: exit.at[1] } } : null;
}

// A walk to `place`, `name`: from the door, or between two stations or stops,
// whose minutes are the tram's walks (decision 28) and have no distance;
// none either once it's behind the rider (decision 68).
// note: what the way needs saying, a suburban station's change (decision 41).
// into: the metro station's exit it goes in by, where its walking directions
// lead, never named: the street has only the station's sign (decision 68).
// lines: for a metro ride from there, the station's lines, its name then
// drawn as its sign; a tram, suburban or bus stop has none (decision 68)
/**
 * @param {{ minutes: number, meters?: number }} walk @param {string} name @param {Point} place
 * @param {import('../../../types/data.js').Names | null} [note] @param {Mark} [mark] @param {{ name: string, place: Point } | null} [into] @param {string[] | null} [lines]
 */
function walkStep(walk, name, place, note = null, mark = NONE, into = null, lines = null) {
    const far = mark !== DONE && walk.meters !== undefined;
    return step(walkMinutes(walk.minutes), html`<div>${formatHtml(t('trip.walk-to'), { place: lines ? stationSign(name, lines) : name })}</div>
        ${far && html`<div class="trip-step-note">${distance(/** @type {number} */ (walk.meters))}</div>`}
        ${note && html`<div class="trip-step-note">${localName(note, language)}</div>`}`, { directions: directionsTo(into?.place ?? place, name), mark });
}

// A metro line's ride: its station's name in a walk to it is its sign (decision 68)
const METRO = /^M\d+$/;
// The lines of metro station `id` for a walk to a ride on `line` from it, or null
/** @param {Rail} rail @param {string | undefined} id @param {string} line */
const signLines = (rail, id, line) => id && METRO.test(line) ? rail.stations[id]?.lines ?? null : null;

// "Way out: [exit]", the exit as its sign in the station (decision 68)
/** @param {{ name: string }} out */
const wayOut = out => formatHtml(t('trip.way-out'), { exit: exitSign(out.name) });

// After a metro ride, the exit to leave the station by, a step of its own
// before the walk from it (decision 51); `mark`: the walk's, the exit
// behind the rider once they're on it
/** @param {ReturnType<typeof exitOf>} out @param {Mark} [mark] */
const exitStep = (out, mark = NONE) => out && step('', html`<div>${wayOut(out)}</div>`, { mark: mark === NOW ? DONE : mark });

// A ride's heading: its line and where it goes, then its badges at the right end
/** @param {unknown} line @param {string | false} toward @param {unknown} [badges] */
const rideHead = (line, toward, badges = '') => html`<div class="trip-step-head"><span>${line}${toward && html` ${format(t('trip.towards'), { end: toward })}`}</span>${badges}</div>`;

// A metro, tram or suburban ride: the Subway page's card in its place, with
// nothing on the left (decisions 46 and 47). Its badges count from `clock`
// (`seconds` from the midnight its trains count from, `epoch` the same
// moment since 1970), clock times for the morning's first trains, none
// once the rider is on it or past it; it says its ride's minutes always, as
// the trip's are door to door; its stations on the way are open as the
// rider left them (`stations`, by the leg's key)
/**
 * @param {Rail} rail @param {NonNullable<ReturnType<typeof wayLegs>[number]>} card @param {Clock} clock @param {boolean} morning
 * @param {Record<string, boolean>} stations @param {Mark} [mark]
 */
function railCard(rail, { leg, next }, clock, morning, stations, mark = NONE) {
    const key = `${leg.line}/${leg.dir}/${leg.from}/${leg.to}`;
    return html`<li class="trip-leg${marked(mark)}>${legCard(rail, leg, next, noTimes(mark) ? null : clock, 3, morning, true, key, Boolean(stations[key]))}</li>`;
}

// Under the way shown in full, what its trains show, in words: only the
// symbols they show, open as the rider last left a legend (`open`, DESIGN.md
// "Icons"). `when`: the cards' trains' (legs.js)
/** @param {Rail} rail @param {TripOption} o @param {import('./legs.js').When} when @param {boolean} open */
function legend(rail, o, when, open) {
    const symbols = [...new Set(wayLegs(rail, o, when)
        .flatMap(card => card ? [legPositions(rail, card.leg, card.next)] : [])
        .filter(where => where.exits.length).flatMap(diagramSymbols))];
    return symbols.length > 0 && diagramLegend(symbols, t, open);
}

/** @param {Rail} rail @param {string} id @returns {Point} */
const stationPlace = (rail, id) => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1] });
// A walk between two stations of `tram.json` (decision 25), `from` one to
// another, through a metro station's exit where it says which (decision
// 51): out of `from` as a step of its own after a ride (`leaving`), and in
// to `id` for a ride from there (`boarding`)
/**
 * @param {Rail} rail @param {string} from @param {string} id @param {number} minutes @param {Mark} [mark]
 * @param {{ leaving?: boolean, boarding?: boolean, line?: string }} [options]
 */
function walkToStation(rail, from, id, minutes, mark = NONE, { leaving = true, boarding = true, line = '' } = {}) {
    const exit = rail.walkExits?.[from]?.[id];
    return html`${leaving && exitStep(exitOf(rail.stations[from]?.exits, exit), mark)}${walkStep({ minutes }, stationName(rail, id), stationPlace(rail, id), null, mark, boarding ? exitOf(rail.stations[id].exits, exit) : null, signLines(rail, id, line))}`;
}

// The walk to where the first ride leaves: to the station, and on to a stop
// beside it, if the trip starts there
/** @param {TripOption} o */
const walkToFirst = o => o.city ? o.firstWalk?.minutes ?? 0 : (o.start.walk?.minutes ?? 0) + (o.plan.walkFirst ?? 0);

// Past an hour, a bus's minutes are no use: its clock time says it
const HOUR_MINUTES = 60;

// A bus's badge and the next one's, at the right end of its heading
// (DESIGN.md, "The Trip page"): OASA's when it has the bus coming (decision
// 35), marked trip-live, or else the timetable's, counted from `clock`
// ({ seconds, epoch }, as railCard's) and counting down by themselves, gone
// once past (decision 61): OASA's in whole minutes, the timetable's to the
// second (minutesLeft)
/** @param {Ride} ride @param {Clock} clock */
function busBadges(ride, clock) {
    const live = ride.live && 'at' in ride.live ? ride.live : null;
    const soon = [live ? live.at : ride.boards, (live ? live.next : ride.next) ?? null].flatMap(at => {
        const minutes = at === null ? null : minutesLeft(at, clock.seconds, !live);
        return at !== null && minutes !== null && minutes < HOUR_MINUTES ? [{ at, minutes }] : [];
    });
    return soon.length > 0 && html`<span class="trip-step-badges${live ? ' trip-live' : ''}">${soon.map(({ at, minutes }, i) => minutesBadge(minutes, t, { said: i ? t('trip.next-in') : undefined, at: epochAt(at, clock), exact: !live }))}</span>`;
}

// A metro or tram station this close to a bus stop is where the bus meets
// its lines, as the stops on the way show them (decision 53)
const NEAR_STATION_METERS = 150;

// The metro and tram lines at the stations near `stop`, as small pills
/** @param {Rail} rail @param {Point} stop */
function linesNear(rail, stop) {
    const lines = new Set(Object.values(rail.stations)
        .filter(({ coords }) => distanceMeters(stop.lat, stop.lng, coords[0], coords[1]) <= NEAR_STATION_METERS)
        .flatMap(station => station.lines.filter(line => rail.lines[line])));
    return [...lines].map(line => linePill(line, rail.lines[line].name, 's'));
}

// A bus ride's stops on the way, as a metro card's stations (legStations in
// the Subway page's render.js): dots on a grey strip, as a bus has no line
// colour, each linked to the stop on the Buses page, with the lines of the
// stations by it. id: the list's, for its button. open: whether it's open
/** @param {Rail} rail @param {Ride} ride @param {string} id @param {boolean} open */
function busStopsOnWay(rail, ride, id, open) {
    return html`<ol class="leg-stations" id="${id}" aria-label="${t('trip.bus-stops-on-way')}"${!open && html` hidden`}>
        ${ride.on.map(stop => {
            const lines = linesNear(rail, stop);
            return html`<li><a href="${viewHref({ stop: stop.id.slice('bus:'.length) })}">${stopName(rail, stop)}</a>${lines.length > 0 && html` ${pillList(lines)}`}</li>`;
        })}
    </ol>`;
}

// A bus ride's last line, as a metro card's (legCard): where to get off on
// the left; on the right, its ride's minutes, OASA's when it has the bus due
// where it gets off, or else "~", and its stops, a button that opens them
// (decision 53). `stations`: the stops on the way the rider opened, by the
// ride's key, as a card's stations are
/** @param {Rail} rail @param {Ride} ride @param {Record<string, boolean>} stations */
function busAction(rail, ride, stations) {
    const key = `bus/${ride.line}/${ride.board.id}/${ride.alight.id}`;
    const id = `stations-${key.replace(/[^a-z0-9]+/gi, '-')}`;
    const open = Boolean(stations[key]);
    const minutes = minutesMark(Math.round((ride.arrives - ride.boards) / 60), t, { about: !(ride.live && 'off' in ride.live) });
    return html`<div class="leg-action mt-2">
            <span>${icon('get-off', 'me-2')}${t('subway.exit-at')} <strong>${stopName(rail, ride.alight)}</strong></span><span class="sr-only">, </span>
            <span class="leg-ride">${minutes} · <button type="button" class="leg-stops-toggle" data-leg="${key}" aria-expanded="${String(open)}" aria-controls="${id}">${format(t(ride.stops === 1 ? 'trip.bus-stop-count' : 'trip.bus-stops-count'), { count: ride.stops })}${icon('more', 'leg-stops-chevron')}</button></span>
        </div>
        ${busStopsOnWay(rail, ride, id, open)}`;
}

// A bus ride of a way, or a suburban train's until its card can be drawn
// (legs.js): a bus's time is the timetable's, an estimate (decision 11), so
// it says "~", unless OASA has the bus coming (decision 35); its badge and
// the next one's beside its heading, and at its foot, as a metro card's,
// where to get off, its minutes and its stops (busAction). A train's is
// when it actually leaves, as late as it runs, `trains` by number (decision
// 47), with how many stops to where it gets off; one to or from a station
// OASA's ticket doesn't cover says it needs Hellenic Train's (decision 41).
// `now`: seconds from midnight, for the minutes, `epoch` the same moment
// since 1970; none on a ride done or being ridden. A train's row has its
// time by the timetable (buses.js cityOption)
/** @param {Rail} rail @param {Ride} ride @param {Drawn} drawn @param {Mark} [mark] */
function rideStep(rail, ride, { now, epoch, trains, stations }, mark = NONE) {
    const bus = ON_THE_ROAD.has(ride.mode);
    const place = stopName(rail, ride.alight);
    const live = ride.live && 'at' in ride.live;
    const beyond = [ride.board, ride.alight].find(stop => stop.oasaTicket === false);
    return step(!bus ? clockTime(asLate(trains, ride.train, /** @type {number} */ (ride.timetable))) : live ? clockTime(ride.boards) : aboutTime(clockTime(ride.boards), t), html`
        ${rideHead(pill(rail, ride), ride.lines.length === 1 && cityName(ride.toward), bus && !noTimes(mark) && busBadges(ride, { seconds: now, epoch }))}
        ${ride.live && 'none' in ride.live && html`<div class="trip-step-note">${t('trip.live-none')}</div>`}
        ${bus ? busAction(rail, ride, stations ?? {}) : html`<div class="trip-step-note">${ride.stops === 1 ? format(t('trip.stop'), { place }) : format(t('trip.stops'), { count: ride.stops, place })}</div>`}
        ${beyond && html`<div class="trip-step-note">${format(t('trip.train-ticket'), { station: stopName(rail, beyond) })}</div>`}`, { leaves: true, mark });
}
// A rail line's pill: the metro's and the tram's are in rail.json; the
// suburban railway's are named as their ids, A1 to A4 (decision 41). Medium,
// as in a heading or a sentence (DESIGN.md)
/** @param {Rail} rail @param {string} line @param {string} mode */
const railPill = (rail, line, mode) => linePill(line, mode === 'suburban' ? line : rail.lines[line].name, 'm');
// Every bus line that rides it, the first to come first
/** @param {Rail} rail @param {Ride} ride */
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
// `before`: the stop of the ride before, null from the door; after a metro
// ride, each stop says the exit its walk comes out by, its own (decision 51,
// Road · 17). `clock`: as railCard's,
// for the minutes; `opened`: the stops the rider opened, by code.
// `mark`: where the ride stands against the rider's step; the one they're
// on is only the stop the way boards at (`board`), the others are offers;
// on the ride or past it, no times
/**
 * @param {Rail} rail @param {BusStop[]} stops @param {Stop | null} before @param {Clock} clock @param {Set<string> | undefined} opened
 * @param {Mark} [mark] @param {string | null} [board]
 */
function busStops(rail, stops, before, clock, opened, mark = NONE, board = null) {
    /** @param {BusStop} stop @param {number} i */
    const stopStep = ({ stop, walk, lines, buses = null, arrivals = [] }, i) => {
        const code = stop.id.slice('bus:'.length);
        const name = stopName(rail, stop);
        const own = mark.current ? stop.id === board ? NOW : NONE : mark;
        /** @param {import('/js/core/lines.js').PillSize} size */
        const plates = size => pillList(lines.map(line => busPlate(line, size)));
        // As the Buses page has a stop's answer, each bus's minutes from now,
        // counting down by themselves, those past gone (decision 61)
        const coming = noTimes(mark) ? [] : arrivals.flatMap(bus => {
            const minutes = minutesLeft(bus.at, clock.seconds);
            return minutes === null ? [] : [{ line: bus.line, to: bus.to, at: epochAt(bus.at, clock), minutes }];
        });
        const result = { arrivals: coming };
        // With none of them on OASA's live times, its lines, and that it has none
        const next = coming.length ? nextBus(result) : html`<span class="sr-only">. ${t('buses.lines')}: </span>${plates('m')}${buses && !arrivals.length && html`<span class="next-bus-dest text-body-secondary fst-italic"><span class="sr-only">. </span>${t('trip.live-none')}</span>`}`;
        const out = before && exitOf(before.exits, walk?.out);
        // Marked trip-live with buses from OASA's live times, as a ride's badges are
        return html`<li class="trip-stop${coming.length ? ' trip-live' : ''}${marked(own)}>${out && html`<div class="trip-stop-exit">${wayOut(out)}</div>`}${stopRow({ code, name: { el: name, en: name }, lat: stop.lat, lng: stop.lng }, i, {
            id: 'trip-stop', star: false, open: opened?.has(code) ?? false,
            away: walk && html`<span class="sr-only">, </span>${minutesMark(walk.minutes, t, { about: true, said: t('trip.walk-short') })}`,
            next, badge: headerBadge(result), arrivals: coming.length > 0 && arrivalRows(result), lines: plates('s'),
            heard: format(t('trip.stop-buses'), { stop: name }),
        })}</li>`;
    };
    const more = stops.slice(STOPS_SHOWN);
    return html`<li>${t(before ? 'trip.any-bus-then' : 'trip.any-bus')}</li>
        ${stops.slice(0, STOPS_SHOWN).map(stopStep)}
        ${more.length > 0 && html`<li><details class="trip-more">
            <summary>${format(t(more.length === 1 ? 'trip.more-stop' : 'trip.more-stops'), { count: more.length })}</summary>
            <ol class="trip-steps">${more.map((stop, i) => stopStep(stop, STOPS_SHOWN + i))}</ol>
        </details></li>`}`;
}

/**
 * A stop a way's last bus can be caught at: the half hour's (HalfRow), or
 * with OASA's live times (LiveWay)
 * @typedef {{ stop: Stop, walk: Walk | null, lines: string[], buses?: { line: string, at: number }[] | null, arrivals?: import('./buses.js').LiveWay['stops'][number]['arrivals'] }} BusStop
 */

// A way of the city's search, step by step: its walks and rides, and for a
// way of the half hour whose last bus can be any of several, the stops.
// live: the way timed with OASA's live times (buses.js liveWay). `drawn`:
// `now`, seconds from midnight, for the minutes; the weekday and date, and
// how late the trains run when the way is timed with it, for its trains
// (legs.js); `stations`: the cards' stations on the way the rider opened;
// `stops`: the bus stops they opened
/**
 * @param {Rail} rail @param {BusOption} o @param {Place} to @param {Drawn} drawn
 * @param {HalfRow | null} [row] @param {{ way: import('./buses.js').LiveWay } | null} [live] @param {Following | null} [following]
 */
function citySteps(rail, o, to, drawn, row = null, live = null, following = null) {
    const mark = marker(following, o.rides.length);
    // A walk to `stop`, out of the metro station of the ride before it by its exit, a step of its own, and into `stop`'s
    // a metro station's name as its sign for a metro ride from there (decision 68)
    /** @param {Walk | null} walk @param {Stop} stop @param {Names | null} note @param {number} at @param {string} mode @param {Stop | null} [before] */
    const walkTo = (walk, stop, note, at, mode, before = null) => walk && html`${before && exitStep(exitOf(before.exits, walk.out), mark(at))}${walkStep(walk, stopName(rail, stop), stop, note, mark(at), exitOf(stop.exits, walk.in), mode === 'metro' && stop.station ? rail.stations[stop.station]?.lines ?? null : null)}`;
    // A last bus that can be any of several is its stops, until the rider
    // has boarded one: then that bus's ride (decision 67)
    const bundled = row?.bundle && !o.rides.at(-1)?.boarded;
    const rides = bundled ? o.rides.slice(0, -1) : o.rides;
    const cards = wayLegs(rail, o, drawn);
    const last = o.rides.length - 1;
    return html`<ol class="trip-steps">
        ${rides.length > 0 && walkTo(o.firstWalk, o.rides[0].board, null, 0, o.rides[0].mode)}
        ${rides.map((ride, i) => html`${i > 0 && walkTo(ride.walkBefore, ride.board, ride.walkNote, i * 3, ride.mode, o.rides[i - 1].alight)}${cards[i] ? railCard(rail, cards[i], { seconds: drawn.now, epoch: drawn.epoch }, false, drawn.stations, mark(i * 3 + 1, 2)) : rideStep(rail, ride, drawn, mark(i * 3 + 1, 2))}`)}
        ${bundled && row && busStops(rail, live?.way.stops ?? row.stops, rides.length > 0 ? o.rides[last - 1].alight : null, { seconds: drawn.now, epoch: drawn.epoch }, drawn.stops, mark(last * 3 + 1, 2), o.rides[last].board.id)}
        ${o.lastWalk && html`${exitStep(exitOf(o.rides[last].alight.exits, o.lastWalk.out), mark(o.rides.length * 3))}${walkStep(o.lastWalk, to.title, to, null, mark(o.rides.length * 3))}`}
    </ol>`;
}

// How long a way takes, door to door: "~25'"
/** @param {{ minutes: number }} o */
const totalMinutes = o => minutesMark(o.minutes, t, { about: true });

// A way of the city's search, step by step
/** @param {Rail} rail @param {BusOption} o @param {Place} to @param {Drawn} drawn @param {Following | null} [following] */
function cityCard(rail, o, to, drawn, following = null) {
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            <h2 class="trip-total">${totalMinutes(o)}</h2>
            <span class="trip-arrives">${format(t('trip.arrive'), { time: clockTime(o.arrives) })}</span>
        </div>
        ${citySteps(rail, o, to, drawn, null, null, following)}
    </div>`;
}

/** @param {TripOption} o */
function when(o) {
    const time = clockTime(o.arrives);
    if (!o.morning) return format(t('trip.arrive'), { time });
    const leave = clockTime(o.plan.legs[0].departures[0].departs - walkToFirst(o) * 60);
    return format(t('trip.morning'), { leave, time });
}

// The best way, step by step. `drawn`: when, and the stations on the way
// the rider opened (citySteps). `following`: where the rider is on it
/** @param {Rail} rail @param {TripOption} o @param {Place} to @param {Drawn} drawn @param {Following | null} [following] */
function tripCard(rail, o, to, drawn, following = null) {
    if (o.city) return cityCard(rail, o, to, drawn, following);
    const cards = wayLegs(rail, o, drawn);
    const mark = marker(following, o.plan.legs.length);
    const after = o.plan.legs.length * 3;
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            ${!o.morning && html`<h2 class="trip-total">${totalMinutes(o)}</h2>`}
            <span class="trip-arrives">${when(o)}</span>
        </div>
        <ol class="trip-steps">
            ${o.start.walk && walkStep(o.start.walk, stationName(rail, o.start.station), stationPlace(rail, o.start.station), null, mark(0), o.plan.walkFirst ? null : exitOf(rail.stations[o.start.station].exits, o.start.walk.in), o.plan.walkFirst ? null : signLines(rail, o.start.station, o.plan.legs[0].line))}
            ${o.plan.walkFirst && walkToStation(rail, o.start.station, o.plan.legs[0].from, o.plan.walkFirst, mark(0), { leaving: false, line: o.plan.legs[0].line })}
            ${o.plan.legs.map((leg, i) => {
                const before = o.plan.legs[i - 1];
                return html`${before && before.to !== leg.from && walkToStation(rail, before.to, leg.from, (rail.walks ?? {})[before.to][leg.from], mark(i * 3), { line: leg.line })}${cards[i] && railCard(rail, cards[i], { seconds: drawn.now - o.dayStart, epoch: drawn.epoch }, o.morning, drawn.stations, mark(i * 3 + 1, 2))}`;
            })}
            ${o.plan.walkLast && walkToStation(rail, o.plan.legs[o.plan.legs.length - 1].to, o.end.station, o.plan.walkLast, mark(after), { boarding: false })}
            ${o.end.walk && html`${!o.plan.walkLast && exitStep(exitOf(rail.stations[o.end.station].exits, o.end.walk.out), mark(after))}${walkStep(o.end.walk, to.title, to, null, mark(after))}`}
        </ol>
    </div>`;
}

// The walk to where a way's first ride leaves, on its line: "Walk ~5'"
/** @param {TripOption} o */
const walkShort = o => formatHtml(t('trip.walk-short'), { minutes: walkMinutes(walkToFirst(o)) });

// Another way, on one line
/** @param {Rail} rail @param {TripOption} o */
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

/** @param {{ minutes: number }} walk @param {Place} to */
function walkCard(walk, to) {
    return html`<div class="trip-card">
        <div class="trip-card-head"><h2 class="trip-total">${formatHtml(t('trip.on-foot'), { minutes: walkMinutes(walk.minutes) })}</h2></div>
        <p class="trip-other">${t('trip.walk-quicker')}</p>
        ${externalLink({ href: walkingUrl(to.lat, to.lng) }, t('trip.walking-directions'), t('shell.new-tab'))}
    </div>`;
}

// For a screen reader, and for naming a card
/** @param {TripOption} o */
export const routeSummary = o => format(t('trip.summary'), { minutes: minutesWords(o.minutes, t), time: clockTime(o.arrives) });

// Where a way's rides board and get off, by line and direction: a metro or
// tram ride's stations (a suburban train's stations and a bus's stops have
// no lift status or step-free data). A ride between two stations is a metro
// or tram ride, which has its direction
/** @param {TripOption} o */
const wayPlatforms = o => ridePlatforms(o.city
    ? o.rides.flatMap(({ line, dir, board, alight }) => board.station && alight.station ? [{ line, dir: /** @type {string} */ (dir), from: board.station, to: alight.station }] : [])
    : o.plan.legs);

// For the step-free notice of the ways shown: their metro stations, for the
// lifts out of service there, and their platforms with steps only
/** @param {Rail} rail @param {TripOption[]} ways */
function access(rail, ways) {
    const platforms = ways.flatMap(wayPlatforms);
    return { ids: metroStations(rail, platforms.map(p => p.station)), gaps: stepFreeGaps(rail, platforms) };
}

// Above the answer, after its messages, the step-free notice (DESIGN.md):
// every station the ways shown use that can't be reached step-free or has
// lifts out, and an error when the lift status is unavailable. lifts:
// watchLifts() in /js/core/lifts.js, or null; open: liftsOpen() in metro.js
/** @param {Rail} rail @param {TripOption[]} ways @param {Lifts | null} lifts @param {boolean} open */
function stepFree(rail, ways, lifts, open) {
    const { ids, gaps } = access(rail, ways);
    return liftNotice(lifts, ids, id => stationName(rail, id), gaps, open);
}

// The same in words, for a screen reader, after the answer's summary: '' when there's none
/** @param {Rail} rail @param {TripOption[]} ways @param {Lifts | null} lifts */
export function stepFreeSummary(rail, ways, lifts) {
    const { ids, gaps } = access(rail, ways);
    return liftSummary(lifts, ids, id => stationName(rail, id), gaps);
}

// Above the answer, what it's missing (decision 43): the buses' times, or
// the suburban railway's for today (decision 41). An error; but a newer
// Wayhop waiting to take over ('updated', main.js) is how to read it, about
// the buses
/** @param {boolean | 'updated'} noBuses @param {boolean} noTrains */
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
// minutes, `epoch` the same moment since 1970, for them to count down by
// themselves (decision 61; none, as on the server, and they don't); `weekday` (0 = Sunday) and `date` in Athens, for the trains of
// the cards (legs.js), by the timetable, as this answer isn't timed with how
// late they run; stations: the cards' stations on the way the rider opened
// (by key); legend: whether the legend is open (legendOpen() in metro.js).
// `rail`: with the day's suburban trains joined for their cards (decision
// 47), or without them, when their rides are rows
/**
 * @param {Rail} rail @param {ReturnType<typeof import('./plan.js').doorToDoor>} trip
 * @param {Place} to
 * @param {{ now: number, epoch?: number | null, weekday: number, date: string, expired?: boolean, noBuses?: boolean | 'updated', noTrains?: boolean, checking?: boolean, lifts?: Lifts | null, liftsOpen?: boolean, stations?: Record<string, boolean>, legend?: boolean, following?: Following | null }} shown
 */
export function renderTrip(rail, { options, walk, walkFirst, longWalk }, to, { now, epoch = null, weekday, date, expired = false, noBuses = false, noTrains = false, checking = false, lifts = null, liftsOpen = true, stations = {}, legend: legendShown = true, following = null }) {
    const [best, ...others] = options;
    const trainsStopped = best?.morning;
    const drawn = { now, epoch, weekday, date, stations };
    return html`
        ${missing(noBuses, noTrains)}
        ${expired && notice('warn', 'warning', t('trip.timetable-ended'), 'mb-3')}
        ${trainsStopped && notice('info', 'night', t('trip.no-trains'), 'mb-3')}
        ${stepFree(rail, options, lifts, liftsOpen)}
        ${walkFirst && !trainsStopped && walkCard(walk, to)}
        ${best && (walkFirst && !trainsStopped
            ? html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>${otherCard(rail, best)}`
            : html`${tripCard(rail, best, to, drawn, following)}${legend(rail, best, drawn, legendShown)}`)}
        ${checking && html`<p class="trip-other" id="trip-checking">${t('trip.half-checking')}</p>`}
        ${longWalk && !walkFirst && longWalkNotice()}
        ${others.length > 0 && !(walkFirst && !trainsStopped) && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}
        ${others.map(o => otherCard(rail, o))}`;
}

const longWalkNotice = () => notice('info', 'bus', html`${t('trip.long-walk')} <a href="${localHref('/buses')}">${t('trip.look-for-buses')}</a>`, 'mb-3');

// ── The next half hour's answer (decision 33) ───────────────────────────────

// A way's minutes over the half hour, the quickest and slowest tenth left
// out: "16–19'", or as a way's total when they're the same, "~17'"; and in
// words, for a screen reader
/** @param {{ range: [number, number] }} row @returns {import('/js/core/times.js').Minutes} */
const rangeOf = ({ range: [low, high] }) => low === high ? low : [low, high];
/** @param {{ range: [number, number] }} row */
const rangeMark = row => minutesMark(rangeOf(row), t, { about: !Array.isArray(rangeOf(row)) });
/** @param {{ range: [number, number] }} row */
export const rangeText = row => minutesWords(rangeOf(row), t, !Array.isArray(rangeOf(row)));

// The way the half hour stands for, step by step, with its range. best: it's
// the clear way. live: the way timed with OASA's live times, in its place.
// `label`: whose way it is, at the right of its heading: 'quicker', the
// quicker way the rider took (decision 36, T14), or 'picked', a way they
// took from the other ways (decision 64); `back`: with the way back. The
// heading can take the keyboard after a choice (main.js). `drawn`: when,
// and the stations on the way the rider opened (citySteps). `following`:
// where the rider is on it (decision 50): then the heading is when they
// get there, the range being for someone still at the start
const LABELS = { quicker: 'trip.quicker-taken', picked: 'trip.picked' };
/**
 * @param {Rail} rail @param {{ row: HalfRow, o: BusOption }} way @param {Place} to @param {Drawn} drawn @param {boolean} best @param {{ way: import('./buses.js').LiveWay } | null} live
 * @param {{ label?: 'quicker' | 'picked' | null, back?: boolean, following?: Following | null }} [options]
 */
function halfCard(rail, { row, o }, to, drawn, best, live, { label = /** @type {'quicker' | 'picked' | null} */ (null), back = false, following = null } = {}) {
    const shown = live?.way.option ?? o;
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            <h2 class="trip-total" tabindex="-1">${following ? format(t('trip.arrive'), { time: clockTime(shown.arrives) }) : rangeMark(row)}</h2>
            ${best && html`<span class="trip-arrives">${t('trip.half-best')}</span>`}
            ${label && html`<span class="trip-arrives">${t(LABELS[label])}</span>`}
        </div>
        ${citySteps(rail, shown, to, drawn, row, live, following)}
        ${back && html`<button type="button" id="trip-quicker-back" class="btn btn-sm locate-btn trip-stand">${t('trip.quicker-back')}</button>`}
    </div>`;
}

// A line in a sentence: a train's pill or a bus's plate
/** @param {Rail} rail @param {{ line: string, mode: string }} ride */
const linePlate = (rail, { line, mode }) => ON_THE_ROAD.has(mode) ? busPlate(line, 'm') : railPill(rail, line, mode);

// How much sooner the quicker way gets there: its heading, and in words for a screen reader
/** @param {import('./buses.js').Offer} offer */
const quickerTitle = offer => formatHtml(t('trip.quicker-title'), { minutes: minutesMark(Math.floor(offer.sooner / 60), t) });
/** @param {import('./buses.js').Offer} offer */
export const quickerSummary = offer => format(t('trip.quicker-title'), { minutes: minutesWords(Math.floor(offer.sooner / 60), t) });
// How long till the switch on the way is taken by itself (T14)
/** @param {number} seconds */
export const switchIn = seconds => format(t('trip.switch-in'), { seconds });

// The quicker way offered on a decision (decision 36), under the directions,
// as OASA has its bus coming in time: how much sooner, where to get off the
// first ride for which bus, and the rider's choice. The directions stay as
// they are unless it's taken. On the way (T14, decision 50), the switch to a
// way 3' or more sooner is the same, off the ride the rider is on for the
// next ride, a train's too, with `seconds` till it's taken by itself
/** @param {Rail} rail @param {import('./buses.js').Offer} offer @param {number | null} [seconds] */
function quickerCard(rail, offer, seconds = null) {
    const off = formatHtml(t(offer.ride.mode === 'metro' ? 'trip.quicker-off-station' : 'trip.quicker-off'), {
        ride: linePlate(rail, offer.ride), change: stopName(rail, offer.change),
    });
    const bus = formatHtml(t(offer.walk ? 'trip.quicker-bus' : 'trip.quicker-bus-here'), {
        bus: linePlate(rail, { line: offer.line, mode: offer.mode ?? 'bus' }), stop: stopName(rail, offer.stop), time: clockTime(offer.at), minutes: offer.walk && walkMinutes(offer.walk.minutes),
    });
    return html`<div class="trip-card" id="trip-quicker">
        <h2 class="trip-total trip-total-small">${quickerTitle(offer)}</h2>
        <p class="trip-quicker-what">${off} ${bus}</p>
        ${seconds !== null && html`<p class="trip-other" id="trip-switch-timer" role="timer">${switchIn(seconds)}</p>`}
        <div class="trip-quicker-actions">
            <button type="button" id="trip-quicker-take" class="btn btn-primary btn-sm rounded-pill px-4">${t('trip.quicker-take')}</button>
            <button type="button" id="trip-quicker-keep" class="btn btn-sm locate-btn">${t('trip.quicker-keep')}</button>
        </div>
    </div>`;
}

// What OASA says of a way's first bus, at the end of its line (decision
// 62): its badge, counting down by itself, or that it has none the rider
// can catch; nothing till its stop is answered
/** @param {{ rides: { mode: string, live?: import('./buses.js').RideLive }[] }} o @param {Clock} clock */
function firstBusLive(o, clock) {
    const said = firstBusSaid(o);
    if (!said) return '';
    if (!('at' in said)) return html` · ${t('trip.live-none')}`;
    const minutes = minutesLeft(said.at, clock.seconds, false);
    return minutes !== null && minutes < HOUR_MINUTES && html` <span class="trip-live">${minutesBadge(minutes, t, { at: epochAt(said.at, clock), exact: false })}</span>`;
}

// Another way of the half hour, on one line: a last bus that can be any of
// several shows them all, and one caught from the door says so. Timed with
// OASA's live times (`timed`, decision 62), its heading is its minutes and
// when it gets there, as for leaving now, and its first bus says what OASA
// has of it; until then, its range over the half hour. With `take`, it's a
// button that takes that way (T18, decision 64): the whole card, its key in
// `data-way`, a chevron at its right, said as "Take this way: …";
// `checking`, its bus is being checked as it's taken, said in the
// chevron's place, the button doing nothing meanwhile
/**
 * @param {Rail} rail @param {{ row: Pick<HalfRow, 'key' | 'bundle' | 'lines'>, o: BusOption }} way @param {{ option: BusOption } | null} [timed]
 * @param {Clock} [clock] @param {boolean} [take] @param {boolean} [checking]
 */
function halfOther(rail, { row, o }, timed = null, clock = { seconds: 0, epoch: null }, take = false, checking = false) {
    const shown = timed?.option ?? o;
    const rides = row.bundle ? shown.rides.slice(0, -1) : shown.rides;
    const pills = [...rides.map(ride => pill(rail, ride)), row.bundle && pillList(row.lines.map(line => busPlate(line, 'm')))];
    const fromDoor = row.bundle && !rides.length;
    // Untimed, it's a row of the half hour's, with its range (onwardOther's are timed)
    const total = timed ? totalMinutes(shown) : rangeMark(/** @type {HalfRow} */ (row));
    const arrives = timed && html`<span class="trip-arrives">${format(t('trip.arrive'), { time: clockTime(shown.arrives) })}</span>`;
    const line = html`${!fromDoor && walkToFirst(shown) > 0 && html`${walkShort(shown)} · `}${pills} ${fromDoor ? t('trip.from-stops-nearby') : format(t('trip.from-station'), { station: stopName(rail, shown.rides[0].board) })}${timed && firstBusLive(shown, clock)}`;
    if (take) {
        return html`<button type="button" class="trip-card trip-take" data-way="${row.key}" aria-disabled="${checking ? 'true' : 'false'}">
            <span class="trip-take-what">
                <span class="trip-card-head"><span class="sr-only">${t('trip.take-way')} </span><span class="trip-total trip-total-small">${total}</span>${arrives}</span>
                <span class="trip-other">${line}</span>
            </span>
            ${checking ? html`<span class="trip-take-checking">${t('trip.take-checking')}</span>` : icon('more', 'trip-take-chevron')}
        </button>`;
    }
    return html`<div class="trip-card">
        <div class="trip-card-head">
            <h3 class="trip-total trip-total-small">${total}</h3>
            ${arrives}
        </div>
        <p class="trip-other">${line}</p>
    </div>`;
}

// Another way shown to a rider followed along the way (decision 63), on from
// where they are: as another way OASA times, its rides from where it leaves
// the one they're on, never one that can be any of several; a button that
// takes it, by its key (decision 64), `checking` while its bus is checked
/** @param {Rail} rail @param {{ key: string, option: BusOption }} other @param {Clock} clock @param {boolean} checking */
const onwardOther = (rail, { key, option }, clock, checking) => halfOther(rail, { row: { key, bundle: false, lines: [] }, o: option }, { option }, clock, true, checking);

/** @param {Rail} rail @param {{ key: string, option: BusOption }[]} onward @param {Clock} clock @param {string | null} checking */
function onwardOthers(rail, onward, clock, checking) {
    const sorted = [...onward].sort((a, b) => a.option.arrives - b.option.arrives);
    return html`${sorted.length > 0 && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}${sorted.map(other => onwardOther(rail, other, clock, other.key === checking))}`;
}

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
// 48). `rail`, `now`, `epoch`, `weekday`, `date`, stations, legend: as
// renderTrip's. Nothing under it (decision 43) but the legend of what its
// trains show. On the way (T14, decision 50): `switching`, the switch to a
// way 3' or more sooner, with the seconds till it's taken by itself, in the
// quicker way's place; `switched`: the rider is on a way found ahead now,
// which `live` has, with the way back: 'quicker', the switch's, or
// 'picked', another way off the ride they took (decision 64). `othersTimed`: the other ways OASA's live
// times time (otherWay in buses.js, decision 62), by row. `onward`: to a
// rider followed along the way, the other ways on from where they are, in
// place of the half hour's (decision 63), the soonest there first, each
// with its key, buttons that take that way. To be taken (decision 64):
// `take`, the half hour's other ways are buttons that take that way;
// `picked`, the first way is one the rider took so, not the one the half
// hour stands for; `lost`, the way they took can't be caught any more, so
// the half hour's own is first again; `checking`, the key of the way whose
// bus is being checked as it's taken; `gone`, the way tapped wasn't taken,
// as its bus has gone
/**
 * @param {Rail} rail @param {string} kind @param {ReturnType<typeof import('./half.js').halfWays>} ways @param {Place} to
 * @param {{ now: number, epoch?: number | null, weekday: number, date: string, expired?: boolean, longWalk?: boolean,
 *   live?: { way: import('./buses.js').LiveWay } | null, offer?: boolean, taken?: import('./buses.js').HalfRow | null,
 *   switching?: { offer: import('./buses.js').Offer, seconds: number } | null, switched?: false | 'quicker' | 'picked',
 *   othersTimed?: Map<HalfRow, import('./searcher.js').OtherWay>, onward?: import('./searcher.js').OnwardWay[] | null, take?: boolean,
 *   picked?: boolean, lost?: boolean, checking?: string | null, gone?: boolean, noTrains?: boolean,
 *   trains?: Record<string, import('./trains.js').TrainLate> | null, lifts?: Lifts | null, liftsOpen?: boolean, stations?: Record<string, boolean>,
 *   stops?: Set<string>, legend?: boolean, following?: Following | null }} shown
 */
export function renderHalf(rail, kind, ways, to, { now, epoch = null, weekday, date, expired = false, longWalk = false, live = null, offer = false, taken = null, switching = null, switched = /** @type {false | 'quicker' | 'picked'} */ (false), othersTimed = new Map(), onward = null, take = false, picked = false, lost = false, checking = /** @type {string | null} */ (null), gone = false, noTrains = false, trains = null, lifts = null, liftsOpen = true, stations = {}, stops = new Set(), legend: legendShown = true, following = null }) {
    const [first, ...rest] = ways;
    // The other ways, in the half hour's order until OASA times one, then
    // the soonest there first
    /** @param {{ row: HalfRow, o: BusOption }} way */
    const arrives = ({ row, o }) => othersTimed.get(row)?.option.arrives ?? o.arrives;
    const others = (taken ? rest.filter(({ row }) => row !== taken) : [...rest]).sort((a, b) => othersTimed.size ? arrives(a) - arrives(b) : 0);
    // The first card's way, as halfCard shows it
    const shown = live?.way.option ?? (taken ? takenOption(taken, first.departure) : first.o);
    const drawn = { now, epoch, weekday, date, trains: live && trains, stations, stops };
    return html`
        ${missing(false, noTrains)}
        ${expired && notice('warn', 'warning', t('trip.timetable-ended'), 'mb-3')}
        ${lost && notice('warn', 'warning', t('trip.picked-lost'), 'mb-3')}
        ${gone && notice('warn', 'warning', t('trip.take-gone'), 'mb-3')}
        ${stepFree(rail, [shown, ...others.map(way => way.o)], lifts, liftsOpen)}
        ${kind === 'depends' && html`<p class="trip-intro">${t('trip.half-depends-intro')}</p>`}
        ${switched
            ? halfCard(rail, { row: { ...first.row, bundle: false }, o: shown }, to, drawn, false, live, { label: switched === 'picked' ? 'picked' : 'quicker', back: true, following })
            : taken
                ? halfCard(rail, { row: taken, o: takenOption(taken, first.departure) }, to, drawn, false, live, { label: 'quicker', back: true, following })
                : halfCard(rail, first, to, drawn, kind === 'clear' && !picked, live, { label: picked ? 'picked' : null, following })}
        ${switching ? quickerCard(rail, switching.offer, switching.seconds) : offer && live?.way.offer && quickerCard(rail, live.way.offer)}
        ${legend(rail, shown, drawn, legendShown)}
        ${longWalk && longWalkNotice()}
        ${onward ? onwardOthers(rail, onward, { seconds: now, epoch }, checking) : html`
            ${others.length > 0 && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}
            ${others.map(way => halfOther(rail, way, othersTimed.get(way.row) ?? null, { seconds: now, epoch }, take, take && way.row.key === checking))}`}`;
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
