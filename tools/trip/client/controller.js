// The Trip page's trip, its search answers, its live times, the ride
// followed and what the rider chose on the way, with no page in it (roadmap
// Trip · state). main.js tells it what happened (an end picked, the minute
// gone by, the worker's answer, a stop's answer from OASA, a fix, a tap, the
// answer being drawn) and carries out the jobs it answers with (search, ask
// OASA for a stop, draw this, say that, keep the trip and the ride). It
// never touches the page, timers, the network, the worker, the location or
// storage, and is given the time, so it's tested in Node
// (test/trip-controller.test.js): given these events, these jobs.
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
// What's drawn of the answer is decided here too (`drawing`): on a decision
// the quicker way the live times offer, taken or kept (decision 36); on a
// ride followed the switch to a way found ahead, counting down (T14); and
// another way taken from the other ways, checked first when OASA had its
// bus coming (decision 64).

import { athensNow } from '/tools/subway/network.js';
import { walkSeconds } from '/tools/subway/city.js';
import { isIdle } from '/tools/buses/timing.js';
import { carry, GAP_MS, leftStart, offDue, placeOn, replanDue, REPLAN_MS, startOver, starting, stepOf, stillDue, waySteps } from './follow.js';
import { halfWays, takenOption } from './half.js';
import { CHECK_WAIT_MS, checkStop, dueStops, firstBusSaid, hasBus, liveStatus, ownBus, stillCaught, unanswered } from './live.js';
import { tickets } from './tickets.js';
import { hasTrain, trainsDue, trainsUnanswered } from './trains.js';

// The next half hour is worked out again once it's this old, while the page
// is open (decision 33)
export const HALF_REWORK_SECONDS = 600;
// On a ride followed, the search ahead runs at each stop reached, at most
// this often (decision 50), and the search for the other ways shown, walking
// or waiting too (decision 63)
export const AHEAD_MS = 60_000;
// On a ride followed, a way 3' or more sooner the search ahead finds is
// switched to after this many seconds unless the rider keeps theirs (T14)
export const SWITCH_SECONDS = 10;

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
 * the decision's choice (decision 36) and the way switched to (decision 64),
 * all taken up with it
 * @typedef {{ from: import('./buses.js').Point, at: number, now: AthensTime, key: string, steps: object[], state: object,
 *   own?: import('./buses.js').OwnBus | null, choice?: Choice, switched?: Switched | null } & Record<string, any>} KeptRide
 */
/** @typedef {'taken' | 'kept' | null} Choice the rider's choice of the quicker way on a decision (decision 36) */
/** @typedef {{ way: import('./buses.js').Ahead, by: 'quicker' | 'picked' }} Switched a way switched to on the ride, and whose it was */
/** @typedef {ReturnType<typeof import('./plan.js').doorToDoor>} DoorToDoor the answer for leaving now, as main.js works it out (plan.js) */
/**
 * What the keyboard goes on to once something the rider did is drawn: the
 * way shown's heading, the way back, the quicker way's take button, or a
 * way among the other ways, by its key (main.js finds them on the page)
 * @typedef {'heading' | 'back' | 'take' | { way: string }} Focus
 */
