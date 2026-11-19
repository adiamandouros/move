// The Trip page's trip, its search answers, its live times and the ride
// followed, with no page in it (roadmap Trip · state). main.js tells it what
// happened (an end picked, the minute gone by, the worker's answer, a stop's
// answer from OASA, a fix) and carries out the jobs it answers with (search,
// ask OASA for a stop, draw, keep the trip and the ride). It never touches
// the page, timers, the network, the worker, the location or storage, and is
// given the time, so it's tested in Node (test/trip-controller.test.js):
// given these events, these jobs. The switch, the decision's choice and the
// ways taken are still main.js's, which the controller asks what it needs
// of them (`chosen`); they move in after this.
//
// The trip is searched for leaving now and, with it, its next half hour
// (decisions 32 and 33); searched again each minute for a later time, the
// half hour too once it's HALF_REWORK_SECONDS old. Planned again from where
// the rider moved to (decision 45), the answer drawn stays until the new
// one's half hour is in, so it doesn't change twice. The way shown in full
// and the other ways shown are timed by the worker with OASA's live times
// (decisions 35 and 62), each stop asked when it's due (live.js), and
// with how late the suburban trains run (decision 42). Only the newest
// answer of each kind counts for the current trip (decision 65, tickets.js).
// With My location on, From follows the rider (decision 45), and once
// they've left, the way shown in full is theirs and each fix places them on
// it (decision 50, follow.js); the ride is kept with the trip (decision 58).

import { athensNow } from '/tools/subway/network.js';
import { walkSeconds } from '/tools/subway/city.js';
import { isIdle } from '/tools/buses/timing.js';
import { carry, GAP_MS, leftStart, offDue, placeOn, replanDue, REPLAN_MS, startOver, starting, stepOf, stillDue, waySteps } from './follow.js';
import { dueStops, liveStatus, ownBus, unanswered } from './live.js';
import { tickets } from './tickets.js';
import { trainsDue, trainsUnanswered } from './trains.js';

// The next half hour is worked out again once it's this old, while the page
// is open (decision 33)
export const HALF_REWORK_SECONDS = 600;
// On a ride followed, the search ahead runs at each stop reached, at most
// this often (decision 50), and the search for the other ways shown, walking
// or waiting too (decision 63)
export const AHEAD_MS = 60_000;

/** @typedef {import('./buses.js').BusOption} BusOption */
/** @typedef {import('./buses.js').StopLive} StopLive */
/** @typedef {import('./trains.js').TrainsLive} TrainsLive */
/** @typedef {import('/tools/subway/network.js').AthensTime} AthensTime */
/** @typedef {import('./searcher.js').Asked} Asked */
/** @typedef {import('./searcher.js').Answered} Answered */
/** @typedef {Extract<Answered, { half: unknown }>['half']} HalfAnswer */
/** @typedef {Extract<Asked, { half: boolean }>} SearchAsked */
/** @typedef {Extract<Asked, { live: unknown }> | Extract<Asked, { others: unknown }>} TimeAsked */
/** @typedef {'start' | 'moved' | 'ride' | 'other' | 'take' | null} Opening */
/**
 * An end of the trip: a place found (an address, a place, a station, as
 * main.js's chosenPlace makes it) or My location
 * @typedef {import('./buses.js').Point & { title: string, station?: string }} Place
 */
/**
 * The ride kept when the page was last open (kept.js, decision 58): where
 * (`from`), for when (`now`) and from what time (`at`) its trip was planned,
 * its way's key and steps and where the rider was on them, their own bus,
 * and the way switched to (decision 64); the switch's part passed on to
 * main.js with the new trip as it is
 * @typedef {{ from: import('./buses.js').Point, at: number, now: AthensTime, key: string, steps: object[], state: object,
 *   own?: import('./buses.js').OwnBus | null, switched?: { way: import('./buses.js').Ahead, by: 'quicker' | 'picked' } | null } & Record<string, any>} KeptRide
 */
/** @typedef {import('./follow.js').Fix} Fix a position from the phone (location.js), placed by follow.js */
/**
 * The way shown in full, as drawn: the half hour `id`'s `row` for its
 * `departure`, `taken`: the quicker way the rider took in its place on a
 * decision (decision 36), `switched`: the way switched to on a ride, by key
 * @typedef {{ id: number, row: number, departure: number, taken: boolean, switched: string | null }} Want
 */
/**
 * The other ways shown, as drawn: the half hour `id`'s rows, each for its departure
 * @typedef {{ id: number, ways: { row: number, departure: number }[] }} OthersWant
 */
/**
 * What main.js still keeps of the switch and the decision (until they move
 * in): the rider's choice of the quicker way, the ways they kept theirs
 * over, the way switched to itself, and that way with whose it was, to keep
 * with the ride (null unless the worker has sent it)
 * @typedef {{ choice: 'taken' | 'kept' | null, declined: string[], switchedWay: import('./buses.js').Ahead | null,
 *   switched: { way: import('./buses.js').Ahead, by: 'quicker' | 'picked' } | null }} Chosen
 */
