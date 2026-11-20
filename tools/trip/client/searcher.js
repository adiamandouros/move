import { trainDay } from '/tools/subway/city.js';
import { aheadWays, busOptions, cityPlanner, halfHour, halfView, hereWays, liveWay, onwardWay, OTHERS, otherWay, shownRows } from './buses.js';

// The Trip page's searches with a bus, away from the page (decision 32):
// worker.js runs them in a worker, so typing and tapping never wait for them.
// A trip is answered for leaving now, then, when the page asks, for the next
// half hour (answer.js, as the page shows it: halfView), a departure at a time. Only the latest trip is
// answered, and a half hour stops for another trip's, not for the same trip
// asked again (the page does that each minute). The latest half hour's way
// shown in full is timed again with OASA's live times whenever the page asks,
// with the quicker way on a decision, or that way once the rider takes it
// (liveWay, decision 36), and with how late its suburban trains run
// (decision 42), without stopping a half hour being worked out. With the
// rider followed on a ride (decision 50), the page asks it to search ahead
// from the ride's stops still to come, at each one reached: the way found
// is kept, and offered with the live times when it's 3' sooner (T14); once
// the rider switches to it, it's the way timed. The other ways shown are
// timed with the live times too, each asking only for its first bus's stop
// (decision 62); to a followed rider, they're the ways the search ahead
// finds on a ride, or from where they are walking or waiting (decision 63).
// The day's city has the suburban railway's trains of that date, when
// trains.json has them (decision 41). No DOM, so it's tested in Node.

/** @typedef {import('./buses.js').Point} Point */
/** @typedef {import('./buses.js').BusOption} BusOption */
// Asked and Answered are the messages both ways: the page (main.js) sends
// and reads them through its Searches type, so both sides are checked
/**
 * What the page asks: `rail` once, first, as the city is planned on (with its
 * tram or without it, decision 29), and `suburban: false` when the suburban
 * railway is hidden (decision 41); then each trip, `id` counting up, leaving
 * `now` (the date in Athens, 'YYYY-MM-DD', for its trains), with
 * `half` when its half hour is wanted too; and the way of the half hour `id`
 * shown in full, its `row` for `departure`, timed with the live times `stops`
 * for leaving `now` (`seq` counting up, as only the latest counts), or
 * `taken`: the quicker way the rider took in its place; `trains`: how late
 * the suburban trains run, by number (trains.js). Followed (decision 50):
 * where the rider is (`step`) on their `own` bus; `ahead`: search ahead
 * first, leaving out the ways `declined` (by key); `switched`: the key of
 * the way ahead they switched to (the switch's, or another way off the
 * ride they took, decision 64), timed in place of the row's, the way itself
 * (`switchedWay`) when the page kept it with the trip; `here`: where they
 * are, for the other ways shown to them walking or waiting (decision 63).
 * And the
 * other ways shown, each a `row` for its `departure`, timed the same way
 * with only their first bus's stop asked for (otherWay, decision 62)
 * @typedef {{ rail: import('../../../types/data.js').Rail, suburban?: boolean }
 *   | { id: number, from: Point, to: Point, now: { weekday: number, seconds: number, date?: string }, half: boolean }
 *   | { id: number, live: { seq: number, row: number, departure: number, now: { seconds: number }, stops: Record<string, import('./buses.js').StopLive>, taken?: boolean, step?: import('./buses.js').LiveStep | null, own?: import('./buses.js').OwnBus | null,
 *     trains?: Record<string, import('./trains.js').TrainLate> | null, ahead?: boolean, declined?: string[], switched?: string | null, switchedWay?: import('./buses.js').Ahead | null, here?: import('./buses.js').Point | null } }
 *   | { id: number, others: { seq: number, ways: { row: number, departure: number }[], now: { seconds: number }, stops: Record<string, import('./buses.js').StopLive>,
 *     trains?: Record<string, import('./trains.js').TrainLate> | null } }} Asked
 */
/**
 * One of the other ways shown to a followed rider (decision 63), timed: its
 * key, the ride it leaves (-1 from where they are), the way, and the stops
 * it asks OASA for, each with when its bus is due there (null: not known)
 * @typedef {{ key: string, leg: number, option: BusOption, asks: { stop: string, at: number | null }[] }} OnwardWay
 */
/**
 * One of the other ways shown (decision 62), timed: the half hour's `row`
 * for its `departure`, the way, and the stops it asks OASA for, as above
 * @typedef {{ row: number, departure: number, option: BusOption, asks: { stop: string, at: number | null }[] }} OtherWay
 */