/** @typedef {'switched' | 'picked' | 'lost' | 'checking' | 'gone'} Said what's said to a screen reader of something that happened (main.js's words) */
/**
 * What's drawn of the half hour's ways (render.js renderHalf's options, as
 * decided here): its kind; the first way's timing with the live times
 * (`live`); whether the quicker way is offered (`offer`) or its row taken in
 * the directions' place (`taken`); the switch counting down (`switching`)
 * or the way switched to, by whom (`switched`); the other ways' timings by
 * row (`othersTimed`), or the ways on from where a followed rider is
 * (`onward`); whether the other ways can be taken (`take`); the first way
 * the rider's pick (`picked`), or theirs gone (`lost`); the way whose bus is
 * being checked (`checking`), or whose bus had gone (`gone`)
 * @typedef {{ kind: string, live: { way: import('./buses.js').LiveWay } | null, offer: boolean, taken: import('./buses.js').HalfRow | null,
 *   switching: { offer: import('./buses.js').Offer, seconds: number } | null, switched: false | 'quicker' | 'picked',
 *   othersTimed: Map<object, import('./searcher.js').OtherWay>, onward: import('./searcher.js').OnwardWay[] | null,
 *   take: boolean, picked: boolean, lost: boolean, checking: string | null, gone: boolean }} HalfShown
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
 * What happened. `kept`: the trip kept from earlier, as the page opens
 * (nothing asked yet), with the way picked then (`picked`, decision 64);
 * `open`: the page is ready, the trip asked; `from`, `to`: an end picked or
 * cleared (null), `say` its answer once it's in (a start picked turns My
 * location off); `swap`: the ends swapped (My location off too); `refresh`:
 * the minute gone by; `redraw`: something the answer is drawn with came in;
 * `answer`, `half`: the worker's; `failed`: its searches can't be had
 * (`updated`: a newer Wayhop is waiting); `drawing`: the answer for leaving
 * at `now` worked out by the page (`answer`), to be drawn (the draw job's),
 * `speak` saying it, `sayHalf` saying the half hour just in. `held`:
 * someone is in the answer (the keyboard, or a pointer held on the switch),
 * so it isn't drawn again under them.
 * The live times: `stop`: a stop's answer from OASA, for the request with
 * `ticket` (null: none came); `trains`: how late the trains run (null: no
 * answer); `timed`, `others-timed`: the worker's timings; `retime`: the way
 * shown to be timed again; `touch`: a tap or a key pressed; `visible`: the
 * page back in sight; `second`: the clock's second gone by (`counting`: the
 * switch is on the page with nobody holding it or on it with the keyboard,
 * so its countdown goes on).
 * The rider's choices: `quicker`: a button of the quicker way's card or the
 * way back (`act`), from the keyboard or not; `take`: another way tapped, by
 * its key (decision 64), with the last position there is; `check-waited`:
 * the time a way tapped waits for its stop's answer is up (`ticket`, as the
 * wait job's).
 * My location: `use-location`: From set to where the rider is (`say` its
 * answer); `locate`: its button pressed (`known`: a recent position, or
 * none yet); `located`: a fix (`typing`: someone is in From, which a fix
 * never fills by itself); `location-problem`: blocked or unavailable;
 * `permission`: the browser's word as the page opens (`typed`: a start was
 * typed meanwhile); `resume`: the ride kept taken up, from where it was;
 * `hidden`: the page out of sight (the phone may close it). `position` on
 * `second` and `visible`: the last fix there is, for planning again once
 * the rider has moved far enough
 * @typedef {{ type: 'kept', from: Place | null, to: Place | null, picked: string | null }
 *   | { type: 'open' } | { type: 'swap' } | { type: 'hidden' } | { type: 'retime' } | { type: 'touch' }
 *   | { type: 'from', place: Place | null, say?: boolean }
 *   | { type: 'to', place: Place | null, say?: boolean }
 *   | { type: 'refresh', held: boolean }
 *   | { type: 'redraw', held: boolean }
 *   | { type: 'answer', id: number, options: BusOption[], trains: boolean, timing: { city: number | null, answer: number }, held: boolean }
 *   | { type: 'half', id: number, view: HalfAnswer, held: boolean }
 *   | { type: 'failed', updated: boolean }
 *   | { type: 'drawing', now: AthensTime, answer: DoorToDoor, speak: boolean, sayHalf: boolean }
 *   | { type: 'stop', code: string, ticket: number, answer: StopLive | null }
 *   | { type: 'trains', answer: TrainsLive | null }
 *   | { type: 'timed' } & Extract<Answered, { live: unknown }>['live']
 *   | { type: 'others-timed' } & Extract<Answered, { others: unknown }>['others']
 *   | { type: 'visible', position: Fix | null, held: boolean }
 *   | { type: 'second', position: Fix | null, held: boolean, counting: boolean }
 *   | { type: 'quicker', act: 'take' | 'keep' | 'back', keyboard: boolean }
 *   | { type: 'take', key: string, keyboard: boolean, position: Fix | null }
 *   | { type: 'check-waited', ticket: number }
 *   | { type: 'use-location', position: Fix, say: boolean }
 *   | { type: 'locate', known: Fix | null }
 *   | { type: 'located', position: Fix, typing: boolean, held: boolean }
 *   | { type: 'location-problem', problem: string }
 *   | { type: 'permission', permission: string, typed: boolean }
 *   | { type: 'resume', ride: KeptRide }} TripEvent
 */
/**
 * What to do. `keep`: keep the trip's ends on the device (kept.js); `intro`:
 * there's no trip, say what the page does; `new-trip`: say it's being
 * worked out; `search`, `time`: ask the worker; `draw`: work out the answer
 * for leaving `now` with the ways with a bus `buses` and tell `drawing`,
 * `speak` saying it, and with `half`, the half hour just in (`say`: said
 * once drawn); `render`: draw that answer (`answer`), for leaving at `now`,
 * as `ways`, the half hour's ways shown (`view`), or none (the answer for
 * leaving now), saying the quicker way that came up (`offered`, with the
 * seconds the switch counts down from), the answer (`speak`) or the half
 * hour just in (`sayHalf`); `draw-answer`: draw the latest answer again,
 * unless someone is in it, or `always`, for something the rider did;
 * `timing`: the half hour's timing under the answer (/trip?timing);
 * `retime`: once what's before it is done (a draw can change which way is
 * shown), the way shown to be timed again. The live times: `show-live`: say
 * above the answer that they're paused, unavailable or older (`status`,
 * live.js; null: nothing to say); `ask-stop`: ask OASA for a stop, the
 * request saying `opening`, its answer told with `ticket`; `ask-trains`:
 * ask how late the trains run. The rider's choices: `focus`: the keyboard
 * goes on to `on`; `say`: tell a screen reader `what` happened;
 * `keep-picked`: keep the way picked with the trip (kept.js), or none;
 * `buzz`: the switch came up, so the phone buzzes where it can;
 * `countdown`: the switch's seconds left; `wait`: tell `check-waited` with
 * `ticket` in `ms`. My location: `following`: its button on or off;
 * `start-location`: ask the browser for the rider's position, following it;
 * `from-here`: From says My location; `from-status`: what From's status
 * line says (finding the location, blocked or unavailable, the ride
 * followed, or minutes since the last position came); `keep-ride`:
 * keep the ride followed with the trip (kept.js), or none
 * @typedef {{ do: 'keep', from: Place | null, to: Place | null }
 *   | { do: 'intro' | 'new-trip' | 'timing' | 'retime' | 'ask-trains' | 'start-location' | 'from-here' | 'buzz' }
 *   | { do: 'draw-answer', always?: true }
 *   | { do: 'following', on: boolean }
 *   | { do: 'from-status', status: 'finding' | 'denied' | 'unavailable' | 'following' | number }
 *   | { do: 'keep-ride', ride: object | null }
 *   | { do: 'search', ask: SearchAsked }
 *   | { do: 'time', ask: TimeAsked }
 *   | { do: 'draw', now: AthensTime, buses: BusOption[], speak: boolean, half?: { say: boolean } }
 *   | { do: 'render', now: AthensTime, answer: DoorToDoor, ways: { row: any, o: any, departure: number }[], view: HalfShown | null,
 *       offered: { offer: import('./buses.js').Offer, seconds: number | null } | null, speak: boolean, sayHalf: boolean }
 *   | { do: 'show-live', status: ReturnType<typeof liveStatus> }
 *   | { do: 'ask-stop', code: string, opening: Opening, ticket: number }
 *   | { do: 'focus', on: Focus }
 *   | { do: 'say', what: Said }
 *   | { do: 'keep-picked', key: string | null }
 *   | { do: 'countdown', seconds: number }
 *   | { do: 'wait', ms: number, ticket: number }} TripJob
 */