/**
 * What happened. `kept`: the trip kept from earlier, as the page opens
 * (nothing asked yet); `open`: the page is ready, the trip asked; `from`,
 * `to`: an end picked or cleared (null), `say` its answer once it's in (a
 * start picked turns My location off); `swap`: the ends swapped (My location
 * off too); `refresh`: the minute gone by; `gone`: the bus of a way tapped had
 * gone, so the ways are searched again at once, the half hour too (decision
 * 64); `moved`: planned again from `position`, where the rider is (a way
 * taken walking or waiting, decision 64); `redraw`: something the answer is
 * drawn with came in; `answer`, `half`: the worker's; `failed`: its searches
 * can't be had (`updated`: a newer Wayhop is waiting). `held`: someone is in
 * the answer (the keyboard, or a pointer held on the switch), so it isn't
 * drawn again under them.
 * The live times: `shown`, `others-shown`: the way shown in full and the
 * other ways shown, as just drawn; `stop`: a stop's answer from OASA, for the
 * request with `ticket` (null: none came); `trains`: how late the trains
 * run (null: no answer); `timed`, `others-timed`: the worker's timings;
 * `retime`: the way shown to be timed again (`ahead`: the search ahead or
 * from where the rider is first, decision 63); `check`: the stop of a way
 * tapped to be asked (decision 64); `touch`: a tap or a key pressed;
 * `visible`: the page back in sight; `second`: the clock's second gone by.
 * My location: `use-location`: From set to where the rider is (`say` its
 * answer); `locate`: its button pressed (`known`: a recent position, or
 * none yet); `located`: a fix (`typing`: someone is in From, which a fix
 * never fills by itself); `location-problem`: blocked or unavailable;
 * `permission`: the browser's word as the page opens (`typed`: a start was
 * typed meanwhile); `resume`: the ride kept taken up, from where it was;
 * `card`: the way shown in full as just drawn, for following, the day's
 * `date` (its trains); `switched`: a way switched to on the ride, or back
 * (the rider's place carries over); `hidden`: the page out of sight (the
 * phone may close it). `position` on `second` and `visible`: the last fix
 * there is, for planning again once the rider has moved far enough
 * @typedef {{ type: 'kept', from: Place | null, to: Place | null }
 *   | { type: 'open' } | { type: 'swap' } | { type: 'gone' } | { type: 'switched' } | { type: 'hidden' }
 *   | { type: 'from', place: Place | null, say?: boolean }
 *   | { type: 'to', place: Place | null, say?: boolean }
 *   | { type: 'moved', position: import('./buses.js').Point }
 *   | { type: 'refresh', held: boolean }
 *   | { type: 'redraw', held: boolean }
 *   | { type: 'answer', id: number, options: BusOption[], trains: boolean, timing: { city: number | null, answer: number }, held: boolean }
 *   | { type: 'half', id: number, view: HalfAnswer, held: boolean }
 *   | { type: 'failed', updated: boolean }
 *   | { type: 'shown', want: Want | null }
 *   | { type: 'others-shown', want: OthersWant | null }
 *   | { type: 'stop', code: string, ticket: number, answer: StopLive | null }
 *   | { type: 'trains', answer: TrainsLive | null }
 *   | { type: 'timed' } & Extract<Answered, { live: unknown }>['live']
 *   | { type: 'others-timed' } & Extract<Answered, { others: unknown }>['others']
 *   | { type: 'retime', ahead?: boolean }
 *   | { type: 'check', code: string }
 *   | { type: 'touch' }
 *   | { type: 'visible', position: Fix | null, held: boolean }
 *   | { type: 'second', position: Fix | null, held: boolean }
 *   | { type: 'use-location', position: Fix, say: boolean }
 *   | { type: 'locate', known: Fix | null }
 *   | { type: 'located', position: Fix, typing: boolean, held: boolean }
 *   | { type: 'location-problem', problem: string }
 *   | { type: 'permission', permission: string, typed: boolean }
 *   | { type: 'resume', ride: KeptRide }
 *   | { type: 'card', way: object | null, date: string }} TripEvent
 */
/**
 * What to do. `keep`: keep the trip's ends on the device (kept.js); `intro`:
 * there's no trip, say what the page does; `new-trip`: say it's being worked
 * out, and start over what's kept of the ride and the switch, taking up the
 * ride kept (`resumed`); `reset-live`, `move-live`: start that over for the
 * searches failing, and for a trip planned again from where the rider moved
 * to; `search`, `time`: ask the worker; `draw`: draw the answer for leaving
 * `now` with the ways with a bus `buses`, `speak` saying it, and with
 * `half`, the half hour just in (`say`: said once drawn); `draw-answer`: draw
 * the latest answer again, unless someone is in it; `timing`: the half
 * hour's timing under the answer (/trip?timing); `retime`: once what's before
 * it is done (a draw can change which way is shown), the way shown to be
 * timed again. The live times: `show-live`: say above the answer that
 * they're paused, unavailable or older (`status`, live.js; null: nothing to
 * say); `ask-stop`: ask OASA for a stop, the request saying `opening`, its
 * answer told with `ticket`; `ask-trains`: ask how late the trains run;
 * `stop-in`: a stop's answer counted (for the way tapped being checked);
 * `switched-way`: the way switched to, as the worker timed it; `checked`:
 * the timing the way tapped waited for may be in (`onward`: a followed
 * rider's, decision 63). My location: `following`: its button on or off;
 * `start-location`: ask the browser for the rider's position, following it;
 * `from-here`: From says My location; `from-status`: what From's status
 * line says (finding the location, blocked or unavailable, the ride
 * followed, or minutes since the last position came); `keep-ride`:
 * keep the ride followed with the trip (kept.js), or none
 * @typedef {{ do: 'keep', from: Place | null, to: Place | null }
 *   | { do: 'intro' | 'reset-live' | 'move-live' | 'timing' | 'retime' | 'draw-answer' | 'ask-trains' | 'start-location' | 'from-here' }
 *   | { do: 'following', on: boolean }
 *   | { do: 'from-status', status: 'finding' | 'denied' | 'unavailable' | 'following' | number }
 *   | { do: 'keep-ride', ride: object | null }
 *   | { do: 'new-trip', resumed: KeptRide | null }
 *   | { do: 'search', ask: SearchAsked }
 *   | { do: 'time', ask: TimeAsked }
 *   | { do: 'draw', now: AthensTime, buses: BusOption[], speak: boolean, half?: { say: boolean } }
 *   | { do: 'show-live', status: ReturnType<typeof liveStatus> }
 *   | { do: 'ask-stop', code: string, opening: Opening, ticket: number }
 *   | { do: 'stop-in', code: string }
 *   | { do: 'switched-way', way: import('./buses.js').Ahead }
 *   | { do: 'checked', onward: boolean }} TripJob
 */