/**
 * What it answers: the ways with a bus or a train for leaving now, with how long they
 * took here (`city`: making the day's city for this trip, null when it was
 * made before) and whether the day's city has trains (`trains`: false when
 * trains.json has none for the date); later, the half hour's answer and how long it took;
 * or that there are no buses to be had, as their times couldn't be loaded or
 * the search failed; the way shown in full timed with the live times,
 * null when it can't be, with the other ways shown to a followed rider
 * (`others`, decision 63; null until searched for that way), each with
 * which ride it leaves (`leg`, -1 from where they are), and the way
 * switched to itself (`switched`), when it's timed; and the other
 * ways shown, each the same, in the order asked
 * @typedef {{ id: number, options: BusOption[], trains: boolean, timing: { city: number | null, answer: number } }
 *   | { id: number, half: import('./buses.js').HalfView & { ms: number } }
 *   | { id: number, live: { seq: number, way: import('./buses.js').LiveWay | null, others: OnwardWay[] | null, switched?: import('./buses.js').Ahead } }
 *   | { id: number, others: { seq: number, ways: (OtherWay | null)[] } }
 *   | { id: number, error: true }} Answered
 */

/**
 * @param {{ loadBuses: () => Promise<import('../../../types/data.js').Buses>,
 *   loadTrains?: () => Promise<import('../../../types/data.js').Trains | null>, post: (message: Answered) => void,
 *   pause?: () => Promise<void>, clock?: () => number }} io
 *   loadTrains: without it, or when it fails, the city has no trains
 *   pause: between two departures of a half hour, to let the page's next message in
 * @returns {(message: Asked) => Promise<void>}
 */