/**
 * The moment an event happens: `ms`, the device's clock (Date.now()), `now`,
 * Athens's (athensNow), and whether the page is out of sight
 * @typedef {{ ms: number, now: AthensTime, hidden: boolean }} Moment
 */

// The same way shown in full: the same row of the same half hour, taken or
// not, switched to or not
/** @param {Partial<Want> | null} a @param {Partial<Want> | null} b */
const sameRow = (a, b) => a?.id === b?.id && a?.row === b?.row && Boolean(a?.taken) === Boolean(b?.taken) && (a?.switched ?? null) === (b?.switched ?? null);

/**
 * `buses`: whether the searches could be started (worker.js); `suburban`:
 * whether they have the suburban railway, unless it's hidden on the Subway
 * page (decision 41); `at`: when the page opened (Date.now()), as last
 * touched; `hereTitle`: what My location is called, as an end; `railOn`:
 * the network a way is followed on, with the day's suburban trains
 * (main.js's drawnOn)
 * @param {{ buses: boolean, suburban: boolean, at: number, hereTitle: string, railOn: (date: string) => import('/tools/subway/network.js').Rail }} options
 */
export function tripController({ buses, suburban, at, hereTitle, railOn }) {
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
    /** @type {{ from: Place | null, to: Place | null, at: number }} */
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
        others: { wanted: /** @type {OthersWant | null} */ (null), ways: /** @type {(import('./searcher.js').OtherWay | null)[]} */ ([]) },
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
    // (A property's type is given as a cast: TypeScript reads a type note
    // before a property only when it starts the line)
    const ride = { key: /** @type {string | null} */ (null), way: /** @type {any} */ (null), steps: /** @type {import('./follow.js').Step[] | null} */ (null),
        state: starting(), left: false, said: /** @type {string | number | null} */ (null), carrying: false, restore: /** @type {{ key: string, steps: any[], state: any } | null} */ (null) };
    /** @type {import('./buses.js').OwnBus | null} */
    let own = null;
    let aheadAt = -Infinity;
    let hereAt = -Infinity;
    // The ride and the searches for it, for a trip started over or planned again
    const rideMoved = () => { own = null; aheadAt = -Infinity; hereAt = -Infinity; };

    // What the rider chose, beside the stage the trip is at. On a decision
    // (decision 36): their choice of the quicker way, taken or kept for the
    // rest of the trip, and whether a quicker way is offered, so it's said
    // once. On a ride followed (decision 50): the switch to the way the
    // search ahead found counting down (`countdown`: its key, the seconds
    // left); the way switched to, by key, whose it was (`switchedBy`: the
    // switch's, or one the rider took from the other ways) and the way
    // itself, as the worker last sent it, to keep with the ride
    // (`switchedWay`); and the ways the rider kept theirs over, never offered
    // again. The way the rider took from the other ways, by its key
    // (`picked`, decision 64), shown first while the half hour has it;
    // `lost`, it went, so the half hour's own is first again, which is said.
    // The way tapped whose bus is being checked (`checking`: its key, what it
    // showed of its bus, the stop asked, whether that's answered, whether
    // it's a followed rider's, from the keyboard, the last position there was
    // and its wait's ticket); `gone`, its bus had gone, so it wasn't taken;
    // `focusNext`, the keyboard goes to the next half hour's heading (a way
    // taken from the keyboard walking or waiting)
    const chosen = {
        /** @type {Choice} */ choice: null, offered: false,
        /** @type {{ key: string, left: number } | null} */ countdown: null,
        /** @type {string | null} */ switched: null, switchedBy: /** @type {'quicker' | 'picked' | null} */ (null),
        /** @type {import('./buses.js').Ahead | null} */ switchedWay: null, declined: /** @type {Set<string>} */ (new Set()),
        /** @type {string | null} */ picked: null, lost: false,
        /** @type {{ key: string, said: import('./buses.js').RideLive | undefined, stop: string, answered: boolean, onward: boolean, keyboard: boolean, position: Fix | null, ticket: number } | null} */ checking: null,
        gone: false, focusNext: false,
    };
    // The way picked when the page was last open, for the trip kept (decision 64)
    /** @type {string | null} */
    let pickedKept = null;
    // What the quicker way's buttons were last drawn for: the switch's way
    // (by key), and whether the way back is from a way switched to
    let buttons = { switching: /** @type {string | null} */ (null), switched: false };
    // No way tapped is being checked any more
    const noCheck = () => {
        latest.drop('check');
        return null;
    };
    // A new trip, or the searches failing: nothing of the choices before
    const choicesOver = () => {
        Object.assign(chosen, { choice: null, offered: false, countdown: null, switched: null, switchedBy: null, switchedWay: null,
            declined: new Set(), picked: null, lost: false, checking: noCheck(), gone: false });
    };
    // The trip planned again from where the rider moved to (decision 45):
    // the way before's choice and switch go; the ways kept over and the way
    // picked stay
    const choicesMoved = () => {
        Object.assign(chosen, { choice: null, offered: false, countdown: null, switched: null, switchedBy: null, switchedWay: null, checking: noCheck(), gone: false });
    };
    // The way switched to, with whose it was, once the worker has sent it
    /** @returns {Switched | null} */
    const switchedNow = () => chosen.switched && chosen.switchedWay?.key === chosen.switched ? { way: chosen.switchedWay, by: chosen.switchedBy ?? 'quicker' } : null;
    const riding = () => Boolean(following && to && ride.left && ride.steps);
    /** @param {import('./buses.js').Point} position @returns {Place} */
    const here = position => ({ lat: position.lat, lng: position.lng, title: hereTitle });
    /** @param {any} o */
    const keyOf = o => o.city ? o.rides.map(r => `${r.board.id}>${r.alight.id}`).join() : o.plan.legs.map(leg => `${leg.from}>${leg.to}`).join();

    /**
     * @template {{ from: Place | null, to: Place | null }} T
     * @param {T | null} what @returns {what is T}
     */
    const forTrip = what => what?.from === from && what?.to === to;
    const holding = () => moving && !forTrip(half);
    const halfNow = () => forTrip(half) ? half : null;
    /** @param {NonNullable<typeof found>} answer @returns {TripJob} */
    const drawFound = (answer, speak = false) => ({ do: 'draw', now: answer.now, buses: answer.options, speak });

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
        const fix = riding() ? ride.state.fix : null;
        return [{ do: 'time', ask: { id: want.id, live: { seq: latest.take('way'), row: want.row, departure: want.departure, now: moment.now, stops: Object.fromEntries(times.answers), taken: want.taken, trains: lateness(), step: stepFor(moment), own,
            ahead, declined: [...chosen.declined], switched: want.switched, switchedWay: want.switched ? chosen.switchedWay : null, here: fix && { lat: fix.lat, lng: fix.lng } } } }];
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
        return forTrip(found) && !holding() ? [drawFound(found)] : [];
    };

    // Where the rider is, for the worker to time the way from (buses.js
    // LiveStep): as of now, or of the last fix when none has come for a while
    // (underground), so nothing slides to the next train; a walk by what's
    // left of it from the last fix
    /** @param {Moment} moment @returns {import('./buses.js').LiveStep | null} */
    const stepFor = moment => {
        if (!riding() || !ride.steps) return null;
        const step = stepOf(ride.steps, ride.state);
        const { fix, at: atMs, stop } = ride.state;
        const frozen = fix && moment.ms - fix.at > GAP_MS;
        const walk = fix && (step.kind === 'walk' || step.kind === 'last') ? Math.round(walkSeconds(fix, step.to)) : 0;
        return { leg: 'ride' in step ? step.ride : 0, kind: step.kind, stop, at: frozen && atMs !== null ? athensNow(new Date(atMs)).seconds : moment.now.seconds, walk };
    };
    // The ride followed, kept with the trip for the page opened again
    // (decision 58): where and for when the way was searched, its steps and
    // where the rider is on them; and the way switched to on a ride, itself,
    // as it can't be searched again from the start (decision 64). Not while
    // the kept one is still being taken up, nor while a new plan is being searched
    /** @returns {TripJob[]} */
    const keepFollowed = () => {
        if (ride.restore || !from || !forTrip(found)) return [];
        return [{ do: 'keep-ride', ride: riding() ? { from: { lat: from.lat, lng: from.lng }, now: found.now, at: planned.at, key: ride.key, steps: ride.steps, state: ride.state, choice: chosen.choice, own, switched: switchedNow() } : null }];
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
        const steps = o && from && to ? waySteps(o, from, to, railOn(date)) : null;
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
        if (!riding() || !ride.state.fix || !offDue(ride.state, moment.ms) || moment.hidden || moment.ms - planned.at < REPLAN_MS) return [];
        from = here(ride.state.fix);
        return render({ moved: true }, moment);
    };
    // A fix with a way to follow: once the rider has left the start, it
    // places them on the way (follow.js); on to another step, the way is
    // timed from there and drawn again; off the way, planned again. Moving
    // on resumes live times paused for standing still
    /** @param {Fix} fix @param {boolean} held @param {Moment} moment @returns {TripJob[]} */
    const placeFix = (fix, held, moment) => {
        if (!ride.steps) return [];
        if (!ride.left) {
            if (!from || !leftStart(fix, from)) return [];
            ride.left = true;
        }
        const nowMs = moment.ms;
        ride.state = placeOn(ride.steps, ride.state, fix, nowMs);
        // Boarding a bus: the one of the way's lines OASA had due at that
        // stop nearest then is theirs, known again where they get off, and
        // kept with the ride from this fix on (decision 58)
        const step = stepOf(ride.steps, ride.state);
        if (ride.state.moved && step.kind === 'ride' && own?.leg !== step.ride) {
            const boarded = ride.way?.rides?.[step.ride];
            const code = boarded?.board.id.startsWith('bus:') ? boarded.board.id.slice('bus:'.length) : null;
            const vehicle = code ? ownBus(times.answers.get(code), boarded.lines, moment.now.seconds) : null;
            own = vehicle ? { leg: step.ride, vehicle } : null;
        }
        /** @type {TripJob[]} */
        const jobs = [...ride.state.moved ? keepFollowed() : [], ...sayRide(moment)];
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
    // Planned again from `position`, where the rider is (a way taken walking or waiting, decision 64)
    /** @param {import('./buses.js').Point} position @param {Moment} moment @returns {TripJob[]} */
    const moveTo = (position, moment) => {
        from = here(position);
        return render({ moved: true }, moment);
    };

    // The way shown in full, as just decided: timed when it's another way,
    // or now for another departure; the other ways shown, when they're others
    /** @param {Want | null} want @param {Moment} moment */
    const wayShown = (want, moment) => sameRow(times.wanted, want) && times.wanted?.departure === want?.departure ? [] : retime(want, false, moment);
    /** @param {OthersWant | null} want @param {Moment} moment */
    const othersShown = (want, moment) => JSON.stringify(want) === JSON.stringify(times.others.wanted) ? [] : retimeOthers(want, moment);

    // The answer drawn for leaving at `now` (`answer`, worked out by the
    // page), or in its place the next half hour's ways (decision 33), unless
    // walking is quicker or the trains have stopped for the night: what's
    // shown of it, the way the rider took from the other ways first, then
    // timed, followed and drawn
    /** @param {Extract<TripEvent, { type: 'drawing' }>} event @param {Moment} moment @returns {TripJob[]} */
    const drawing = ({ now, answer, speak, sayHalf }, moment) => {
        /** @type {TripJob[]} */
        const jobs = [];
        const shown = halfNow();
        const plain = !answer.walkFirst && !answer.options[0]?.morning;
        const all = shown && plain ? halfWays(shown.view, now.seconds) : [];
        const rows = shown?.view.rows ?? [];
        // The way the rider took from the other ways first, while the half
        // hour has it (decision 64); gone, the half hour's own, said once
        const pickedWay = chosen.picked ? all.find(way => way.row.key === chosen.picked) : null;
        if (chosen.picked && all.length && !pickedWay) {
            Object.assign(chosen, { picked: null, lost: true });
            jobs.push({ do: 'keep-picked', key: null }, { do: 'say', what: 'lost' });
        }
        const ways = pickedWay ? [pickedWay, ...all.filter(way => way !== pickedWay)] : all;
        // The way shown in full has OASA's live times when it has a bus, or
        // when it's a decision's directions, for the quicker way's bus, and
        // its trains' lateness when it has a train (decision 42): the
        // worker's latest timing of its row, until the next comes; the
        // quicker way's in its place once the rider takes it (decision 36)
        const [first] = ways;
        const directions = Boolean(first) && shown?.view.kind === 'decision' && first.row === rows[0];
        const choice = directions ? chosen.choice : null;
        // On a ride followed, the way switched to on the way (T14)
        const switched = riding() ? chosen.switched : null;
        // Timed with the live times when it has a bus or a train, or on a
        // decision; and while the rider is followed along it, whatever it has
        /** @type {Want | null} */
        const want = first && shown && (hasBus(first.o) || hasTrain(first.o) || directions || riding())
            ? { id: shown.id, row: rows.indexOf(first.row), departure: first.departure, taken: choice === 'taken', switched }
            : null;
        const last = [times.way, times.directions].find(way => want && sameRow(way, want));
        const timed = last ? { way: last.way } : null;
        // The switch to a way 3' or more sooner, counting down from when it
        // first comes up, with a buzz where the phone can (T14); in place of
        // the quicker way on a decision
        const sooner = riding() && !switched && timed?.way.switchTo;
        const switching = sooner && !chosen.declined.has(sooner.key) ? sooner : null;
        if (switching?.key !== chosen.countdown?.key) {
            chosen.countdown = switching && { key: switching.key, left: SWITCH_SECONDS };
            if (switching) jobs.push({ do: 'buzz' });
        }
        const offer = switching || (!choice && timed?.way.offer);
        // The other ways shown with a bus, timed with OASA's live times
        // (decision 62): not on a ride followed, where they're from the start
        // the rider has left
        const takenRow = choice === 'taken' ? shown?.view.quicker ?? null : null;
        const others = riding() ? [] : ways.slice(1).filter(({ row, o }) => row !== takenRow && hasBus(o));
        jobs.push(...othersShown(others.length && shown ? { id: shown.id, ways: others.map(({ row, departure }) => ({ row: rows.indexOf(row), departure })) } : null, moment));
        // To a rider followed along the way, the ways on from where they
        // are, once searched (decision 63), but the way switched to
        const onward = riding() && times.onward ? times.onward.filter(other => other.key !== switched) : null;
        const othersTimed = new Map(times.others.ways
            .flatMap(way => way && others.some(other => other.row === rows[way.row] && other.departure === way.departure)
                ? [/** @type {[any, import('./searcher.js').OtherWay]} */ ([rows[way.row], way])] : []));
        // The way shown in full, for My location to follow the rider along
        // (decision 50): the first card's, or the answer for leaving now's
        // best; none when walking is quicker or the trains have stopped. Not
        // while a way switched to isn't timed yet: the first card is still
        // the way before
        const card = ways.length
            ? timed?.way.option ?? (choice === 'taken' && takenRow ? takenOption(takenRow, first.departure) : first.o)
            : plain ? answer.options[0] ?? null : null;
        if (!(switched && !timed)) jobs.push(...followWay(following ? card : null, moment.now.date));
        // A quicker way coming up is said once, as it isn't where the
        // keyboard is; the switch with when it's taken by itself
        const offered = offer && !chosen.offered ? { offer, seconds: switching ? SWITCH_SECONDS : null } : null;
        chosen.offered = Boolean(offer);
        buttons = { switching: switching?.key ?? null, switched: Boolean(switched) };
        /** @type {HalfShown | null} */
        const view = ways.length && shown ? {
            kind: shown.view.kind, live: timed, offer: !choice, taken: takenRow,
            switching: switching && chosen.countdown ? { offer: switching, seconds: chosen.countdown.left } : null, switched: switched ? chosen.switchedBy ?? 'quicker' : false,
            othersTimed, onward, take: !riding(), picked: Boolean(pickedWay) && pickedWay !== all[0], lost: chosen.lost,
            checking: chosen.checking?.key ?? null, gone: chosen.gone,
        } : null;
        jobs.push({ do: 'render', now, answer, ways, view, offered, speak, sayHalf: sayHalf && ways.length > 0 });
        return [...jobs, ...wayShown(want, moment)];
    };

    // The answer drawn again at once, for something the rider did; from the
    // keyboard, the keyboard goes on to what's there now (`next`). A tap
    // leaves it, so the live times go on redrawing (they wait while the
    // keyboard is in the answer)
    /** @param {boolean | null} keyboard @param {Focus} next @returns {TripJob[]} */
    const drawAgain = (keyboard, next) => [{ do: 'draw-answer', always: true }, ...keyboard ? [/** @type {TripJob} */ ({ do: 'focus', on: next })] : []];
    // The switch on the way (T14, decision 50). Taken (by the rider, or by
    // itself when the countdown ends: `keyboard` null), the way found ahead
    // is theirs, and they stay where they are on it; kept, or gone back
    // from, that way is never offered again in this trip. `by`: the switch's
    // way, or another way off the ride the rider took (decision 64), a tap on
    // which is said; a countdown is called off. Either way the rider's place
    // carries over to the way drawn next
    /** @param {string} key @param {boolean | null} keyboard @param {'quicker' | 'picked'} by @returns {TripJob[]} */
    const switchTo = (key, keyboard, by) => {
        Object.assign(chosen, { switched: key, switchedBy: by, switchedWay: null, countdown: null });
        ride.carrying = true;
        /** @type {TripJob[]} */
        const said = keyboard === null ? [{ do: 'say', what: 'switched' }] : by === 'picked' && !keyboard ? [{ do: 'say', what: 'picked' }] : [];
        return [...said, ...drawAgain(keyboard, 'back')];
    };
    /** @param {string} key @param {boolean} keyboard */
    const keepRoute = (key, keyboard) => {
        chosen.declined.add(key);
        chosen.countdown = null;
        return drawAgain(keyboard, 'heading');
    };
    /** @param {boolean} keyboard */
    const switchBack = keyboard => {
        if (chosen.switched) chosen.declined.add(chosen.switched);
        Object.assign(chosen, { switched: null, switchedBy: null, switchedWay: null });
        ride.carrying = true;
        return drawAgain(keyboard, 'heading');
    };
    // A second off the countdown, unless it's out of sight or someone holds
    // it (not `counting`); at none, taken
    /** @param {boolean} counting @param {Moment} moment @returns {TripJob[]} */
    const countDown = (counting, moment) => {
        const { countdown } = chosen;
        if (!countdown || !counting || moment.hidden) return [];
        countdown.left--;
        if (countdown.left <= 0) return switchTo(countdown.key, null, 'quicker');
        return [{ do: 'countdown', seconds: countdown.left }];
    };

    // Another way taken (decision 64), by where the rider is. Before they've
    // left, it's the way shown in full, and the one it replaces goes among
    // the other ways; kept with the trip. Followed, on a ride, it's taken as
    // the switch's is, with the way back; walking or waiting, the trip is
    // planned again from where they are (`position`, the last there was, if
    // no fix placed them), with that way picked. From the keyboard, the
    // keyboard goes on to the way shown's heading (or the way back); a tap
    // is said
    /** @param {{ key: string, leg: number }} way @param {boolean} keyboard @param {Fix | null} position @param {Moment} moment @returns {TripJob[]} */
    const takeNow = ({ key, leg }, keyboard, position, moment) => {
        if (!riding()) {
            Object.assign(chosen, { picked: key, lost: false, choice: null });
            return [{ do: 'keep-picked', key }, { do: 'draw-answer', always: true }, keyboard ? { do: 'focus', on: 'heading' } : { do: 'say', what: 'picked' }];
        }
        if (leg >= 0) return switchTo(key, keyboard, 'picked');
        const at = ride.state.fix ?? position;
        if (!at) return [];
        Object.assign(chosen, { picked: key, lost: false, focusNext: keyboard });
        return [{ do: 'keep-picked', key }, ...keyboard ? [] : [/** @type {TripJob} */ ({ do: 'say', what: 'picked' })], ...moveTo(at, moment)];
    };
    // The way tapped, as drawn: before the rider has left, the half hour's
    // row by its key, with OASA's timing of it when it has one; followed,
    // the way on from where they are (decision 63), with the ride it leaves
    /** @param {string} key */
    const tappedWay = key => {
        if (riding()) return times.onward?.find(other => other.key === key) ?? null;
        const timed = times.others.ways.find(way => way && halfNow()?.view.rows[way.row]?.key === key);
        return { key, leg: -1, option: timed?.option ?? null, asks: timed?.asks ?? [] };
    };
    // The way tapped, timed again with its stop's new answer (or none came
    // in time: `timedOut`): taken while its bus can still be caught; gone,
    // not taken, said, and the ways searched again at once (followed, from
    // where the rider is first, decision 63)
    /** @param {boolean} timedOut @param {Moment} moment @returns {TripJob[]} */
    const settle = (timedOut, moment) => {
        const check = chosen.checking;
        chosen.checking = noCheck();
        if (!check || !forTrip(found)) return [];
        const way = check.onward === riding() ? tappedWay(check.key) : null;
        if (way && (timedOut || stillCaught(check.said, way.option ? firstBusSaid(way.option) : undefined))) return takeNow(way, check.keyboard, check.position, moment);
        chosen.gone = true;
        return [{ do: 'say', what: 'gone' }, ...riding() ? retime(times.wanted, true, moment) : render({ refresh: true, rework: true }, moment), ...drawAgain(check.keyboard, { way: check.key })];
    };
    // A timing in, after the stop's new answer: for the half hour's other
    // ways, or a followed rider's (`onward`)
    /** @param {boolean} onward @param {Moment} moment */
    const checkedIn = (onward, moment) => chosen.checking?.answered && chosen.checking.onward === onward ? settle(false, moment) : [];

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
        if (forTrip(found) && (!refresh || riding())) return [...jobs, drawFound(found, speak)];
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
            choicesMoved();
            times.opening = 'moved';
            jobs.push(showLive());
        } else if (!same) {
            // A new trip: nothing asked for the one before counts
            timing.half = null;
            latest.newTrip();
            timesMoved();
            timesOver();
            rideMoved();
            choicesOver();
            // The rider's own bus, their choice and the way switched to as
            // they were, for the ride kept (decisions 58 and 64); the way
            // picked when the page was last open, for the trip kept
            own = resumed?.own ?? null;
            if (resumed) chosen.choice = resumed.choice ?? null;
            if (resumed?.switched) Object.assign(chosen, { switched: resumed.switched.way.key, switchedBy: resumed.switched.by, switchedWay: resumed.switched.way });
            if (pickedKept) chosen.picked = pickedKept;
            pickedKept = null;
            jobs.push({ do: 'new-trip' }, showLive());
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
            pickedKept = event.picked;
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
        // Not while someone is in the answer: the next minute then
        refresh: (event, moment) => {
            if (!from || !to || event.held) return [];
            return [...render({ refresh: true }, moment), { do: 'retime' }];
        },
        redraw: (event, moment) => redraw(event.held, moment),
        answer: event => {
            if (!latest.counts('search', event.id) || !asked) return [];
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
        // Drawn at once, unless someone is in the answer (but when it was
        // planned again for a way taken from the keyboard: then the keyboard
        // goes on to its heading): then with the next refresh. Said, unless it
        // was planned again from where the rider moved to
        half: event => {
            if (!latest.counts('half', event.id) || !askedHalf) return [];
            half = { id: event.id, from: askedHalf.from, to: askedHalf.to, view: event.view };
            timing.half = event.view;
            if (!forTrip(found) || (event.held && !chosen.focusNext)) return [{ do: 'timing' }];
            const say = !moving;
            moving = false;
            const focus = chosen.focusNext;
            chosen.focusNext = false;
            return [{ do: 'timing' }, { ...drawFound(found), half: { say } }, ...focus ? [/** @type {TripJob} */ ({ do: 'focus', on: 'heading' })] : []];
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
            choicesOver();
            return [showLive(), ...render({ speak: asked?.speak }, moment)];
        },

        drawing,
        // A stop's answer, or the last one marked older when none came; both
        // ways timed again with it, and the way tapped being checked with it,
        // then taken or not (`settle`)
        stop: (event, moment) => {
            const { code } = event;
            const answer = event.answer ?? unanswered(times.answers.get(code));
            if (!latest.counts(`stop ${code}`, event.ticket)) return [];
            times.answers.set(code, answer);
            times.asked.set(code, moment.ms);
            times.asking.delete(code);
            if (chosen.checking?.stop === code) chosen.checking.answered = true;
            return [showLive(), ...timeAgain(moment)];
        },
        trains: (event, moment) => {
            Object.assign(times, { trains: event.answer ?? trainsUnanswered(times.trains), trainsAsked: moment.ms, askingTrains: false });
            return [showLive(), ...timeAgain(moment)];
        },
        // The worker's timing of the way shown, with the ways on from where a
        // followed rider is and the way switched to, as it found them
        timed: (event, moment) => {
            if (!latest.counts('way', event.seq) || !times.wanted) return [];
            times.way = event.way && { ...times.wanted, way: event.way };
            if (times.way && !times.way.taken) times.directions = times.way;
            if (event.others) times.onward = event.others;
            if (event.switched && event.switched.key === chosen.switched) chosen.switchedWay = event.switched;
            return [showLive(), ...askDue(moment), ...checkedIn(true, moment), { do: 'draw-answer' }];
        },
        'others-timed': (event, moment) => {
            if (!latest.counts('others', event.seq)) return [];
            times.others.ways = event.ways;
            return [showLive(), ...askDue(moment), ...checkedIn(false, moment), { do: 'draw-answer' }];
        },
        retime: (_, moment) => retime(times.wanted, false, moment),
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
            const jobs = [...countDown(event.counting, moment), ...replanIfMoved(event.position, event.held, moment), ...replanIfOff(moment), ...sayRide(moment)];
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

        // The quicker way's buttons, as they were drawn: the switch's on the
        // way (T14, decision 50), taken or kept, and the way back from a way
        // switched to; else the decision's (decision 36), taken, kept for the
        // rest of the trip or gone back from
        quicker: ({ act, keyboard }) => {
            if (buttons.switching && act === 'take') return switchTo(buttons.switching, keyboard, 'quicker');
            if (buttons.switching && act === 'keep') return keepRoute(buttons.switching, keyboard);
            if (buttons.switched && act === 'back') return switchBack(keyboard);
            chosen.choice = act === 'take' ? 'taken' : act === 'keep' ? 'kept' : null;
            return drawAgain(keyboard, act === 'take' ? 'back' : act === 'keep' ? 'heading' : 'take');
        },
        // Another way tapped (decision 64), checked on the tap: a way whose bus
        // OASA had coming has that bus's stop asked again when its answer is
        // 30 s old or more (checkStop), at most one request a tap, said on the
        // card meanwhile, then taken or not once timed with it (settle), or
        // on the answer there is after CHECK_WAIT_MS; taken at once
        // otherwise. Nothing while the answer isn't this trip's, or one is
        // being checked
        take: (event, moment) => {
            if (!forTrip(found) || holding() || chosen.checking) return [];
            const way = tappedWay(event.key);
            if (!way) return [];
            const { key, keyboard, position } = event;
            chosen.gone = false;
            const said = way.option ? firstBusSaid(way.option) : undefined;
            const asked = way.asks[0] ? times.asked.get(way.asks[0].stop) : undefined;
            const stop = checkStop(said, way.asks, asked, moment.ms);
            if (!stop) return takeNow(way, keyboard, position, moment);
            const ticket = latest.take('check');
            chosen.checking = { key, said, stop, answered: false, onward: riding(), keyboard, position, ticket };
            return [{ do: 'wait', ms: CHECK_WAIT_MS, ticket }, ...drawAgain(keyboard, { way: key }), { do: 'say', what: 'checking' },
                ...times.asking.has(stop) ? [] : [askStop(stop, 'take')]];
        },
        'check-waited': (event, moment) => latest.counts('check', event.ticket) ? settle(true, moment) : [],
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
            if (riding() && ride.steps) return stepOf(ride.steps, ride.state).kind === 'arrived' ? 'arrived' : 'riding';
            if (following && ride.steps) return 'followed';
            return noBuses || (forTrip(found) && !holding()) ? 'answered' : 'searching';
        },
        // Followed along the way, the rider has left: the step they're on, for
        // the answer drawn
        get riding() { return riding(); },
        onStep: () => riding() && ride.steps ? stepOf(ride.steps, ride.state) : null,
        // The latest answer for leaving now, and the latest half hour, while
        // they're this trip's
        answer: () => forTrip(found) ? found : null,
        halfHour: halfNow,
        // Planned again from where the rider moved to, its half hour not in yet
        holding,
        get plannedAt() { return planned.at; },
        get noBuses() { return noBuses; },
        get noTrains() { return noTrains; },
        timing,
        // The live times as they stand, to look at: not to be changed
        times,
        lateness,
    };
}
