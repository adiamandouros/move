// The stops the bus-pass collector asks for (server/oasa/collector.js), a set
// of 30 for each week, chosen so that two of a week's stops on the same line
// measure as much rush-hour bus travel as possible: a ride between them is
// timed by the same bus passing both (server/oasa/passes.js). Decision 26.
//
//   node scripts/planner-lab/build-buses.js data/local/planner-lab/buses.json
//   node scripts/collector-stops.js data/local/planner-lab/buses.json data/raw/oasa/network.json
//
// It writes server/oasa/collector-stops.json. Only Node's own modules.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

export const WEEKS = 10;
export const PER_WEEK = 30;
// Only stops this close to Syntagma are asked for
export const AROUND_KM = 8;
/** @type {LatLng} */
const SYNTAGMA = [37.9755, 23.7348];
// A stretch between two asked stops counts if it's this long: shorter ones
// are lost in the minute OASA rounds to, longer ones mix too many roads
export const STRETCH_KM = [1, 6];
// Areas served mainly by buses, each given a measured stretch in the first week
/** @type {Record<string, LatLng>} */
export const AREAS = {
    Kypseli: [38.0005, 23.7400],
    Patisia: [38.0135, 23.7340],
    Galatsi: [38.0170, 23.7560],
    Vyronas: [37.9600, 23.7530],
    Zografou: [37.9770, 23.7700],
};
const AREA_KM = 0.7;
// Weekday rush hours, as the collector asks (Athens time, seconds)
const RUSH = [[7 * 3600, 10 * 3600], [16 * 3600, 20 * 3600]];

/**
 * A point first in a list: [lat, lng], or a stop's [lat, lng, name]
 * @typedef {[number, number, ...unknown[]]} LatLng
 * One weekday of buses (build-buses.js), as much of it as is read here
 * @typedef {{ stops: Record<string, [number, number, string]>, routes: { line: string, stops: string[], trips: [number, number][] }[] }} DayBuses
 * A route with rush trips: its stops and where each is in it, the length of
 * each edge between two stops and how far along each stop is (km), its rush
 * trips, and the edges earlier weeks measure
 * @typedef {{ stops: string[], idx: Map<string, number>, edges: number[], cum: number[], trips: number, covered: Uint8Array }} Route
 */

/** @param {LatLng} p @param {LatLng} q */
export const km = (p, q) => Math.hypot((p[1] - q[1]) * 88, (p[0] - q[0]) * 111);

/**
 * @param {DayBuses} buses one weekday of buses (build-buses.js)
 * @param {Set<string>} live the stop codes OASA's live network has
 * @returns {string[][]} the stop codes of each week
 */
