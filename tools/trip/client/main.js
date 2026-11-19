import { announce, format, formatHtml, html, localName, notice, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { watchLifts } from '/js/core/lifts.js';
import { legendOpen, liftsOpen } from '/js/core/metro.js';
import { lastPosition, locationPermission, onLocation, onLocationProblem, showFollowing, startLocation } from '/js/core/location.js';
import { countBadges, minutesMark, minutesWords } from '/js/core/times.js';
import { athensClock, athensNow, closestStation, isTimetableExpired, withSuburban, withTram } from '/tools/subway/network.js';
import { watchLegStations } from '/tools/subway/render.js';
import { suburbanHidden, tramHidden } from '/tools/subway/tram-switch.js';
import { forgetTrip, keepPicked, keepRide, keepTrip, keptTrip } from './kept.js';
import { arrivalsUrl, CHECK_WAIT_MS, checkStop, stillCaught, stopLive } from './live.js';
import { doorToDoor, isLongWalk } from './plan.js';
import { placePicker } from './picker.js';
import { sameRow, tripController } from './controller.js';
import { TRAINS_URL } from './trains.js';
import { firstBusSaid, halfWays, hasBus, hasTrain, howExact, liveNotice, placeTitle, quickerSummary, rangeText, renderHalf, renderTrip, routeSummary, stepFreeSummary, switchIn, takenOption } from './render.js';

const $ = id => document.getElementById(id);
const result = $('trip-result');
const liveBox = $('trip-live-status');
const fromInput = /** @type {HTMLInputElement} */ ($('trip-from'));
const toInput = /** @type {HTMLInputElement} */ ($('trip-to'));
const locate = $('trip-locate');

// The answer worked out again while the page is open; its times count down
// by themselves in between, each TICK_MS (decision 61)
const REFRESH_MS = 60_000;
// How often the times count down, and the live times' stops are checked for
// being due (live.js), as on the Buses page
const TICK_MS = 1_000;
// On a ride followed, a way 3' or more sooner the search ahead finds
// (controller.js) is switched to after this many seconds unless the rider
// keeps theirs (T14)
const SWITCH_SECONDS = 10;
// Buses for everyone (decision 39). /trip?timing also says how long their
// searches take on this device, for phone tests (roadmap Plan 7)
const TIMING = new URLSearchParams(location.search).has('timing');

async function loadJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function loadRail() {
    try {
        return await loadJson('/data/rail.json');
    } catch {
        setHtml(result, notice('danger', 'error', t('trip.data-error')));
        return null;
    }
}

// trains.json, for the suburban rides' cards (decision 47), as the Subway
// page loads it: from the browser's copy, the searches' own being in their
// worker. Nothing waits for it: until it's in, or without it, a train's ride
// is a row
async function loadTrains() {
    try {
        return await loadJson('/data/trains.json');
    } catch {
        return null;
    }
}

/** @typedef {import('./searcher.js').Asked} Asked */
/** @typedef {import('./searcher.js').Answered} Answered */
/**
 * The worker as the page talks to it: what it's asked and what it answers
 * are searcher.js's, so a field one side names differently is a type error
 * @typedef {Omit<Worker, 'postMessage' | 'addEventListener'> & {
 *   postMessage(message: Asked): void,
 *   addEventListener(type: 'message', listener: (event: MessageEvent<Answered>) => void): void,
 *   addEventListener(type: 'error', listener: (event: Event) => void): void }} Searches
 */

// The searches with a bus run in the background (worker.js, decision 32),
// started with the version the page's import map gives it. `rail` is what
// the city is planned on. Null where a browser can't start it: then, as when
// the buses' times can't be loaded, the trip is by metro and tram, and says so
// `suburban`: whether they have the suburban railway, unless it's hidden on the Subway page (decision 41)
/** @returns {Searches | null} */
function startSearches(rail, suburban) {
    try {
        /** @type {Searches} */
        const worker = new Worker(import.meta.resolve('./worker.js'), { type: 'module' });
        worker.postMessage({ rail, suburban });
        return worker;
    } catch {
        return null;
    }
}

// A newer Wayhop is installed, or being installed, and waits until every
// page of the one in use is closed (shell.js, sw.js)
async function updateWaiting() {
    try {
        const registration = await navigator.serviceWorker?.getRegistration();
        return Boolean(navigator.serviceWorker.controller && (registration?.waiting || registration?.installing));
    } catch {
        return false;
    }
}

// The half hour's kind of answer (answer.js), in words; its departures are
// tried every 2 minutes (answer.js's STEP_SECONDS)
const KINDS = { clear: 'trip.half-clear', decision: 'trip.half-decision', depends: 'trip.half-depends', none: 'trip.half-none' };
const halfWords = half => half ? formatHtml(t('trip.timing-half'), { minutes: minutesMark(2, t), ms: half.ms, kind: t(KINDS[half.kind]) }) : t('trip.timing-half-working');

// The timing, under the answer
function timingBox(timing) {
    return html`<div class="trip-card" id="trip-timing">
        <h2 class="route-option-label">${t('trip.timing-title')}</h2>
        <p class="trip-other">${timing.city !== null && html`${format(t('trip.timing-city'), { ms: timing.city })} · `}${format(t('trip.timing-answer'), { ms: timing.answer })}</p>
        <p class="trip-other" id="trip-half" role="status">${halfWords(timing.half)}</p>
    </div>`;
}

// What a place found means for a trip: a metro station is that station, and
// so is a tram stop when the tram is planned on, so there's no walk to it, and
// it goes by the page's language
function chosenPlace(rail, found) {
    const place = { lat: found.lat, lng: found.lng, title: placeTitle(found) };
    const tram = { metro: false, tram: true }[found.placeKind];
    if (tram === undefined || (tram && !Object.values(rail.stations).some(station => station.tram))) return place;
    const station = closestStation(rail, found.lat, found.lng, tram);
    return { ...place, station, title: localName(rail.stations[station].name, language) };
}

// `metro`: rail.json, which the page plans on with its tram or without it
function start(metro) {
    const hidden = tramHidden();
    const rail = hidden ? metro : withTram(metro);
    // Each end's place as search found it, kept on the device (kept.js)
    /** @type {WeakMap<object, object>} */
    const foundOf = new WeakMap();
    const noSuburban = suburbanHidden();
    let searches = startSearches(hidden ? { ...metro, tram: undefined } : metro, !noSuburban);
    // What the answer is drawn on: `rail`, with the day's suburban trains
    // joined once trains.json is in, for their rides' cards (decision 47).
    // The page plans on `rail` alone; its trains come from the searches
    let timetable = null;
    let joined = { date: null, rail };
    const drawnOn = date => {
        if (!timetable) return rail;
        if (joined.date !== date) joined = { date, rail: withSuburban(rail, timetable, date) };
        return joined.rail;
    };
    // The trip, its search answers, its half hour, its live times and the
    // ride followed (controller.js): told what happens (tell, below), it
    // answers with the jobs to do. What it asks of the switch and the
    // decision, still kept here: chosen, below
    const trip = tripController({ buses: Boolean(searches), suburban: !noSuburban, at: Date.now(), hereTitle: t('trip.my-location'), railOn: date => drawnOn(date), chosen: () => chosen() });

    // The way picked kept, put first again in the trip's first answer
    /** @type {string | null} */
    let pickedKept = null;
    // What's kept here of the switch and the decision until they move into
    // the controller (Trip · state, step 5); OASA's live times and the ride
    // followed are the controller's (trip.times, trip.riding). On a decision
    // (decision 36): the rider's choice of the quicker way, taken or kept for
    // the rest of the trip, and whether a quicker way is offered, so it's said
    // once. On a ride followed (decision 50): the switch to the way the search
    // ahead found counting down (`countdown`: its key, the seconds left), held
    // while a pointer is down on it; the way switched to, by key; and the ways
    // the rider kept theirs over, never offered again. The way the rider took from the other ways, by its key
    // (`picked`, decision 64), shown first while the half hour has it;
    // `lost`, it went, so the half hour's own is first again, which is said.
    // On a ride, whose way the one switched to is (`switchedBy`: the
    // switch's, or one the rider took from the other ways) and the way
    // itself, as the worker last sent it, to keep with the trip. The way
    // tapped whose bus is being checked (`checking`: its key, what it showed
    // of its bus, the stop asked, whether that's answered, whether it's a
    // followed rider's, and from the keyboard); `gone`, its bus had gone, so
    // it wasn't taken; `focusNext`, the keyboard goes to the next answer's heading
    const live = {
        /** @type {'taken' | 'kept' | null} */ choice: null, offered: false,
        /** @type {{ key: string, left: number } | null} */ countdown: null, held: false,
        /** @type {string | null} */ switched: null, /** @type {Set<string>} */ declined: new Set(),
        /** @type {string | null} */ picked: null, lost: false,
        /** @type {'quicker' | 'picked' | null} */ switchedBy: null, /** @type {import('./buses.js').Ahead | null} */ switchedWay: null,
        /** @type {{ key: string, said: import('./buses.js').RideLive | undefined, stop: string, answered: boolean, onward: boolean, keyboard: boolean, timer: ReturnType<typeof setTimeout> } | null} */ checking: null,
        gone: false, focusNext: false,
    };
    // Someone is in the answer: the keyboard is there, or a pointer is held
    // down on the switch (T14). It isn't drawn again under them till they're done.
    // The keyboard's focus only: Android's browser focuses a button that's
    // tapped too, and that focus would stop every redraw for good (Road · 3)
    /** @param {Element} box */
    const keyboardIn = box => box.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    const inAnswer = () => live.held || keyboardIn(result);
    // The cards' stations on the way the rider opened or closed (by leg),
    // and the bus stops they opened (by code), kept through the refreshes
    // while the trip goes to the same place, a start that follows My
    // location included (decisions 46 and 48)
    /** @type {{ to: unknown, legs: Record<string, boolean>, stops: Set<string> }} */
    let opened = { to: null, legs: {}, stops: new Set() };
    const openedFor = () => {
        if (opened.to !== trip.to) opened = { to: trip.to, legs: {}, stops: new Set() };
        return opened;
    };
    const openedLegs = () => openedFor().legs;
    const openedStops = () => openedFor().stops;
    watchLegStations(result, openedLegs);
    // A stop's row as the rider opens or closes it, so a redraw while it
    // slides keeps what they chose
    const stopOf = e => /** @type {HTMLElement} */ (e.target).closest('.trip-stop')?.querySelector('.stop-item')?.getAttribute('data-stop');
    result.addEventListener('show.bs.collapse', e => { const code = stopOf(e); if (code) openedStops().add(code); });
    result.addEventListener('hide.bs.collapse', e => { const code = stopOf(e); if (code) openedStops().delete(code); });

    // What the controller asks of the switch and the decision, kept here
    // until they move in: the rider's choice, the ways they kept theirs over,
    // the way switched to itself, and that way with whose it was, to keep
    // with the ride once the worker has sent it
    /** @returns {import('./controller.js').Chosen} */
    const chosen = () => ({ choice: live.choice, declined: [...live.declined], switchedWay: live.switchedWay,
        switched: live.switched && live.switchedWay?.key === live.switched ? { way: live.switchedWay, by: live.switchedBy ?? 'quicker' } : null });
    // No way tapped is being checked any more
    const noCheck = () => {
        clearTimeout(live.checking?.timer);
        return null;
    };
    // A new trip: nothing of the switch and the decision before (the
    // controller starts its live times and the ride over)
    const resetLive = () => {
        Object.assign(live, { choice: null, offered: false, countdown: null, switched: null, declined: new Set(), picked: null, lost: false,
            switchedBy: null, switchedWay: null, checking: noCheck(), gone: false });
    };
    // The trip planned again from where the rider moved to (decision 45):
    // the way before's choice and switch go; the ways kept over and the way
    // picked stay
    const moveLive = () => {
        Object.assign(live, { choice: null, offered: false, countdown: null, switched: null,
            switchedBy: null, switchedWay: null, checking: noCheck(), gone: false });
    };
    // Paused, unavailable or older live times, said above the answer
    /** @param {Parameters<typeof liveNotice>[0]} status */
    const showLive = status => {
        const shown = liveNotice(status);
        setHtml(liveBox, shown);
        liveBox.hidden = !shown;
        liveBox.querySelector('button')?.addEventListener('click', () => tell({ type: 'touch' }));
    };
    // A stop's live times asked of OASA, its answer told with the request's ticket
    /** @param {{ code: string, opening: import('./controller.js').Opening, ticket: number }} job */
    const askStop = async ({ code, opening, ticket }) => {
        let answer = null;
        try {
            const response = await fetch(arrivalsUrl(code, opening), { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            answer = stopLive((await response.json()).stops[code], athensNow().seconds);
        } catch {
            // None came: the controller marks the last one older
        }
        tell({ type: 'stop', code, ticket, answer });
    };
    // How late the suburban trains run, all of them in one request
    const askTrains = async () => {
        let answer = null;
        try {
            const response = await fetch(TRAINS_URL, { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            answer = await response.json();
        } catch {
            // None came: the controller marks the last one older
        }
        tell({ type: 'trains', answer });
    };

    // The answer for leaving at `now`, the ways with a bus being `buses`, or
    // in its place the next half hour's (decision 33), unless walking is
    // quicker, the trains have stopped for the night, or it has nothing to
    // show. Returns the half hour's ways when they're drawn
    const draw = (now, buses, speak) => {
        const answer = doorToDoor(rail, trip.from, trip.to, now, { buses });
        const expired = isTimetableExpired(rail, now);
        const half = trip.halfHour();
        const all = half && !answer.walkFirst && !answer.options[0]?.morning ? halfWays(half.view, now.seconds) : [];
        // The way the rider took from the other ways first, while the half
        // hour has it (decision 64); gone, the half hour's own, said once
        const pickedWay = live.picked ? all.find(way => way.row.key === live.picked) : null;
        if (live.picked && all.length && !pickedWay) {
            Object.assign(live, { picked: null, lost: true });
            keepPicked(null, Date.now());
            announce(t('trip.picked-lost'));
        }
        const ways = pickedWay ? [pickedWay, ...all.filter(way => way !== pickedWay)] : all;
        const picked = Boolean(pickedWay) && pickedWay !== all[0];
        // The way shown in full has OASA's live times when it has a bus, or
        // when it's a decision's directions, for the quicker way's bus, and
        // its trains' lateness when it has a train (decision 42): the
        // worker's latest timing of its row, until the next comes; the
        // quicker way's in its place once the rider takes it (decision 36)
        const [first] = ways;
        const directions = Boolean(first) && half.view.kind === 'decision' && first.row === half.view.rows[0];
        const choice = directions ? live.choice : null;
        // On a ride followed, the way switched to on the way (T14)
        const switched = trip.riding ? live.switched : null;
        // Timed with the live times when it has a bus or a train, or on a
        // decision; and while the rider is followed along it, whatever it has
        const want = first && (hasBus(first.o) || hasTrain(first.o) || directions || trip.riding)
            ? { id: half.id, row: half.view.rows.indexOf(first.row), departure: first.departure, taken: choice === 'taken', switched }
            : null;
        const latest = [trip.times.way, trip.times.directions].find(way => want && sameRow(way, want));
        const timed = latest ? { way: latest.way } : null;
        // The minutes count from the clock, not from when the search was made;
        // the cards' trains are the day's (legs.js), as late as they run
        // when the way is timed with it (decision 47)
        const { seconds: clock, epoch, weekday, date } = athensClock();
        const cards = { weekday, date, stations: openedLegs(), stops: openedStops(), legend: legendOpen() };
        // The switch to a way 3' or more sooner, counting down from when it
        // first comes up, with a buzz where the phone can (T14); in place of
        // the quicker way on a decision
        const sooner = trip.riding && !switched && timed?.way.switchTo;
        const switching = sooner && !live.declined.has(sooner.key) ? sooner : null;
        if (switching?.key !== live.countdown?.key) {
            live.countdown = switching && { key: switching.key, left: SWITCH_SECONDS };
            if (switching) navigator.vibrate?.(200);
        }
        const offer = switching || (!choice && timed?.way.offer);
        // The other ways shown with a bus, timed with OASA's live times
        // (decision 62): not on a ride followed, where they're from the start
        // the rider has left
        const takenRow = choice === 'taken' ? half.view.quicker : null;
        const others = trip.riding ? [] : ways.slice(1).filter(({ row, o }) => row !== takenRow && hasBus(o));
        const othersWant = others.length ? { id: half.id, ways: others.map(({ row, departure }) => ({ row: half.view.rows.indexOf(row), departure })) } : null;
        tell({ type: 'others-shown', want: othersWant });
        // To a rider followed along the way, the ways on from where they
        // are, once searched (decision 63), but the way switched to
        const onward = trip.riding && trip.times.onward ? trip.times.onward.filter(other => other.key !== switched) : null;
        const othersTimed = new Map(trip.times.others.ways
            .filter(way => way && others.some(other => other.row === half.view.rows[way.row] && other.departure === way.departure))
            .map(way => /** @type {[any, any]} */ ([half.view.rows[way.row], way])));
        const known = lifts();
        // The way shown in full, for My location to follow the rider along
        // (decision 50): the first card's, or the answer for leaving now's
        // best; none when walking is quicker or the trains have stopped
        const card = ways.length
            ? timed?.way.option ?? (choice === 'taken' ? takenOption(half.view.quicker, first.departure) : first.o)
            : !answer.walkFirst && !answer.options[0]?.morning ? answer.options[0] ?? null : null;
        // Not while a way switched to isn't timed yet: the first card is still the way before
        if (!(switched && !timed)) tell({ type: 'card', way: card, date });
        const shown = ways.length
            ? renderHalf(drawnOn(date), half.view.kind, ways, trip.to, { now: clock, epoch, expired, longWalk: isLongWalk(ways[0].o), live: timed, offer: !choice, taken: choice === 'taken' ? half.view.quicker : null,
                switching: switching && { offer: switching, seconds: live.countdown.left }, switched: switched ? live.switchedBy ?? 'quicker' : false, othersTimed, onward, take: !trip.riding, picked, lost: live.lost,
                checking: live.checking?.key ?? null, gone: live.gone, noTrains: trip.noTrains, trains: trip.lateness(), lifts: known, liftsOpen: liftsOpen(), following: trip.onStep(), ...cards })
            : renderTrip(drawnOn(date), answer, trip.to, { now: clock, epoch, expired, noBuses: trip.noBuses, noTrains: trip.noTrains && !trip.noBuses, checking: Boolean(searches) && !half, lifts: known, liftsOpen: liftsOpen(), following: trip.onStep(), ...cards });
        setHtml(result, html`${shown}${TIMING && timingBox(trip.timing)}`);
        // The rider's choice redraws the answer at once. From the keyboard,
        // the keyboard goes on to what's there now: the way back or the offer
        // again, or the way shown. A tap leaves it, so the live times go on
        // redrawing (they wait while the keyboard is in the answer)
        const choose = (made, next) => event => {
            live.choice = made;
            draw(now, buses, false);
            if (event.detail === 0) /** @type {HTMLElement | null} */ (result.querySelector(next) ?? result.querySelector('.trip-card h2'))?.focus();
        };
        if (switching) {
            $('trip-quicker-take')?.addEventListener('click', event => switchTo(switching.key, event));
            $('trip-quicker-keep')?.addEventListener('click', event => keepRoute(switching.key, event));
        } else {
            $('trip-quicker-take')?.addEventListener('click', choose('taken', '#trip-quicker-back'));
            $('trip-quicker-keep')?.addEventListener('click', choose('kept', '.trip-card h2'));
        }
        $('trip-quicker-back')?.addEventListener('click', switched ? event => switchBack(event) : choose(null, '#trip-quicker-take'));
        // A quicker way coming up is said once, as it isn't where the keyboard
        // is; the switch with when it's taken by itself
        if (offer && !live.offered) announce(switching ? `${quickerSummary(offer)} ${switchIn(SWITCH_SECONDS)}` : quickerSummary(offer));
        live.offered = Boolean(offer);
        if (speak) {
            const said = ways.length ? halfReady(ways) : answer.options[0] ? routeSummary(answer.options[0]) : t('trip.walk-quicker');
            const access = stepFreeSummary(rail, ways.length ? ways.map(way => way.o) : answer.options, known);
            announce(access ? `${said} ${access}` : said);
        }
        tell({ type: 'shown', want });
        return ways;
    };
    const halfReady = ways => format(t('trip.half-ready'), { range: rangeText(ways[0].row) });

    // The switch on the way (T14, decision 50), drawn again at once. Taken
    // (by the rider, or by itself when the countdown ends), the way found
    // ahead is theirs, and they stay where they are on it; kept, or gone
    // back from, that way is never offered again in this trip. From the
    // keyboard, the keyboard goes on to the way back, or the way shown
    const switchDraw = (event, next) => {
        drawAnswer();
        if (event?.detail === 0) /** @type {HTMLElement | null} */ (result.querySelector(next) ?? result.querySelector('.trip-card h2'))?.focus();
    };
    // `by`: the switch's way, or another way off the ride the rider took
    // (decision 64), a tap on which is said; a countdown is called off
    const switchTo = (key, event = null, by = 'quicker') => {
        Object.assign(live, { switched: key, switchedBy: by, switchedWay: null, countdown: null, held: false });
        tell({ type: 'switched' });
        if (!event) announce(t('trip.switched'));
        else if (by === 'picked' && event.detail !== 0) announce(t('trip.picked-said'));
        switchDraw(event, '#trip-quicker-back');
    };
    const keepRoute = (key, event) => {
        live.declined.add(key);
        Object.assign(live, { countdown: null, held: false });
        switchDraw(event, '.trip-card h2');
    };
    const switchBack = event => {
        if (live.switched) live.declined.add(live.switched);
        Object.assign(live, { switched: null, switchedBy: null, switchedWay: null });
        tell({ type: 'switched' });
        switchDraw(event, '.trip-card h2');
    };
    // A second off the countdown, unless it's out of sight, touched or has
    // the keyboard; at none, taken
    const countDown = () => {
        const card = $('trip-quicker');
        if (!live.countdown || !card || document.hidden || live.held || keyboardIn(card)) return;
        live.countdown.left--;
        if (live.countdown.left <= 0) { switchTo(live.countdown.key); return; }
        const timer = $('trip-switch-timer');
        if (timer) timer.textContent = switchIn(live.countdown.left);
    };
    result.addEventListener('pointerdown', e => { live.held = Boolean(/** @type {HTMLElement} */ (e.target).closest('#trip-quicker')); });
    ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, () => { live.held = false; }));

    // Another way taken (decision 64), by where the rider is. Before they've
    // left, it's the way shown in full, and the one it replaces goes among
    // the other ways; kept with the trip. Followed, on a ride, it's taken as
    // the switch's is, with the way back; walking or waiting, the trip is
    // planned again from where they are, with that way picked. From the
    // keyboard, the keyboard goes on to the way shown's heading (or the way
    // back); a tap is said
    const takeNow = ({ key, leg }, keyboard) => {
        if (!trip.riding) {
            Object.assign(live, { picked: key, lost: false, choice: null });
            keepPicked(key, Date.now());
            drawAnswer();
            if (keyboard) /** @type {HTMLElement | null} */ (result.querySelector('.trip-card h2'))?.focus();
            else announce(t('trip.picked-said'));
            return;
        }
        if (leg >= 0) { switchTo(key, { detail: keyboard ? 0 : 1 }, 'picked'); return; }
        const at = trip.fix ?? lastPosition();
        if (!at) return;
        Object.assign(live, { picked: key, lost: false, focusNext: keyboard });
        keepPicked(key, Date.now());
        if (!keyboard) announce(t('trip.picked-said'));
        tell({ type: 'moved', position: at });
    };
    // The way tapped, as drawn: before the rider has left, the half hour's
    // row by its key, with OASA's timing of it when it has one; followed,
    // the way on from where they are (decision 63), with the ride it leaves
    const tappedWay = key => {
        if (trip.riding) return trip.times.onward?.find(other => other.key === key) ?? null;
        const timed = trip.times.others.ways.find(way => way && trip.halfHour()?.view.rows[way.row]?.key === key);
        return { key, leg: -1, option: timed?.option ?? null, asks: timed?.asks ?? [] };
    };
    const focusWay = key => /** @type {HTMLElement | null} */ (result.querySelector(`[data-way="${CSS.escape(key)}"]`) ?? result.querySelector('.trip-card h2'))?.focus();
    // Checked on the tap: a way whose bus OASA had coming has that bus's
    // stop asked again when its answer is 30 s old or more (checkStop), at
    // most one request a tap, said on the card meanwhile; taken at once otherwise
    const takeWay = (key, event) => {
        if (!trip.answer() || trip.holding() || live.checking) return;
        const way = tappedWay(key);
        if (!way) return;
        live.gone = false;
        const keyboard = event.detail === 0;
        const said = way.option ? firstBusSaid(way.option) : undefined;
        const asked = way.asks[0] ? trip.times.asked.get(way.asks[0].stop) : undefined;
        const stop = checkStop(said, way.asks, asked, Date.now());
        if (!stop) { takeNow(way, keyboard); return; }
        live.checking = { key, said, stop, answered: false, onward: trip.riding, keyboard, timer: setTimeout(() => settleCheck(true), CHECK_WAIT_MS) };
        drawAnswer();
        if (keyboard) focusWay(key);
        announce(t('trip.take-checking'));
        tell({ type: 'check', code: stop });
    };
    // The way tapped, timed again with its stop's new answer (or none came
    // in time: `timedOut`): taken while its bus can still be caught; gone,
    // not taken, said, and the ways searched again at once
    const settleCheck = (timedOut = false) => {
        const check = live.checking;
        live.checking = noCheck();
        if (!check || !trip.answer()) return;
        const way = check.onward === trip.riding ? tappedWay(check.key) : null;
        if (way && (timedOut || stillCaught(check.said, way.option ? firstBusSaid(way.option) : undefined))) { takeNow(way, check.keyboard); return; }
        live.gone = true;
        announce(t('trip.take-gone'));
        if (trip.riding) tell({ type: 'retime', ahead: true });
        else tell({ type: 'gone' });
        drawAnswer();
        if (check.keyboard) focusWay(check.key);
    };
    // Its timing in, after the stop's new answer: for the half hour's other
    // ways, or a followed rider's (`onward`)
    const checked = onward => {
        if (live.checking?.answered && live.checking.onward === onward) settleCheck();
    };
    result.addEventListener('click', e => {
        const button = /** @type {HTMLElement} */ (e.target).closest('[data-way]');
        if (button instanceof HTMLElement && button.dataset.way) takeWay(button.dataset.way, e);
    });

    // The controller's jobs (controller.js), carried out in order
    /** @param {import('./controller.js').TripJob} job */
    const carryOut = job => {
        switch (job.do) {
            case 'keep':
                keepTrip({ from: foundOf.get(job.from) ?? null, to: foundOf.get(job.to) ?? null }, Date.now());
                break;
            case 'intro':
                setHtml(result, html`<p class="trip-intro">${t('trip.intro')}</p>`);
                break;
            case 'new-trip': {
                // Said while it's worked out, the first of the day taking
                // longest, as the day's city is made for it
                setHtml(result, html`<p class="trip-intro" role="status">${t('trip.working')}</p>`);
                resetLive();
                const { resumed } = job;
                if (resumed) {
                    Object.assign(live, { choice: resumed.choice ?? null });
                    // The way switched to on the ride, as it was (decision 64)
                    if (resumed.switched) Object.assign(live, { switched: resumed.switched.way.key, switchedBy: resumed.switched.by, switchedWay: resumed.switched.way });
                }
                // The way picked when the page was last open, for the trip kept (decision 64)
                if (pickedKept) live.picked = pickedKept;
                pickedKept = null;
                break;
            }
            case 'reset-live':
                resetLive();
                break;
            case 'move-live':
                moveLive();
                break;
            case 'search':
                searches?.postMessage(job.ask);
                break;
            case 'draw': {
                const ways = draw(job.now, job.buses, job.speak);
                if (!job.half) break;
                // The half hour just in, said; when it was planned again for a
                // way taken from the keyboard, the keyboard goes on to its
                // heading (takeNow)
                if (ways.length && job.half.say) announce(halfReady(ways));
                if (live.focusNext) /** @type {HTMLElement | null} */ (result.querySelector('.trip-card h2'))?.focus();
                live.focusNext = false;
                break;
            }
            case 'timing': {
                const box = $('trip-half');
                if (box) setHtml(box, halfWords(trip.timing.half));
                break;
            }
            case 'retime':
                tell({ type: 'retime' });
                break;
            case 'time':
                searches?.postMessage(job.ask);
                break;
            case 'draw-answer':
                if (!inAnswer()) drawAnswer();
                break;
            case 'show-live':
                showLive(job.status);
                break;
            case 'ask-stop':
                askStop(job);
                break;
            case 'ask-trains':
                askTrains();
                break;
            // The way tapped is timed again with it, and then taken or not (takeWay)
            case 'stop-in':
                if (live.checking?.stop === job.code) live.checking.answered = true;
                break;
            case 'switched-way':
                if (job.way.key === live.switched) live.switchedWay = job.way;
                break;
            case 'checked':
                checked(job.onward);
                break;
            case 'following':
                showFollowing(locate, job.on);
                break;
            case 'start-location':
                startLocation();
                break;
            case 'from-here':
                fromInput.value = t('trip.my-location');
                fromPicker.say('');
                break;
            case 'from-status':
                fromPicker.say(fromStatus(job.status));
                break;
            case 'keep-ride':
                keepRide(job.ride, Date.now());
                break;
        }
    };
    /** @param {import('./controller.js').TripEvent} event */
    const tell = event => {
        for (const job of trip.tell(event, { ms: Date.now(), now: athensNow(), hidden: document.hidden })) carryOut(job);
    };
    // The latest answer drawn again as it is, while it's the trip's
    const drawAnswer = () => {
        const shown = trip.answer();
        if (shown) draw(shown.now, shown.options, false);
    };
    // The answer drawn again with what came in, unless someone is in it:
    // then with the next refresh
    const redraw = () => tell({ type: 'redraw', held: inAnswer() });
    // The times count down, signal or not, and while the answer is held too
    // (badges only, so the keyboard stays where it is); one gone draws the
    // answer again, for what comes after it, once nobody's in it (decision 61)
    const countTimes = () => {
        if (!document.hidden && countBadges(result, t)) redraw();
    };
    // Lifts out of service and the lift status (STASY), for the step-free
    // notice: asked for at once, so they're in by the first answer, and
    // drawn in when they come
    const lifts = watchLifts(redraw);
    lifts();
    // The suburban trains' timetable, unless the railway is hidden on the
    // Subway page (decision 41): their rides' cards drawn in when it comes
    if (!noSuburban) {
        loadTrains().then(loaded => {
            timetable = loaded;
            if (loaded) redraw();
        });
    }

    // The searches can't be had: by metro and tram from now on. With a newer
    // Wayhop waiting, it's most likely an older copy of the searches, kept by
    // a service worker from before they came from the server first (sw.js):
    // it says so, as closing Wayhop everywhere brings the new one
    const fail = async () => {
        if (!searches) return;
        searches.terminate();
        searches = null;
        tell({ type: 'failed', updated: await updateWaiting() });
    };
    searches?.addEventListener('error', fail);
    searches?.addEventListener('message', ({ data }) => {
        if ('error' in data) { fail(); return; }
        if ('live' in data) {
            tell({ type: 'timed', ...data.live });
            return;
        }
        if ('others' in data) {
            tell({ type: 'others-timed', ...data.others });
            return;
        }
        // Drawn at once, unless someone is in the answer, but when it was
        // planned again for a way taken from the keyboard (takeNow)
        if ('half' in data) {
            tell({ type: 'half', id: data.id, view: data.half, held: inAnswer() && !live.focusNext });
            return;
        }
        tell({ type: 'answer', id: data.id, options: data.options, trains: data.trains, timing: data.timing, held: inAnswer() });
    });

    // A place found, chosen for an end, with what it was found as
    const placeFor = found => {
        const place = chosenPlace(rail, found);
        foundOf.set(place, found);
        return place;
    };
    // How exact an end is, under its field, as when it was picked (picker.js)
    const sayExact = (picker, place) => {
        const found = place && foundOf.get(place);
        picker.say((found && howExact(found)?.words) ?? '');
    };
    // The field says the place as the answer does: a station by the page's
    // language. A start typed or picked turns My location off (the controller)
    /** @param {HTMLInputElement} input @param {'from' | 'to'} end */
    const chooser = (input, end) => found => {
        const place = found ? placeFor(found) : null;
        if (place) input.value = place.title;
        tell({ type: end, place, say: Boolean(found) });
    };
    // What From's status line says of My location (the controller's
    // from-status): finding it, blocked, unavailable, following the ride, or
    // how long ago the last position came (underground)
    /** @param {'finding' | 'denied' | 'unavailable' | 'following' | number} status */
    const fromStatus = status => typeof status === 'number' ? format(t('trip.last-position'), { minutes: minutesWords(status, t) })
        : { finding: t('trip.finding-location'), denied: t('trip.location-denied'), unavailable: t('trip.location-unavailable'), following: t('trip.following') }[status];
    // My location (DESIGN.md, "Start from here"): while it's on, From follows
    // where the rider is, and once they've left, the way shown in full is
    // theirs and each fix places them on it (decision 50; before a way to
    // follow, the trip is planned again once they've moved far enough,
    // decision 45); all of it the controller's. Typing or picking a start,
    // swapping, or location blocked turns it off; pressed again, it looks
    // again. The position stays on this device.

    // A field holds a choice while its place is set (My location's too):
    // typing sets it to null
    const fromPicker = placePicker({ input: fromInput, list: $('trip-from-list'), status: $('trip-from-status'), rail, onChange: chooser(fromInput, 'from'), chosen: () => Boolean(trip.from) });
    const toPicker = placePicker({ input: toInput, list: $('trip-to-list'), status: $('trip-to-status'), rail, onChange: chooser(toInput, 'to'), chosen: () => Boolean(trip.to) });

    // What was typed before the train times had loaded is replayed as
    // typing, so it's searched
    [fromInput, toInput].forEach(input => {
        if (input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The trip kept from earlier in this session, unless something was typed
    // first. With no start kept, My location starts it as below
    const kept = !fromInput.value && !toInput.value ? keptTrip(Date.now()) : null;
    const keptFrom = kept?.from ? placeFor(kept.from) : null;
    const keptTo = kept?.to ? placeFor(kept.to) : null;
    tell({ type: 'kept', from: keptFrom, to: keptTo });
    if (keptFrom) { fromInput.value = keptFrom.title; sayExact(fromPicker, keptFrom); }
    if (keptTo) { toInput.value = keptTo.title; sayExact(toPicker, keptTo); }
    // The ride followed from My location when the page was last open
    // (decision 58): taken up below, in place of a start from where the rider is
    const resume = kept?.ride && !kept.from && trip.to ? kept.ride : null;
    pickedKept = kept?.picked ?? null;
    // The link to this page starts it over, as on the other tools (remember.js)
    document.querySelectorAll('a[data-tool="trip"]').forEach(link => link.addEventListener('click', forgetTrip));

    $('trip-swap').addEventListener('click', () => {
        [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
        sayExact(fromPicker, trip.to);
        sayExact(toPicker, trip.from);
        tell({ type: 'swap' });
    });

    locate.addEventListener('click', () => tell({ type: 'locate', known: lastPosition() }));
    // On by itself, a position never fills From while someone is in it,
    // perhaps about to type a start of their own
    const inFrom = () => document.activeElement === fromInput;
    onLocation(position => tell({ type: 'located', position, typing: inFrom(), held: inAnswer() }));
    onLocationProblem(problem => tell({ type: 'location-problem', problem }));

    // On when the page opens without a start: from a recent position at
    // once, then following it if the browser already allows that. Nothing
    // asks for the location here, and what's typed meanwhile wins. The
    // answer isn't said, as nothing is said of a trip the page opens with
    if (!fromInput.value) {
        const last = lastPosition();
        if (resume) tell({ type: 'resume', ride: resume });
        else if (last && !inFrom()) tell({ type: 'use-location', position: last, say: false });
        locationPermission().then(permission => tell({ type: 'permission', permission, typed: Boolean(fromInput.value) }));
    }

    setInterval(() => tell({ type: 'refresh', held: inAnswer() }), REFRESH_MS);
    // Each second: the switch's countdown, the times counting down, and the
    // controller's second (a re-plan once the rider has moved far enough or
    // is off the way, From's status line, the live times asked when due or
    // paused), with the last position there is
    setInterval(() => {
        countDown();
        countTimes();
        tell({ type: 'second', position: lastPosition(), held: inAnswer() });
    }, TICK_MS);
    // Any tap or key press counts as someone looking at the page
    const touch = () => tell({ type: 'touch' });
    document.addEventListener('pointerdown', touch, { passive: true });
    document.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', () => {
        // Where the rider is, kept as the phone may close the app now
        if (document.hidden) { tell({ type: 'hidden' }); return; }
        // Timers wait while the phone is locked: the times catch up at once
        countTimes();
        tell({ type: 'visible', position: lastPosition(), held: inAnswer() });
    });
    // The ride kept was searched again as it was taken up (the resume): a
    // second search here would be for now, and would drop what came back
    // with it (the decision's choice, the rider's own bus, the way switched to)
    if (!resume) tell({ type: 'open' });
}

// The metro and the tram, or the metro alone when the tram is hidden on the
// Subway page (decision 29)
const metro = await loadRail();
if (metro) start(metro);
