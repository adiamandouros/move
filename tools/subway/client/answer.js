// What kind of answer a trip has, from every departure in a window: one
// instant can't tell a clear answer from a lucky connection. The answer is
// one clear way, a decision on the way, or "it depends". A decision gives the
// directions that stay on the first ride, and offers the quicker way only if it
// comes up, for the rider to take or not. Apart from that, a
// way's last stretch by bus is a bundle: any of the lines from that change
// to the door, as the first to come is what counts.

import { AFTER_WALK_SECONDS, CHANGE_SECONDS } from './city.js';
import { findWays, fold, secondsTo, wayKey } from './ways.js';
import { cost } from './weights.js';

// The window, from the time you leave, and how often it's tried: every 2
// minutes since the phone test (6 Nov: every minute took twice as long, and
// on 39 trips 2 minutes changed 2 answers and no top 5)
export const WINDOW_SECONDS = 1800;
const STEP_SECONDS = 120;
// A way this close to the fastest is as good as it, to a rider, and isn't
// worth changing to on the way
export const TIE_SECONDS = 180;
// The share of departures that makes a way clear. A decision is worth it
// when each choice beats the other by a tie or more this often (agreed 3 Nov)
const CLEAR_SHARE = 0.8;
const DECISION_SHARE = 0.15;
// The range shown leaves out the quickest and the slowest tenth
const RANGE_TAIL = 0.1;
// How much later than OASA says a bus comes, by how far ahead it said it
// (rush-hour test, 2 Nov: the median at each distance)
const LATENESS = [[15 * 60, 60], [20 * 60, 90], [30 * 60, 150], [45 * 60, 210], [Infinity, 420]];
const ON_THE_ROAD = new Set(['bus', 'trolley']);

/** @typedef {ReturnType<typeof import('./city.js').createPlanner>} Planner */
/** @typedef {import('./ways.js').Way & { cost: number }} Way what it costs a rider by the weights (weights.js), seconds */
/**
 * One row of an answer: a way, its last stretch by bus as a bundle of lines.
 * onward: the lines of its second ride. best: its earliest arrival for each
 * departure, null where it isn't found. range: minutes, quickest to slowest
 * but a tenth at each end. every: seconds between buses of the bundle, null
 * when fewer than two come. first, close: the share of departures it's the
 * fastest on (a tie too), and within a tie of it. cost: the median over the
 * departures of what it costs by the weights, Infinity where it isn't found, which only puts rows in order (agreed 3 Nov): real
 * times decide what kind of answer it is. stops: where its last bus is
 * caught, nearest first, each with the walk to it (seconds, from the change
 * or from the start) and its lines: a bundle's buses can leave from several.
 * @typedef {{ key: string, way: Way, lines: string[], onward: string[], bundle: boolean, best: (Way | null)[], range: [number, number], every: number | null, first: number, close: number, cost: number,
 *   stops: { stop: number, walk: number, lines: string[] }[] }} Row
 */
/**
 * stop: where the onward bus is caught. ready: the earliest the rider is
 * there. latest: the latest it can leave and still beat staying on. reaches:
 * when the first ride gets to the change, by the timetable.
 * @typedef {{ stayOn: Row, getOff: Row, stop: number, lines: string[], ready: number, latest: number, reaches: number }} Decision
 */
/** @typedef {{ kind: 'clear' | 'decision' | 'depends' | 'none', rows: Row[], departures: number[], clear?: Row, decision?: Decision }} Answer */

const lastIsBus = way => ON_THE_ROAD.has(way.legs.at(-1).mode);

// Ways that are the same up to their last bus, from the same change, are one row
/** @param {Planner} planner @param {Way} way */
export function rowKey(planner, way) {
    if (!lastIsBus(way)) return wayKey(planner, way);
    const before = way.legs.slice(0, -1);
    if (!before.length) return 'a bus from the start';
    return `${wayKey(planner, { ...way, legs: before })} at ${planner.stops[before.at(-1).alight].name}, a bus`;
}

// The value a share `q` of the way up a sorted list
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** @typedef {{ window?: number, step?: number, walkLimit?: number, badDay?: Planner }} Options */

