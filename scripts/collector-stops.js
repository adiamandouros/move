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
const SYNTAGMA = [37.9755, 23.7348];
// A stretch between two asked stops counts if it's this long: shorter ones
// are lost in the minute OASA rounds to, longer ones mix too many roads
export const STRETCH_KM = [1, 6];
// Areas served mainly by buses, each given a measured stretch in the first week
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

export const km = (p, q) => Math.hypot((p[1] - q[1]) * 88, (p[0] - q[0]) * 111);

/**
 * @param {{ stops: Record<string, [number, number, string]>, routes: { line: string, stops: string[], trips: [number, number][] }[] }} buses
 *   one weekday of buses (build-buses.js)
 * @param {Set<string>} live the stop codes OASA's live network has
 * @returns {string[][]} the stop codes of each week
 */
export function pickWeeks(buses, live, { weeks = WEEKS, perWeek = PER_WEEK, areas = AREAS } = {}) {
    const routes = buses.routes.map(r => {
        const edges = r.stops.slice(1).map((s, i) => km(buses.stops[r.stops[i]], buses.stops[s]));
        const cum = [0];
        for (const e of edges) cum.push(cum.at(-1) + e);
        const trips = r.trips.filter(([start]) => RUSH.some(([from, to]) => start >= from && start < to)).length;
        return { stops: r.stops, idx: new Map(r.stops.map((s, i) => [s, i])), edges, cum, trips, covered: new Uint8Array(edges.length) };
    }).filter(r => r.trips);
    const through = new Map();
    for (const r of routes) for (const s of r.stops) (through.get(s) ?? through.set(s, []).get(s)).push(r);
    const candidates = [...through.keys()].filter(s => live.has(s) && km(buses.stops[s], SYNTAGMA) <= AROUND_KM).sort();

    // The edges a route's stretches between these stops cover, as [from, to) of edge indexes
    const stretches = (r, at) => {
        const out = [];
        for (let k = 1; k < at.length; k++) {
            const d = r.cum[at[k]] - r.cum[at[k - 1]];
            if (d >= STRETCH_KM[0] && d <= STRETCH_KM[1]) out.push([at[k - 1], at[k]]);
        }
        return out;
    };
    // Rush trips x km not measured yet, on these stretches
    const fresh = (r, spans, week) => {
        let v = 0;
        for (const [a, b] of spans) for (let e = a; e < b; e++) if (!r.covered[e] && !week[e]) v += r.trips * r.edges[e];
        return v;
    };

    const asked = new Set(candidates);
    // Per route through s, the most a stretch from s to another stop could measure that isn't yet
    const potential = s => through.get(s).reduce((sum, r) => {
        const i = r.idx.get(s);
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
        const chosen = [];
        // Per route: this week's stop indexes, and the edges they cover
        const at = new Map(routes.map(r => [r, []]));
        const weekCover = new Map(routes.map(r => [r, new Uint8Array(r.edges.length)]));
        const gain = s => through.get(s).reduce((sum, r) => {
            const now = stretches(r, at.get(r));
            const next = stretches(r, [...at.get(r), r.idx.get(s)].sort((x, y) => x - y));
            // Only what adding s newly covers
            const before = fresh(r, now, new Uint8Array(r.edges.length));
            return sum + fresh(r, next, new Uint8Array(r.edges.length)) - before;
        }, 0);
        const add = s => {
            chosen.push(s);
            for (const r of through.get(s)) {
                at.get(r).push(r.idx.get(s));
                at.get(r).sort((x, y) => x - y);
                const cover = weekCover.get(r);
                for (const [a, b] of stretches(r, at.get(r))) for (let e = a; e < b; e++) cover[e] = 1;
            }
        };
        // Its best partner: the stop that measures the most together with it
        const bestBy = (pool, score) => pool.reduce((best, s) => {
            const v = score(s);
            return v > best.v ? { s, v } : best;
        }, { s: null, v: 0 }).s;

        if (w === 0) {
            for (const p of Object.values(areas)) {
                const near = candidates.filter(s => !chosen.includes(s) && km(buses.stops[s], p) <= AREA_KM);
                // The area's busiest stop, then the stop that measures most with it
                const busiest = bestBy(near, s => through.get(s).reduce((n, r) => n + r.trips, 0));
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
            const cover = weekCover.get(r);
            for (let e = 0; e < cover.length; e++) if (cover[e]) r.covered[e] = 1;
        }
        result.push(chosen);
    }
    return result;
}

// Rush trips x km within AROUND_KM, and the share these weeks measure
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
    const buses = JSON.parse(readFileSync(busesFile, 'utf8'));
    const network = JSON.parse(readFileSync(networkFile, 'utf8'));
    const live = new Set(Object.values(network.stops).flatMap(r => r.stops.map(s => s.code)));
    const weeks = pickWeeks(buses, live);
    const names = Object.fromEntries(weeks.flat().sort().map(s => [s, buses.stops[s][2]]));
    const out = fileURLToPath(new URL('../server/oasa/collector-stops.json', import.meta.url));
    writeFileSync(out, `${JSON.stringify({ made: new Date().toISOString().slice(0, 10), weeks, names }, null, 1)}\n`);
    weeks.forEach((w, i) => console.log(`week ${i + 1}: ${(100 * coverage(buses, weeks.slice(0, i + 1))).toFixed(0)}% of rush-hour bus-km within ${AROUND_KM} km measured`));
    console.log(`Written to ${out}`);
}