export function pickWeeks(buses, live, { weeks = WEEKS, perWeek = PER_WEEK, areas = AREAS } = {}) {
    /** @type {Route[]} */
    const routes = buses.routes.map(r => {
        const edges = r.stops.slice(1).map((s, i) => km(buses.stops[r.stops[i]], buses.stops[s]));
        const cum = [0];
        for (const e of edges) cum.push(cum[cum.length - 1] + e);
        const trips = r.trips.filter(([start]) => RUSH.some(([from, to]) => start >= from && start < to)).length;
        return { stops: r.stops, idx: new Map(r.stops.map((s, i) => [s, i])), edges, cum, trips, covered: new Uint8Array(edges.length) };
    }).filter(r => r.trips);
    /** @type {Map<string, Route[]>} */
    const through = new Map();
    for (const r of routes) {
        for (const s of r.stops) {
            let list = through.get(s);
            if (!list) through.set(s, list = []);
            list.push(r);
        }
    }
    // Asked only of a stop with routes through it (the candidates are those)
    const routesThrough = (/** @type {string} */ s) => /** @type {Route[]} */ (through.get(s));
    // Where a stop is in a route through it
    const indexIn = (/** @type {Route} */ r, /** @type {string} */ s) => /** @type {number} */ (r.idx.get(s));
    const candidates = [...through.keys()].filter(s => live.has(s) && km(buses.stops[s], SYNTAGMA) <= AROUND_KM).sort();

    // The edges a route's stretches between these stops cover, as [from, to) of edge indexes
    /** @param {Route} r @param {number[]} at */
    const stretches = (r, at) => {
        /** @type {[number, number][]} */
        const out = [];
        for (let k = 1; k < at.length; k++) {
            const d = r.cum[at[k]] - r.cum[at[k - 1]];
            if (d >= STRETCH_KM[0] && d <= STRETCH_KM[1]) out.push([at[k - 1], at[k]]);
        }
        return out;
    };
    // Rush trips x km not measured yet, on these stretches
    /** @param {Route} r @param {[number, number][]} spans @param {Uint8Array} week */
    const fresh = (r, spans, week) => {
        let v = 0;
        for (const [a, b] of spans) for (let e = a; e < b; e++) if (!r.covered[e] && !week[e]) v += r.trips * r.edges[e];
        return v;
    };

    const asked = new Set(candidates);
    // Per route through s, the most a stretch from s to another stop could measure that isn't yet
    const potential = (/** @type {string} */ s) => routesThrough(s).reduce((sum, r) => {
        const i = indexIn(r, s);
        let most = 0;
        r.stops.forEach((other, j) => {
            if (j === i || !asked.has(other)) return;
            const [a, b] = i < j ? [i, j] : [j, i];
            const d = r.cum[b] - r.cum[a];
            if (d >= STRETCH_KM[0] && d <= STRETCH_KM[1]) most = Math.max(most, fresh(r, [[a, b]], new Uint8Array(r.edges.length)));
        });
        return sum + most;
    }, 0);

    const result = [];
    for (let w = 0; w < weeks; w++) {
        /** @type {string[]} */
        const chosen = [];
        // Per route: this week's stop indexes, and the edges they cover
        // (every route is in both)
        const at = new Map(routes.map(r => [r, /** @type {number[]} */ ([])]));
        const weekCover = new Map(routes.map(r => [r, new Uint8Array(r.edges.length)]));
        const atOf = (/** @type {Route} */ r) => /** @type {number[]} */ (at.get(r));
        const coverOf = (/** @type {Route} */ r) => /** @type {Uint8Array} */ (weekCover.get(r));
        const gain = (/** @type {string} */ s) => routesThrough(s).reduce((sum, r) => {
            const now = stretches(r, atOf(r));
            const next = stretches(r, [...atOf(r), indexIn(r, s)].sort((x, y) => x - y));
            // Only what adding s newly covers
            const before = fresh(r, now, new Uint8Array(r.edges.length));
            return sum + fresh(r, next, new Uint8Array(r.edges.length)) - before;
        }, 0);
        const add = (/** @type {string} */ s) => {
            chosen.push(s);
            for (const r of routesThrough(s)) {
                atOf(r).push(indexIn(r, s));
                atOf(r).sort((x, y) => x - y);
                const cover = coverOf(r);
                for (const [a, b] of stretches(r, atOf(r))) for (let e = a; e < b; e++) cover[e] = 1;
            }
        };
        // Its best partner: the stop that measures the most together with it
        /** @param {string[]} pool @param {(s: string) => number} score */
        const bestBy = (pool, score) => pool.reduce((best, s) => {
            const v = score(s);
            return v > best.v ? { s, v } : best;
        }, { s: /** @type {string | null} */ (null), v: 0 }).s;

        if (w === 0) {
            for (const p of Object.values(areas)) {
                const near = candidates.filter(s => !chosen.includes(s) && km(buses.stops[s], p) <= AREA_KM);
                // The area's busiest stop, then the stop that measures most with it
                const busiest = bestBy(near, s => routesThrough(s).reduce((n, r) => n + r.trips, 0));
                if (!busiest) continue;
                add(busiest);
                const partner = bestBy(candidates.filter(s => !chosen.includes(s)), gain);
                if (partner) add(partner);
            }
        }
        while (chosen.length < perWeek) {
            const pool = candidates.filter(s => !chosen.includes(s));
            let next = bestBy(pool, gain);
            // No one stop adds anything (a week's first): the one that could
            // start the stretch measuring most, with a partner still to come
            next ??= bestBy(pool, potential);
            if (!next) break;
            add(next);
        }
        for (const r of routes) {
            const cover = coverOf(r);
            for (let e = 0; e < cover.length; e++) if (cover[e]) r.covered[e] = 1;
        }
        result.push(chosen);
    }
    return result;
}

// Rush trips x km within AROUND_KM, and the share these weeks measure
/** @param {DayBuses} buses @param {string[][]} weeks */
export function coverage(buses, weeks) {
    const sets = weeks.map(w => new Set(w));
    let all = 0, measured = 0;
    for (const r of buses.routes) {
        const trips = r.trips.filter(([start]) => RUSH.some(([from, to]) => start >= from && start < to)).length;
        if (!trips) continue;
        const covered = new Uint8Array(r.stops.length - 1);
        for (const set of sets) {
            const at = r.stops.flatMap((s, i) => set.has(s) ? [i] : []);
            for (let k = 1; k < at.length; k++) {
                let d = 0;
                for (let e = at[k - 1]; e < at[k]; e++) d += km(buses.stops[r.stops[e]], buses.stops[r.stops[e + 1]]);
                if (d >= STRETCH_KM[0] && d <= STRETCH_KM[1]) for (let e = at[k - 1]; e < at[k]; e++) covered[e] = 1;
            }
        }
        r.stops.slice(1).forEach((s, e) => {
            const from = buses.stops[r.stops[e]], to = buses.stops[s];
            if (km(from, SYNTAGMA) > AROUND_KM || km(to, SYNTAGMA) > AROUND_KM) return;
            const d = trips * km(from, to);
            all += d;
            if (covered[e]) measured += d;
        });
    }
    return all ? measured / all : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [busesFile, networkFile] = process.argv.slice(2);
    if (!busesFile || !networkFile) {
        console.error('Usage: collector-stops.js <buses.json> <network.json>');
        process.exit(2);
    }
    /** @type {DayBuses} */
    const buses = JSON.parse(readFileSync(busesFile, 'utf8'));
    /** @type {import('../server/data/oasa-network.js').Network} */
    const network = JSON.parse(readFileSync(networkFile, 'utf8'));
    const live = new Set(Object.values(network.stops).flatMap(r => r.stops.map(s => s.code)));
    const weeks = pickWeeks(buses, live);
    const names = Object.fromEntries(weeks.flat().sort().map(s => [s, buses.stops[s][2]]));
    const out = fileURLToPath(new URL('../server/oasa/collector-stops.json', import.meta.url));
    writeFileSync(out, `${JSON.stringify({ made: new Date().toISOString().slice(0, 10), weeks, names }, null, 1)}\n`);
    weeks.forEach((w, i) => console.log(`week ${i + 1}: ${(100 * coverage(buses, weeks.slice(0, i + 1))).toFixed(0)}% of rush-hour bus-km within ${AROUND_KM} km measured`));
    console.log(`Written to ${out}`);
}
