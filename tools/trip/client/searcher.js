import { busOptions, cityPlanner, halfHour } from './buses.js';

// The Trip page's searches with a bus, away from the page (decision 32):
// worker.js runs them in a worker, so typing and tapping never wait for them.
// A trip is answered for leaving now, then, when the page asks, for the next
// half hour (answer.js), a departure at a time. Only the latest trip is
// answered, and a half hour stops for another trip's, not for the same trip
// asked again (the page does that each minute). No DOM, so it's tested in Node.

/** @typedef {import('./buses.js').Point} Point */
/** @typedef {import('./buses.js').BusOption} BusOption */
/**
 * What the page asks: `rail` once, first, as the city is planned on (with its
 * tram or without it, decision 29); then each trip, `id` counting up, with
 * `half` when its half hour is wanted too
 * @typedef {{ rail: import('../../../types/data.js').Rail }
 *   | { id: number, from: Point, to: Point, now: { weekday: number, seconds: number }, half: boolean }} Asked
 */
/**
 * What it answers: the ways with a bus for leaving now, with how long they
 * took here (`city`: making the day's city for this trip, null when it was
 * made before); later, the half hour's kind of answer and how long it took;
 * or that there are no buses to be had, as their times couldn't be loaded or
 * the search failed
 * @typedef {{ id: number, options: BusOption[], timing: { city: number | null, answer: number } }
 *   | { id: number, half: { kind: string, ms: number } }
 *   | { id: number, error: true }} Answered
 */

/**
 * @param {{ loadBuses: () => Promise<import('../../../types/data.js').Buses>, post: (message: Answered) => void,
 *   pause?: () => Promise<void>, clock?: () => number }} io
 *   pause: between two departures of a half hour, to let the page's next message in
 * @returns {(message: Asked) => Promise<void>}
 */
export function searcher({ loadBuses, post, pause = () => new Promise(resolve => setTimeout(resolve)), clock = () => performance.now() }) {
    let rail = null;
    let buses = null;
    // The city's search for the day, made when its first trip needs it
    let city = null;
    let latest = 0;
    let latestHalf = 0;

    // How long making it took, or null when it was made before
    const cityOn = (loaded, weekday) => {
        if (city?.weekday === weekday) return null;
        const started = clock();
        city = { weekday, planner: cityPlanner(rail, loaded, weekday) };
        return Math.round(clock() - started);
    };

    return async message => {
        if ('rail' in message) {
            rail = message.rail;
            buses = loadBuses().catch(() => null);
            return;
        }
        const { id, from, to, now, half } = message;
        latest = id;
        if (half) latestHalf = id;
        const loaded = await buses;
        try {
            if (!loaded) throw new Error('No buses');
            if (id === latest) {
                const made = cityOn(loaded, now.weekday);
                const started = clock();
                const options = busOptions(city.planner, from, to, now);
                post({ id, options, timing: { city: made, answer: Math.round(clock() - started) } });
            }
            if (!half || id !== latestHalf) return;
            cityOn(loaded, now.weekday);
            const started = clock();
            const steps = halfHour(city.planner, from, to, now);
            let step = steps.next();
            while (!step.done) {
                await pause();
                if (id !== latestHalf) return;
                step = steps.next();
            }
            post({ id, half: { kind: step.value.kind, ms: Math.round(clock() - started) } });
        } catch {
            if (id === latest) post({ id, error: true });
        }
    };
}
