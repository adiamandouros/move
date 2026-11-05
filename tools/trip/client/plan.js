import { distanceMeters } from '/js/core/geo.js';
import { arrivalsFrom, nextDay, planTrip } from '/tools/subway/network.js';

// From one place to another on foot, by metro and by tram: `rail` is the metro
// alone or with the tram (withTram, decision 29). No DOM, so it's tested in
// Node. A place is { lat, lng, station? }: with `station` (an id in `rail`)
// it's that station or stop, and there's no walk to it.

// Walks are worked out from the straight line, as we have no street map:
// streets add about a third, at an ordinary pace. Shown as estimates.
const WINDING = 1.3;
const METERS_PER_MINUTE = 80;
// The nearest station isn't always the best: the next one may be on a direct line
const STATIONS_TRIED = 3;
// Any other station or tram stop this close is tried too
const NEAR_MINUTES = 15;
// Of the trips between those, how many more are planned: the search's quickest
const SEARCHED_PAIRS = 6;
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

// The stations to try from a place: { station, walk, nearest }, nearest first.
// nearest: one of the metro stations nearest it, or the station it is: every
// trip between those is planned. The others are any station or tram stop a
// short walk away
/** @param {Rail} rail @param {Place} place */
export function stationsNear(rail, place) {
    if (place.station) return [{ station: place.station, walk: null, nearest: true }];
    const all = Object.keys(rail.stations)
        .map(station => ({ station, walk: walkBetween(place, stationPlace(rail, station)) }))
        .sort((a, b) => a.walk.meters - b.walk.meters);
    const metro = new Set(all.filter(({ station }) => !rail.stations[station].tram).slice(0, STATIONS_TRIED));
    return all.filter(s => metro.has(s) || s.walk.minutes <= NEAR_MINUTES).map(s => ({ ...s, nearest: metro.has(s) }));
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
const sameWay = (a, b) => a.plan.legs[0].from === b.plan.legs[0].from && linesOf(a) === linesOf(b);

// The trip, door to door: `options`, what gets there first first, and `walk`,
// on foot. `walkFirst`: walking gets there sooner, or there's no train to
// take. `longWalk`: the best option's walk at either end is a long one.
/** @param {Rail} rail @param {Place} from @param {Place} to @param {{ weekday: number, seconds: number, date: string }} now */
export function doorToDoor(rail, from, to, now) {
    const pairs = stationsNear(rail, from).flatMap(start => stationsNear(rail, to).map(end => ({ start, end })))
        .filter(({ start, end }) => start.station !== end.station);
    // Every trip between the nearest stations, and the quickest few others
    const nearest = pairs.filter(({ start, end }) => start.nearest && end.nearest);
    const tried = [...nearest, ...soonest(rail, pairs.filter(pair => !nearest.includes(pair)), now).slice(0, SEARCHED_PAIRS)];
    const found = tried
        .map(({ start, end }) => option(rail, start, end, now))
        .filter(Boolean);
    // The morning's first trains only if no trip can be made tonight
    const tonight = found.filter(o => !o.morning);
    const options = (tonight.length ? tonight : found)
        .sort((a, b) => a.arrives - b.arrives || a.changes - b.changes)
        // Ways that read the same: the first
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
