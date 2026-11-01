// Where the buses go today, with the times of the August feed. OASA's live
// network (data/raw/oasa/network.json) has every route, all 706, and is
// up to date: the feed is only used for when they run. Reading it asks OASA for
// nothing: the nightly data build keeps it.
//
// Each of the feed's stop lists goes on the live route of its line it shares
// the most with. A stop that's moved is mended, not the reason to lose the
// row: the times of the stops both have stay, and a stop only the live route
// has gets its time from how far along the road it is.

import { STOP_CODE } from '../../server/data/check-output.js';
import { meters } from '../../server/places/search.js';

// How much of two stop lists has to be the same for them to be one route
// (twice the shared stops over both lengths): the worst real match is 0.57
const SAME_ROUTE = 0.5;

const round = n => Math.round(n * 1e5) / 1e5;
const variant = route => route.name.includes('[');

/** @typedef {import('./network.js').Buses} Buses */
/** @typedef {{ line: string, code: string, name: string, stops: { code: string, el: string, lat: number, lng: number }[] }} LiveRoute */

// Every route with two stops or more. Line numbers can have spaces around them
/** @param {any} network @returns {LiveRoute[]} */
export function liveRoutes({ lines, routes, stops }) {
    return lines.flatMap(({ code, line }) => (routes[code] ?? []).map(route => ({
        line: line.trim(), code: route.code, name: route.name.el,
        stops: (stops[route.code]?.stops ?? []).filter(stop => STOP_CODE.test(stop.code)),
    }))).filter(route => route.stops.length >= 2);
}

// The stops two lists share in order, as many as there are: [[i, j]…]. In order
// so that a route the other way, or round a loop, doesn't count as the same
/** @param {string[]} a @param {string[]} b @returns {[number, number][]} */
export function shared(a, b) {
    const longest = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            longest[i][j] = a[i] === b[j] ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1]);
        }
    }
    /** @type {[number, number][]} */
    const pairs = [];
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
        if (a[i] === b[j]) pairs.push([i++, j++]);
        else if (longest[i + 1][j] >= longest[i][j + 1]) i++;
        else j++;
    }
    return pairs;
}

// The live route a list of the feed's stops belongs to, the plain one if a
// variant with a note in brackets fits as well
function bestRoute(stops, routes) {
    let best = null;
    for (const route of routes) {
        const codes = route.stops.map(stop => stop.code);
        const pairs = shared(stops, codes);
        const score = 2 * pairs.length / (stops.length + codes.length);
        if (score < SAME_ROUTE) continue;
        if (!best || score > best.score || (score === best.score && variant(best.route) && !variant(route))) best = { route, pairs, score };
    }
    return best;
}

// A trip's seconds at each live stop, from its seconds at the feed's stops.
// Past either end of what's shared, at the speed of the whole trip
/** @param {number[]} offsets @param {[number, number][]} pairs @param {number[]} along meters along the live route */
export function retimed(offsets, pairs, along) {
    const known = pairs.map(([stop, live]) => ({ time: offsets[stop], at: along[live] }));
    const first = known[0];
    const last = known.at(-1);
    const pace = last.at > first.at ? (last.time - first.time) / (last.at - first.at) : 0;
    let next = 0;
    return along.map(at => {
        while (next < known.length && known[next].at < at) next++;
        const after = known[next];
        const before = known[next - 1];
        if (after?.at === at) return after.time;
        if (!before) return Math.round(first.time - (first.at - at) * pace);
        if (!after) return Math.round(last.time + (at - last.at) * pace);
        return Math.round(before.time + (at - before.at) * (after.time - before.time) / (after.at - before.at));
    });
}

/**
 * The feed's day of buses on today's routes. gone: lines of the feed no live
 * route carries; untimed: live routes the feed has no times for, which can't
 * be searched: a market-day diversion, or a line newer than the feed.
 * @param {Buses} buses @param {any} network
 * @returns {{ buses: Buses, gone: string[], untimed: LiveRoute[] }}
 */
export function onLiveRoutes(buses, network) {
    const live = liveRoutes(network);
    const ofLine = new Map();
    for (const route of live) ofLine.set(route.line, [...ofLine.get(route.line) ?? [], route]);
    const timed = new Set();
    const gone = new Set();
    const routes = [];
    const stops = new Map();
    for (const { line, mode, stops: codes, profiles, trips } of buses.routes) {
        const best = bestRoute(codes, ofLine.get(line.trim()) ?? []);
        if (!best) {
            gone.add(line.trim());
            continue;
        }
        const { route, pairs } = best;
        timed.add(route.code);
        let walked = 0;
        const along = route.stops.map((stop, i) => (walked += i ? meters(route.stops[i - 1], stop) : 0));
        const onRoute = profiles.map(offsets => retimed(offsets, pairs, along));
        routes.push({
            line: line.trim(), mode, stops: route.stops.map(stop => stop.code),
            profiles: onRoute.map(offsets => offsets.map(offset => offset - offsets[0])),
            trips: trips.map(([start, profile]) => /** @type {[number, number]} */ ([start + onRoute[profile][0], profile])),
        });
        for (const stop of route.stops) stops.set(stop.code, [round(stop.lat), round(stop.lng), stop.el]);
    }
    return {
        buses: { ...buses, stops: Object.fromEntries([...stops].sort(([a], [b]) => a.localeCompare(b))), routes },
        gone: [...gone],
        untimed: live.filter(route => !timed.has(route.code)),
    };
}
