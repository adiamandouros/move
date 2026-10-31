import { distanceMeters } from '/js/core/geo.js';
import { nextDay, planTrip } from '/tools/subway/network.js';

// From one place to another on foot and by metro. No DOM, so it's tested in
// Node. A place is { lat, lng, station? }: with `station` (an id in rail.json)
// it's that station, and there's no walk to it.

// Walks are worked out from the straight line, as we have no street map:
// streets add about a third, at an ordinary pace. Shown as estimates.
const WINDING = 1.3;
const METERS_PER_MINUTE = 80;
// The nearest station isn't always the best: the next one may be on a direct line
const STATIONS_TRIED = 3;
const MAX_OPTIONS = 3;
const LONG_WALK_MINUTES = 30;
const DAY = 86_400;
// Longer than this until a train: the trains have stopped for the night
const LONGEST_WAIT = 3600;

/** @typedef {import('../../../types/data.js').Rail} Rail */
/** @typedef {{ lat: number, lng: number, station?: string }} Place */

/** @param {Place} from @param {Place} to */
export function walkBetween(from, to) {
    const meters = distanceMeters(from.lat, from.lng, to.lat, to.lng) * WINDING;
    return { meters: Math.round(meters), minutes: Math.max(1, Math.round(meters / METERS_PER_MINUTE)) };
}

const stationPlace = (rail, station) => ({ lat: rail.stations[station].coords[0], lng: rail.stations[station].coords[1] });

// The stations to try from a place: { station, walk }, nearest first
/** @param {Rail} rail @param {Place} place */
export function stationsNear(rail, place) {
    if (place.station) return [{ station: place.station, walk: null }];
    return Object.keys(rail.stations)
        .map(station => ({ station, walk: walkBetween(place, stationPlace(rail, station)) }))
        .sort((a, b) => a.walk.meters - b.walk.meters)
        .slice(0, STATIONS_TRIED);
}

// `now`, `minutes` later, into the next day if it comes to that
function later(now, minutes) {
    const seconds = now.seconds + minutes * 60;
    return seconds < DAY ? { ...now, seconds } : { ...nextDay(now), seconds: seconds - DAY };
}

function option(rail, start, end, now) {
    const leave = later(now, start.walk?.minutes ?? 0);
    const { plans, now: day, tomorrow } = planTrip(rail, start.station, end.station, leave);
    const plan = plans.find(p => p.arrives !== null);
    if (!plan) return null;
    // Seconds from the midnight of `now`, whichever day the train runs on
    const arrives = plan.arrives + (day.date === now.date ? 0 : DAY) + (end.walk?.minutes ?? 0) * 60;
    const morning = tomorrow || plan.legs[0].departures[0].departs - leave.seconds > LONGEST_WAIT;
    return { start, end, plan, morning, arrives, minutes: Math.round((arrives - now.seconds) / 60), changes: plan.legs.length - 1 };
}

const linesOf = o => o.plan.legs.map(leg => leg.line).join();
const sameWay = (a, b) => a.start.station === b.start.station && linesOf(a) === linesOf(b);

// The trip, door to door: `options`, what gets there first first, and `walk`,
// on foot. `walkFirst`: walking gets there sooner, or there's no train to
// take. `longWalk`: the best option's walk at either end is a long one.
/** @param {Rail} rail @param {Place} from @param {Place} to @param {{ weekday: number, seconds: number, date: string }} now */
export function doorToDoor(rail, from, to, now) {
    const pairs = stationsNear(rail, from).flatMap(start => stationsNear(rail, to).map(end => ({ start, end })));
    const found = pairs
        .filter(({ start, end }) => start.station !== end.station)
        .map(({ start, end }) => option(rail, start, end, now))
        .filter(Boolean);
    // The morning's first trains only if no trip can be made tonight
    const tonight = found.filter(o => !o.morning);
    const options = (tonight.length ? tonight : found)
        .sort((a, b) => a.arrives - b.arrives || a.changes - b.changes)
        // Ways that read the same, from one station on the same lines: the first
        .filter((o, i, all) => all.findIndex(other => sameWay(other, o)) === i)
        .slice(0, MAX_OPTIONS);
    const walk = walkBetween(from, to);
    const best = options[0];
    return {
        options, walk,
        walkFirst: !best || best.morning || walk.minutes <= best.minutes,
        longWalk: Boolean(best) && Math.max(best.start.walk?.minutes ?? 0, best.end.walk?.minutes ?? 0) >= LONG_WALK_MINUTES,
    };
}
