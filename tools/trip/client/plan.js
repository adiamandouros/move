import { METERS_PER_MINUTE, stationWalk, walkMeters } from '/tools/subway/city.js';
import { arrivalsFrom, nextDay, planTrip } from '/tools/subway/network.js';
import { weighed } from '/tools/subway/weights.js';

// From one place to another on foot, by metro, by tram and by bus: `rail` is
// the metro alone or with the tram (withTram, decision 29), and the ways with
// a bus come from the city's search (buses.js, in the background: searcher.js,
// decision 32). No DOM, so it's
// tested in Node. A place is { lat, lng, station? }: with `station` (an id in
// `rail`) it's that station or stop, and there's no walk to it.

// Walks are worked out from the straight line, as we have no street map:
// the city's search's walk (city.js), so a walk to a station is timed the
// same in every option (decision 37), to or from the nearest of its exits
// that goes the rider's way (decision 51). Shown as estimates.
// The nearest station isn't always the best: the next one may be on a direct line
const STATIONS_TRIED = 3;
// Any other station or tram stop this close is tried too, and any bus stop
// (buses.js): as far as 15 minutes were at the straight line × 1.3 (decision 37)
export const NEAR_MINUTES = 16;
// Of the trips between those, how many more are planned: the search's quickest
const SEARCHED_PAIRS = 6;
const MAX_OPTIONS = 3;
const LONG_WALK_MINUTES = 30;
const DAY = 86_400;
// Longer than this until a train: the trains have stopped for the night
const LONGEST_WAIT = 3600;

/** @typedef {import('../../../types/data.js').Rail} Rail */
/** @typedef {{ lat: number, lng: number, station?: string }} Place */
/** @typedef {import('./buses.js').BusOption} BusOption */

/** @param {Place} from @param {Place} to */
export function walkBetween(from, to) {
    const meters = walkMeters(from, to);
    return { meters: Math.round(meters), minutes: Math.max(1, Math.round(meters / METERS_PER_MINUTE)) };
}

// A station as the city's search walks to it (city.js), with a metro station's exits
const stationPlace = (rail, station) => {
    const { coords, exits } = rail.stations[station];
    return { lat: coords[0], lng: coords[1], exits };
};

/**
 * A walk from `place` into `station` (`way` 'in') or out of it to `place`
 * ('out'), through the exit it goes by (`exit`, its place in the station's
 * exits, or null), its `meters` and `minutes`; `away`, the minutes to where
 * the station is, which say how far it is (NEAR_MINUTES), as for the city's
 * search, so its exits never put it out of reach
 * @param {Rail} rail @param {Place} place @param {string} station @param {import('/tools/subway/city.js').Way} way
 */
export function walkStation(rail, place, station, way) {
    const at = stationPlace(rail, station);
    const { exit, seconds } = stationWalk(at, place, way);
    return { meters: Math.round(seconds / 60 * METERS_PER_MINUTE), minutes: Math.max(1, Math.round(seconds / 60)), away: walkBetween(place, at).minutes, exit };
}

// The stations to try from a place, walking into them (`way` 'in') or, at
// the trip's end, out of them ('out'): { station, walk, nearest }, nearest
// first. nearest: one of the metro stations nearest it, or the station it
// is: every trip between those is planned. The others are any station or
// tram stop a short walk away on the street
/** @param {Rail} rail @param {Place} place @param {import('/tools/subway/city.js').Way} [way] */
export function stationsNear(rail, place, way = 'in') {
    if (place.station) return [{ station: place.station, walk: null, nearest: true }];
    const all = Object.keys(rail.stations)
        .map(station => ({ station, walk: walkStation(rail, place, station, way), far: walkMeters(place, stationPlace(rail, station)) }))
        .sort((a, b) => a.far - b.far)
        .map(({ far, ...s }) => s);
    const metro = new Set(all.filter(({ station }) => !rail.stations[station].tram).slice(0, STATIONS_TRIED));
    return all.filter(s => metro.has(s) || s.walk.away <= NEAR_MINUTES).map(s => ({ ...s, nearest: metro.has(s) }));
}

// `now`, `minutes` later, into the next day if it comes to that
function later(now, minutes) {
    const seconds = now.seconds + minutes * 60;
    return seconds < DAY ? { ...now, seconds } : { ...nextDay(now), seconds: seconds - DAY };
}

// The minutes on foot of a metro or tram option: to the station and from the
// last, to and from a stop beside one, and between stations on the way
const walkedMinutes = (rail, start, end, plan) => (start.walk?.minutes ?? 0) + (end.walk?.minutes ?? 0)
    + (plan.walkFirst ?? 0) + (plan.walkLast ?? 0)
    + plan.legs.reduce((sum, leg, i) => sum + (i && plan.legs[i - 1].to !== leg.from ? rail.walks[plan.legs[i - 1].to][leg.from] : 0), 0);