/**
 * The moment an event happens: `ms`, the device's clock (Date.now()), `now`,
 * Athens's (athensNow), and whether the page is out of sight
 * @typedef {{ ms: number, now: AthensTime, hidden: boolean }} Moment
 */

// The same way shown in full: the same row of the same half hour, taken or
// not, switched to or not
/** @param {Partial<Want> | null} a @param {Partial<Want> | null} b */
export const sameRow = (a, b) => a?.id === b?.id && a?.row === b?.row && Boolean(a?.taken) === Boolean(b?.taken) && (a?.switched ?? null) === (b?.switched ?? null);

/**
 * `buses`: whether the searches could be started (worker.js); `suburban`:
 * whether they have the suburban railway, unless it's hidden on the Subway
 * page (decision 41); `at`: when the page opened (Date.now()), as last
 * touched; `hereTitle`: what My location is called, as an end; `railOn`:
 * the network a way is followed on, with the day's suburban trains
 * (main.js's drawnOn); `chosen`: what main.js still keeps of the switch and
 * the decision
 * @param {{ buses: boolean, suburban: boolean, at: number, hereTitle: string, railOn: (date: string) => import('/tools/subway/network.js').Rail, chosen: () => Chosen }} options
 */
export function tripController({ buses, suburban, at, hereTitle, railOn, chosen }) {
    // Only the newest answer to each kind of question counts, for the
    // current trip (decision 65): a trip searched ('search'), its half hour
    // ('half'), the way shown timed ('way'), the other ways timed ('others'),
    // each stop asked of OASA (`stop <code>`)
    const latest = tickets();
    /** @type {Place | null} */
    let from = null;
    /** @type {Place | null} */
    let to = null;
    // What's been asked of the searches: the latest trip, and the latest half
    // hour; the latest answer, the ways with a bus for leaving at its `now`;
    // and the latest half hour's answer. Each for the trip it says
    /** @type {{ from: Place, to: Place, now: AthensTime, speak: boolean } | null} */
    let asked = null;
    /** @type {{ from: Place, to: Place } | null} */
    let askedHalf = null;
    /** @type {{ from: Place, to: Place, now: AthensTime, options: BusOption[] } | null} */
    let found = null;
    /** @type {{ id: number, from: Place, to: Place, view: HalfAnswer } | null} */
    let half = null;
    // How long they took, for /trip?timing
    /** @type {{ city: number | null, answer: number, half: HalfAnswer | null }} */
    const timing = { city: null, answer: 0, half: null };
    // The trip as last planned, and when (decision 45: My location plans it
    // again once the rider has moved far enough). While it's planned again
    // from where they moved to (`moving`), the answer shown stays until the
    // new one's next half hour is in
    let planned = { from, to, at: 0 };
    let moving = false;
    // The buses can't be had: their searches couldn't be started or failed
    // ('updated': most likely an older copy of them, with a newer Wayhop waiting)
    /** @type {boolean | 'updated'} */
    let noBuses = !buses;
    // The suburban railway has no times for today, so the searches leave it
    // out (decision 41); not said when it's hidden on the Subway page
    let noTrains = false;

    // OASA's live times (decision 35). The way shown in full: which way that
    // is (`wanted`), the worker's latest timing of it (`way`), and on a
    // decision (decision 36) the directions' latest timing, drawn at once if
    // the rider goes back to them. Each stop's latest answer, when each was
    // asked, those being asked, and what the next new stop's request says
    // (`opening`: a new trip's first, or the first after it was planned again
    // from where the rider moved to, decision 45); whether asking is paused,
    // and when the page was last touched. How late the suburban trains run:
    // the latest answer, for every train, so kept from trip to trip; when it
    // was asked for, and whether it's being asked for. The other ways shown
    // (decision 62): which they are and the worker's latest timing of each;
    // to a rider followed along the way, the ways on from where they are
    // instead (`onward`, decision 63), as last timed, kept till the next
    // search finds others
    const times = {
        /** @type {Want | null} */ wanted: null,
        /** @type {(Want & { way: import('./buses.js').LiveWay }) | null} */ way: null,
        /** @type {(Want & { way: import('./buses.js').LiveWay }) | null} */ directions: null,
        /** @type {Map<string, StopLive>} */ answers: new Map(),
        /** @type {Map<string, number>} */ asked: new Map(),
        /** @type {Set<string>} */ asking: new Set(),
        /** @type {Opening} */ opening: 'start',
        paused: false,
        touched: at,
        /** @type {TrainsLive | null} */ trains: null,
        trainsAsked: -Infinity,
        askingTrains: false,
        others: { /** @type {OthersWant | null} */ wanted: null, /** @type {(import('./searcher.js').OtherWay | null)[]} */ ways: [] },
        /** @type {import('./searcher.js').OnwardWay[] | null} */ onward: null,
    };
    // A new trip: nothing of the one before; planned again from where the
    // rider moved to: the stops keep their answers and their turn on the
    // tiers, so only the stops new to its way are asked at once
    const timesOver = () => Object.assign(times, { answers: new Map(), asked: new Map(), asking: new Set(), opening: 'start' });
    const timesMoved = () => Object.assign(times, { wanted: null, way: null, directions: null, others: { wanted: null, ways: [] }, onward: null });

    // My location following the rider's own ride (Plan 7, decision 50).
    // `following`: My location's switch; `waiting`: pressed, with no position
    // yet. The ride: the way shown in full as the steps it's followed by
    // (follow.js), which way they're for (`key`, by its stops), where the
    // last fix put the rider on them, whether they've left the start, and
    // what From's status line says of it (`said`). `carrying`: the next way is
    // one switched to on the way, or back, so the rider's place carries over
    // (carry). `restore`: the ride kept when the page was last open (decision
    // 58), its way's key and steps and where the rider was on them, till the
    // way drawn is its own (or the half hour is in); meanwhile nothing is
    // planned again from where they are. The rider's own bus, by its vehicle
    // code, once they've boarded (decision 50); when the search ahead last
    // ran, and the search from where they are walking or waiting (decision 63)
    let following = false;
    let waiting = false;
    const ride = { /** @type {string | null} */ key: null, /** @type {any} */ way: null, /** @type {any[] | null} */ steps: null,
        state: starting(), left: false, /** @type {string | number | null} */ said: null, carrying: false, /** @type {{ key: string, steps: any[], state: any } | null} */ restore: null };
    /** @type {import('./buses.js').OwnBus | null} */
    let own = null;
    let aheadAt = -Infinity;
    let hereAt = -Infinity;
    // The ride and the searches for it, for a trip started over or planned again
    const rideMoved = () => { own = null; aheadAt = -Infinity; hereAt = -Infinity; };
    const riding = () => Boolean(following && to && ride.left && ride.steps);
    /** @param {import('./buses.js').Point} position @returns {Place} */
    const here = position => ({ lat: position.lat, lng: position.lng, title: hereTitle });
    /** @param {any} o */
    const keyOf = o => o.city ? o.rides.map(r => `${r.board.id}>${r.alight.id}`).join() : o.plan.legs.map(leg => `${leg.from}>${leg.to}`).join();

    /** @param {{ from: Place | null, to: Place | null } | null} what */
    const forTrip = what => what?.from === from && what?.to === to;
    const holding = () => moving && !forTrip(half);
    /** @returns {TripJob} */
    const drawFound = (speak = false) => ({ do: 'draw', now: found.now, buses: found.options, speak });

    // How late the suburban trains run, by number, as the way shown in full
    // is timed with it: none while it can't be had
    const lateness = () => times.trains?.unavailable ? null : times.trains?.trains ?? null;
    // The stops to ask OASA for: the way shown in full's, then the other
    // ways' first buses' (decision 62), or a followed rider's (decision 63),
    // that it doesn't have already
    const wayAsks = () => times.way?.way.asks ?? [];
    const otherAsks = () => {
        const shown = new Set(wayAsks().map(a => a.stop));
        const others = riding() ? times.onward ?? [] : times.others.ways;
        return others.flatMap(way => way?.asks ?? []).filter(a => !shown.has(a.stop) && shown.add(a.stop));
    };
    /** @returns {TripJob} */
    const showLive = () => {
        const asks = [...wayAsks(), ...otherAsks()];
        const status = times.way || asks.length ? liveStatus(asks, times.answers, times.paused, times.way && times.way.way.train !== null ? times.trains : null) : null;
        return { do: 'show-live', status };
    };
    // The way shown in full, timed again by the worker with the live times
    // there are, for leaving now; or nothing to time, as it has no bus, which
    // a timing still to come for the way before doesn't count for either.
    // `ahead`: the search ahead, or from where the rider is, first (decision 63)
    /** @param {Want | null} want @param {boolean} ahead @param {Moment} moment @returns {TripJob[]} */
    const retime = (want, ahead, moment) => {
        times.wanted = want;
        if (!want || noBuses) {
            latest.drop('way');
            if (!times.way) return [];
            times.way = null;
            return [showLive()];
        }
        const { declined, switchedWay } = chosen();
        const fix = riding() ? ride.state.fix : null;
        return [{ do: 'time', ask: { id: want.id, live: { seq: latest.take('way'), row: want.row, departure: want.departure, now: moment.now, stops: Object.fromEntries(times.answers), taken: want.taken, trains: lateness(), step: stepFor(moment), own,
            ahead, declined, switched: want.switched, switchedWay: want.switched ? switchedWay : null, here: fix && { lat: fix.lat, lng: fix.lng } } } }];
    };
    // The other ways shown, timed again by the worker with the live times
    // there are, each asking only for its first bus's stop (decision 62);
    // none to time, as none has a bus
    /** @param {OthersWant | null} want @param {Moment} moment @returns {TripJob[]} */
    const retimeOthers = (want, moment) => {
        // Another half hour's rows aren't the ones timed
        if (want?.id !== times.others.wanted?.id) times.others.ways = [];
        times.others.wanted = want;
        if (!want?.ways.length || noBuses) {
            latest.drop('others');
            times.others.ways = [];
            return [];
        }
        return [{ do: 'time', ask: { id: want.id, others: { seq: latest.take('others'), ways: want.ways, now: moment.now, stops: Object.fromEntries(times.answers), trains: lateness() } } }];
    };
    // Both, with what came in
    /** @param {Moment} moment */
    const timeAgain = moment => [...retime(times.wanted, false, moment), ...retimeOthers(times.others.wanted, moment)];
    // A stop's live times, one request each, so each shows as soon as it's in
    /** @param {string} code @param {Opening} opening @returns {TripJob} */
    const askStop = (code, opening) => {
        times.asking.add(code);
        return { do: 'ask-stop', code, opening, ticket: latest.take(`stop ${code}`) };
    };
    // The stops that are due (live.js), and the trains when the way has one
    // (trains.js): nothing while paused or out of sight. The first stop not
    // asked before says the trip's `opening`, the way shown's before the
    // other ways'; after a re-plan that kept every stop, nothing does. A
    // stop first asked for the ride the rider is on (their own bus's,
    // decision 50) says that instead, and one first asked for another way
    // (decision 62) that
    /** @param {Moment} moment @returns {TripJob[]} */
    const askDue = moment => {
        if (times.paused || moment.hidden) return [];
        const asks = [...wayAsks(), ...otherAsks()];
        if (!asks.length && !times.way) return [];
        const { seconds } = moment.now;
        const due = dueStops(asks, times, moment.ms, seconds);
        const forRide = new Set(wayAsks().filter(a => a.ride).map(a => a.stop));
        const forOther = new Set(otherAsks().map(a => a.stop));
        const unasked = code => !times.answers.has(code) && !forRide.has(code);
        const first = due.find(code => unasked(code) && !forOther.has(code)) ?? due.find(unasked);
        /** @returns {Opening} */
        const opening = code => forRide.has(code) ? times.answers.has(code) ? null : 'ride'
            : code === first ? times.opening ?? (forOther.has(code) ? 'other' : null)
            : forOther.has(code) && !times.answers.has(code) ? 'other' : null;
        const jobs = due.map(code => askStop(code, opening(code)));
        times.opening = null;
        const train = times.way?.way.train ?? null;
        if (train !== null && trainsDue(train, { asking: times.askingTrains, asked: times.trainsAsked, answer: times.trains }, moment.ms, seconds)) {
            times.askingTrains = true;
            jobs.push({ do: 'ask-trains' });
        }
        return jobs;
    };
    // Someone is looking at the page: paused live times go on
    /** @param {Moment} moment @returns {TripJob[]} */
    const touch = moment => {
        times.touched = moment.ms;
        if (!times.paused) return [];
        times.paused = false;
        return [showLive(), ...timeAgain(moment)];
    };
    // The answer drawn again with what came in, unless someone is in it:
    // then with the next refresh
    /** @param {boolean} held @param {Moment} moment @returns {TripJob[]} */
    const redraw = (held, moment) => {
        if (!from || !to || held) return [];
        if (noBuses) return [{ do: 'draw', now: moment.now, buses: [], speak: false }];
        return forTrip(found) && !holding() ? [drawFound()] : [];
    };

    // Where the rider is, for the worker to time the way from (buses.js
    // LiveStep): as of now, or of the last fix when none has come for a while
    // (underground), so nothing slides to the next train; a walk by what's
    // left of it from the last fix
    /** @param {Moment} moment @returns {import('./buses.js').LiveStep | null} */
    const stepFor = moment => {
        if (!riding()) return null;
        const step = stepOf(ride.steps, ride.state);
        const { fix, at: atMs, stop } = ride.state;
        const frozen = fix && moment.ms - fix.at > GAP_MS;
        const walk = fix && (step.kind === 'walk' || step.kind === 'last') ? Math.round(walkSeconds(fix, step.to)) : 0;
        return { leg: 'ride' in step ? step.ride : 0, kind: step.kind, stop, at: frozen ? athensNow(new Date(atMs)).seconds : moment.now.seconds, walk };
    };
    // The ride followed, kept with the trip for the page opened again
    // (decision 58): where and for when the way was searched, its steps and
    // where the rider is on them; and the way switched to on a ride, itself,
    // as it can't be searched again from the start (decision 64). Not while
    // the kept one is still being taken up, nor while a new plan is being searched
    /** @returns {TripJob[]} */
    const keepFollowed = () => {
        if (ride.restore || !forTrip(found)) return [];
        const { choice, switched } = chosen();
        return [{ do: 'keep-ride', ride: riding() ? { from: { lat: from.lat, lng: from.lng }, now: found.now, at: planned.at, key: ride.key, steps: ride.steps, state: ride.state, choice, own, switched } : null }];
    };
    /** @returns {TripJob[]} */
    const resetRide = () => {
        Object.assign(ride, { key: null, way: null, steps: null, state: starting(), left: false, said: null, carrying: false, restore: null });
        return [{ do: 'keep-ride', ride: null }];
    };
    // My location on or off: typing or picking a start, swapping, or the
    // location blocked turns it off, and the ride followed goes
    /** @param {boolean} on @returns {TripJob[]} */
    const follow = on => {
        following = on;
        waiting &&= on;
        return [{ do: 'following', on }, ...on ? [] : resetRide()];
    };
    // The steps are made again only for another way: a trip planned again,
    // or the quicker way taken; the rider's place on them starts over, where
    // the last fix had them, but for a way switched to on the way or back,
    // and for the ride kept: where they were on its own way, carried over
    // to another (a way switched to isn't searched again)
    /** @param {any} o a way of the answer for leaving now, or of the half hour @param {string} date @returns {TripJob[]} */
    const followWay = (o, date) => {
        const key = o ? keyOf(o) : null;
        const { restore } = ride;
        const final = restore && (key === restore.key || forTrip(half));
        if (key === ride.key) {
            if (final) ride.restore = null;
            return [];
        }
        const steps = o ? waySteps(o, from, to, railOn(date)) : null;
        const state = restore && steps ? key === restore.key ? restore.state : carry(restore.steps, restore.state, steps)
            : ride.carrying && ride.steps && steps ? carry(ride.steps, ride.state, steps) : startOver(ride.state);
        if (final) ride.restore = null;
        Object.assign(ride, { key, way: o, steps, state, carrying: false });
        return keepFollowed();
    };
    // My location as From, from `position`, `say` its answer once it's in
    /** @param {Fix} position @param {boolean} say @param {Moment} moment @returns {TripJob[]} */
    const useLocation = (position, say, moment) => {
        const jobs = [/** @type {TripJob} */ ({ do: 'from-here' }), ...follow(true)];
        from = here(position);
        return [...jobs, ...render({ speak: say }, moment)];
    };
    // What From's status line says of a ride followed: that it is, or how
    // long ago the last position came once that's a while (underground)
    /** @param {Moment} moment @returns {TripJob[]} */
    const sayRide = moment => {
        if (!riding()) return [];
        const age = ride.state.fix ? moment.ms - ride.state.fix.at : 0;
        const status = age > GAP_MS ? Math.floor(age / 60_000) : 'following';
        if (status === ride.said) return [];
        ride.said = status;
        return [{ do: 'from-status', status }];
    };
    // Before there's a way to follow, the trip planned again once the rider
    // has moved far enough (decision 45): in sight only, and not while the
    // keyboard is in the answer, as for a refresh
    /** @param {Fix | null} position @param {boolean} held @param {Moment} moment @returns {TripJob[]} */
    const replanIfMoved = (position, held, moment) => {
        if (!following || !from || !to || ride.steps || ride.restore || moment.hidden || held) return [];
        if (!position || !replanDue({ lat: from.lat, lng: from.lng, at: planned.at }, position, moment.ms)) return [];
        from = here(position);
        return render({ moved: true }, moment);
    };
    // Off the way (decision 50), by a fix or by the minute going by since
    // the first fix off it: planned again from where the rider is, as a new
    // start, in sight and no sooner than 2 minutes after the last plan
    /** @param {Moment} moment @returns {TripJob[]} */
    const replanIfOff = moment => {
        if (!riding() || !offDue(ride.state, moment.ms) || moment.hidden || moment.ms - planned.at < REPLAN_MS) return [];
        from = here(ride.state.fix);
        return render({ moved: true }, moment);
    };
    // A fix with a way to follow: once the rider has left the start, it
    // places them on the way (follow.js); on to another step, the way is
    // timed from there and drawn again; off the way, planned again. Moving
    // on resumes live times paused for standing still
    /** @param {Fix} fix @param {boolean} held @param {Moment} moment @returns {TripJob[]} */
    const placeFix = (fix, held, moment) => {
        if (!ride.left) {
            if (!leftStart(fix, from)) return [];
            ride.left = true;
        }
        const nowMs = moment.ms;
        ride.state = placeOn(ride.steps, ride.state, fix, nowMs);
        /** @type {TripJob[]} */
        const jobs = [...ride.state.moved ? keepFollowed() : [], ...sayRide(moment)];
        // Boarding a bus: the one of the way's lines OASA had due at that
        // stop nearest then is theirs, known again where they get off
        const step = stepOf(ride.steps, ride.state);
        if (ride.state.moved && step.kind === 'ride' && own?.leg !== step.ride) {
            const boarded = ride.way?.rides?.[step.ride];
            const code = boarded?.board.id.startsWith('bus:') ? boarded.board.id.slice('bus:'.length) : null;
            const vehicle = code ? ownBus(times.answers.get(code), boarded.lines, moment.now.seconds) : null;
            own = vehicle ? { leg: step.ride, vehicle } : null;
        }
        if (times.paused && ride.state.anchor?.at === nowMs) jobs.push(...touch(moment));
        if (offDue(ride.state, nowMs)) return [...jobs, ...replanIfOff(moment)];
        // The other ways shown searched again (decision 63): at a stop of the
        // ride, the search ahead with them (decision 50), and walking or
        // waiting with each fix, each at most once a minute
        const onFoot = step.kind === 'walk' || step.kind === 'wait';
        const ahead = onFoot ? nowMs - hereAt >= AHEAD_MS : ride.state.moved && nowMs - aheadAt >= AHEAD_MS;
        if (ahead && onFoot) hereAt = nowMs;
        else if (ahead) aheadAt = nowMs;
        if (!ride.state.moved) return ahead ? [...jobs, ...retime(times.wanted, true, moment)] : jobs;
        return [...jobs, ...retime(times.wanted, ahead, moment), ...redraw(held, moment)];
    };

    // The trip as it stands, asked or drawn. `refresh`: the same trip, for a
    // later time, with `rework` its half hour worked out again however old;
    // `moved`: planned again from where the rider moved to; `resumed`: the
    // ride kept, searched for when it was
    /**
     * @param {{ speak?: boolean, refresh?: boolean, moved?: boolean, rework?: boolean, resumed?: KeptRide | null }} how
     * @param {Moment} moment
     * @returns {TripJob[]}
     */
    const render = ({ speak = false, refresh = false, moved = false, rework = false, resumed = null }, moment) => {
        /** @type {TripJob[]} */
        const jobs = [{ do: 'keep', from, to }];
        if (!from || !to) return [...jobs, { do: 'intro' }];
        if (!forTrip(planned)) planned = { from, to, at: moment.ms };
        const now = resumed?.now ?? moment.now;
        if (noBuses) return [...jobs, { do: 'draw', now, buses: [], speak }];
        const same = forTrip(found);
        // Followed along the way, the rider has left: the answer isn't
        // searched again for someone leaving the start now, so the way shown
        // stays theirs (decision 50); it's timed from where they are (retime)
        if (same && (!refresh || riding())) return [...jobs, drawFound(speak)];
        // Its own search still out (the minute's refresh, or the page opening,
        // before its answer came): nothing more is asked, as the answer is on
        // its way. Asked again, it would start the trip over: the answer kept
        // while it's planned again from where the rider moved to taken away,
        // every stop's live times asked again, a ride kept searched for now
        if (!same && forTrip(asked)) return jobs;
        // A new trip's half hour, and one old enough to be worked out again
        // (or from before midnight); the old one stays until the new one comes
        const age = forTrip(half) ? now.seconds - half.view.departures[0] : 0;
        const halfToo = !same || rework || age < 0 || age >= HALF_REWORK_SECONDS;
        moving = moved || (same && moving);
        if (moved) {
            // The way's timing and the other ways' still to come are for the
            // way before; the stops keep their answers
            latest.drop('way', 'others');
            timesMoved();
            rideMoved();
            times.opening = 'moved';
            jobs.push({ do: 'move-live' }, showLive());
        } else if (!same) {
            // A new trip: nothing asked for the one before counts
            timing.half = null;
            latest.newTrip();
            timesMoved();
            timesOver();
            rideMoved();
            // The rider's own bus as it was, for the ride kept (decision 58)
            own = resumed?.own ?? null;
            jobs.push({ do: 'new-trip', resumed }, showLive());
        }
        // Taken once a new trip has started over, so its answers count for it
        const id = halfToo ? latest.take('search', 'half') : latest.take('search');
        asked = { from, to, now, speak };
        if (halfToo) askedHalf = { from, to };
        jobs.push({ do: 'search', ask: { id, from, to, now, half: halfToo } });
        return jobs;
    };

    /** @type {{ [type in TripEvent['type']]: (event: Extract<TripEvent, { type: type }>, moment: Moment) => TripJob[] }} */
    const on = {
        kept: event => {
            from = event.from ?? from;
            to = event.to ?? to;
            return [];
        },
        open: (_, moment) => render({}, moment),
        from: (event, moment) => {
            const jobs = follow(false);
            from = event.place;
            return [...jobs, ...render({ speak: Boolean(event.say) }, moment)];
        },
        to: (event, moment) => {
            to = event.place;
            return render({ speak: Boolean(event.say) }, moment);
        },
        swap: (_, moment) => {
            const jobs = follow(false);
            [from, to] = [to, from];
            return [...jobs, ...render({}, moment)];
        },
        moved: (event, moment) => {
            from = here(event.position);
            return render({ moved: true }, moment);
        },
        // Not while someone is in the answer: the next minute then
        refresh: (event, moment) => {
            if (!from || !to || event.held) return [];
            return [...render({ refresh: true }, moment), { do: 'retime' }];
        },
        gone: (_, moment) => render({ refresh: true, rework: true }, moment),
        redraw: (event, moment) => redraw(event.held, moment),
        answer: event => {
            if (!latest.counts('search', event.id)) return [];
            found = { from: asked.from, to: asked.to, now: asked.now, options: event.options };
            noTrains = event.trains === false && suburban;
            timing.city = event.timing.city ?? timing.city;
            timing.answer = event.timing.answer;
            // Not for an end being typed over since it was asked, nor while
            // planned again from where the rider moved to, till its half hour
            if (holding() || !forTrip(found)) return [];
            moving = false;
            // Nor under the keyboard, as when the ways are searched again for
            // a way whose bus had gone: with the next refresh
            return event.held ? [] : [{ do: 'draw', now: asked.now, buses: event.options, speak: asked.speak }];
        },
        // Drawn at once, unless someone is in the answer: then with the next
        // refresh. Said, unless it was planned again from where the rider moved to
        half: event => {
            if (!latest.counts('half', event.id)) return [];
            half = { id: event.id, from: askedHalf.from, to: askedHalf.to, view: event.view };
            timing.half = event.view;
            if (!forTrip(found) || event.held) return [{ do: 'timing' }];
            const say = !moving;
            moving = false;
            return [{ do: 'timing' }, { ...drawFound(), half: { say } }];
        },
        // By metro and tram from now on
        failed: (event, moment) => {
            noBuses = event.updated ? 'updated' : true;
            found = null;
            moving = false;
            latest.newTrip();
            timesMoved();
            timesOver();
            rideMoved();
            return [{ do: 'reset-live' }, showLive(), ...render({ speak: asked?.speak }, moment)];
        },

        // The way shown in full drawn: timed when it's another way, or now
        // for another departure; the other ways shown, when they're others
        shown: (event, moment) => sameRow(times.wanted, event.want) && times.wanted?.departure === event.want?.departure ? [] : retime(event.want, false, moment),
        'others-shown': (event, moment) => JSON.stringify(event.want) === JSON.stringify(times.others.wanted) ? [] : retimeOthers(event.want, moment),
        // A stop's answer, or the last one marked older when none came; both
        // ways timed again with it
        stop: (event, moment) => {
            const { code } = event;
            const answer = event.answer ?? unanswered(times.answers.get(code));
            if (!latest.counts(`stop ${code}`, event.ticket)) return [];
            times.answers.set(code, answer);
            times.asked.set(code, moment.ms);
            times.asking.delete(code);
            return [{ do: 'stop-in', code }, showLive(), ...timeAgain(moment)];
        },
        trains: (event, moment) => {
            Object.assign(times, { trains: event.answer ?? trainsUnanswered(times.trains), trainsAsked: moment.ms, askingTrains: false });
            return [showLive(), ...timeAgain(moment)];
        },
        // The worker's timing of the way shown, with the ways on from where a
        // followed rider is and the way switched to, as it found them
        timed: (event, moment) => {
            if (!latest.counts('way', event.seq)) return [];
            times.way = event.way && { ...times.wanted, way: event.way };
            if (times.way && !times.way.taken) times.directions = times.way;
            if (event.others) times.onward = event.others;
            return [...event.switched ? [/** @type {TripJob} */ ({ do: 'switched-way', way: event.switched })] : [],
                showLive(), ...askDue(moment), { do: 'checked', onward: true }, { do: 'draw-answer' }];
        },
        'others-timed': (event, moment) => {
            if (!latest.counts('others', event.seq)) return [];
            times.others.ways = event.ways;
            return [showLive(), ...askDue(moment), { do: 'checked', onward: false }, { do: 'draw-answer' }];
        },
        retime: (event, moment) => retime(times.wanted, event.ahead ?? false, moment),
        // Not while it's being asked already
        check: event => times.asking.has(event.code) ? [] : [askStop(event.code, 'take')],
        touch: (_, moment) => touch(moment),
        // Timers wait while the phone is locked: the times catch up at once,
        // and the trip is planned again if the rider has moved or is off the way
        visible: (event, moment) => [...replanIfMoved(event.position, event.held, moment), ...replanIfOff(moment), ...touch(moment), ...askDue(moment)],
        // Whether the rider has moved far enough for the trip to be planned
        // again (positions come only when the phone has a new one), or has
        // been off the way long enough; From's status line; the live times
        // asked again when due, and paused, as on the Buses page, once nobody
        // has touched the page for a while (a ride followed: standing still
        // as long, decision 50)
        second: (event, moment) => {
            const jobs = [...replanIfMoved(event.position, event.held, moment), ...replanIfOff(moment), ...sayRide(moment)];
            if ((!times.way && !times.others.ways.length) || times.paused || moment.hidden) return jobs;
            const idle = riding() ? stillDue(ride.state, times.touched, moment.ms) : isIdle(times.touched, moment.ms);
            if (!idle) return [...jobs, ...askDue(moment)];
            times.paused = true;
            return [...jobs, showLive()];
        },
        // Where the rider is, kept as the phone may close the app now
        hidden: () => keepFollowed(),

        'use-location': (event, moment) => useLocation(event.position, event.say, moment),
        // Pressed: From from a recent position at once, or said to be found;
        // then following where the rider is
        locate: (event, moment) => {
            if (event.known) return [...useLocation(event.known, true, moment), { do: 'start-location' }];
            const jobs = follow(true);
            waiting = true;
            return [...jobs, { do: 'from-status', status: 'finding' }, { do: 'start-location' }];
        },
        // A fix: From for one pressed and waiting, or with no start (unless
        // someone is in From, perhaps about to type a start of their own);
        // with no To, From moves with the rider and nothing is asked; with a
        // way to follow, it places the rider on it; before one, the trip
        // planned again once they've moved far enough
        located: (event, moment) => {
            if (!following) return [];
            if (waiting) {
                waiting = false;
                return useLocation(event.position, true, moment);
            }
            if (!from) return event.typing ? [] : useLocation(event.position, true, moment);
            if (!to) {
                from = here(event.position);
                return [];
            }
            if (ride.steps) return placeFix(event.position, event.held, moment);
            return replanIfMoved(event.position, event.held, moment);
        },
        // Blocked, it can't follow anything. Said only when someone pressed it
        // and is waiting for it
        'location-problem': event => {
            /** @type {TripJob[]} */
            const jobs = [];
            if (waiting && event.problem !== 'slow') {
                waiting = false;
                jobs.push({ do: 'from-status', status: event.problem === 'denied' ? 'denied' : 'unavailable' });
            }
            return event.problem === 'denied' ? [...jobs, ...follow(false)] : jobs;
        },
        // As the page opens without a start: following the rider if the
        // browser already allows it, unless a start was typed meanwhile
        permission: event => {
            const jobs = event.permission === 'denied' ? follow(false) : [];
            if (event.permission !== 'granted' || (event.typed && !following)) return jobs;
            return [...jobs, ...follow(true), { do: 'start-location' }];
        },
        // The ride kept, taken up (decision 58): the trip searched again from
        // where and for when it was, so the same way comes back, and the rider
        // placed where they were on it; the next fix places them from there.
        // On a way switched to (decision 64), its steps at once, as the search
        // from the start won't find it: the worker times it from them
        resume: (event, moment) => {
            const kept = event.ride;
            const jobs = [/** @type {TripJob} */ ({ do: 'from-here' }), ...follow(true)];
            Object.assign(ride, { left: true, restore: { key: kept.key, steps: kept.steps, state: kept.state } });
            if (kept.switched) Object.assign(ride, { key: kept.key, steps: kept.steps, state: kept.state, carrying: true });
            from = here(kept.from);
            planned = { from, to, at: kept.at };
            return [...jobs, ...render({ speak: true, resumed: kept }, moment)];
        },
        // The way shown in full, for My location to follow the rider along
        card: event => followWay(following ? event.way : null, event.date),
        switched: () => {
            ride.carrying = true;
            return [];
        },
    };

    return {
        /**
         * What happened, at `moment`; the jobs to do, in order
         * @param {TripEvent} event
         * @param {Moment} moment
         * @returns {TripJob[]}
         */
        tell: (event, moment) => /** @type {(event: TripEvent, moment: Moment) => TripJob[]} */ (on[event.type])(event, moment),
        get from() { return from; },
        get to() { return to; },
        // Where the trip stands: no trip (an end missing), searching (asked,
        // or planned again from where the rider moved to, the answer before
        // staying till the new half hour), answered (an answer for this trip
        // to draw), followed (My location following a way, the rider not left
        // yet), riding (left, on the way) or arrived
        /** @returns {'none' | 'searching' | 'answered' | 'followed' | 'riding' | 'arrived'} */
        get stage() {
            if (!from || !to) return 'none';
            if (riding()) return stepOf(ride.steps, ride.state).kind === 'arrived' ? 'arrived' : 'riding';
            if (following && ride.steps) return 'followed';
            return noBuses || (forTrip(found) && !holding()) ? 'answered' : 'searching';
        },
        // Followed along the way, the rider has left: the step they're on, for
        // the answer drawn, and where the last fix put them
        get riding() { return riding(); },
        onStep: () => riding() ? stepOf(ride.steps, ride.state) : null,
        get fix() { return ride.state.fix; },
        // The latest answer for leaving now, and the latest half hour, while
        // they're this trip's
        answer: () => forTrip(found) ? found : null,
        halfHour: () => forTrip(half) ? half : null,
        // Planned again from where the rider moved to, its half hour not in yet
        holding,
        get plannedAt() { return planned.at; },
        get noBuses() { return noBuses; },
        get noTrains() { return noTrains; },
        timing,
        // The live times as they stand, for drawing: not to be changed
        times,
        lateness,
    };
}
