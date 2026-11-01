// From what the search finds to the ways a rider could choose from. RAPTOR
// only gives the best with each number of rides, and a rider's choices are
// more than that (decision: routes are offered, slower ones hidden, never
// dropped), so it's asked again without what it found, and every line that
// runs from a change to the door is looked up.

import { MAX_RIDES } from './raptor.js';

// Searches for one trip, and how far behind the first a way is still worth
// looking past. Over the budget, rarer ways are missed
const BUDGET = 40;
const SLACK_SECONDS = 1800;
// A change and the stops around it count as one place
const SAME_PLACE_SECONDS = 300;

/** @typedef {ReturnType<typeof import('./raptor.js').createPlanner>} Planner */
/** @typedef {import('./raptor.js').Journey & { at: number, walk: number }} Way */

// The seconds on foot to `stop` in an [stop, seconds…] list
/** @param {number[]} list @param {number} stop */
export function secondsTo(list, stop) {
    let least = Infinity;
    for (let i = 0; i < list.length; i += 2) if (list[i] === stop) least = Math.min(least, list[i + 1]);
    return least;
}

// The fastest way with the fewest rides in the last search
/** @param {Planner} planner @param {number[]} access @param {number[]} egress @returns {Way | null} */
export function fastest(planner, access, egress) {
    const { at } = planner.arrival(egress);
    if (at === null) return null;
    let rides = 1;
    while ((planner.arrival(egress, rides).at ?? Infinity) > at) rides++;
    return withWalk(planner, planner.arrival(egress, rides).stop, rides, at, access, egress);
}

function withWalk(planner, stop, rides, at, access, egress) {
    const journey = planner.journey(stop, rides);
    return { ...journey, at, walk: secondsTo(access, journey.legs[0].board) + journey.walked + secondsTo(egress, stop) };
}

// The way's rides up to each change, then each line from there to the door:
// the 750 from Aigaleo is hidden behind the same bus from Korydallos
function everyLastRide(planner, way, access, egress, walkLimit) {
    return way.legs.slice(0, -1).flatMap((leg, i) => {
        const before = way.legs.slice(0, i + 1);
        const except = new Set(before.map(({ line }) => line));
        return planner.onwardRides(leg.alight, leg.arrives, egress, { except, walkLimit }).map(({ leg: last, at, stop }) => {
            const legs = [...before, last];
            const walked = legs.reduce((sum, { walkBefore }) => sum + walkBefore, 0);
            return { legs, walked, at, walk: secondsTo(access, legs[0].board) + walked + secondsTo(egress, stop) };
        });
    });
}

// Lines and where they change: the same lines changing elsewhere are another way
/** @param {Planner} planner @param {Way} way */
export const wayKey = ({ stops }, way) => way.legs.map((leg, i) => (i ? `${stops[leg.board].name} ` : '') + leg.line).join(' ');

/**
 * The ways from `access` to `egress`, those that arrive first first: the best
 * with each number of rides, then the best without each line and each change
 * of what's been found, and so on from the earliest arrival, so that a way
 * behind two better lines still comes up. Then, from each change of those
 * close enough to the first, every line that goes on to the door.
 * @param {Planner} planner @param {number[]} access @param {number[]} egress @param {number} now
 * @param {{ budget?: number, slack?: number, walkLimit?: number }} [options]
 * @returns {Way[]}
 */
export function findWays(planner, access, egress, now, { budget = BUDGET, slack = SLACK_SECONDS, walkLimit } = {}) {
    const asked = new Set();
    const pending = [];
    const add = (way, lines, places) => pending.push({ way, lines, places });
    const ask = (lines, places) => {
        const signature = `${[...lines].sort().join()}|${[...places].sort((a, b) => a - b).join()}`;
        if (asked.has(signature) || asked.size >= budget) return null;
        asked.add(signature);
        const banBoard = new Uint8Array(planner.stops.length);
        for (const stop of places) banBoard[stop] = 1;
        planner.search(access, now, { ban: new Set(lines), banBoard, walkLimit });
        return fastest(planner, access, egress);
    };

    const first = ask([], []);
    if (!first) return [];
    add(first, [], []);
    for (let rides = 1; rides < MAX_RIDES; rides++) {
        const { at, stop } = planner.arrival(egress, rides);
        if (at !== null) add(withWalk(planner, stop, rides, at, access, egress), [], []);
    }

    const found = new Map();
    const keep = way => {
        const key = wayKey(planner, way);
        if (!found.has(key) || way.at < found.get(key).at) found.set(key, way);
    };
    while (pending.length && asked.size < budget) {
        pending.sort((a, b) => a.way.at - b.way.at);
        const { way, lines, places } = pending.shift();
        keep(way);
        if (way.at > first.at + slack) continue;
        for (const line of new Set(way.legs.map(leg => leg.line))) {
            const next = ask([...lines, line], places);
            if (next) add(next, [...lines, line], places);
        }
        for (const leg of way.legs.slice(1)) {
            const around = planner.near(planner.stops[leg.board], SAME_PLACE_SECONDS);
            const more = [...places, leg.board, ...around.filter((_, i) => i % 2 === 0)];
            const next = ask(lines, [...new Set(more)]);
            if (next) add(next, lines, [...new Set(more)]);
        }
    }
    for (const { way } of pending) keep(way);
    for (const way of [...found.values()]) {
        if (way.at <= first.at + slack) everyLastRide(planner, way, access, egress, walkLimit).forEach(keep);
    }
    return [...found.values()].sort((a, b) => a.at - b.at);
}

// The same lines arriving together are one way, however many stops it could
// be caught at: it's the same bus. The one with the least walking stays
/** @param {Way[]} ways */
export function fold(ways) {
    const kept = new Map();
    for (const way of ways) {
        const key = `${way.legs.map(leg => leg.line).join('+')}|${Math.round(way.at / 60)}`;
        if (!kept.has(key) || way.walk < kept.get(key).walk) kept.set(key, way);
    }
    return [...kept.values()].sort((a, b) => a.at - b.at || a.walk - b.walk);
}

// What a way rides on rail and where it gets off: what a rider would call it
/** @param {Planner} planner @param {Way} way */
export function spine({ stops }, way) {
    const rail = way.legs.filter(leg => leg.mode === 'metro' || leg.mode === 'tram');
    return rail.length ? `${rail.map(leg => leg.line).join('+')} to ${stops[rail.at(-1).alight].name}` : 'buses only';
}

const clock = seconds => `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;

// One line about a way, for reading in a terminal
/** @param {Planner} planner @param {Way} way @param {number} now */
export function describeWay({ stops }, way, now) {
    const rides = way.legs.map(leg => `${clock(leg.boards)} ${leg.line} ${stops[leg.board].name} > ${stops[leg.alight].name}`);
    return `${clock(way.at)}, ${Math.round((way.at - now) / 60)} min, ${way.legs.length - 1} changes, ${Math.round(way.walk / 60)} on foot: ${rides.join(' | ')}`;
}

/**
 * The fastest way for each departure in a window: one instant can't tell a
 * clear answer from a lucky connection
 * @param {Planner} planner @param {number[]} access @param {number[]} egress
 * @param {{ from: number, to: number, step?: number, walkLimit?: number }} window seconds from midnight
 * @returns {{ now: number, way: Way | null }[]}
 */
export function acrossWindow(planner, access, egress, { from, to, step = 60, walkLimit }) {
    const departures = [];
    for (let now = from; now <= to; now += step) {
        planner.search(access, now, { walkLimit });
        departures.push({ now, way: fastest(planner, access, egress) });
    }
    return departures;
}