function option(rail, start, end, now) {
    const leave = later(now, start.walk?.minutes ?? 0);
    const { plans, now: day, tomorrow } = planTrip(rail, start.station, end.station, leave);
    const plan = plans.find(p => p.arrives !== null);
    if (!plan) return null;
    // The plan's times count from its day's midnight: `dayStart` seconds
    // after `now`'s, when it's tomorrow's
    const dayStart = day.date === now.date ? 0 : DAY;
    // Seconds from the midnight of `now`, whichever day the train runs on
    const arrives = plan.arrives + dayStart + (end.walk?.minutes ?? 0) * 60;
    const morning = tomorrow || plan.legs[0].departures[0].departs - leave.seconds > LONGEST_WAIT;
    const changes = plan.legs.length - 1;
    return {
        start, end, plan, dayStart, morning, arrives, changes,
        minutes: Math.round((arrives - now.seconds) / 60),
        cost: weighed(arrives - now.seconds, walkedMinutes(rail, start, end, plan) * 60, changes),
    };
}

// The trips the search gets to the door soonest, soonest first: for each
// station to start from, one search to every station at the other end
function soonest(rail, pairs, now) {
    const at = new Map();
    for (const start of new Set(pairs.map(pair => pair.start))) {
        const leave = later(now, start.walk?.minutes ?? 0);
        const from = pairs.filter(pair => pair.start === start);
        arrivalsFrom(rail, start.station, from.map(pair => pair.end.station), leave).forEach((arrives, i) => {
            if (arrives !== null) at.set(from[i], arrives + (leave.date === now.date ? 0 : DAY) + (from[i].end.walk?.minutes ?? 0) * 60);
        });
    }
    return [...at.keys()].sort((a, b) => at.get(a) - at.get(b));
}

const linesOf = o => o.plan.legs.map(leg => leg.line).join();
// From the same station or stop on the same lines, however it's walked to
// (the city's search keeps its ways apart itself)
const sameWay = (a, b) => !a.city && !b.city && a.plan.legs[0].from === b.plan.legs[0].from && linesOf(a) === linesOf(b);
// An option's walk from the door and to it, in minutes
const endWalks = o => o.city ? [o.firstWalk?.minutes ?? 0, o.lastWalk?.minutes ?? 0] : [o.start.walk?.minutes ?? 0, o.end.walk?.minutes ?? 0];
// An option's walk at either end is a long one
/** @param {ReturnType<typeof option> | BusOption} o */
export const isLongWalk = o => Math.max(...endWalks(o)) >= LONG_WALK_MINUTES;

// The trip, door to door: `options`, in order by what they cost a rider
// (weights.js: what gets there first, walking counting 1.5 and 3 minutes a
// change), and `walk`, on foot. `buses`: the ways with a bus (busOptions in
// buses.js); without them, the metro and tram alone. `walkFirst`:
// walking gets there sooner than any option, or there's none to take.
// `longWalk`: the first option's walk at either end is a long one.
/**
 * @param {Rail} rail @param {Place} from @param {Place} to @param {{ weekday: number, seconds: number, date: string }} now
 * @param {{ buses?: BusOption[] }} [options]
 */
export function doorToDoor(rail, from, to, now, { buses = [] } = {}) {
    const pairs = stationsNear(rail, from, 'in').flatMap(start => stationsNear(rail, to, 'out').map(end => ({ start, end })))
        .filter(({ start, end }) => start.station !== end.station);
    // Every trip between the nearest stations, and the quickest few others
    const nearest = pairs.filter(({ start, end }) => start.nearest && end.nearest);
    const tried = [...nearest, ...soonest(rail, pairs.filter(pair => !nearest.includes(pair)), now).slice(0, SEARCHED_PAIRS)];
    const found = [
        ...tried.map(({ start, end }) => option(rail, start, end, now)).filter(Boolean),
        ...buses,
    ];
    // The morning's first trains only if no trip can be made tonight
    const tonight = found.filter(o => !o.morning);
    const options = (tonight.length ? tonight : found)
        .sort((a, b) => a.cost - b.cost || a.arrives - b.arrives || a.changes - b.changes)
        // Ways that read the same: the first
        .filter((o, i, all) => !all.slice(0, i).some(other => sameWay(other, o)))
        .slice(0, MAX_OPTIONS);
    const walk = walkBetween(from, to);
    const best = options[0];
    return {
        options, walk,
        walkFirst: !best || best.morning || walk.minutes <= Math.min(...options.map(o => o.minutes)),
        longWalk: Boolean(best) && isLongWalk(best),
    };
}