export function searcher({ loadBuses, loadTrains = async () => null, post, pause = () => new Promise(resolve => setTimeout(resolve)), clock = () => performance.now() }) {
    /** @type {import('../../../types/data.js').Rail | null} */
    let rail = null;
    /** @type {Promise<import('../../../types/data.js').Buses | null> | null} */
    let buses = null;
    /** @type {Promise<import('../../../types/data.js').Trains | null> | null} */
    let trains = null;
    // The city's search for the day, made when its first trip needs it
    /** @type {{ weekday: number, date: string | undefined, trains: boolean, planner: import('./buses.js').Planner } | null} */
    let city = null;
    let latest = 0;
    let latestHalf = 0;
    // The latest half hour's answer, its rows as the page shows them and its
    // decision, to time again with live times; the way the search ahead
    // found, for which way it was searched from, and the one switched to;
    // and the ways found for the other ways shown to a followed rider
    /**
     * @type {{ id: number, planner: import('./buses.js').Planner, from: Point, to: Point, rows: import('/tools/subway/answer.js').Row[],
     *   decision: import('/tools/subway/answer.js').Decision | null, ahead: { of: string, found: import('./buses.js').Ahead | null } | null,
     *   switched: import('./buses.js').Ahead | null, onward: { of: string, ways: import('./buses.js').Ahead[], here: Point | null } | null,
     *   before: import('./buses.js').Ahead[] | null } | null}
     */
    let shown = null;

    // The day's city, and how long making it took, or null when it was made before
    /** @param {import('../../../types/data.js').Buses} loaded @param {import('../../../types/data.js').Trains | null} day @param {{ weekday: number, date?: string }} now */
    const cityOn = (loaded, day, { weekday, date }) => {
        if (city?.weekday === weekday && city.date === date) return { today: city, made: null };
        if (!rail) throw new Error('No rail');
        const started = clock();
        const trainsOf = day && date ? trainDay(day, date) : null;
        city = { weekday, date, trains: Boolean(trainsOf), planner: cityPlanner(rail, loaded, weekday, trainsOf) };
        return { today: city, made: Math.round(clock() - started) };
    };

    return async message => {
        if ('rail' in message) {
            rail = message.rail;
            buses = loadBuses().catch(() => null);
            // Not when the suburban railway is hidden on the Subway page (decision 41)
            trains = message.suburban === false ? null : loadTrains().catch(() => null);
            return;
        }
        if ('live' in message) {
            const { id, live: { seq, row, departure, now, stops, taken = false, trains = null, step = null, own = null, ahead = false, declined = [], switched = null, switchedWay = null, here = null } } = message;
            const current = shown;
            if (!current || id !== current.id) return;
            /** @type {import('./buses.js').LiveWay | null} */
            let way = null;
            /** @type {OnwardWay[] | null} */
            let others = null;
            /** @type {import('./buses.js').Ahead | null} */
            let onto = null;
            try {
                // The way switched to on a ride, as a row of its own: the
                // switch's (T14), or another way off the ride the rider took
                // (decision 64), among those last found or the search before;
                // or the one the page kept with the trip (decision 58)
                if (switched && current.switched?.key !== switched) {
                    const found = [current.ahead?.found, ...current.onward?.ways ?? [], ...current.before ?? [], switchedWay];
                    current.switched = found.find(each => each?.key === switched && each.leg >= 0) ?? null;
                }
                onto = switched && current.switched?.key === switched ? current.switched : null;
                // (a row of its own, as onwardWay in buses.js makes one: only what timing it reads)
                const full = onto ? /** @type {import('/tools/subway/answer.js').Row} */ (/** @type {unknown} */ ({ key: onto.key, best: [onto.way], bundle: false, lines: [], stops: [] })) : current.rows[row];
                const at = onto ? 0 : departure;
                // The quicker way goes with the decision's directions
                const decision = !onto && full && full === current.decision?.stayOn ? current.decision : null;
                const options = { decision, taken: !onto && taken, trains, step, own };
                // The way ahead is for the way it was searched from, and none the rider declined
                const of = `${onto?.key ?? row} ${at} ${options.taken}`;
                // The other ways shown are for the way followed, whichever of
                // the half hour's departures the page shows as the clock goes on
                const followed = `${onto?.key ?? full?.key} ${options.taken}`;
                // Searched: on a ride, ahead, the first not declined being the
                // switch's; walking or waiting, from where the rider is
                // (decision 63); kept for the timings till the next search
                if (ahead && full) {
                    const kind = step?.kind;
                    const ways = kind === 'ride' ? aheadWays(current.planner, current.from, current.to, full, at, now, stops, options)
                        : here && (kind === 'walk' || kind === 'wait') ? hereWays(current.planner, here, current.to, full, at, now) : [];
                    current.ahead = { of, found: ways.find(each => each.leg >= 0 && !declined.includes(each.key)) ?? null };
                    current.before = current.onward?.ways ?? [];
                    current.onward = { of: followed, ways, here };
                }
                const found = current.ahead?.of === of && current.ahead.found && !declined.includes(current.ahead.found.key) ? current.ahead.found : null;
                way = full ? liveWay(current.planner, current.from, current.to, full, at, now, stops, { ...options, ahead: found }) : null;
                // The other ways shown to the rider, but the switch's, each timed
                if (way && current.onward?.of === followed) {
                    const { ways, here: from } = current.onward;
                    const switchTo = way.switchTo?.key;
                    others = ways.filter(each => each.key !== switchTo).slice(0, OTHERS).flatMap(each => {
                        const timed = onwardWay(current.planner, each.leg < 0 && from ? from : current.from, current.to, each, now, stops, { step, own, trains });
                        return timed ? [timed] : [];
                    });
                }
            } catch { /* the way as the half hour has it */ }
            // The way switched to goes back with it, for the page to keep with the trip
            post({ id, live: { seq, way, others, ...onto && { switched: onto } } });
            return;
        }
        if ('others' in message) {
            const { id, others: { seq, ways, now, stops, trains = null } } = message;
            const current = shown;
            if (!current || id !== current.id) return;
            const timed = ways.map(({ row, departure }) => {
                try {
                    const way = current.rows[row] ? otherWay(current.planner, current.from, current.to, current.rows[row], departure, now, stops, trains) : null;
                    return way && { row, departure, ...way };
                } catch { return null; }
            });
            post({ id, others: { seq, ways: timed } });
            return;
        }
        const { id, from, to, now, half } = message;
        latest = id;
        if (half) latestHalf = id;
        const loaded = await buses;
        const day = await trains;
        try {
            if (!loaded) throw new Error('No buses');
            if (id === latest) {
                const { today, made } = cityOn(loaded, day, now);
                const started = clock();
                const options = busOptions(today.planner, from, to, now);
                post({ id, options, trains: today.trains, timing: { city: made, answer: Math.round(clock() - started) } });
            }
            if (!half || id !== latestHalf) return;
            const { planner } = cityOn(loaded, day, now).today;
            const started = clock();
            const steps = halfHour(planner, from, to, now);
            let step = steps.next();
            while (!step.done) {
                await pause();
                if (id !== latestHalf) return;
                step = steps.next();
            }
            shown = { id, planner, from, to, rows: shownRows(step.value), decision: step.value.decision ?? null, ahead: null, switched: null, onward: null, before: null };
            post({ id, half: { ...halfView(planner, from, to, step.value), ms: Math.round(clock() - started) } });
        } catch {
            if (id === latest) post({ id, error: true });
        }
    };
}
