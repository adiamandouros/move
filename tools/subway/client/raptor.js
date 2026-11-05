// The trip search: RAPTOR (Delling, Pajor and Werneck, 2012) finds the
// earliest arrival at every stop with at most 1, 2, 3… rides. Each round rides
// every line through the stops the last round improved, then walks on from
// wherever it got to, so a round is one more ride. There's no graph with
// minutes on it: the waits come from the trips' own times. No DOM, and only
// relative imports, so the browser, the server and the planner lab share it
// (decision 28).

const INF = 2 ** 30;
export const MAX_RIDES = 6;
// From getting off to being ready for a ride from the same stop
export const CHANGE_SECONDS = 180;

/**
 * trips: each trip's time at each stop, in seconds from the day's midnight
 * @typedef {{ line: string, mode: string, stops: number[], trips: number[][] }} Route
 */
/**
 * One ride. route: which of the given routes, and boardIndex, alightIndex
 * where along its stops. walkBefore: seconds on foot from the last ride, when
 * it got off elsewhere
 * @typedef {{ line: string, mode: string, route: number, boardIndex: number, alightIndex: number,
 *   board: number, alight: number, boards: number, arrives: number, walkBefore: number }} Leg
 */
/** @typedef {{ legs: Leg[], walked: number }} Journey */
/** @typedef {{ ban?: Set<string> | null, banBoard?: Uint8Array | null, walkFactor?: number, walkLimit?: number, egress?: number[] | null }} SearchOptions */
/**
 * afterWalk: seconds after a walk before the next ride, on top of the walk.
 * walkSeconds: how long a walk between two stops is said to take (the walks'
 * own seconds if not given)
 * @typedef {{ afterWalk?: number, walkSeconds?: ((from: number, to: number) => number) | null }} PlannerOptions
 */

// A route's trips, in as many routes as it takes for none to overtake another:
// the search takes the first trip it can catch to be the first to arrive too
/** @param {Route} route @param {number} given */
function withoutOvertaking(route, given) {
    const groups = [];
    for (const trip of [...route.trips].sort((a, b) => a[0] - b[0])) {
        let group = groups.find(g => trip.every((time, i) => time >= g.at(-1)[i]));
        if (!group) groups.push(group = []);
        group.push(trip);
    }
    return groups.map(trips => ({
        line: route.line, mode: route.mode, given, stops: route.stops, width: route.stops.length,
        trips: trips.length, times: Int32Array.from(trips.flat()),
    }));
}

// The first trip of a route that leaves `position` at `from` or later
function firstTrip({ trips, width, times }, position, from) {
    let low = 0;
    let high = trips;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (times[middle * width + position] >= from) high = middle;
        else low = middle + 1;
    }
    return low;
}

/**
 * walks: for each stop, the stops a walk away from it, [stop, seconds…]
 * @param {{ stops: unknown[], routes: Route[], walks: number[][] }} network
 * @param {PlannerOptions} [options]
 */
