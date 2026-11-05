// How much a way costs a rider, to rank ways by: not only when it gets there.
// Agreed on 3 November 2026 (roadmap Plan 6). The times a rider is shown stay
// real ones; this only puts ways in order, and drops none.
//
// - Buses take their slowest tenth (a bad day, withRides' badDay in
//   server/data/bus-timetable.js), where
//   there are enough rides measured: a bus that's often stuck ranks lower.
//   So a change after a bus that only works on a usual day is the next
//   departure here.
// - A minute on foot counts as one and a half.
// - Each change costs 3 minutes on top of its own walk and wait.
// - A change with a walk and under a minute to spare is missed half the time,
//   as walks are estimates: half the wait for the next departure is added.
//   A change at the same stop has the search's margin already.

import { AFTER_WALK_SECONDS } from './city.js';
import { secondsTo } from './ways.js';

const WALK_WEIGHT = 1.5;
const CHANGE_COST_SECONDS = 180;
const TIGHT_SECONDS = 60;
const MISS_CHANCE = 0.5;
// Missing the last trip of a line: as bad as an hour's wait
const NO_NEXT_SECONDS = 3600;

/** @typedef {ReturnType<typeof import('./city.js').createPlanner>} Planner */
/** @typedef {import('./ways.js').Way} Way */

// The weights on a way's own times: seconds to the door, `walk` of them on
// foot, and its changes. Also for ways the search didn't find (the Trip page's
// metro options)
/** @param {number} seconds @param {number} walk @param {number} changes */
export const weighed = (seconds, walk, changes) => seconds + (WALK_WEIGHT - 1) * walk + CHANGE_COST_SECONDS * changes;

/**
 * What `way` costs, in seconds from `now`, timed on `badDay` (a planner over
 * the same stops, or the way's own one when nothing is measured): Infinity if
 * a ride of it can't be made there
 * @param {Planner} badDay @param {Way} way @param {number} now @param {number[]} access @param {number[]} egress
 */
export function cost(badDay, way, now, access, egress) {
    const legs = badDay.ride(way.legs, now + secondsTo(access, way.legs[0].board));
    if (!legs) return Infinity;
    const last = legs.at(-1);
    const at = last.arrives + secondsTo(egress, last.alight);
    let risk = 0;
    legs.forEach((leg, i) => {
        if (!i || !leg.walkBefore) return;
        const spare = leg.boards - (legs[i - 1].arrives + leg.walkBefore + AFTER_WALK_SECONDS);
        if (spare < TIGHT_SECONDS) risk += MISS_CHANCE * (leg.next === null ? NO_NEXT_SECONDS : leg.next - leg.boards);
    });
    return weighed(at - now, way.walk, legs.length - 1) + risk;
}
