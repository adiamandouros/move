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
import { arrivalsUrl, stopLive } from './live.js';
import { doorToDoor, isLongWalk } from './plan.js';
import { placePicker } from './picker.js';
import { tripController } from './controller.js';
import { TRAINS_URL } from './trains.js';
import { howExact, liveNotice, placeTitle, quickerSummary, rangeText, renderHalf, renderTrip, routeSummary, stepFreeSummary, switchIn } from './render.js';

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
    // The trip, its search answers, its half hour, its live times, the ride
    // followed and the rider's choices (controller.js): told what happens
    // (tell, below), it answers with the jobs to do
    const trip = tripController({ buses: Boolean(searches), suburban: !noSuburban, at: Date.now(), hereTitle: t('trip.my-location'), railOn: date => drawnOn(date) });

    // A pointer held down on the quicker way's card, or the switch's (T14)
    let held = false;
    // Someone is in the answer: the keyboard is there, or a pointer is held
    // down on the switch. It isn't drawn again under them till they're done.
    // The keyboard's focus only: Android's browser focuses a button that's
    // tapped too, and that focus would stop every redraw for good (Road · 3)
    /** @param {Element} box */
    const keyboardIn = box => box.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    const inAnswer = () => held || keyboardIn(result);
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

    // The answer for leaving at `now`, the ways with a bus being `buses`,
    // worked out here on the metro and the tram, for the controller to
    // decide what's drawn of it (its render job, below)
    /** @param {import('/tools/subway/network.js').AthensTime} now @param {import('./buses.js').BusOption[]} buses @param {boolean} speak @param {boolean} sayHalf */
    const draw = (now, buses, speak, sayHalf) => {
        tell({ type: 'drawing', now, answer: doorToDoor(rail, trip.from, trip.to, now, { buses }), speak, sayHalf });
    };
    // The answer drawn: in place of the answer for leaving now, the next half
    // hour's ways (decision 33), as the controller decided (`view`), unless
    // walking is quicker, the trains have stopped for the night, or it has
    // nothing to show. The minutes count from the clock, not from when the
    // search was made; the cards' trains are the day's (legs.js), as late as
    // they run when the way is timed with it (decision 47)
    /** @param {Extract<import('./controller.js').TripJob, { do: 'render' }>} job */
    const render = ({ now, answer, ways, view, offered, speak, sayHalf }) => {
        const expired = isTimetableExpired(rail, now);
        const { seconds: clock, epoch, weekday, date } = athensClock();
        const cards = { weekday, date, stations: openedLegs(), stops: openedStops(), legend: legendOpen() };
        const known = lifts();
        const shown = view
            ? renderHalf(drawnOn(date), view.kind, ways, trip.to, { now: clock, epoch, expired, longWalk: isLongWalk(ways[0].o), ...view,
                noTrains: trip.noTrains, trains: trip.lateness(), lifts: known, liftsOpen: liftsOpen(), following: trip.onStep(), ...cards })
            : renderTrip(drawnOn(date), answer, trip.to, { now: clock, epoch, expired, noBuses: trip.noBuses, noTrains: trip.noTrains && !trip.noBuses, checking: Boolean(searches) && !trip.halfHour(), lifts: known, liftsOpen: liftsOpen(), following: trip.onStep(), ...cards });
        setHtml(result, html`${shown}${TIMING && timingBox(trip.timing)}`);
        if (offered) announce(offered.seconds !== null ? `${quickerSummary(offered.offer)} ${switchIn(offered.seconds)}` : quickerSummary(offered.offer));
        if (speak) {
            const said = ways.length ? halfReady(ways) : answer.options[0] ? routeSummary(answer.options[0]) : t('trip.walk-quicker');
            const access = stepFreeSummary(rail, ways.length ? ways.map(way => way.o) : answer.options, known);
            announce(access ? `${said} ${access}` : said);
        }
        if (sayHalf) announce(halfReady(ways));
    };
    const halfReady = ways => format(t('trip.half-ready'), { range: rangeText(ways[0].row) });

    // The quicker way's buttons and the way back (decision 36, T14), and
    // the other ways as buttons (decision 64), told as they're pressed, from
    // the keyboard or not; what each does is the controller's
    /** @type {Record<string, 'take' | 'keep' | 'back'>} */
    const QUICKER = { 'trip-quicker-take': 'take', 'trip-quicker-keep': 'keep', 'trip-quicker-back': 'back' };
    result.addEventListener('click', e => {
        const target = /** @type {HTMLElement} */ (e.target);
        const keyboard = e.detail === 0;
        const quicker = target.closest('#trip-quicker-take, #trip-quicker-keep, #trip-quicker-back');
        if (quicker) { tell({ type: 'quicker', act: QUICKER[quicker.id], keyboard }); return; }
        const way = target.closest('[data-way]');
        if (way instanceof HTMLElement && way.dataset.way) tell({ type: 'take', key: way.dataset.way, keyboard, position: lastPosition() });
    });
    result.addEventListener('pointerdown', e => { held = Boolean(/** @type {HTMLElement} */ (e.target).closest('#trip-quicker')); });
    ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, () => { held = false; }));
    // Where the keyboard goes once something the rider did is drawn; the way
    // shown's heading when that isn't there
    const FOCUS = { heading: '.trip-card h2', back: '#trip-quicker-back', take: '#trip-quicker-take' };
    /** @param {import('./controller.js').Focus} on */
    const focusOn = on => /** @type {HTMLElement | null} */ (result.querySelector(typeof on === 'object' ? `[data-way="${CSS.escape(on.way)}"]` : FOCUS[on]) ?? result.querySelector('.trip-card h2'))?.focus();
    // What's said of something that happened, as it isn't where the keyboard is
    const SAID = { switched: 'trip.switched', picked: 'trip.picked-said', lost: 'trip.picked-lost', checking: 'trip.take-checking', gone: 'trip.take-gone' };

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
            // Said while it's worked out, the first of the day taking
            // longest, as the day's city is made for it
            case 'new-trip':
                setHtml(result, html`<p class="trip-intro" role="status">${t('trip.working')}</p>`);
                break;
            case 'search':
                searches?.postMessage(job.ask);
                break;
            // The half hour just in, said once drawn
            case 'draw':
                draw(job.now, job.buses, job.speak, Boolean(job.half?.say));
                break;
            case 'render':
                render(job);
                break;
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
                if (job.always || !inAnswer()) drawAnswer();
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
            case 'focus':
                focusOn(job.on);
                break;
            case 'say':
                announce(t(SAID[job.what]));
                break;
            case 'keep-picked':
                keepPicked(job.key, Date.now());
                break;
            case 'buzz':
                navigator.vibrate?.(200);
                break;
            case 'countdown': {
                const timer = $('trip-switch-timer');
                if (timer) timer.textContent = switchIn(job.seconds);
                break;
            }
            case 'wait':
                setTimeout(() => tell({ type: 'check-waited', ticket: job.ticket }), job.ms);
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
        if (shown) draw(shown.now, shown.options, false, false);
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
        // Drawn at once, unless someone is in the answer (the controller)
        if ('half' in data) {
            tell({ type: 'half', id: data.id, view: data.half, held: inAnswer() });
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
    tell({ type: 'kept', from: keptFrom, to: keptTo, picked: kept?.picked ?? null });
    if (keptFrom) { fromInput.value = keptFrom.title; sayExact(fromPicker, keptFrom); }
    if (keptTo) { toInput.value = keptTo.title; sayExact(toPicker, keptTo); }
    // The ride followed from My location when the page was last open
    // (decision 58): taken up below, in place of a start from where the rider is
    const resume = kept?.ride && !kept.from && trip.to ? kept.ride : null;
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
    // Each second: the controller's second (the switch's countdown, while
    // it's on the page and nobody holds it or is on it with the keyboard; a
    // re-plan once the rider has moved far enough or is off the way, From's
    // status line, the live times asked when due or paused), with the last
    // position there is; and the times counting down
    setInterval(() => {
        const card = $('trip-quicker');
        tell({ type: 'second', position: lastPosition(), held: inAnswer(), counting: Boolean(card) && !held && !keyboardIn(card) });
        countTimes();
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