/**
 * The rows of every departure from `now` to the end of the window, the best
 * by the weights first, and what kind of answer their real times make. badDay: the same
 * stops with buses' slowest tenth, where measured, to rank by (weights.js)
 * @param {Planner} planner @param {number[]} access @param {number[]} egress @param {number} now @param {Options} [options]
 * @returns {Answer}
 */
export function answer(planner, access, egress, now, options) {
    const steps = answering(planner, access, egress, now, options);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}

/**
 * The same answer a departure at a time: it pauses after each, so the Trip
 * page can stop it for another trip (tools/trip/client/searcher.js)
 * @param {Planner} planner @param {number[]} access @param {number[]} egress @param {number} now @param {Options} [options]
 * @returns {Generator<void, Answer>}
 */
export function* answering(planner, access, egress, now, { window = WINDOW_SECONDS, step = STEP_SECONDS, walkLimit, badDay = planner } = {}) {
    const departures = [];
    for (let at = now; at <= now + window; at += step) departures.push(at);
    const byKey = new Map();
    for (const [d, at] of departures.entries()) {
        for (const found of fold(findWays(planner, access, egress, at, { walkLimit }))) {
            const way = { ...found, cost: cost(badDay, found, at, access, egress) };
            const key = rowKey(planner, way);
            if (!byKey.has(key)) byKey.set(key, { key, best: departures.map(() => null), lines: new Set(), onward: new Set(), buses: new Set(), stops: new Map() });
            const row = byKey.get(key);
            const last = way.legs.at(-1);
            if (way.legs.length > 1) row.onward.add(way.legs[1].line);
            if (lastIsBus(way)) {
                row.lines.add(last.line);
                row.buses.add(`${last.line} ${last.boards}`);
                const walk = way.legs.length > 1 ? last.walkBefore : secondsTo(access, last.board);
                if (!row.stops.has(last.board)) row.stops.set(last.board, { stop: last.board, walk, lines: new Set() });
                row.stops.get(last.board).lines.add(last.line);
            }
            if (!row.best[d] || way.at < row.best[d].at) row.best[d] = way;
        }
        yield;
    }
    const fastest = departures.map((_, d) => Math.min(...[...byKey.values()].map(({ best }) => best[d]?.at ?? Infinity)));

    /** @type {Row[]} */
    const rows = [...byKey.values()].map(({ key, best, lines, onward, buses, stops }) => {
        const found = best.map((way, d) => way && way.at - departures[d]).filter(seconds => seconds !== null).sort((a, b) => a - b);
        // A departure it isn't found for costs all there is: one that's rarely there sinks
        const costs = best.map(way => way?.cost ?? Infinity).sort((a, b) => a - b);
        const leaving = [...buses].map(bus => Number(bus.split(' ')[1])).sort((a, b) => a - b);
        return {
            key, best, lines: [...lines].sort(), onward: [...onward].sort(), bundle: lines.size > 1,
            way: best.find(Boolean),
            range: /** @type {[number, number]} */ ([quantile(found, RANGE_TAIL), quantile(found, 1 - RANGE_TAIL)].map(s => Math.round(s / 60))),
            every: leaving.length > 1 ? Math.round((leaving.at(-1) - leaving[0]) / (leaving.length - 1)) : null,
            first: best.filter((way, d) => way?.at === fastest[d]).length / departures.length,
            close: best.filter((way, d) => way && way.at <= fastest[d] + TIE_SECONDS).length / departures.length,
            cost: quantile(costs, 0.5),
            stops: [...stops.values()].map(({ stop, walk, lines: at }) => ({ stop, walk, lines: [...at].sort() })).sort((a, b) => a.walk - b.walk),
        };
    }).sort((a, b) => a.cost - b.cost || b.close - a.close);
    if (!rows.length) return { kind: 'none', rows, departures };

    const decision = decisionIn(rows, departures);
    if (decision) return { kind: 'decision', rows, departures, decision };
    const clear = rows.reduce((most, row) => row.close > most.close ? row : most);
    if (clear.close >= CLEAR_SHARE) return { kind: 'clear', rows, departures, clear };
    return { kind: 'depends', rows, departures };
}

