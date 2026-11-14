import { announce, format, formatHtml, html, localName, notice, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { watchLifts } from '/js/core/lifts.js';
import { legendOpen, liftsOpen } from '/js/core/metro.js';
import { lastPosition, locationPermission, onLocation, onLocationProblem, showFollowing, startLocation } from '/js/core/location.js';
import { minutesMark, minutesWords } from '/js/core/times.js';
import { athensNow, closestStation, isTimetableExpired, withSuburban, withTram } from '/tools/subway/network.js';
import { watchLegStations } from '/tools/subway/render.js';
import { suburbanHidden, tramHidden } from '/tools/subway/tram-switch.js';
import { walkSeconds } from '/tools/subway/city.js';
import { isIdle } from '/tools/buses/timing.js';
import { carry, GAP_MS, leftStart, offDue, placeOn, replanDue, REPLAN_MS, startOver, starting, stepOf, stillDue, waySteps } from './follow.js';
import { forgetTrip, keepTrip, keptTrip } from './kept.js';
import { arrivalsUrl, dueStops, liveStatus, ownBus, stopLive, unanswered } from './live.js';
import { doorToDoor, isLongWalk } from './plan.js';
import { placePicker } from './picker.js';
import { TRAINS_URL, trainsDue, trainsUnanswered } from './trains.js';
import { halfWays, hasBus, hasTrain, howExact, liveNotice, placeTitle, quickerSummary, rangeText, renderHalf, renderTrip, routeSummary, stepFreeSummary, switchIn, takenOption } from './render.js';

const $ = id => document.getElementById(id);
const result = $('trip-result');
const liveBox = $('trip-live-status');
const fromInput = /** @type {HTMLInputElement} */ ($('trip-from'));
const toInput = /** @type {HTMLInputElement} */ ($('trip-to'));
const locate = $('trip-locate');

// Keeps the times current while the page is open
const REFRESH_MS = 60_000;
// The next half hour is worked out again once it's this old, while the page
// is open (decision 33)
const HALF_REWORK_SECONDS = 600;
// How often the live times' stops are checked for being due (live.js), as on the Buses page
const TICK_MS = 1_000;
// On a ride followed, the search ahead runs at each stop reached, at most
// this often (decision 50); a way 3' or more sooner it finds is switched to
// after this many seconds unless the rider keeps theirs (T14)
const AHEAD_MS = 60_000;
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

// The searches with a bus run in the background (worker.js, decision 32),
// started with the version the page's import map gives it. `rail` is what
// the city is planned on. Null where a browser can't start it: then, as when
// the buses' times can't be loaded, the trip is by metro and tram, and says so
// `suburban`: whether they have the suburban railway, unless it's hidden on the Subway page (decision 41)
function startSearches(rail, suburban) {
    try {
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
    let from = null;
    let to = null;
    // Each end's place as search found it, kept for the session (kept.js)
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
    /** @type {boolean | 'updated'} */
    let noBuses = !searches;
    // The suburban railway has no times for today, so the searches leave it out
    // (decision 41); not said when it's hidden on the Subway page
    let noTrains = false;
    // What's been asked of the searches: the latest trip, and the latest half
    // hour (only the latest of each is answered); the latest answer, the ways
    // with a bus for leaving at its `now`; and the latest half hour's answer.
    // Each for the trip it says
    let asked = null;
    let askedHalf = null;
    let found = null;
    let half = null;
    const timing = { city: null, answer: 0, half: null };
    const forTrip = what => what?.from === from && what?.to === to;
    // The trip as last planned, and when (decision 45: My location plans it
    // again once the rider has moved far enough). While it's planned again
    // from where they moved to, the answer shown stays until the new one's
    // next half hour is in, so it doesn't change twice every 2 minutes
    let planned = { from, to, at: 0 };
    let moving = false;
    const holding = () => moving && !forTrip(half);

    // My location following the rider's own ride (Plan 7, decision 50): the
    // way shown in full as the steps it's followed by (follow.js), which way
    // they're for (`key`, by its stops), where the last fix put the rider on
    // them, whether they've left the start, and what From's status line says
    // of it. `following` itself is My location's switch (below)
    // `carrying`: the next way is one switched to on the way, or back, so the
    // rider's place carries over (carry)
    let following = false;
    const ride = { key: null, way: null, steps: null, state: starting(), left: false, said: null, carrying: false };
    const riding = () => Boolean(following && to && ride.left && ride.steps);
    const keyOf = o => o.city ? o.rides.map(r => `${r.board.id}>${r.alight.id}`).join() : o.plan.legs.map(leg => `${leg.from}>${leg.to}`).join();
    // The steps are made again only for another way: a trip planned again,
    // or the quicker way taken; the rider's place on them starts over, where
    // the last fix had them, but for a way switched to on the way or back
    const followWay = (o, date) => {
        const key = o ? keyOf(o) : null;
        if (key === ride.key) return;
        const steps = o ? waySteps(o, from, to, drawnOn(date)) : null;
        const state = ride.carrying && ride.steps && steps ? carry(ride.steps, ride.state, steps) : startOver(ride.state);
        Object.assign(ride, { key, way: o, steps, state, carrying: false });
    };
    const resetRide = () => Object.assign(ride, { key: null, way: null, steps: null, state: starting(), left: false, said: null, carrying: false });
    // Where the rider is, for the worker to time the way from (buses.js
    // LiveStep): as of now, or of the last fix when none has come for a while
    // (underground), so nothing slides to the next train; a walk by what's
    // left of it from the last fix
    const stepFor = () => {
        if (!riding()) return null;
        const step = stepOf(ride.steps, ride.state);
        const { fix, at, stop } = ride.state;
        const frozen = fix && Date.now() - fix.at > GAP_MS;
        const walk = fix && (step.kind === 'walk' || step.kind === 'last') ? Math.round(walkSeconds(fix, step.to)) : 0;
        return { leg: 'ride' in step ? step.ride : 0, kind: step.kind, stop, at: athensNow(new Date(frozen ? at : Date.now())).seconds, walk };
    };
    // For the answer drawn: the step the rider is on
    const followingShown = () => riding() ? stepOf(ride.steps, ride.state) : null;

    // OASA's live times for the way shown in full (decision 35): which way
    // that is (`wanted`: the half hour `id`'s `row`, for `departure`), the
    // worker's latest timing of it with the live times there are (`way`), each
    // stop's latest answer, when each was asked, those being asked, what the
    // next new stop's request says (`opening`: a new trip's first, or the first
    // after it was planned again from where the rider moved to, decision 45),
    // and whether asking is paused. `seq`
    // counts what's asked of the worker, as only its latest answer counts;
    // `trip`, each new trip, so an answer for an older one is dropped. On a
    // decision (decision 36): the rider's choice of the quicker way, taken
    // or kept for the rest of the trip; the directions' latest timing, drawn
    // at once if the rider goes back to them; and whether a quicker way is
    // offered, so it's said once. How late the suburban trains run (decision
    // 42): the latest answer, for every train, so kept from trip to trip;
    // when it was asked for, and whether it's being asked for. On a ride
    // followed (decision 50): when the search ahead last ran; the switch to
    // the way it found counting down (`countdown`: its key, the seconds
    // left), held while a pointer is down on it; the way switched to, by
    // key; and the ways the rider kept theirs over, never offered again
    const live = {
        seq: 0, trip: 0, wanted: null, way: null,
        /** @type {Map<string, import('./buses.js').StopLive>} */ answers: new Map(),
        /** @type {Map<string, number>} */ asked: new Map(),
        /** @type {Set<string>} */ asking: new Set(),
        /** @type {'start' | 'moved' | null} */ opening: 'start', paused: false, touched: Date.now(),
        /** @type {import('./buses.js').OwnBus | null} */ own: null,
        /** @type {'taken' | 'kept' | null} */ choice: null, directions: null, offered: false,
        /** @type {import('./trains.js').TrainsLive | null} */ trains: null, trainsAsked: -Infinity, askingTrains: false,
        aheadAt: -Infinity, /** @type {{ key: string, left: number } | null} */ countdown: null, held: false,
        /** @type {string | null} */ switched: null, /** @type {Set<string>} */ declined: new Set(),
    };
    // Someone is in the answer: the keyboard is there, or a pointer is held
    // down on the switch (T14). It isn't drawn again under them till they're done.
    // The keyboard's focus only: Android's browser focuses a button that's
    // tapped too, and that focus would stop every redraw for good (Road · 3)
    /** @param {Element} box */
    const keyboardIn = box => box.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    const inAnswer = () => live.held || keyboardIn(result);
    const sameRow = (a, b) => a?.id === b?.id && a?.row === b?.row && Boolean(a?.taken) === Boolean(b?.taken) && (a?.switched ?? null) === (b?.switched ?? null);
    // The cards' stations on the way the rider opened or closed (by leg),
    // and the bus stops they opened (by code), kept through the refreshes
    // while the trip goes to the same place, a start that follows My
    // location included (decisions 46 and 48)
    /** @type {{ to: unknown, legs: Record<string, boolean>, stops: Set<string> }} */
    let opened = { to: null, legs: {}, stops: new Set() };
    const openedFor = () => {
        if (opened.to !== to) opened = { to, legs: {}, stops: new Set() };
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

    // How late the suburban trains run, by number, as the way shown in full
    // is timed with it: none while it can't be had
    const lateness = () => live.trains?.unavailable ? null : live.trains?.trains ?? null;
    // The way shown in full, timed again by the worker with the live times
    // there are, for leaving now; or nothing to time, as it has no bus.
    // `ahead`: search ahead from the ride the rider is on first
    const retime = (want = live.wanted, ahead = false) => {
        live.wanted = want;
        if (!want || !searches) {
            if (live.way) { live.way = null; showLive(); }
            return;
        }
        searches.postMessage({ id: want.id, live: { seq: ++live.seq, row: want.row, departure: want.departure, now: athensNow(), stops: Object.fromEntries(live.answers), taken: want.taken, trains: lateness(), step: stepFor(), own: live.own,
            ahead, declined: [...live.declined], switched: want.switched } });
    };
    const resetLive = () => {
        Object.assign(live, { trip: live.trip + 1, wanted: null, way: null, answers: new Map(), asked: new Map(), asking: new Set(), opening: 'start', choice: null, directions: null, offered: false, own: null,
            aheadAt: -Infinity, countdown: null, switched: null, declined: new Set() });
        showLive();
    };
    // The trip planned again from where the rider moved to (decision 45):
    // each stop keeps its answer and its turn on the tiers, so only the
    // stops new to its way are asked at once. The way being timed goes, and
    // an answer for it still to come from the worker is dropped
    const moveLive = () => {
        Object.assign(live, { seq: live.seq + 1, wanted: null, way: null, opening: 'moved', choice: null, directions: null, offered: false, own: null, aheadAt: -Infinity, countdown: null, switched: null });
        showLive();
    };
    // Paused, unavailable or older live times, said above the answer
    const showLive = () => {
        const shown = live.way ? liveNotice(liveStatus(live.way.way.asks, live.answers, live.paused, live.way.way.train === null ? null : live.trains)) : '';
        setHtml(liveBox, shown);
        liveBox.hidden = !shown;
        liveBox.querySelector('button')?.addEventListener('click', interact);
    };
    // A stop's live times, one request each, so each shows as soon as it's in
    const ask = async (code, opening) => {
        const trip = live.trip;
        live.asking.add(code);
        let answer;
        try {
            const response = await fetch(arrivalsUrl(code, opening), { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            answer = stopLive((await response.json()).stops[code], athensNow().seconds);
        } catch {
            answer = unanswered(live.answers.get(code));
        }
        if (trip !== live.trip) return;
        live.answers.set(code, answer);
        live.asked.set(code, Date.now());
        live.asking.delete(code);
        showLive();
        retime();
    };
    // How late the suburban trains run, all of them in one request
    const askTrains = async () => {
        live.askingTrains = true;
        let answer;
        try {
            const response = await fetch(TRAINS_URL, { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            answer = await response.json();
        } catch {
            answer = trainsUnanswered(live.trains);
        }
        Object.assign(live, { trains: answer, trainsAsked: Date.now(), askingTrains: false });
        showLive();
        retime();
    };
    // The stops that are due (live.js), and the trains when the way has one
    // (trains.js): nothing while paused or out of sight. The first stop not
    // asked before says the trip's `opening`; after a re-plan that kept
    // every stop, nothing does. A stop first asked for the ride the rider is
    // on (their own bus's, decision 50) says that instead
    const askDue = () => {
        if (!live.way || live.paused || document.hidden) return;
        const seconds = athensNow().seconds;
        const due = dueStops(live.way.way.asks, live, Date.now(), seconds);
        const forRide = new Set(live.way.way.asks.filter(a => a.ride).map(a => a.stop));
        const first = due.find(code => !live.answers.has(code) && !forRide.has(code));
        for (const code of due) ask(code, forRide.has(code) ? live.answers.has(code) ? null : 'ride' : code === first ? live.opening : null);
        live.opening = null;
        const { train } = live.way.way;
        if (train !== null && trainsDue(train, { asking: live.askingTrains, asked: live.trainsAsked, answer: live.trains }, Date.now(), seconds)) askTrains();
    };
    // Any tap or key press counts as someone looking at the page
    const interact = () => {
        live.touched = Date.now();
        if (!live.paused) return;
        live.paused = false;
        showLive();
        retime();
    };

    // The answer for leaving at `now`, the ways with a bus being `buses`, or
    // in its place the next half hour's (decision 33), unless walking is
    // quicker, the trains have stopped for the night, or it has nothing to
    // show. Returns the half hour's ways when they're drawn
    const draw = (now, buses, speak) => {
        const trip = doorToDoor(rail, from, to, now, { buses });
        const expired = isTimetableExpired(rail, now);
        const ways = forTrip(half) && !trip.walkFirst && !trip.options[0]?.morning ? halfWays(half.view, now.seconds) : [];
        // The way shown in full has OASA's live times when it has a bus, or
        // when it's a decision's directions, for the quicker way's bus, and
        // its trains' lateness when it has a train (decision 42): the
        // worker's latest timing of its row, until the next comes; the
        // quicker way's in its place once the rider takes it (decision 36)
        const [first] = ways;
        const directions = Boolean(first) && half.view.kind === 'decision' && first.row === half.view.rows[0];
        const choice = directions ? live.choice : null;
        // On a ride followed, the way switched to on the way (T14)
        const switched = riding() ? live.switched : null;
        // Timed with the live times when it has a bus or a train, or on a
        // decision; and while the rider is followed along it, whatever it has
        const want = first && (hasBus(first.o) || hasTrain(first.o) || directions || riding())
            ? { id: half.id, row: half.view.rows.indexOf(first.row), departure: first.departure, taken: choice === 'taken', switched }
            : null;
        const latest = [live.way, live.directions].find(way => want && sameRow(way, want));
        const timed = latest ? { way: latest.way } : null;
        // The minutes count from the clock, not from when the search was made;
        // the cards' trains are the day's (legs.js), as late as they run
        // when the way is timed with it (decision 47)
        const { seconds: clock, weekday, date } = athensNow();
        const cards = { weekday, date, stations: openedLegs(), stops: openedStops(), legend: legendOpen() };
        // The switch to a way 3' or more sooner, counting down from when it
        // first comes up, with a buzz where the phone can (T14); in place of
        // the quicker way on a decision
        const sooner = riding() && !switched && timed?.way.switchTo;
        const switching = sooner && !live.declined.has(sooner.key) ? sooner : null;
        if (switching?.key !== live.countdown?.key) {
            live.countdown = switching && { key: switching.key, left: SWITCH_SECONDS };
            if (switching) navigator.vibrate?.(200);
        }
        const offer = switching || (!choice && timed?.way.offer);
        const known = lifts();
        // The way shown in full, for My location to follow the rider along
        // (decision 50): the first card's, or the answer for leaving now's
        // best; none when walking is quicker or the trains have stopped
        const card = ways.length
            ? timed?.way.option ?? (choice === 'taken' ? takenOption(half.view.quicker, first.departure) : first.o)
            : !trip.walkFirst && !trip.options[0]?.morning ? trip.options[0] ?? null : null;
        followWay(following ? card : null, date);
        const shown = ways.length
            ? renderHalf(drawnOn(date), half.view.kind, ways, to, { now: clock, expired, longWalk: isLongWalk(ways[0].o), live: timed, offer: !choice, taken: choice === 'taken' ? half.view.quicker : null,
                switching: switching && { offer: switching, seconds: live.countdown.left }, switched: Boolean(switched), noTrains, trains: lateness(), lifts: known, liftsOpen: liftsOpen(), following: followingShown(), ...cards })
            : renderTrip(drawnOn(date), trip, to, { now: clock, expired, noBuses, noTrains: noTrains && !noBuses, checking: Boolean(searches) && !forTrip(half), lifts: known, liftsOpen: liftsOpen(), following: followingShown(), ...cards });
        const answer = html`${shown}${TIMING && timingBox(timing)}`;
        setHtml(result, answer);
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
            const said = ways.length ? halfReady(ways) : trip.options[0] ? routeSummary(trip.options[0]) : t('trip.walk-quicker');
            const access = stepFreeSummary(rail, ways.length ? ways.map(way => way.o) : trip.options, known);
            announce(access ? `${said} ${access}` : said);
        }
        if (!sameRow(live.wanted, want) || live.wanted?.departure !== want?.departure) retime(want);
        return ways;
    };
    const halfReady = ways => format(t('trip.half-ready'), { range: rangeText(ways[0].row) });

    // The switch on the way (T14, decision 50), drawn again at once. Taken
    // (by the rider, or by itself when the countdown ends), the way found
    // ahead is theirs, and they stay where they are on it; kept, or gone
    // back from, that way is never offered again in this trip. From the
    // keyboard, the keyboard goes on to the way back, or the way shown
    const switchDraw = (event, next) => {
        if (forTrip(found)) draw(found.now, found.options, false);
        if (event?.detail === 0) /** @type {HTMLElement | null} */ (result.querySelector(next) ?? result.querySelector('.trip-card h2'))?.focus();
    };
    const switchTo = (key, event = null) => {
        Object.assign(live, { switched: key, countdown: null, held: false });
        ride.carrying = true;
        if (!event) announce(t('trip.switched'));
        switchDraw(event, '#trip-quicker-back');
    };
    const keepRoute = (key, event) => {
        live.declined.add(key);
        Object.assign(live, { countdown: null, held: false });
        switchDraw(event, '.trip-card h2');
    };
    const switchBack = event => {
        if (live.switched) live.declined.add(live.switched);
        live.switched = null;
        ride.carrying = true;
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

    // The answer drawn again with what came in, unless someone is in it:
    // then with the next refresh
    const redraw = () => {
        if (!from || !to || inAnswer()) return;
        if (!searches) draw(athensNow(), [], false);
        else if (forTrip(found) && !holding()) draw(found.now, found.options, false);
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

    // `refresh`: the same trip, for a later time; `moved`: planned again
    // from where the rider moved to
    const render = ({ speak = false, refresh = false, moved = false } = {}) => {
        keepTrip({ from: foundOf.get(from) ?? null, to: foundOf.get(to) ?? null }, Date.now());
        const ready = from && to;
        if (!ready) { setHtml(result, html`<p class="trip-intro">${t('trip.intro')}</p>`); return; }
        if (!forTrip(planned)) planned = { from, to, at: Date.now() };
        const now = athensNow();
        if (!searches) { draw(now, [], speak); return; }
        const same = forTrip(found);
        // Followed along the way, the rider has left: the answer isn't
        // searched again for someone leaving the start now, so the way shown
        // stays theirs (decision 50); it's timed from where they are (retime)
        if (same && (!refresh || riding())) { draw(found.now, found.options, speak); return; }
        const id = (asked?.id ?? 0) + 1;
        asked = { id, from, to, now, speak };
        // A new trip's half hour, and one old enough to be worked out again
        // (or from before midnight); the old one stays until the new one comes
        const age = forTrip(half) ? now.seconds - half.view.departures[0] : 0;
        const halfToo = !same || age < 0 || age >= HALF_REWORK_SECONDS;
        if (halfToo) askedHalf = { id, from, to };
        moving = moved || (same && moving);
        if (moved) moveLive();
        else if (!same) {
            // A new trip: said while it's worked out, the first of the day
            // taking longest, as the day's city is made for it
            setHtml(result, html`<p class="trip-intro" role="status">${t('trip.working')}</p>`);
            timing.half = null;
            resetLive();
        }
        searches.postMessage({ id, from, to, now, half: halfToo });
    };

    // The searches can't be had: by metro and tram from now on. With a newer
    // Wayhop waiting, it's most likely an older copy of the searches, kept by
    // a service worker from before they came from the server first (sw.js):
    // it says so, as closing Wayhop everywhere brings the new one
    const fail = async () => {
        if (!searches) return;
        searches.terminate();
        searches = null;
        noBuses = await updateWaiting() ? 'updated' : true;
        found = null;
        moving = false;
        resetLive();
        render({ speak: asked?.speak });
    };
    searches?.addEventListener('error', fail);
    searches?.addEventListener('message', ({ data }) => {
        if ('error' in data) { fail(); return; }
        if ('live' in data) {
            if (data.live.seq !== live.seq) return;
            live.way = data.live.way && { ...live.wanted, way: data.live.way };
            if (live.way && !live.way.taken) live.directions = live.way;
            showLive();
            askDue();
            if (forTrip(found) && !inAnswer()) draw(found.now, found.options, false);
            return;
        }
        if ('half' in data) {
            if (data.id !== askedHalf?.id) return;
            half = { id: data.id, from: askedHalf.from, to: askedHalf.to, view: data.half };
            timing.half = data.half;
            const box = $('trip-half');
            if (box) setHtml(box, halfWords(timing.half));
            // Drawn at once, unless someone is in the answer: then with the
            // next refresh, which waits for that too. Said, unless it was
            // planned again from where the rider moved to
            if (!forTrip(found) || inAnswer()) return;
            const ways = draw(found.now, found.options, false);
            if (ways.length && !moving) announce(halfReady(ways));
            moving = false;
            return;
        }
        if (data.id !== asked.id) return;
        found = { from: asked.from, to: asked.to, now: asked.now, options: data.options };
        noTrains = data.trains === false && !noSuburban;
        timing.city = data.timing.city ?? timing.city;
        timing.answer = data.timing.answer;
        // Not for an end being typed over since it was asked
        if (holding() || !forTrip(found)) return;
        moving = false;
        draw(asked.now, data.options, asked.speak);
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
    // The field says the place as the answer does: a station by the page's language
    const chooser = (input, set) => found => {
        const place = found && placeFor(found);
        if (place) input.value = place.title;
        set(place);
        render({ speak: Boolean(found) });
    };
    // My location (DESIGN.md, "Start from here"): while it's on, From follows
    // where the rider is, and once they've left, the way shown in full is
    // theirs and each fix places them on it (decision 50; before a way to
    // follow, the trip is planned again once they've moved far enough,
    // decision 45). Typing or picking a start, swapping, or location blocked
    // turns it off; pressed again, it looks again. The position stays on
    // this device. `waiting`: pressed, with no position yet
    let waiting = false;
    const follow = on => {
        following = on;
        waiting &&= on;
        if (!on) resetRide();
        showFollowing(locate, on);
    };
    const here = position => ({ lat: position.lat, lng: position.lng, title: t('trip.my-location') });
    const useLocation = position => {
        from = here(position);
        fromInput.value = t('trip.my-location');
        follow(true);
        fromPicker.say('');
        render({ speak: true });
    };
    // In sight only, and not while the keyboard is in the answer, as for a
    // refresh. With a way to follow, the fixes place the rider on it instead (placeFix)
    const replanIfMoved = (position = null) => {
        if (!following || !from || !to || ride.steps || document.hidden || inAnswer()) return;
        const now = position ?? lastPosition();
        if (!now || !replanDue({ lat: from.lat, lng: from.lng, at: planned.at }, now, Date.now())) return;
        from = here(now);
        render({ moved: true });
    };
    // What From's status line says of a ride followed: that it is, or how
    // long ago the last position came once that's a while (underground)
    const sayRide = () => {
        if (!riding()) return;
        const age = ride.state.fix ? Date.now() - ride.state.fix.at : 0;
        const words = age > GAP_MS ? format(t('trip.last-position'), { minutes: minutesWords(Math.floor(age / 60_000), t) }) : t('trip.following');
        if (words === ride.said) return;
        ride.said = words;
        fromPicker.say(words);
    };
    // Off the way (decision 50), by a fix or by the minute going by since
    // the first fix off it: planned again from where the rider is, as a new
    // start, in sight and no sooner than 2 minutes after the last plan
    const replanIfOff = () => {
        if (!riding() || !offDue(ride.state, Date.now()) || document.hidden || Date.now() - planned.at < REPLAN_MS) return;
        from = here(ride.state.fix);
        render({ moved: true });
    };
    // A fix with a way to follow: once the rider has left the start, it
    // places them on the way (follow.js); on to another step, the way is
    // timed from there and drawn again; off the way, planned again. Moving
    // on resumes live times paused for standing still
    const placeFix = fix => {
        if (!ride.left) {
            if (!leftStart(fix, from)) return;
            ride.left = true;
        }
        const nowMs = Date.now();
        ride.state = placeOn(ride.steps, ride.state, fix, nowMs);
        sayRide();
        // Boarding a bus: the one of the way's lines OASA had due at that
        // stop nearest then is theirs, known again where they get off
        const step = stepOf(ride.steps, ride.state);
        if (ride.state.moved && step.kind === 'ride' && live.own?.leg !== step.ride) {
            const boarded = ride.way?.rides?.[step.ride];
            const code = boarded?.board.id.startsWith('bus:') ? boarded.board.id.slice('bus:'.length) : null;
            const vehicle = code ? ownBus(live.answers.get(code), boarded.lines, athensNow(new Date(nowMs)).seconds) : null;
            live.own = vehicle ? { leg: step.ride, vehicle } : null;
        }
        if (live.paused && ride.state.anchor?.at === nowMs) interact();
        if (offDue(ride.state, nowMs)) { replanIfOff(); return; }
        if (!ride.state.moved) return;
        // At a stop of the ride, the search ahead, at most once a minute
        const ahead = step.kind === 'ride' && nowMs - live.aheadAt >= AHEAD_MS;
        if (ahead) live.aheadAt = nowMs;
        retime(live.wanted, ahead);
        redraw();
    };

    // A field holds a choice while its place is set (My location's too):
    // typing sets it to null
    const fromPicker = placePicker({ input: fromInput, list: $('trip-from-list'), status: $('trip-from-status'), rail, onChange: chooser(fromInput, place => { from = place; follow(false); }), chosen: () => Boolean(from) });
    const toPicker = placePicker({ input: toInput, list: $('trip-to-list'), status: $('trip-to-status'), rail, onChange: chooser(toInput, place => { to = place; }), chosen: () => Boolean(to) });

    // What was typed before the train times had loaded is replayed as
    // typing, so it's searched
    [fromInput, toInput].forEach(input => {
        if (input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The trip kept from earlier in this session, unless something was typed
    // first. With no start kept, My location starts it as below
    const kept = !fromInput.value && !toInput.value ? keptTrip(Date.now()) : null;
    if (kept?.from) { from = placeFor(kept.from); fromInput.value = from.title; sayExact(fromPicker, from); }
    if (kept?.to) { to = placeFor(kept.to); toInput.value = to.title; sayExact(toPicker, to); }
    // The link to this page starts it over, as on the other tools (remember.js)
    document.querySelectorAll('a[data-tool="trip"]').forEach(link => link.addEventListener('click', forgetTrip));

    $('trip-swap').addEventListener('click', () => {
        follow(false);
        [from, to] = [to, from];
        [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
        sayExact(fromPicker, from);
        sayExact(toPicker, to);
        render();
    });

    locate.addEventListener('click', () => {
        const known = lastPosition();
        if (known) useLocation(known);
        else {
            follow(true);
            waiting = true;
            fromPicker.say(t('trip.finding-location'));
        }
        startLocation();
    });
    // On by itself, a position never fills From while someone is in it,
    // perhaps about to type a start of their own
    const inFrom = () => document.activeElement === fromInput;
    onLocation(position => {
        if (!following) return;
        if (waiting) {
            waiting = false;
            useLocation(position);
        } else if (!from) {
            if (!inFrom()) useLocation(position);
        } else if (!to) {
            // Nothing planned yet: From moves with the rider, and nothing is asked
            from = here(position);
        } else if (ride.steps) {
            placeFix(position);
        } else {
            replanIfMoved(position);
        }
    });
    // Blocked, it can't follow anything. Said only when someone pressed it
    // and is waiting for it
    onLocationProblem(problem => {
        if (waiting && problem !== 'slow') {
            waiting = false;
            fromPicker.say(t(problem === 'denied' ? 'trip.location-denied' : 'trip.location-unavailable'));
        }
        if (problem === 'denied') follow(false);
    });

    // On when the page opens without a start: from a recent position at
    // once, then following it if the browser already allows that. Nothing
    // asks for the location here, and what's typed meanwhile wins
    if (!fromInput.value) {
        const last = lastPosition();
        if (last && !inFrom()) useLocation(last);
        locationPermission().then(permission => {
            if (permission === 'denied') follow(false);
            if (permission !== 'granted' || (fromInput.value && !following)) return;
            follow(true);
            startLocation();
        });
    }

    setInterval(() => {
        if (!from || !to || inAnswer()) return;
        render({ refresh: true });
        retime();
    }, REFRESH_MS);
    // The live times: asked again when due, and paused, as on the Buses page,
    // once nobody has touched the page for a while. And whether the rider
    // has moved far enough for the trip to be planned again (positions come
    // only when the phone has a new one)
    // A ride followed pauses for standing still as long instead (decision 50)
    const pauseDue = () => riding() ? stillDue(ride.state, live.touched, Date.now()) : isIdle(live.touched, Date.now());
    setInterval(() => {
        countDown();
        replanIfMoved();
        replanIfOff();
        sayRide();
        if (!live.way || live.paused || document.hidden) return;
        if (pauseDue()) {
            live.paused = true;
            showLive();
            return;
        }
        askDue();
    }, TICK_MS);
    document.addEventListener('pointerdown', interact, { passive: true });
    document.addEventListener('keydown', interact);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        replanIfMoved();
        replanIfOff();
        interact();
        askDue();
    });
    render();
}

// The metro and the tram, or the metro alone when the tram is hidden on the
// Subway page (decision 29)
const metro = await loadRail();
if (metro) start(metro);
