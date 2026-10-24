// Route finding and departure times over rail.json (see server/data/build-rail.js
// for the format). No DOM access, so it can be unit-tested in Node.

/** @typedef {import('../../../types/data.js').Rail} Rail */
/** @typedef {import('../../../types/data.js').Stop} Stop */
/** @typedef {import('../../../types/data.js').Position} Position */
/**
 * A ride on one line, between stop indexes of one direction
 * @typedef {{ line: string, dir: string, from: string, to: string, fromIndex: number, toIndex: number }} Leg
 */
/** @typedef {{ departs: number, arrives: number, isLast: boolean, isSecondLast: boolean }} Departure */
/** @typedef {{ via?: string, legs: Leg[] }} Route */
/** @typedef {Route & { legs: (Leg & { departures: Departure[] })[], arrives: number | null }} PlannedRoute */
/** @typedef {{ weekday: number, seconds: number, date: string }} AthensTime */

const DAY = 86_400;
// Minimum time to change trains at an interchange
export const TRANSFER_SECONDS = 180;
// OASA's feed sometimes has near-duplicate trips a few seconds apart
const DUPLICATE_SECONDS = 60;
const MAX_OPTIONS = 3;
// How far the timetable's last train may be from STASY's and still be it
// (the timetable times some trains up to 3 minutes off STASY's)
const LAST_TRAIN_LEEWAY = 300;

// STASY's last train for a leg on one weekday's service, when its stop has
// STASY's hours (rail.json): to the nearest destination at least as far as
// the leg goes. Seconds, null when the trains run all night, or undefined
// when there are no STASY times there.
/** @param {Rail} rail @param {Leg} leg @param {number} weekday */
function stasyLast(rail, leg, weekday) {
    const { stops } = rail.lines[leg.line].directions[leg.dir];
    const to = stops[leg.fromIndex].hours?.find(h => stops.findIndex(s => s.station === h.to) >= leg.toIndex);
    return to ? to.last[weekday] : undefined;
}

// Current weekday (0 = Sunday) and seconds since midnight in Athens, wherever
// the device's clock is set.
/** @returns {AthensTime} */
export function athensNow(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Athens', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    }).formatToParts(date).map(p => [p.type, p.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return { weekday, seconds: +parts.hour * 3600 + +parts.minute * 60 + +parts.second, date: athensDate(date) };
}

export function athensDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(date);
}

// Every way to ride one line from `from` to `to` without changing.
/** @param {Rail} rail @param {string} from @param {string} to @returns {Leg[]} */
function legsBetween(rail, from, to) {
    const legs = [];
    for (const [line, { directions }] of Object.entries(rail.lines)) {
        for (const [dir, { stops }] of Object.entries(directions)) {
            const fromIndex = stops.findIndex(s => s.station === from);
            const toIndex = stops.findIndex(s => s.station === to);
            if (fromIndex !== -1 && toIndex > fromIndex) legs.push({ line, dir, from, to, fromIndex, toIndex });
        }
    }
    return legs;
}

// Direct routes if there are any, otherwise every one-change route. All three
// metro lines cross each other, so one change is always enough.
/** @param {Rail} rail @param {string} from @param {string} to @returns {Route[]} */
export function findRoutes(rail, from, to) {
    if (!from || !to || from === to) return [];
    const direct = legsBetween(rail, from, to);
    if (direct.length) return direct.map(leg => ({ legs: [leg] }));

    const routes = [];
    for (const [via, station] of Object.entries(rail.stations)) {
        if (station.lines.length < 2 || via === from || via === to) continue;
        for (const first of legsBetween(rail, from, via)) {
            for (const second of legsBetween(rail, via, to)) {
                if (first.line !== second.line) routes.push({ via, legs: [first, second] });
            }
        }
    }
    return routes;
}