// Two rows on the same first ride, a train or a bus, one leaving it sooner for
// a bus and one staying on, each beating the other by more than a tie often enough: the
// directions stay on, and the rider is offered the bus when OASA has it coming
// in time (quickerWay).
// One that's never much worse needs no decision, and a train onward is in the
// timetable, so the search decides that before anyone leaves
/** @param {Row[]} rows @param {number[]} departures @returns {Decision | null} */
function decisionIn(rows, departures) {
    const often = rows.filter(row => row.close >= DECISION_SHARE);
    const share = (a, b) => departures.filter((_, d) => a.best[d] && (!b.best[d] || b.best[d].at - a.best[d].at >= TIE_SECONDS)).length / departures.length;
    for (const [i, a] of often.entries()) {
        for (const b of often.slice(i + 1)) {
            const d = departures.findIndex((_, j) => sameFirstRide(a.best[j], b.best[j]) && byBus(a.best[j], b.best[j]));
            if (d < 0 || share(a, b) < DECISION_SHARE || share(b, a) < DECISION_SHARE) continue;
            const [getOff, stayOn] = a.best[d].legs[0].arrives < b.best[d].legs[0].arrives ? [a, b] : [b, a];
            const off = getOff.best[d];
            const [, onward] = off.legs;
            // From the onward bus leaving to the door takes the same whenever it leaves
            const latest = stayOn.best[d].at - (off.at - onward.boards);
            const ready = off.legs[0].arrives + (onward.walkBefore ? onward.walkBefore + AFTER_WALK_SECONDS : CHANGE_SECONDS);
            return { stayOn, getOff, stop: onward.board, lines: getOff.onward, ready, latest, reaches: off.legs[0].arrives };
        }
    }
    return null;
}

// Both ways start on the same train or bus, and one leaves it sooner
const sameFirstRide = (a, b) => Boolean(a && b && a.legs.length > 1 && b.legs.length > 1)
    && a.legs[0].line === b.legs[0].line && a.legs[0].board === b.legs[0].board && a.legs[0].boards === b.legs[0].boards
    && a.legs[0].alight !== b.legs[0].alight;

// The one that leaves the first ride sooner does it for a bus
const byBus = (a, b) => ON_THE_ROAD.has((a.legs[0].arrives < b.legs[0].arrives ? a : b).legs[1].mode);

// How much later a bus predicted `ahead` seconds out comes, as a rule
/** @param {number} ahead */
export const lateness = ahead => LATENESS.find(([upTo]) => ahead <= upTo)[1];

/**
 * Whether to offer the rider a quicker way: the directions stay on the first
 * ride, and say nothing of the decision. Only a bus that comes in time, late as
 * buses are that far out, and saves a tie or more is offered, for the rider to
 * take or not; no prediction doesn't mean no bus, but it isn't one to wait for.
 * From what OASA predicts at the decision's stop, asked at `asked`. When the
 * first ride is a bus, `here` is when OASA has the rider's own bus due at the
 * change: as late as it is, getting there and staying on are both later.
 * Staying on may be later still, if it misses a train, so this can only offer
 * too little, never too much. sooner: seconds it saves on staying on.
 * @param {Pick<Decision, 'lines' | 'ready' | 'latest'> & { reaches?: number }} decision
 * @param {{ line: string, at: number }[]} predictions when each bus is due at the stop, seconds from midnight
 * @param {number} asked
 * @param {{ here?: number }} [live]
 * @returns {{ offer: boolean, why: 'quicker' | 'not-quicker' | 'missed' | 'none', line?: string, at?: number, sooner?: number }}
 */
export function quickerWay({ lines, ready, latest, reaches }, predictions, asked, { here } = {}) {
    const late = here === undefined ? 0 : Math.max(0, here + lateness(here - asked) - reaches);
    const ours = predictions.filter(({ line }) => lines.includes(line)).sort((a, b) => a.at - b.at);
    if (!ours.length) return { offer: false, why: 'none' };
    const caught = ours.filter(({ at }) => at >= ready + late);
    if (!caught.length) return { offer: false, why: 'missed' };
    const [bus] = caught;
    // Staying on gets there `latest` plus the ride; so does this bus, leaving when it's due
    const sooner = latest + late - (bus.at + lateness(bus.at - asked));
    return { offer: sooner >= TIE_SECONDS, why: sooner >= TIE_SECONDS ? 'quicker' : 'not-quicker', ...bus, sooner };
}
