// The Trip page's trip and its search answers, with no page in it (roadmap
// Trip · state). main.js tells it what happened (an end picked, the minute
// gone by, the worker's answer, the rider moved on) and carries out the jobs
// it answers with (search, draw, keep the trip, start the live times over).
// It never touches the page, timers, the worker or storage, and is given the
// time, so it's tested in Node (test/trip-controller.test.js): given these
// events, these jobs. The live times, following the ride and the switch are
// still main.js's; they move in after this, one step each.
//
// The trip is searched for leaving now and, with it, its next half hour
// (decisions 32 and 33); searched again each minute for a later time, the
// half hour too once it's HALF_REWORK_SECONDS old. Only the newest answer of
// each kind counts for the current trip (decision 65, tickets.js). Planned
// again from where the rider moved to (decision 45), the answer drawn stays
// until the new one's half hour is in, so it doesn't change twice.

// The next half hour is worked out again once it's this old, while the page
// is open (decision 33)
export const HALF_REWORK_SECONDS = 600;

/** @typedef {import('./buses.js').BusOption} BusOption */
/** @typedef {import('/tools/subway/network.js').AthensTime} AthensTime */
/** @typedef {Extract<import('./searcher.js').Answered, { half: unknown }>['half']} HalfAnswer */
/** @typedef {Extract<import('./searcher.js').Asked, { half: boolean }>} SearchAsked */
/**
 * An end of the trip: a place found (an address, a place, a station, as
 * main.js's chosenPlace makes it) or My location
 * @typedef {import('./buses.js').Point & { title: string, station?: string }} Place
 */
/**
 * The ride kept when the page was last open (kept.js, decision 58): for when
 * (`now`) and from what time (`at`) its trip was planned; the rest is the
 * live times', passed on to main.js with the new trip as it is
 * @typedef {{ at: number, now: AthensTime } & Record<string, any>} KeptRide
 */
/**
 * What happened. `kept`: the trip kept from earlier, as the page opens
 * (nothing asked yet); `open`: the page is ready, the trip asked; `from`,
 * `to`: an end picked, cleared (null) or My location, `say` its answer once
 * it's in; `here`: From moved with the rider before there's a To (nothing
 * asked); `swap`: the ends swapped; `moved`: planned again from where the
 * rider moved to; `resume`: the ride kept taken up, from where it was;
 * `refresh`: the minute gone by (`riding`: followed along the way, so the way
 * isn't searched again for leaving now, decision 50); `gone`: the bus of a
 * way tapped had gone, so the ways are searched again at once, the half hour
 * too (decision 64); `redraw`: something the answer is drawn with came in;
 * `answer`, `half`: the worker's; `failed`: its searches can't be had
 * (`updated`: a newer Wayhop is waiting). `held`: someone is in the answer
 * (the keyboard, or a pointer held on the switch), so it isn't drawn again
 * under them
 * @typedef {{ type: 'kept', from: Place | null, to: Place | null }
 *   | { type: 'open' } | { type: 'swap' } | { type: 'gone' }
 *   | { type: 'from', place: Place | null, say?: boolean }
 *   | { type: 'to', place: Place | null, say?: boolean }
 *   | { type: 'here', place: Place } | { type: 'moved', place: Place }
 *   | { type: 'resume', place: Place, ride: KeptRide }
 *   | { type: 'refresh', riding: boolean, held: boolean }
 *   | { type: 'redraw', held: boolean }
 *   | { type: 'answer', id: number, options: BusOption[], trains: boolean, timing: { city: number | null, answer: number }, held: boolean }
 *   | { type: 'half', id: number, view: HalfAnswer, held: boolean }
 *   | { type: 'failed', updated: boolean }} TripEvent
 */
/**
 * What to do. `keep`: keep the trip's ends on the device (kept.js); `intro`:
 * there's no trip, say what the page does; `new-trip`: say it's being worked
 * out and start the live times over, taking up the ride kept (`resumed`);
 * `reset-live`: start the live times over; `move-live`: the live times for a
 * trip planned again from where the rider moved to (each stop keeps its
 * answer); `search`: ask the worker; `draw`: draw the answer for leaving
 * `now` with the ways with a bus `buses`, `speak` saying it, and with
 * `half`, the half hour just in (`say`: said once drawn); `timing`: the
 * half hour's timing under the answer (/trip?timing); `retime`: time the way
 * shown with the live times again
 * @typedef {{ do: 'keep', from: Place | null, to: Place | null }
 *   | { do: 'intro' | 'reset-live' | 'move-live' | 'timing' | 'retime' }
 *   | { do: 'new-trip', resumed: KeptRide | null }
 *   | { do: 'search', ask: SearchAsked }
 *   | { do: 'draw', now: AthensTime, buses: BusOption[], speak: boolean, half?: { say: boolean } }} TripJob
 */
/**
 * The time as an event happens: `ms`, the device's clock (Date.now()), and
 * `now`, Athens's (athensNow)
 * @typedef {{ ms: number, now: AthensTime }} Clock
 */