// The ISO date `days` days after `date`
/** @param {string} date @param {number} days */
function addDays(date, days) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Upcoming departures for one leg at or after `after` seconds (relative to
// today's midnight). Includes yesterday's trips that run past midnight,
// unless ownDay (only the day's own service). With `date` (today's, ISO), a
// day the timetable has its own trains for (a holiday) uses them; otherwise
// its weekday's.
// Each result: { departs, arrives, isLast, isSecondLast }. The last ones are
// only flagged when STASY's last train agrees (the timetable misses the late
// airport trains, and there's no last one when the trains run all night), or
// when there are no STASY times.
/**
 * @param {Rail} rail @param {Leg} leg
 * @param {{ weekday: number, after: number, count?: number, ownDay?: boolean, date?: string }} when
 * @returns {Departure[]}
 */
export function departures(rail, leg, { weekday, after, count = 2, ownDay = false, date }) {
    const { timetable } = rail.lines[leg.line].directions[leg.dir];
    const found = [];
    for (const dayOffset of ownDay ? [0] : [-1, 0]) {
        const serviceDay = (weekday + dayOffset + 7) % 7;
        const own = date ? timetable.dates?.[addDays(date, dayOffset)] : undefined;
        const pattern = timetable.patterns[own ?? timetable.days[serviceDay]];
        const trains = [];
        for (const [start, p] of pattern) {
            const { stops, offsets } = timetable.profiles[p];
            const i = stops.indexOf(leg.fromIndex);
            const j = stops.indexOf(leg.toIndex);
            if (i === -1 || j <= i) continue;
            trains.push({ departs: start + offsets[i] + dayOffset * DAY, arrives: start + offsets[j] + dayOffset * DAY });
        }
        trains.sort((a, b) => a.departs - b.departs);
        const unique = trains.filter((d, k) => k === 0 || d.departs - trains[k - 1].departs >= DUPLICATE_SECONDS);
        const last = stasyLast(rail, leg, serviceDay);
        const lastKnown = last === undefined
            || (last !== null && unique.length > 0 && Math.abs(unique.at(-1).departs - dayOffset * DAY - last) <= LAST_TRAIN_LEEWAY);
        unique.forEach((d, k) => {
            d.isLast = lastKnown && k === unique.length - 1;
            d.isSecondLast = lastKnown && k === unique.length - 2;
        });
        found.push(...unique.filter(d => d.departs >= after));
    }
    return found.sort((a, b) => a.departs - b.departs).slice(0, count);
}

// Departures for every leg of a route, with each later leg timed from the
// arrival of the first upcoming train on the previous leg plus a change.
// `arrives` is the earliest arrival at the destination, or null if no train
// makes the whole journey today.
// ownDay: only the day's own trains (see departures)
/** @param {Rail} rail @param {Route} route @param {AthensTime} now @param {boolean} [ownDay] @returns {PlannedRoute} */
export function planRoute(rail, route, now, ownDay = false) {
    let after = now.seconds;
    let reachable = true;
    const legs = route.legs.map(leg => {
        const next = reachable ? departures(rail, leg, { weekday: now.weekday, after, ownDay, date: now.date }) : [];
        if (next.length) after = next[0].arrives + TRANSFER_SECONDS;
        else reachable = false;
        return { ...leg, departures: next };
    });
    const last = legs.at(-1).departures[0];
    return { ...route, legs, arrives: reachable && last ? last.arrives : null };
}

// Plan every route and keep the few that arrive first.
/** @param {Rail} rail @param {string} from @param {string} to @param {AthensTime} now @param {boolean} [ownDay] @returns {PlannedRoute[]} */
export function planJourney(rail, from, to, now, ownDay = false) {
    return findRoutes(rail, from, to)
        .map(route => planRoute(rail, route, now, ownDay))
        .sort((a, b) => (a.arrives ?? Infinity) - (b.arrives ?? Infinity))
        .slice(0, MAX_OPTIONS);
}

// The day after `now`, from midnight
/** @param {AthensTime} now @returns {AthensTime} */
export function nextDay(now) {
    return { weekday: (now.weekday + 1) % 7, seconds: 0, date: addDays(now.date, 1) };
}

// When a planned route gets there, and how long it takes from boarding the
// first train to getting off the last (rides, changes, waits for the next
// train): on the first trains that make the whole trip, tomorrow's first
// ones when none does today (`arrives` then counts from today's midnight, so
// it compares with today's). null when none does tomorrow either.
/** @param {Rail} rail @param {PlannedRoute} route @param {AthensTime} now @returns {{ arrives: number, minutes: number } | null} */
export function tripTime(rail, route, now) {
    const tomorrow = route.arrives === null;
    const plan = tomorrow ? planRoute(rail, route, nextDay(now), true) : route;
    const first = plan.legs[0].departures[0];
    if (plan.arrives === null || !first) return null;
    return { arrives: plan.arrives + (tomorrow ? DAY : 0), minutes: Math.round((plan.arrives - first.departs) / 60) };
}

// planJourney, and after the last train of the day (no route gets there
// today) the same trip on tomorrow's first trains. Tomorrow's own: tonight's
// trains after midnight can't make the trip, or today's plan would have.
// They'd only leave you waiting at a change until the morning.
/**
 * @param {Rail} rail @param {string} from @param {string} to @param {AthensTime} now
 * @returns {{ plans: PlannedRoute[], now: AthensTime, tomorrow: boolean }} now: the time the plans start from
 */
export function planTrip(rail, from, to, now) {
    const plans = planJourney(rail, from, to, now);
    if (!plans.length || plans.some(plan => plan.arrives !== null)) return { plans, now, tomorrow: false };
    const tomorrow = nextDay(now);
    return { plans: planJourney(rail, from, to, tomorrow, true), now: tomorrow, tomorrow: true };
}

// Where to stand on a leg: at an interchange, near the way to the next line;
// otherwise near the exit, with how it's reached (escalators, stairs: those
// are the exit's, not the change's)
/**
 * @param {Rail} rail @param {Leg} leg @param {Leg | null} next
 * @returns {{ stop: Stop, exits: Position[], elevators: Position[], escalators: Position[], stairs: Position[] }}
 */
export function legPositions(rail, leg, next) {
    const stop = rail.lines[leg.line].directions[leg.dir].stops[leg.toIndex];
    const exits = next ? stop.transfers?.[`${next.line}/${next.dir}`] ?? stop.exits : stop.exits;
    return { stop, exits, elevators: stop.elevators ?? [], escalators: next ? [] : stop.escalators ?? [], stairs: next ? [] : stop.stairs ?? [] };
}

/** @param {Rail} rail @param {number} lat @param {number} lng @returns {string} */
export function closestStation(rail, lat, lng) {
    let best = null;
    let bestDist = Infinity;
    for (const [id, { coords }] of Object.entries(rail.stations)) {
        // Equirectangular approximation — plenty for picking the nearest station
        const x = (coords[1] - lng) * Math.cos((lat * Math.PI) / 180);
        const y = coords[0] - lat;
        const d = x * x + y * y;
        if (d < bestDist) { bestDist = d; best = id; }
    }
    return best;
}

/** @param {Rail} rail @param {AthensTime} now */
export function isTimetableExpired(rail, now) {
    return now.date > rail.feed.validTo;
}
