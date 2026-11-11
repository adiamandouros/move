import { announce, format, formatHtml, html, localName, notice, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { watchLifts } from '/js/core/lifts.js';
import { legendOpen, liftsOpen } from '/js/core/metro.js';
import { lastPosition, locationPermission, onLocation, onLocationProblem, showFollowing, startLocation } from '/js/core/location.js';
import { minutesMark } from '/js/core/times.js';
import { athensNow, closestStation, isTimetableExpired, withTram } from '/tools/subway/network.js';
import { watchLegStations } from '/tools/subway/render.js';
import { suburbanHidden, tramHidden } from '/tools/subway/tram-switch.js';
import { isIdle } from '/tools/buses/timing.js';
import { replanDue } from './follow.js';
import { arrivalsUrl, dueStops, liveStatus, stopLive, unanswered } from './live.js';
import { doorToDoor, isLongWalk } from './plan.js';
import { placePicker } from './picker.js';
import { TRAINS_URL, trainsDue, trainsUnanswered } from './trains.js';
import { halfWays, hasBus, hasTrain, howExact, liveNotice, placeTitle, quickerSummary, rangeText, renderChosen, renderHalf, renderTrip, routeSummary, stepFreeSummary } from './render.js';

const $ = id => document.getElementById(id);
const result = $('trip-result');
const liveBox = $('trip-live-status');
const form = $('trip-form');
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
    const place = { lat: found.lat, lng: found.lng, title: placeTitle(found), exact: howExact(found)?.words ?? null };
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
    // The fields are back, with the answer still under them
    let changing = false;
    const noSuburban = suburbanHidden();
    let searches = startSearches(hidden ? { ...metro, tram: undefined } : metro, !noSuburban);
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
    // when it was asked for, and whether it's being asked for
    const live = {
        seq: 0, trip: 0, wanted: null, way: null,
        /** @type {Map<string, import('./buses.js').StopLive>} */ answers: new Map(),
        /** @type {Map<string, number>} */ asked: new Map(),
        /** @type {Set<string>} */ asking: new Set(),
        /** @type {'start' | 'moved' | null} */ opening: 'start', paused: false, touched: Date.now(),
        /** @type {'taken' | 'kept' | null} */ choice: null, directions: null, offered: false,
        /** @type {import('./trains.js').TrainsLive | null} */ trains: null, trainsAsked: -Infinity, askingTrains: false,
    };
    const sameRow = (a, b) => a?.id === b?.id && a?.row === b?.row && Boolean(a?.taken) === Boolean(b?.taken);
    // The cards' stations on the way the rider opened or closed (by leg),
    // kept through the refreshes while the trip goes to the same place, a
    // start that follows My location included (decision 46)
    let opened = { to: null, legs: {} };
    const openedLegs = () => {
        if (opened.to !== to) opened = { to, legs: {} };
        return opened.legs;
    };
    watchLegStations(result, openedLegs);

    // The way shown in full, timed again by the worker with the live times
    // there are, for leaving now; or nothing to time, as it has no bus
    const retime = (want = live.wanted) => {
        live.wanted = want;
        if (!want || !searches) {
            if (live.way) { live.way = null; showLive(); }
            return;
        }
        const trains = live.trains?.unavailable ? null : live.trains?.trains ?? null;
        searches.postMessage({ id: want.id, live: { seq: ++live.seq, row: want.row, departure: want.departure, now: athensNow(), stops: Object.fromEntries(live.answers), taken: want.taken, trains } });
    };
    const resetLive = () => {
        Object.assign(live, { trip: live.trip + 1, wanted: null, way: null, answers: new Map(), asked: new Map(), asking: new Set(), opening: 'start', choice: null, directions: null, offered: false });
        showLive();
    };
    // The trip planned again from where the rider moved to (decision 45):
    // each stop keeps its answer and its turn on the tiers, so only the
    // stops new to its way are asked at once. The way being timed goes, and
    // an answer for it still to come from the worker is dropped
    const moveLive = () => {
        Object.assign(live, { seq: live.seq + 1, wanted: null, way: null, opening: 'moved', choice: null, directions: null, offered: false });
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
    // every stop, nothing does
    const askDue = () => {
        if (!live.way || live.paused || document.hidden) return;
        const seconds = athensNow().seconds;
        const due = dueStops(live.way.way.asks, live, Date.now(), seconds);
        const first = due.find(code => !live.answers.has(code));
        for (const code of due) ask(code, code === first ? live.opening : null);
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
        const want = first && (hasBus(first.o) || hasTrain(first.o) || directions)
            ? { id: half.id, row: half.view.rows.indexOf(first.row), departure: first.departure, taken: choice === 'taken' }
            : null;
        const latest = [live.way, live.directions].find(way => want && sameRow(way, want));
        const timed = latest ? { way: latest.way } : null;
        // The minutes count from the clock, not from when the search was made;
        // the cards' trains are the day's (legs.js)
        const { seconds: clock, weekday } = athensNow();
        const cards = { weekday, stations: openedLegs(), legend: legendOpen() };
        const offer = !choice && timed?.way.offer;
        const known = lifts();
        const shown = ways.length
            ? renderHalf(rail, half.view.kind, ways, to, { now: clock, expired, longWalk: isLongWalk(ways[0].o), live: timed, offer: !choice, taken: choice === 'taken' ? half.view.quicker : null, noTrains, lifts: known, liftsOpen: liftsOpen(), ...cards })
            : renderTrip(rail, trip, to, { now: clock, expired, noBuses, noTrains: noTrains && !noBuses, checking: Boolean(searches) && !forTrip(half), lifts: known, liftsOpen: liftsOpen(), ...cards });
        const answer = html`${shown}${TIMING && timingBox(timing)}`;
        setHtml(result, changing ? answer : html`${renderChosen(from, to)}${answer}`);
        $('trip-change')?.addEventListener('click', () => {
            changing = true;
            render();
            fromInput.focus();
            fromInput.select();
        });
        // The rider's choice redraws the answer at once. From the keyboard,
        // the keyboard goes on to what's there now: the way back or the offer
        // again, or the way shown. A tap leaves it, so the live times go on
        // redrawing (they wait while the keyboard is in the answer)
        const choose = (made, next) => event => {
            live.choice = made;
            draw(now, buses, false);
            if (event.detail === 0) /** @type {HTMLElement | null} */ (result.querySelector(next) ?? result.querySelector('.trip-card h2'))?.focus();
        };
        $('trip-quicker-take')?.addEventListener('click', choose('taken', '#trip-quicker-back'));
        $('trip-quicker-keep')?.addEventListener('click', choose('kept', '.trip-card h2'));
        $('trip-quicker-back')?.addEventListener('click', choose(null, '#trip-quicker-take'));
        // A quicker way coming up is said once, as it isn't where the keyboard is
        if (offer && !live.offered) announce(quickerSummary(offer));
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

    // Lifts out of service and the lift status (STASY), for the step-free
    // notice: asked for at once, so they're in by the first answer, and
    // drawn in when they come, unless someone is in the answer: then with
    // the next refresh
    const lifts = watchLifts(() => {
        if (!from || !to || result.contains(document.activeElement)) return;
        if (!searches) draw(athensNow(), [], false);
        else if (forTrip(found) && !holding()) draw(found.now, found.options, false);
    });
    lifts();

    // `refresh`: the same trip, for a later time; `moved`: planned again
    // from where the rider moved to
    const render = ({ speak = false, refresh = false, moved = false } = {}) => {
        const ready = from && to;
        form.hidden = Boolean(ready) && !changing;
        if (!ready) { setHtml(result, html`<p class="trip-intro">${t('trip.intro')}</p>`); return; }
        if (!forTrip(planned)) planned = { from, to, at: Date.now() };
        const now = athensNow();
        if (!searches) { draw(now, [], speak); return; }
        const same = forTrip(found);
        if (same && !refresh) { draw(found.now, found.options, speak); return; }
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
            if (forTrip(found) && !result.contains(document.activeElement)) draw(found.now, found.options, false);
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
            if (!forTrip(found) || result.contains(document.activeElement)) return;
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
        if (holding()) return;
        moving = false;
        draw(asked.now, data.options, asked.speak);
    });

    const chooser = (input, set) => found => {
        if (found) input.value = placeTitle(found);
        set(found && chosenPlace(rail, found));
        changing = false;
        render({ speak: Boolean(found) });
    };
    // My location (DESIGN.md, "Start from here"): while it's on, From follows
    // where the rider is, and the trip is planned again once they've moved
    // far enough (decision 45). Typing or picking a start, swapping, or
    // location blocked turns it off; pressed again, it looks again. The
    // position stays on this device. `waiting`: pressed, with no position yet
    let following = false;
    let waiting = false;
    const follow = on => {
        following = on;
        waiting &&= on;
        showFollowing(locate, on);
    };
    const here = position => ({ lat: position.lat, lng: position.lng, title: t('trip.my-location'), exact: null });
    const useLocation = position => {
        from = here(position);
        fromInput.value = t('trip.my-location');
        follow(true);
        fromPicker.say('');
        render({ speak: true });
    };
    // In sight only, and not while the keyboard is in the answer, as for a refresh
    const replanIfMoved = (position = null) => {
        if (!following || !from || !to || document.hidden || result.contains(document.activeElement)) return;
        const now = position ?? lastPosition();
        if (!now || !replanDue({ lat: from.lat, lng: from.lng, at: planned.at }, now, Date.now())) return;
        from = here(now);
        render({ moved: true });
    };

    // A field holds a choice while its place is set (My location's too):
    // typing sets it to null
    const fromPicker = placePicker({ input: fromInput, list: $('trip-from-list'), status: $('trip-from-status'), rail, onChange: chooser(fromInput, place => { from = place; follow(false); }), chosen: () => Boolean(from) });
    placePicker({ input: toInput, list: $('trip-to-list'), status: $('trip-to-status'), rail, onChange: chooser(toInput, place => { to = place; }), chosen: () => Boolean(to) });

    // What was typed before the train times had loaded is replayed as
    // typing, so it's searched
    [fromInput, toInput].forEach(input => {
        if (input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    $('trip-swap').addEventListener('click', () => {
        follow(false);
        [from, to] = [to, from];
        [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
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
        if (!from || !to || result.contains(document.activeElement)) return;
        render({ refresh: true });
        retime();
    }, REFRESH_MS);
    // The live times: asked again when due, and paused, as on the Buses page,
    // once nobody has touched the page for a while. And whether the rider
    // has moved far enough for the trip to be planned again (positions come
    // only when the phone has a new one)
    setInterval(() => {
        replanIfMoved();
        if (!live.way || live.paused || document.hidden) return;
        if (isIdle(live.touched, Date.now())) {
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
        interact();
        askDue();
    });
    render();
}

// The metro and the tram, or the metro alone when the tram is hidden on the
// Subway page (decision 29)
const metro = await loadRail();
if (metro) start(metro);