/**
 * `latest`: the page's tickets (tickets.js), which the live times take theirs
 * from too until they move in; `buses`: whether the searches could be started
 * (worker.js); `suburban`: whether they have the suburban railway, unless
 * it's hidden on the Subway page (decision 41)
 * @param {{ latest: import('./tickets.js').Tickets, buses: boolean, suburban: boolean }} options
 */
export function tripController({ latest, buses, suburban }) {
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

    /** @param {{ from: Place | null, to: Place | null } | null} what */
    const forTrip = what => what?.from === from && what?.to === to;
    const holding = () => moving && !forTrip(half);
    /** @returns {TripJob} */
    const drawFound = (speak = false) => ({ do: 'draw', now: found.now, buses: found.options, speak });

    // The trip as it stands, asked or drawn. `refresh`: the same trip, for a
    // later time, with `rework` its half hour worked out again however old;
    // `moved`: planned again from where the rider moved to; `riding`: the
    // rider has left on the way followed; `resumed`: the ride kept, searched
    // for when it was
    /**
     * @param {{ speak?: boolean, refresh?: boolean, moved?: boolean, rework?: boolean, riding?: boolean, resumed?: KeptRide | null }} how
     * @param {Clock} clock
     * @returns {TripJob[]}
     */
    const render = ({ speak = false, refresh = false, moved = false, rework = false, riding = false, resumed = null }, clock) => {
        /** @type {TripJob[]} */
        const jobs = [{ do: 'keep', from, to }];
        if (!from || !to) return [...jobs, { do: 'intro' }];
        if (!forTrip(planned)) planned = { from, to, at: clock.ms };
        const now = resumed?.now ?? clock.now;
        if (noBuses) return [...jobs, { do: 'draw', now, buses: [], speak }];
        const same = forTrip(found);
        // Followed along the way, the rider has left: the answer isn't
        // searched again for someone leaving the start now, so the way shown
        // stays theirs (decision 50); it's timed from where they are (retime)
        if (same && (!refresh || riding)) return [...jobs, drawFound(speak)];
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
            jobs.push({ do: 'move-live' });
        } else if (!same) {
            // A new trip: nothing asked for the one before counts
            timing.half = null;
            latest.newTrip();
            jobs.push({ do: 'new-trip', resumed });
        }
        // Taken once a new trip has started over, so its answers count for it
        const id = halfToo ? latest.take('search', 'half') : latest.take('search');
        asked = { from, to, now, speak };
        if (halfToo) askedHalf = { from, to };
        jobs.push({ do: 'search', ask: { id, from, to, now, half: halfToo } });
        return jobs;
    };

    /** @type {{ [type in TripEvent['type']]: (event: Extract<TripEvent, { type: type }>, clock: Clock) => TripJob[] }} */
    const on = {
        kept: event => {
            from = event.from ?? from;
            to = event.to ?? to;
            return [];
        },
        open: (_, clock) => render({}, clock),
        from: (event, clock) => {
            from = event.place;
            return render({ speak: Boolean(event.say) }, clock);
        },
        to: (event, clock) => {
            to = event.place;
            return render({ speak: Boolean(event.say) }, clock);
        },
        // Nothing planned yet: From moves with the rider, and nothing is asked
        here: event => {
            from = event.place;
            return [];
        },
        swap: (_, clock) => {
            [from, to] = [to, from];
            return render({}, clock);
        },
        moved: (event, clock) => {
            from = event.place;
            return render({ moved: true }, clock);
        },
        // Searched again from where and for when it was, so the same way comes back
        resume: (event, clock) => {
            from = event.place;
            planned = { from, to, at: event.ride.at };
            return render({ speak: true, resumed: event.ride }, clock);
        },
        // Not while someone is in the answer: the next minute then
        refresh: (event, clock) => {
            if (!from || !to || event.held) return [];
            return [...render({ refresh: true, riding: event.riding }, clock), { do: 'retime' }];
        },
        gone: (_, clock) => render({ refresh: true, rework: true }, clock),
        redraw: (event, clock) => {
            if (!from || !to || event.held) return [];
            if (noBuses) return [{ do: 'draw', now: clock.now, buses: [], speak: false }];
            return forTrip(found) && !holding() ? [drawFound()] : [];
        },
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
        failed: (event, clock) => {
            noBuses = event.updated ? 'updated' : true;
            found = null;
            moving = false;
            latest.newTrip();
            return [{ do: 'reset-live' }, ...render({ speak: asked?.speak }, clock)];
        },
    };

    return {
        /**
         * What happened, at `clock`; the jobs to do, in order
         * @param {TripEvent} event
         * @param {Clock} clock
         * @returns {TripJob[]}
         */
        tell: (event, clock) => /** @type {(event: TripEvent, clock: Clock) => TripJob[]} */ (on[event.type])(event, clock),
        get from() { return from; },
        get to() { return to; },
        // Where the trip stands: no trip (an end missing), searching (asked,
        // or planned again from where the rider moved to, the answer before
        // staying till the new half hour), or answered (an answer for this
        // trip to draw)
        /** @returns {'none' | 'searching' | 'answered'} */
        get stage() {
            if (!from || !to) return 'none';
            return noBuses || (forTrip(found) && !holding()) ? 'answered' : 'searching';
        },
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
    };
}
