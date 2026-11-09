import { refreshEvery } from '/tools/buses/timing.js';

// The suburban railway's live times on the Trip page (decision 42): how late
// each running train is, as Wayhop's server works it out from railway.gov.gr's
// trains' positions (server/railway/), and a train ride timed with it. Asked
// for while the way shown in full has a train, on the Buses page's tiers
// (timing.js) by when its train leaves. No DOM, so it's tested in Node.

/**
 * Wayhop's answer: each running train's lateness by its number, `late`
 * seconds, `exact` when measured at a station rather than "at least"; or
 * none to be had. `stale`: the last answer, kept as it couldn't be asked again
 * @typedef {{ late: number, exact: boolean }} TrainLate
 * @typedef {{ at?: string, trains?: Record<string, TrainLate>, unavailable?: boolean, stale?: boolean }} TrainsLive
 */
/**
 * A train ride's lateness, as the page says it: whole minutes, measured or at
 * least; `timetable`: when the timetable has a train the rider would miss by
 * it, and catches as it's late (seconds from midnight)
 * @typedef {{ minutes: number, exact: boolean, timetable?: number }} RideLate
 */

export const TRAINS_URL = '/api/trains';
// A late train the timetable would miss is planned on when its lateness was
// measured at a station and leaves this much to spare (the rider's call, 9
// November 2026)
export const SPARE_SECONDS = 120;

/**
 * What's kept when the trains couldn't be asked for (offline, or the server
 * in trouble): the last answer, marked as possibly old, or that there's none
 * @param {TrainsLive | null} last @returns {TrainsLive}
 */
export const trainsUnanswered = last => last && !last.unavailable ? { ...last, stale: true } : { unavailable: true };

/**
 * Whether to ask for the trains now: its last answer is due again by when
 * the way's first train leaves, `train` (seconds from midnight), and they
 * aren't being asked for. `asked`: when they were last asked, answered or not (ms)
 * @param {number} train @param {{ asking: boolean, asked: number, answer: TrainsLive | null }} state
 * @param {number} nowMs @param {number} seconds now, from midnight
 */
export function trainsDue(train, { asking, asked, answer }, nowMs, seconds) {
    if (asking) return false;
    const due = refreshEvery(answer && { unavailable: answer.unavailable, arrivals: [{ minutes: Math.floor((train - seconds) / 60) }] });
    return nowMs - asked >= due;
}

/**
 * Every trip of `leg`'s line from its station to where it gets off, on every
 * route of the line calling at both (its trains end at several stations),
 * with its train's number (city.js keeps them)
 * @param {import('./buses.js').Planner} planner
 * @param {{ line: string, board: number, alight: number }} leg
 */
function tripsOf(planner, leg) {
    const trips = [];
    planner.routes.forEach((route, given) => {
        if (route.mode !== 'suburban' || route.line !== leg.line) return;
        const boardIndex = route.stops.indexOf(leg.board);
        const alightIndex = boardIndex < 0 ? -1 : route.stops.indexOf(leg.alight, boardIndex + 1);
        if (alightIndex < 0) return;
        route.trips.forEach((times, i) => trips.push({ route: given, boardIndex, alightIndex, boards: times[boardIndex], arrives: times[alightIndex], train: route.numbers?.[i] ?? null }));
    });
    return trips;
}

/**
 * The train ride `leg` for someone at its station at `ready` (seconds from
 * midnight), with how late the trains are, `trains` by number: the train
 * there first, of those the timetable has leaving from `ready` on, each
 * there as late as it runs, and those leaving before it that run late
 * enough to be caught with SPARE_SECONDS to spare, as measured at a station
 * (the rider's call, 9 November 2026). Its departure is the timetable's,
 * so a train that makes up time isn't missed; a train caught late leaves when
 * it's expected. Null when there's no train
 * @param {Parameters<typeof tripsOf>[0]} planner @param {Parameters<typeof tripsOf>[1] & Record<string, any>} leg
 * @param {number} ready @param {Record<string, TrainLate> | null | undefined} trains
 * @returns {{ leg: any, late: RideLate | null } | null}
 */
export function trainRide(planner, leg, ready, trains) {
    const timed = tripsOf(planner, leg).map(trip => {
        const late = (trip.train && trains?.[trip.train]) || null;
        return { ...trip, late, at: trip.arrives + (late?.late ?? 0) };
    });
    const [best] = timed
        .filter(trip => trip.boards >= ready || (trip.late?.exact && trip.boards + trip.late.late >= ready + SPARE_SECONDS))
        .sort((a, b) => a.at - b.at || a.boards - b.boards);
    if (!best) return null;
    const caught = best.boards < ready;
    const { route, boardIndex, alightIndex } = best;
    return {
        leg: { ...leg, route, boardIndex, alightIndex, boards: best.boards + (caught ? best.late.late : 0), arrives: best.at },
        late: best.late && { minutes: Math.round(best.late.late / 60), exact: best.late.exact, ...(caught && { timetable: best.boards }) },
    };
}