export function createPlanner({ stops, routes: given, walks }, { afterWalk = 0, walkSeconds = null } = {}) {
    const count = stops.length;
    const routes = given.flatMap(withoutOvertaking);
    const serving = stops.map(() => []);
    routes.forEach((route, r) => route.stops.forEach((stop, position) => serving[stop].push(r, position)));
    const walkOf = walkSeconds ?? ((from, to) => {
        const onFoot = walks[from];
        for (let j = 0; j < onFoot.length; j += 2) if (onFoot[j] === to) return onFoot[j + 1];
        return INF;
    });

    // By round: the earliest arrival at each stop, how it was got, and the
    // earliest a next ride can leave each stop, and from where it was walked to
    const table = () => Array.from({ length: MAX_RIDES + 1 }, () => new Int32Array(count));
    const arrivals = table();
    const byRoute = table();
    const byTrip = table();
    const boardedAt = table();
    const ready = table();
    const cameFrom = table();
    const rideArrival = new Int32Array(count);
    const firstPosition = new Int32Array(routes.length);
    const toDoor = new Int32Array(count);

    /**
     * From `access`, [stop, seconds on foot…], leaving at `now`.
     * ban: lines not to ride. banBoard: stops no later ride may start from.
     * walkFactor stretches every walk. Asks for the answers with arrival().
     * egress: the door's [stop, seconds on foot…]. With it, nothing that gets
     * somewhere later than the best at the door so far is kept, as it can't
     * beat it: a search in the city takes a third of the time, and arrival()
     * answers the same for that egress, at the same walkFactor or less.
     * @param {number[]} access @param {number} now @param {SearchOptions} [options]
     */
    function search(access, now, { ban = null, banBoard = null, walkFactor = 1, walkLimit = Infinity, egress = null } = {}) {
        // Only what's later goes: a way as early may be the one chosen
        let bound = INF;
        toDoor.fill(-1);
        for (let i = 0; egress && i < egress.length; i += 2) {
            const seconds = Math.round(egress[i + 1] * walkFactor);
            if (toDoor[egress[i]] < 0 || seconds < toDoor[egress[i]]) toDoor[egress[i]] = seconds;
        }
        arrivals[0].fill(INF);
        ready[0].fill(INF);
        cameFrom[0].fill(-2);
        let marked = [];
        for (let i = 0; i < access.length; i += 2) {
            const stop = access[i];
            const at = now + Math.round(access[i + 1] * walkFactor);
            if (at < ready[0][stop]) {
                ready[0][stop] = at;
                marked.push(stop);
            }
        }
        let last = 0;
        for (let k = 1; k <= MAX_RIDES && marked.length; k++) {
            firstPosition.fill(-1);
            const scan = [];
            for (const stop of marked) {
                const through = serving[stop];
                for (let j = 0; j < through.length; j += 2) {
                    const r = through[j];
                    const position = through[j + 1];
                    if (ban?.has(routes[r].line)) continue;
                    if (firstPosition[r] < 0) {
                        firstPosition[r] = position;
                        scan.push(r);
                    } else if (position < firstPosition[r]) firstPosition[r] = position;
                }
            }
            arrivals[k].set(arrivals[k - 1]);
            ready[k].set(ready[k - 1]);
            byRoute[k].fill(-1);
            cameFrom[k].fill(-2);
            rideArrival.fill(INF);
            const reached = [];
            for (const r of scan) {
                const { stops: along, width, trips, times } = routes[r];
                let trip = -1;
                let board = -1;
                for (let i = firstPosition[r]; i < width; i++) {
                    const stop = along[i];
                    if (trip >= 0 && times[trip * width + i] <= bound) {
                        const at = times[trip * width + i];
                        if (at < arrivals[k][stop]) {
                            if (toDoor[stop] >= 0) bound = Math.min(bound, at + toDoor[stop]);
                            arrivals[k][stop] = at;
                            byRoute[k][stop] = r;
                            byTrip[k][stop] = trip;
                            boardedAt[k][stop] = board;
                        }
                        if (at < rideArrival[stop]) {
                            if (rideArrival[stop] === INF) reached.push(stop);
                            rideArrival[stop] = at;
                        }
                    }
                    const can = banBoard && k > 1 && banBoard[stop] ? INF : ready[k - 1][stop];
                    if (can < INF && can <= bound && (trip < 0 || can <= times[trip * width + i])) {
                        const low = firstTrip(routes[r], i, can);
                        if (low < trips && (trip < 0 || low < trip)) {
                            trip = low;
                            board = i;
                        }
                    }
                }
            }
            const improved = new Set();
            const offer = (stop, at, from) => {
                if (at > bound || at >= ready[k][stop]) return;
                ready[k][stop] = at;
                cameFrom[k][stop] = from;
                improved.add(stop);
            };
            for (const stop of reached) {
                const at = rideArrival[stop];
                offer(stop, at + CHANGE_SECONDS, stop);
                const near = walks[stop];
                for (let j = 0; j < near.length; j += 2) {
                    if (near[j + 1] <= walkLimit) offer(near[j], at + Math.round(near[j + 1] * walkFactor) + afterWalk, stop);
                }
            }
            marked = [...improved];
            last = k;
        }
        for (let k = last + 1; k <= MAX_RIDES; k++) {
            arrivals[k].set(arrivals[last]);
            ready[k].set(ready[last]);
            byRoute[k].fill(-1);
            cameFrom[k].fill(-2);
        }
    }

    // The earliest at the door with at most `rides` rides, with `egress`,
    // [stop, seconds on foot…], from the stops around it; at is null if there's none
    /** @param {number[]} egress @param {number} [rides] @param {number} [walkFactor] */
    function arrival(egress, rides = MAX_RIDES, walkFactor = 1) {
        let best = INF;
        let stop = -1;
        for (let i = 0; i < egress.length; i += 2) {
            const at = arrivals[rides][egress[i]];
            if (at >= INF) continue;
            const there = at + Math.round(egress[i + 1] * walkFactor);
            if (there < best) {
                best = there;
                stop = egress[i];
            }
        }
        return { at: best < INF ? best : null, stop };
    }

    // The rides that got to `stop` in the last search, with at most `rides`
    /** @param {number} stop @param {number} rides @returns {Journey} */
    function journey(stop, rides) {
        const legs = [];
        let walked = 0;
        let at = stop;
        let k = rides;
        for (;;) {
            while (byRoute[k][at] < 0) k--;
            const route = routes[byRoute[k][at]];
            const trip = byTrip[k][at];
            const position = boardedAt[k][at];
            const board = route.stops[position];
            legs.unshift({
                line: route.line, mode: route.mode, route: route.given, boardIndex: position, alightIndex: route.stops.indexOf(at, position + 1),
                board, alight: at, boards: route.times[trip * route.width + position], arrives: arrivals[k][at], walkBefore: 0,
            });
            let before = k - 1;
            while (before > 0 && cameFrom[before][board] === -2) before--;
            if (before === 0) return { legs, walked };
            const from = cameFrom[before][board];
            if (from !== board) {
                legs[0].walkBefore = walkOf(from, board);
                walked += legs[0].walkBefore;
            }
            at = from;
            k = before;
        }
    }

    /**
     * Every line, but those in `except`, that goes from `stop` or a stop in
     * walking distance, for someone there at `at`, to a stop of `egress`: its
     * ride with the earliest arrival at the door, and the least walking for that.
     * The search can't give this: it only keeps what's better than the rest.
     * @param {number} stop @param {number} at @param {number[]} egress
     * @param {{ except?: Set<string>, walkLimit?: number }} [options]
     * @returns {{ leg: Leg, at: number, stop: number }[]}
     */
    function onwardRides(stop, at, egress, { except = new Set(), walkLimit = Infinity } = {}) {
        const toDoor = new Map();
        for (let i = 0; i < egress.length; i += 2) {
            if (!toDoor.has(egress[i]) || egress[i + 1] < toDoor.get(egress[i])) toDoor.set(egress[i], egress[i + 1]);
        }
        const best = new Map();
        const from = (board, ready, walkBefore) => {
            const through = serving[board];
            for (let j = 0; j < through.length; j += 2) {
                const route = routes[through[j]];
                const position = through[j + 1];
                if (except.has(route.line)) continue;
                const trip = firstTrip(route, position, ready);
                if (trip >= route.trips) continue;
                for (let i = position + 1; i < route.width; i++) {
                    const walk = toDoor.get(route.stops[i]);
                    if (walk === undefined) continue;
                    const arrives = route.times[trip * route.width + i];
                    const there = arrives + walk;
                    const held = best.get(route.line);
                    if (held && (held.at < there || (held.at === there && held.leg.walkBefore + held.walk <= walkBefore + walk))) continue;
                    best.set(route.line, {
                        at: there, stop: route.stops[i], walk,
                        leg: {
                            line: route.line, mode: route.mode, route: route.given, boardIndex: position, alightIndex: i,
                            board, alight: route.stops[i], boards: route.times[trip * route.width + position], arrives, walkBefore,
                        },
                    });
                }
            }
        };
        from(stop, at + CHANGE_SECONDS, 0);
        const near = walks[stop];
        for (let j = 0; j < near.length; j += 2) {
            if (near[j + 1] <= walkLimit) from(near[j], at + near[j + 1] + afterWalk, walkOf(stop, near[j]));
        }
        return [...best.values()].map(({ leg, at: there, stop: last }) => ({ leg, at: there, stop: last }));
    }

    /**
     * The same rides on this timetable, for someone at the first stop at
     * `start`: each the first trip of its line from where it boards, once in
     * from the ride before and walked from it, to where it gets off. next:
     * when the line's trip after it boards there, null if there's none. Null
     * if a ride can't be made. The timetable can be another than the search's,
     * with the same stops.
     * @param {Leg[]} legs @param {number} start
     * @returns {(Leg & { next: number | null })[] | null}
     */
    function ride(legs, start) {
        const timed = [];
        let ready = start;
        for (const leg of legs) {
            if (timed.length) ready = timed.at(-1).arrives + (leg.walkBefore ? leg.walkBefore + afterWalk : CHANGE_SECONDS);
            const through = serving[leg.board];
            let best = null;
            const taking = [];
            for (let j = 0; j < through.length; j += 2) {
                const route = routes[through[j]];
                const position = through[j + 1];
                const to = route.stops.indexOf(leg.alight, position + 1);
                if (route.line !== leg.line || to < 0) continue;
                taking.push([route, position]);
                const trip = firstTrip(route, position, ready);
                if (trip >= route.trips) continue;
                const arrives = route.times[trip * route.width + to];
                if (!best || arrives < best.arrives) best = { ...leg, boards: route.times[trip * route.width + position], arrives, next: null };
            }
            if (!best) return null;
            for (const [route, position] of taking) {
                const trip = firstTrip(route, position, best.boards + 1);
                if (trip < route.trips) best.next = Math.min(best.next ?? Infinity, route.times[trip * route.width + position]);
            }
            timed.push(best);
        }
        return timed;
    }

    return { stops, search, arrival, journey, onwardRides, ride };
}
