import { trainDay } from '/tools/subway/city.js';
import { busOptions, cityPlanner, halfHour, halfView, liveWay, shownRows } from './buses.js';

// The Trip page's searches with a bus, away from the page (decision 32):
// worker.js runs them in a worker, so typing and tapping never wait for them.
// A trip is answered for leaving now, then, when the page asks, for the next
// half hour (answer.js, as the page shows it: halfView), a departure at a time. Only the latest trip is
// answered, and a half hour stops for another trip's, not for the same trip
// asked again (the page does that each minute). The latest half hour's way
// shown in full is timed again with OASA's live times whenever the page asks,
// with the quicker way on a decision, or that way once the rider takes it
// (liveWay, decision 36), without stopping a half hour being worked out.
// The day's city has the suburban railway's trains of that date, when
// trains.json has them (decision 41). No DOM, so it's tested in Node.

/** @typedef {import('./buses.js').Point} Point */
/** @typedef {import('./buses.js').BusOption} BusOption */
/**
 * What the page asks: `rail` once, first, as the city is planned on (with its
 * tram or without it, decision 29), and `suburban: false` when the suburban
 * railway is hidden (decision 41); then each trip, `id` counting up, leaving
 * `now` (the date in Athens, 'YYYY-MM-DD', for its trains), with
 * `half` when its half hour is wanted too; and the way of the half hour `id`
 * shown in full, its `row` for `departure`, timed with the live times `stops`
 * for leaving `now` (`seq` counting up, as only the latest counts), or
 * `taken`: the quicker way the rider took in its place
 * @typedef {{ rail: import('../../../types/data.js').Rail, suburban?: boolean }
 *   | { id: number, from: Point, to: Point, now: { weekday: number, seconds: number, date?: string }, half: boolean }
 *   | { id: number, live: { seq: number, row: number, departure: number, now: { seconds: number }, stops: Record<string, import('./buses.js').StopLive>, taken?: boolean } }} Asked
 */
/**
 * What it answers: the ways with a bus or a train for leaving now, with how long they
 * took here (`city`: making the day's city for this trip, null when it was
 * made before) and whether the day's city has trains (`trains`: false when
 * trains.json has none for the date); later, the half hour's answer and how long it took;
 * or that there are no buses to be had, as their times couldn't be loaded or
 * the search failed; and the way shown in full timed with the live times,
 * null when it can't be
 * @typedef {{ id: number, options: BusOption[], trains: boolean, timing: { city: number | null, answer: number } }
 *   | { id: number, half: import('./buses.js').HalfView & { ms: number } }
 *   | { id: number, live: { seq: number, way: import('./buses.js').LiveWay | null } }
 *   | { id: number, error: true }} Answered
 */

/**
 * @param {{ loadBuses: () => Promise<import('../../../types/data.js').Buses>,
 *   loadTrains?: () => Promise<import('../../../types/data.js').Trains>, post: (message: Answered) => void,
 *   pause?: () => Promise<void>, clock?: () => number }} io
 *   loadTrains: without it, or when it fails, the city has no trains
 *   pause: between two departures of a half hour, to let the page's next message in
 * @returns {(message: Asked) => Promise<void>}
 */
export function searcher({ loadBuses, loadTrains = async () => null, post, pause = () => new Promise(resolve => setTimeout(resolve)), clock = () => performance.now() }) {
    let rail = null;
    let buses = null;
    let trains = null;
    // The city's search for the day, made when its first trip needs it
    let city = null;
    let latest = 0;
    let latestHalf = 0;
    // The latest half hour's answer, its rows as the page shows them and its
    // decision, to time again with live times
    let shown = null;

    // How long making it took, or null when it was made before
    /** @param {import('../../../types/data.js').Buses} loaded @param {import('../../../types/data.js').Trains | null} day @param {{ weekday: number, date?: string }} now */
    const cityOn = (loaded, day, { weekday, date }) => {
        if (city?.weekday === weekday && city.date === date) return null;
        const started = clock();
        const trainsOf = day && date ? trainDay(day, date) : null;
        city = { weekday, date, trains: Boolean(trainsOf), planner: cityPlanner(rail, loaded, weekday, trainsOf) };
        return Math.round(clock() - started);
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
            const { id, live: { seq, row, departure, now, stops, taken = false } } = message;
            if (id !== shown?.id) return;
            let way = null;
            try {
                const full = shown.rows[row];
                // The quicker way goes with the decision's directions
                const decision = full && full === shown.decision?.stayOn ? shown.decision : null;
                way = full ? liveWay(shown.planner, shown.from, shown.to, full, departure, now, stops, { decision, taken }) : null;
            } catch { /* the way as the half hour has it */ }
            post({ id, live: { seq, way } });
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
                const made = cityOn(loaded, day, now);
                const started = clock();
                const options = busOptions(city.planner, from, to, now);
                post({ id, options, trains: city.trains, timing: { city: made, answer: Math.round(clock() - started) } });
            }
            if (!half || id !== latestHalf) return;
            cityOn(loaded, day, now);
            const { planner } = city;
            const started = clock();
            const steps = halfHour(planner, from, to, now);
            let step = steps.next();
            while (!step.done) {
                await pause();
                if (id !== latestHalf) return;
                step = steps.next();
            }
            shown = { id, planner, from, to, rows: shownRows(step.value), decision: step.value.decision ?? null };
            post({ id, half: { ...halfView(planner, from, to, step.value), ms: Math.round(clock() - started) } });
        } catch {
            if (id === latest) post({ id, error: true });
        }
    };
}
