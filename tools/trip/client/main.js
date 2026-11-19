import { announce, format, formatHtml, html, localName, notice, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { watchLifts } from '/js/core/lifts.js';
import { legendOpen, liftsOpen } from '/js/core/metro.js';
import { lastPosition, locationPermission, onLocation, onLocationProblem, showFollowing, startLocation } from '/js/core/location.js';
import { countBadges, minutesMark, minutesWords } from '/js/core/times.js';
import { athensClock, athensNow, closestStation, isTimetableExpired, withSuburban, withTram } from '/tools/subway/network.js';
import { watchLegStations } from '/tools/subway/render.js';
import { suburbanHidden, tramHidden } from '/tools/subway/tram-switch.js';
import { walkSeconds } from '/tools/subway/city.js';
import { isIdle } from '/tools/buses/timing.js';
import { carry, GAP_MS, leftStart, offDue, placeOn, replanDue, REPLAN_MS, startOver, starting, stepOf, stillDue, waySteps } from './follow.js';
import { forgetTrip, keepPicked, keepRide, keepTrip, keptTrip } from './kept.js';
import { arrivalsUrl, CHECK_WAIT_MS, checkStop, dueStops, liveStatus, ownBus, stillCaught, stopLive, unanswered } from './live.js';
import { doorToDoor, isLongWalk } from './plan.js';
import { placePicker } from './picker.js';
import { tripController } from './controller.js';
import { tickets } from './tickets.js';
import { TRAINS_URL, trainsDue, trainsUnanswered } from './trains.js';
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
// On a ride followed, the search ahead runs at each stop reached, at most
// this often (decision 50), and the search for the other ways shown, walking
// or waiting too (decision 63); a way 3' or more sooner it finds is switched
// to after this many seconds unless the rider keeps theirs (T14)
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
    // Only the latest answer to each kind of question asked in the
    // background counts, for the current trip (decision 65): a trip
    // searched ('search'), its half hour ('half'), the way shown timed
    // ('way'), the other ways timed ('others'), each stop asked of OASA
    // (`stop <code>`)
    const latest = tickets();
    // The trip, its search answers and its half hour (controller.js): told
    // what happens (tell, below), it answers with the jobs to do
    const trip = tripController({ latest, buses: Boolean(searches), suburban: !noSuburban });

    // My location following the rider's own ride (Plan 7, decision 50): the
    // way shown in full as the steps it's followed by (follow.js), which way
    // they're for (`key`, by its stops), where the last fix put the rider on
    // them, whether they've left the start, and what From's status line says
    // of it. `following` itself is My location's switch (below)
    // `carrying`: the next way is one switched to on the way, or back, so the
    // rider's place carries over (carry). `restore`: the ride kept when the
    // page was last open (decision 58), its way's key and steps and where
    // the rider was on them, till the way drawn is its own (or the half
    // hour is in); meanwhile nothing is planned again from where they are
    let following = false;
    const ride = { key: null, way: null, steps: null, state: starting(), left: false, said: null, carrying: false, restore: null };
    const riding = () => Boolean(following && trip.to && ride.left && ride.steps);
    const keyOf = o => o.city ? o.rides.map(r => `${r.board.id}>${r.alight.id}`).join() : o.plan.legs.map(leg => `${leg.from}>${leg.to}`).join();
    // The steps are made again only for another way: a trip planned again,
    // or the quicker way taken; the rider's place on them starts over, where
    // the last fix had them, but for a way switched to on the way or back,
    // and for the ride kept: where they were on its own way, carried over
    // to another (a way switched to isn't searched again)
    const followWay = (o, date) => {
        const key = o ? keyOf(o) : null;
        const { restore } = ride;
        const final = restore && (key === restore.key || Boolean(trip.halfHour()));
        if (key === ride.key) {
            if (final) ride.restore = null;
            return;
        }
        const steps = o ? waySteps(o, trip.from, trip.to, drawnOn(date)) : null;
        const state = restore && steps ? key === restore.key ? restore.state : carry(restore.steps, restore.state, steps)
            : ride.carrying && ride.steps && steps ? carry(ride.steps, ride.state, steps) : startOver(ride.state);
        if (final) ride.restore = null;
        Object.assign(ride, { key, way: o, steps, state, carrying: false });
        keepFollowed();
    };
    const resetRide = () => {
        Object.assign(ride, { key: null, way: null, steps: null, state: starting(), left: false, said: null, carrying: false, restore: null });
        keepRide(null, Date.now());
    };
    // The ride followed, kept with the trip for the page opened again
    // (decision 58): where and for when the way was searched, its steps and
    // where the rider is on them; and the way switched to on a ride, itself,
    // as it can't be searched again from the start (decision 64). Not while
    // the kept one is still being taken up, nor while a new plan is being searched
    const keepFollowed = () => {
        const shown = trip.answer();
        if (ride.restore || !shown) return;
        const switched = live.switched && live.switchedWay?.key === live.switched ? { way: live.switchedWay, by: live.switchedBy ?? 'quicker' } : null;
        keepRide(riding() ? { from: { lat: trip.from.lat, lng: trip.from.lng }, now: shown.now, at: trip.plannedAt, key: ride.key, steps: ride.steps, state: ride.state, choice: live.choice, own: live.own, switched } : null, Date.now());
    };
    // The way picked kept, put first again in the trip's first answer
    /** @type {string | null} */
    let pickedKept = null;
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
    // and whether asking is paused. On a
    // decision (decision 36): the rider's choice of the quicker way, taken
    // or kept for the rest of the trip; the directions' latest timing, drawn
    // at once if the rider goes back to them; and whether a quicker way is
    // offered, so it's said once. How late the suburban trains run (decision
    // 42): the latest answer, for every train, so kept from trip to trip;
    // when it was asked for, and whether it's being asked for. On a ride
    // followed (decision 50): when the search ahead last ran, and the
    // search from where they are walking or waiting (decision 63); the switch to
    // the way it found counting down (`countdown`: its key, the seconds
    // left), held while a pointer is down on it; the way switched to, by
    // key; and the ways the rider kept theirs over, never offered again.
    // The other ways shown (decision 62): which they are (`wanted`: the half
    // hour `id`'s rows, each for its departure) and the worker's latest
    // timing of each. To a rider followed
    // along the way, the ways on from where they are instead (`onward`,
    // decision 63), as last timed, kept till the next search finds others.
    // The way the rider took from the other ways, by its key (`picked`,
    // decision 64), shown first while the half hour has it; `lost`, it
    // went, so the half hour's own is first again, which is said. On a
    // ride, whose way the one switched to is (`switchedBy`: the switch's, or
    // one the rider took from the other ways) and the way itself, as the
    // worker last sent it, to keep with the trip. The way tapped whose bus
    // is being checked (`checking`: its key, what it showed of its bus, the
    // stop asked, whether that's answered, whether it's a followed rider's,
    // and from the keyboard); `gone`, its bus had gone, so it wasn't taken;
    // `focusNext`, the keyboard goes to the next answer's heading
    const live = {
        wanted: null, way: null,
        /** @type {Map<string, import('./buses.js').StopLive>} */ answers: new Map(),
        /** @type {Map<string, number>} */ asked: new Map(),
        /** @type {Set<string>} */ asking: new Set(),
        /** @type {'start' | 'moved' | null} */ opening: 'start', paused: false, touched: Date.now(),
        /** @type {import('./buses.js').OwnBus | null} */ own: null,
        /** @type {'taken' | 'kept' | null} */ choice: null, directions: null, offered: false,
        /** @type {import('./trains.js').TrainsLive | null} */ trains: null, trainsAsked: -Infinity, askingTrains: false,
        aheadAt: -Infinity, hereAt: -Infinity, /** @type {{ key: string, left: number } | null} */ countdown: null, held: false,
        /** @type {string | null} */ switched: null, /** @type {Set<string>} */ declined: new Set(),
        others: { /** @type {{ id: number, ways: { row: number, departure: number }[] } | null} */ wanted: null, /** @type {(import('./searcher.js').OtherWay | null)[]} */ ways: [] },
        /** @type {import('./searcher.js').OnwardWay[] | null} */ onward: null,
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
    const sameRow = (a, b) => a?.id === b?.id && a?.row === b?.row && Boolean(a?.taken) === Boolean(b?.taken) && (a?.switched ?? null) === (b?.switched ?? null);
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

    // How late the suburban trains run, by number, as the way shown in full
    // is timed with it: none while it can't be had
    const lateness = () => live.trains?.unavailable ? null : live.trains?.trains ?? null;
    // The way shown in full, timed again by the worker with the live times
    // there are, for leaving now; or nothing to time, as it has no bus.
    // `ahead`: search first for the other ways shown to a followed rider,
    // ahead from the ride they're on, or from where they are (decision 63)
    const retime = (want = live.wanted, ahead = false) => {
        live.wanted = want;
        if (!want || !searches) {
            if (live.way) { live.way = null; showLive(); }
            return;
        }
        const fix = riding() ? ride.state.fix : null;
        searches.postMessage({ id: want.id, live: { seq: latest.take('way'), row: want.row, departure: want.departure, now: athensNow(), stops: Object.fromEntries(live.answers), taken: want.taken, trains: lateness(), step: stepFor(), own: live.own,
            ahead, declined: [...live.declined], switched: want.switched, switchedWay: want.switched ? live.switchedWay : null, here: fix && { lat: fix.lat, lng: fix.lng } } });
    };
    // The other ways shown, timed again by the worker with the live times
    // there are, each asking only for its first bus's stop (decision 62);
    // none to time, as none has a bus
    const retimeOthers = (want = live.others.wanted) => {
        // Another half hour's rows aren't the ones timed
        if (want?.id !== live.others.wanted?.id) live.others.ways = [];
        live.others.wanted = want;
        // Asking for none overtakes what was asked before too
        const seq = latest.take('others');
        if (!want?.ways.length || !searches) { live.others.ways = []; return; }
        searches.postMessage({ id: want.id, others: { seq, ways: want.ways, now: athensNow(), stops: Object.fromEntries(live.answers), trains: lateness() } });
    };
    const noOthers = () => ({ wanted: null, ways: [] });
    // No way tapped is being checked any more
    const noCheck = () => {
        clearTimeout(live.checking?.timer);
        return null;
    };
    // A new trip: nothing asked for the one before counts, the way's timing
    // still to come from the worker included (the controller's tickets)
    const resetLive = () => {
        Object.assign(live, { wanted: null, way: null, answers: new Map(), asked: new Map(), asking: new Set(), opening: 'start', choice: null, directions: null, offered: false, own: null,
            aheadAt: -Infinity, hereAt: -Infinity, countdown: null, switched: null, declined: new Set(), others: noOthers(), onward: null, picked: null, lost: false,
            switchedBy: null, switchedWay: null, checking: noCheck(), gone: false });
        showLive();
    };
    // The trip planned again from where the rider moved to (decision 45):
    // each stop keeps its answer and its turn on the tiers, so only the
    // stops new to its way are asked at once. The way being timed goes, and
    // an answer for it still to come from the worker is dropped, the other
    // ways' too (the controller's tickets)
    const moveLive = () => {
        Object.assign(live, { wanted: null, way: null, opening: 'moved', choice: null, directions: null, offered: false, own: null, aheadAt: -Infinity, hereAt: -Infinity, countdown: null, switched: null, others: noOthers(), onward: null,
            switchedBy: null, switchedWay: null, checking: noCheck(), gone: false });
        showLive();
    };
    // The stops to ask OASA for: the way shown in full's, then the other
    // ways' first buses' (decision 62), or a followed rider's (decision 63),
    // that it doesn't have already
    const wayAsks = () => live.way?.way.asks ?? [];
    const otherAsks = () => {
        const shown = new Set(wayAsks().map(a => a.stop));
        const others = riding() ? live.onward ?? [] : live.others.ways;
        return others.flatMap(way => way?.asks ?? []).filter(a => !shown.has(a.stop) && shown.add(a.stop));
    };
    // Paused, unavailable or older live times, said above the answer
    const showLive = () => {
        const asks = [...wayAsks(), ...otherAsks()];
        const shown = live.way || asks.length ? liveNotice(liveStatus(asks, live.answers, live.paused, live.way && live.way.way.train !== null ? live.trains : null)) : '';
        setHtml(liveBox, shown);
        liveBox.hidden = !shown;
        liveBox.querySelector('button')?.addEventListener('click', interact);
    };
    // A stop's live times, one request each, so each shows as soon as it's in
    const ask = async (code, opening) => {
        const kind = `stop ${code}`;
        const ticket = latest.take(kind);
        live.asking.add(code);
        let answer;
        try {
            const response = await fetch(arrivalsUrl(code, opening), { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            answer = stopLive((await response.json()).stops[code], athensNow().seconds);
        } catch {
            answer = unanswered(live.answers.get(code));
        }
        if (!latest.counts(kind, ticket)) return;
        live.answers.set(code, answer);
        live.asked.set(code, Date.now());
        live.asking.delete(code);
        // The way tapped is timed again with it, and then taken or not (takeWay)
        if (live.checking?.stop === code) live.checking.answered = true;
        showLive();
        retime();
        retimeOthers();
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
        retimeOthers();
    };
    // The stops that are due (live.js), and the trains when the way has one
    // (trains.js): nothing while paused or out of sight. The first stop not
    // asked before says the trip's `opening`, the way shown's before the
    // other ways'; after a re-plan that kept every stop, nothing does. A
    // stop first asked for the ride the rider is on (their own bus's,
    // decision 50) says that instead, and one first asked for another way
    // (decision 62) that
    const askDue = () => {
        if (live.paused || document.hidden) return;
        const asks = [...wayAsks(), ...otherAsks()];
        if (!asks.length && !live.way) return;
        const seconds = athensNow().seconds;
        const due = dueStops(asks, live, Date.now(), seconds);
        const forRide = new Set(wayAsks().filter(a => a.ride).map(a => a.stop));
        const forOther = new Set(otherAsks().map(a => a.stop));
        const unasked = code => !live.answers.has(code) && !forRide.has(code);
        const first = due.find(code => unasked(code) && !forOther.has(code)) ?? due.find(unasked);
        const opening = code => forRide.has(code) ? live.answers.has(code) ? null : 'ride'
            : code === first ? live.opening ?? (forOther.has(code) ? 'other' : null)
            : forOther.has(code) && !live.answers.has(code) ? 'other' : null;
        for (const code of due) ask(code, opening(code));
        live.opening = null;
        const train = live.way?.way.train ?? null;
        if (train !== null && trainsDue(train, { asking: live.askingTrains, asked: live.trainsAsked, answer: live.trains }, Date.now(), seconds)) askTrains();
    };
    // Any tap or key press counts as someone looking at the page
    const interact = () => {
        live.touched = Date.now();
        if (!live.paused) return;
        live.paused = false;
        showLive();
        retime();
        retimeOthers();
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
        const { seconds: clock, epoch, weekday, date } = athensClock();
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
        // The other ways shown with a bus, timed with OASA's live times
        // (decision 62): not on a ride followed, where they're from the start
        // the rider has left
        const takenRow = choice === 'taken' ? half.view.quicker : null;
        const others = riding() ? [] : ways.slice(1).filter(({ row, o }) => row !== takenRow && hasBus(o));
        const othersWant = others.length ? { id: half.id, ways: others.map(({ row, departure }) => ({ row: half.view.rows.indexOf(row), departure })) } : null;
        if (JSON.stringify(othersWant) !== JSON.stringify(live.others.wanted)) retimeOthers(othersWant);
        // To a rider followed along the way, the ways on from where they
        // are, once searched (decision 63), but the way switched to
        const onward = riding() && live.onward ? live.onward.filter(other => other.key !== switched) : null;
        const othersTimed = new Map(live.others.ways
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
        if (!(switched && !timed)) followWay(following ? card : null, date);
        const shown = ways.length
            ? renderHalf(drawnOn(date), half.view.kind, ways, trip.to, { now: clock, epoch, expired, longWalk: isLongWalk(ways[0].o), live: timed, offer: !choice, taken: choice === 'taken' ? half.view.quicker : null,
                switching: switching && { offer: switching, seconds: live.countdown.left }, switched: switched ? live.switchedBy ?? 'quicker' : false, othersTimed, onward, take: !riding(), picked, lost: live.lost,
                checking: live.checking?.key ?? null, gone: live.gone, noTrains: trip.noTrains, trains: lateness(), lifts: known, liftsOpen: liftsOpen(), following: followingShown(), ...cards })
            : renderTrip(drawnOn(date), answer, trip.to, { now: clock, epoch, expired, noBuses: trip.noBuses, noTrains: trip.noTrains && !trip.noBuses, checking: Boolean(searches) && !half, lifts: known, liftsOpen: liftsOpen(), following: followingShown(), ...cards });
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
        drawAnswer();
        if (event?.detail === 0) /** @type {HTMLElement | null} */ (result.querySelector(next) ?? result.querySelector('.trip-card h2'))?.focus();
    };
    // `by`: the switch's way, or another way off the ride the rider took
    // (decision 64), a tap on which is said; a countdown is called off
    const switchTo = (key, event = null, by = 'quicker') => {
        Object.assign(live, { switched: key, switchedBy: by, switchedWay: null, countdown: null, held: false });
        ride.carrying = true;
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

    // Another way taken (decision 64), by where the rider is. Before they've
    // left, it's the way shown in full, and the one it replaces goes among
    // the other ways; kept with the trip. Followed, on a ride, it's taken as
    // the switch's is, with the way back; walking or waiting, the trip is
    // planned again from where they are, with that way picked. From the
    // keyboard, the keyboard goes on to the way shown's heading (or the way
    // back); a tap is said
    const takeNow = ({ key, leg }, keyboard) => {
        if (!riding()) {
            Object.assign(live, { picked: key, lost: false, choice: null });
            keepPicked(key, Date.now());
            drawAnswer();
            if (keyboard) /** @type {HTMLElement | null} */ (result.querySelector('.trip-card h2'))?.focus();
            else announce(t('trip.picked-said'));
            return;
        }
        if (leg >= 0) { switchTo(key, { detail: keyboard ? 0 : 1 }, 'picked'); return; }
        const at = ride.state.fix ?? lastPosition();
        if (!at) return;
        Object.assign(live, { picked: key, lost: false, focusNext: keyboard });
        keepPicked(key, Date.now());
        if (!keyboard) announce(t('trip.picked-said'));
        tell({ type: 'moved', place: here(at) });
    };
    // The way tapped, as drawn: before the rider has left, the half hour's
    // row by its key, with OASA's timing of it when it has one; followed,
    // the way on from where they are (decision 63), with the ride it leaves
    const tappedWay = key => {
        if (riding()) return live.onward?.find(other => other.key === key) ?? null;
        const timed = live.others.ways.find(way => way && trip.halfHour()?.view.rows[way.row]?.key === key);
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
        const asked = way.asks[0] ? live.asked.get(way.asks[0].stop) : undefined;
        const stop = checkStop(said, way.asks, asked, Date.now());
        if (!stop) { takeNow(way, keyboard); return; }
        live.checking = { key, said, stop, answered: false, onward: riding(), keyboard, timer: setTimeout(() => settleCheck(true), CHECK_WAIT_MS) };
        drawAnswer();
        if (keyboard) focusWay(key);
        announce(t('trip.take-checking'));
        if (!live.asking.has(stop)) ask(stop, 'take');
    };
    // The way tapped, timed again with its stop's new answer (or none came
    // in time: `timedOut`): taken while its bus can still be caught; gone,
    // not taken, said, and the ways searched again at once
    const settleCheck = (timedOut = false) => {
        const check = live.checking;
        live.checking = noCheck();
        if (!check || !trip.answer()) return;
        const way = check.onward === riding() ? tappedWay(check.key) : null;
        if (way && (timedOut || stillCaught(check.said, way.option ? firstBusSaid(way.option) : undefined))) { takeNow(way, check.keyboard); return; }
        live.gone = true;
        announce(t('trip.take-gone'));
        if (riding()) retime(live.wanted, true);
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
                    Object.assign(live, { choice: resumed.choice ?? null, own: resumed.own ?? null });
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
                retime();
                break;
        }
    };
    /** @param {import('./controller.js').TripEvent} event */
    const tell = event => {
        for (const job of trip.tell(event, { ms: Date.now(), now: athensNow() })) carryOut(job);
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
            if (!latest.counts('way', data.live.seq)) return;
            live.way = data.live.way && { ...live.wanted, way: data.live.way };
            if (live.way && !live.way.taken) live.directions = live.way;
            if (data.live.others) live.onward = data.live.others;
            if (data.live.switched?.key === live.switched) live.switchedWay = data.live.switched;
            showLive();
            askDue();
            checked(true);
            if (!inAnswer()) drawAnswer();
            return;
        }
        if ('others' in data) {
            if (!latest.counts('others', data.others.seq)) return;
            live.others.ways = data.others.ways;
            showLive();
            askDue();
            checked(false);
            if (!inAnswer()) drawAnswer();
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
    // language. A start typed or picked turns My location off
    /** @param {HTMLInputElement} input @param {'from' | 'to'} end */
    const chooser = (input, end) => found => {
        const place = found ? placeFor(found) : null;
        if (place) input.value = place.title;
        if (end === 'from') follow(false);
        tell({ type: end, place, say: Boolean(found) });
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
    // The ride kept, taken up (decision 58): the trip searched again from
    // where and for when it was, so the same way comes back, and the rider
    // placed where they were on it; the next fix places them from there
    const resumeRide = kept => {
        fromInput.value = t('trip.my-location');
        follow(true);
        Object.assign(ride, { left: true, restore: { key: kept.key, steps: kept.steps, state: kept.state } });
        // On a way switched to (decision 64), its steps at once, as the
        // search from the start won't find it: the worker times it from them
        if (kept.switched) Object.assign(ride, { key: kept.key, steps: kept.steps, state: kept.state, carrying: true });
        fromPicker.say('');
        tell({ type: 'resume', place: here(kept.from), ride: kept });
    };
    const useLocation = position => {
        fromInput.value = t('trip.my-location');
        follow(true);
        fromPicker.say('');
        tell({ type: 'from', place: here(position), say: true });
    };
    // In sight only, and not while the keyboard is in the answer, as for a
    // refresh. With a way to follow, the fixes place the rider on it instead (placeFix)
    const replanIfMoved = (position = null) => {
        if (!following || !trip.from || !trip.to || ride.steps || ride.restore || document.hidden || inAnswer()) return;
        const now = position ?? lastPosition();
        if (!now || !replanDue({ lat: trip.from.lat, lng: trip.from.lng, at: trip.plannedAt }, now, Date.now())) return;
        tell({ type: 'moved', place: here(now) });
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
        if (!riding() || !offDue(ride.state, Date.now()) || document.hidden || Date.now() - trip.plannedAt < REPLAN_MS) return;
        tell({ type: 'moved', place: here(ride.state.fix) });
    };
    // A fix with a way to follow: once the rider has left the start, it
    // places them on the way (follow.js); on to another step, the way is
    // timed from there and drawn again; off the way, planned again. Moving
    // on resumes live times paused for standing still
    const placeFix = fix => {
        if (!ride.left) {
            if (!leftStart(fix, trip.from)) return;
            ride.left = true;
        }
        const nowMs = Date.now();
        ride.state = placeOn(ride.steps, ride.state, fix, nowMs);
        if (ride.state.moved) keepFollowed();
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
        // The other ways shown searched again (decision 63): at a stop of the
        // ride, the search ahead with them (decision 50), and walking or
        // waiting with each fix, each at most once a minute
        const onFoot = step.kind === 'walk' || step.kind === 'wait';
        const ahead = onFoot ? nowMs - live.hereAt >= AHEAD_MS : ride.state.moved && nowMs - live.aheadAt >= AHEAD_MS;
        if (ahead) live[onFoot ? 'hereAt' : 'aheadAt'] = nowMs;
        if (!ride.state.moved) {
            if (ahead) retime(live.wanted, true);
            return;
        }
        retime(live.wanted, ahead);
        redraw();
    };

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
        follow(false);
        [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
        sayExact(fromPicker, trip.to);
        sayExact(toPicker, trip.from);
        tell({ type: 'swap' });
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
        } else if (!trip.from) {
            if (!inFrom()) useLocation(position);
        } else if (!trip.to) {
            // Nothing planned yet: From moves with the rider, and nothing is asked
            tell({ type: 'here', place: here(position) });
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
        if (resume) resumeRide(resume);
        else if (last && !inFrom()) useLocation(last);
        locationPermission().then(permission => {
            if (permission === 'denied') follow(false);
            if (permission !== 'granted' || (fromInput.value && !following)) return;
            follow(true);
            startLocation();
        });
    }

    setInterval(() => tell({ type: 'refresh', riding: riding(), held: inAnswer() }), REFRESH_MS);
    // The live times: asked again when due, and paused, as on the Buses page,
    // once nobody has touched the page for a while. And whether the rider
    // has moved far enough for the trip to be planned again (positions come
    // only when the phone has a new one)
    // A ride followed pauses for standing still as long instead (decision 50)
    const pauseDue = () => riding() ? stillDue(ride.state, live.touched, Date.now()) : isIdle(live.touched, Date.now());
    setInterval(() => {
        countDown();
        countTimes();
        replanIfMoved();
        replanIfOff();
        sayRide();
        if ((!live.way && !live.others.ways.length) || live.paused || document.hidden) return;
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
        // Where the rider is, kept as the phone may close the app now
        if (document.hidden) { keepFollowed(); return; }
        // Timers wait while the phone is locked: the times catch up at once
        countTimes();
        replanIfMoved();
        replanIfOff();
        interact();
        askDue();
    });
    // The ride kept was searched again as it was taken up (resumeRide): a
    // second search here would be for now, and would drop what came back
    // with it (the decision's choice, the rider's own bus, the way switched to)
    if (!resume) tell({ type: 'open' });
}

// The metro and the tram, or the metro alone when the tram is hidden on the
// Subway page (decision 29)
const metro = await loadRail();
if (metro) start(metro);
