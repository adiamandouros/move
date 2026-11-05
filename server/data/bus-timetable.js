import { join } from 'path';
import { latinName } from '../../public/js/core/text.js';
import { meters } from '../places/search.js';
import { STOP_CODE } from './check-output.js';
import { readCsv } from './csv.js';

// The buses' timetable for the trip search (roadmap Plan 7, decision 30).
//
// OASA's open-data bus timetable stopped in August 2026, and its trips and
// stop times now come as RAR archives, which the data build doesn't open
// (sources.js). Its week is kept in the repository instead, converted once
// (scripts/bus-feed.js → data/oasa/bus-timetable.json, weekFromFeed below):
// {
//   schema, feed: { modified, validFrom, validTo },
//   routes: [{ line: '040', mode: 'bus' | 'trolley', stops: ['10361', …],
//              profiles: [[0, 95, …]], patterns: [[[start, profile], …], …], days: [7 patterns, 0 = Sunday] }, …]
// }
// A trip leaves the first stop at `start` (seconds after midnight, more than
// 86400 after midnight) and reaches stops[i] at start + profiles[profile][i].
// Days with the same trips share a pattern.
//
// Every night buildBuses puts it on the routes of OASA's live network, which
// is up to date where the feed isn't (onLiveRoutes), and takes the ride times
// the server has measured where there are enough (withRides, decision 26), for
// buses.json, the browser's, in half the room once gzipped (about 310 KB):
// {
//   schema, feed,
//   stops:  [['10361', 37.97491, 23.73488, 'ΣΥΝΤΑΓΜΑ', ''], …],   `en` as in bus-stops.json
//   routes: [{ line, mode, code: OASA's route, stops: [index into stops, …],
//              runs: [[90, 30, …]], patterns: [[[after, run], …], …], days }, …]
// }
// A run is a profile as the seconds from each stop to the next, to the 10 s
// as the metro's are, and a trip leaves its first stop `after` seconds after
// the trip before it (the first, after midnight).

export const TIMETABLE_SCHEMA = 1;
export const BUSES_SCHEMA = 1;
const TROLLEY = '11';
// The feed's services: day_1 is Monday … day_7 Sunday
const SERVICE = /^day_([1-7])$/;
// How much of two stop lists has to be the same for them to be one route
// (twice the shared stops over both lengths): the worst real match is 0.57
const SAME_ROUTE = 0.5;
// Fewer measured rides than this at an hour say too little
export const MIN_RIDES = 3;
const KINDS = ['su', 'wd', 'wd', 'wd', 'wd', 'wd', 'sa'];

const round = n => Math.round(n * 1e5) / 1e5;
const variant = route => route.name.includes('[');
const seconds = time => {
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600 + m * 60 + s;
};
const isoDate = yyyymmdd => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}`;
// A stop's English name where it isn't its Greek one in Latin letters, else ''
const ownEnglish = stop => stop.en && stop.en !== latinName(stop.el) ? stop.en : '';

/** @typedef {[number, number]} Trip [start, profile] */
/** @typedef {{ line: string, mode: string, code?: string, stops: string[], profiles: number[][], patterns: Trip[][], days: number[] }} WeekRoute */
/** @typedef {{ schema: number, feed: { modified: string, validFrom: string, validTo: string }, routes: WeekRoute[] }} Week */

// A week of trips, [start, profile] by weekday, as patterns shared by the days with the same trips
/** @param {Trip[][]} week */
function patternsOf(week) {
    const patterns = [];
    const known = new Map();
    const days = week.map(trips => {
        const key = JSON.stringify(trips.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
        if (!known.has(key)) known.set(key, patterns.push(trips) - 1);
        return known.get(key);
    });
    return { patterns, days };
}

/**
 * The feed's week, from its files in `dir`: each route's stop lists, with the
 * trips that call at the same stops in the same times sharing a profile.
 * `modified`: when it was published (YYYY-MM-DD).
 * @param {string} dir @param {string} modified @returns {Promise<Week>}
 */
export async function weekFromFeed(dir, modified) {
    const lineOf = new Map();
    for await (const route of readCsv(join(dir, 'routes.txt'), { required: ['route_id', 'route_short_name', 'route_type'] })) {
        lineOf.set(route.route_id, { line: route.route_short_name.trim(), mode: route.route_type === TROLLEY ? 'trolley' : 'bus' });
    }
    let validFrom = '99999999';
    let validTo = '';
    for await (const service of readCsv(join(dir, 'calendar.txt'), { required: ['service_id', 'start_date', 'end_date'] })) {
        if (!SERVICE.test(service.service_id)) continue;
        if (service.start_date < validFrom) validFrom = service.start_date;
        if (service.end_date > validTo) validTo = service.end_date;
    }
    const tripOf = new Map();
    for await (const trip of readCsv(join(dir, 'trips.txt'), { required: ['route_id', 'service_id', 'trip_id'] })) {
        const day = SERVICE.exec(trip.service_id);
        if (day && lineOf.has(trip.route_id)) tripOf.set(trip.trip_id, { route: trip.route_id, weekday: Number(day[1]) % 7 });
    }
    const calls = new Map();
    for await (const call of readCsv(join(dir, 'stop_times.txt'), { required: ['trip_id', 'arrival_time', 'stop_id', 'stop_sequence'] })) {
        if (!tripOf.has(call.trip_id)) continue;
        if (!calls.has(call.trip_id)) calls.set(call.trip_id, []);
        calls.get(call.trip_id).push([Number(call.stop_sequence), call.stop_id, seconds(call.arrival_time)]);
    }

    const routes = new Map();
    for (const [trip, along] of calls) {
        if (along.length < 2) continue;
        along.sort((a, b) => a[0] - b[0]);
        const { route: id, weekday } = tripOf.get(trip);
        const stops = along.map(([, stop]) => stop);
        const key = `${id}|${stops.join()}`;
        if (!routes.has(key)) routes.set(key, { ...lineOf.get(id), stops, shapes: new Map(), week: Array.from({ length: 7 }, () => []) });
        const route = routes.get(key);
        const shape = along.map(([, , time]) => time - along[0][2]).join();
        if (!route.shapes.has(shape)) route.shapes.set(shape, route.shapes.size);
        route.week[weekday].push([along[0][2], route.shapes.get(shape)]);
    }
    return {
        schema: TIMETABLE_SCHEMA,
        feed: { modified, validFrom: isoDate(validFrom), validTo: isoDate(validTo) },
        routes: [...routes.values()]
            .sort((a, b) => a.line.localeCompare(b.line) || a.stops.join().localeCompare(b.stops.join()))
            .map(({ line, mode, stops, shapes, week }) => ({
                line, mode, stops,
                profiles: [...shapes.keys()].map(shape => shape.split(',').map(Number)),
                ...patternsOf(week),
            })),
    };
}

/** @typedef {{ line: string, code: string, name: string, stops: { code: string, el: string, en: string, lat: number, lng: number }[] }} LiveRoute */

// Every route of OASA's live network with two stops or more. Line numbers can have spaces around them
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
 * The feed's routes on today's live ones. Each of the feed's stop lists goes
 * on the live route of its line it shares the most with. A stop that's moved
 * is mended, not the reason to lose the row: the times of the stops both have
 * stay, and a stop only the live route has gets its time from how far along
 * the road it is. gone: lines of the feed no live route carries; untimed:
 * live routes the feed has no times for, which can't be searched: a
 * market-day diversion, or a line newer than the feed.
 * @param {WeekRoute[]} feed @param {any} network
 * @returns {{ routes: (WeekRoute & { code: string })[], gone: string[], untimed: LiveRoute[] }}
 */
export function onLiveRoutes(feed, network) {
    const live = liveRoutes(network);
    const ofLine = new Map();
    for (const route of live) ofLine.set(route.line, [...ofLine.get(route.line) ?? [], route]);
    const timed = new Set();
    const gone = new Set();
    const routes = [];
    for (const { line, mode, stops: codes, profiles, patterns, days } of feed) {
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
            line: line.trim(), mode, code: route.code, stops: route.stops.map(stop => stop.code),
            profiles: onRoute.map(offsets => offsets.map(offset => offset - offsets[0])),
            patterns: patterns.map(trips => trips.map(([start, profile]) => /** @type {Trip} */ ([start + onRoute[profile][0], profile]))),
            days,
        });
    }
    return { routes, gone: [...gone], untimed: live.filter(route => !timed.has(route.code)) };
}

// A trip's seconds at each stop with the measured stretches of `rides` that
// have enough rides at the hour it gets to them on a `kind` of day: it takes
// that long between their two stops, and the stops after move with it
function retimeTrip(profile, start, rides, kind, column, minRides) {
    const offsets = [...profile];
    let done = 0;
    for (const { i, j, times } of rides) {
        // Stretches one after the other; one overlapping a measured one is left
        if (i < done) continue;
        const time = times[`${kind} ${Math.floor((start + offsets[i]) / 3600) % 24}`];
        if (!time || time[0] < minRides) continue;
        const was = offsets[j] - offsets[i];
        const scale = was > 0 ? time[column] / was : 1;
        const shift = time[column] - was;
        for (let k = i + 1; k < offsets.length; k++) {
            offsets[k] = k <= j ? Math.round(offsets[i] + (profile[k] - profile[i]) * scale) : offsets[k] + shift;
        }
        // (an empty stretch in the feed: the time goes on its last stop)
        if (was <= 0) offsets[j] = offsets[i] + time[column];
        done = j;
    }
    return offsets;
}

/**
 * Measured ride times in place of the feed's: where bus-rides.json
 * (build-rides.js) has enough rides for a stretch of a route at that hour, on
 * that kind of day. The feed's times stay everywhere else. Its median is a
 * usual day; with badDay, its slowest tenth, which the planner lab ranks
 * ways by (scripts/planner-lab/weights.js).
 * @param {(WeekRoute & { code?: string })[]} routes
 * @param {{ rides: { route: string, from: string, to: string, times: Record<string, [number, number, number]> }[] }} table
 * @param {{ minRides?: number, badDay?: boolean }} [options]
 * @returns {{ routes: WeekRoute[], retimed: number }} retimed: trips of the week with a measured stretch
 */
export function withRides(routes, table, { minRides = MIN_RIDES, badDay = false } = {}) {
    const column = badDay ? 2 : 1;
    const byRoute = new Map();
    for (const ride of table.rides) (byRoute.get(ride.route) ?? byRoute.set(ride.route, []).get(ride.route)).push(ride);
    let retimed = 0;
    const out = routes.map(route => {
        const rides = (byRoute.get(route.code ?? '') ?? [])
            .map(ride => ({ ...ride, i: route.stops.indexOf(ride.from), j: route.stops.indexOf(ride.to) }))
            .filter(ride => ride.i >= 0 && ride.j > ride.i)
            .sort((a, b) => a.i - b.i || a.j - b.j);
        if (!rides.length) return route;
        const profiles = [];
        const knownProfile = new Map();
        const week = route.days.map((pattern, weekday) => route.patterns[pattern].map(([start, profile]) => {
            const offsets = retimeTrip(route.profiles[profile], start, rides, KINDS[weekday], column, minRides);
            const key = offsets.join();
            if (key !== route.profiles[profile].join()) retimed++;
            if (!knownProfile.has(key)) knownProfile.set(key, profiles.push(offsets) - 1);
            return /** @type {Trip} */ ([start, knownProfile.get(key)]);
        }));
        return { ...route, profiles, ...patternsOf(week) };
    });
    return { routes: out, retimed };
}

// A profile as its seconds to each next stop, to the 10 s, never more than 5 s off
/** @param {number[]} offsets */
const runOf = offsets => offsets.slice(1).map((offset, i) => Math.round(offset / 10) * 10 - Math.round(offsets[i] / 10) * 10);
/** @param {Trip[]} trips */
const afterEach = trips => trips.map(([start, profile], i) => [start - (trips[i - 1]?.[0] ?? 0), profile]);

/**
 * buses.json: the week on today's live routes, with the measured ride times.
 * @param {Week | null} week @param {any} network @param {Parameters<typeof withRides>[1]} rides
 */
export function buildBuses(week, network, rides) {
    if (!network) throw new Error('no bus network from OASA yet');
    if (week?.schema !== TIMETABLE_SCHEMA) throw new Error(`the bus timetable isn't schema ${TIMETABLE_SCHEMA}`);
    const { routes: live, gone, untimed } = onLiveRoutes(week.routes, network);
    const { routes } = withRides(live, rides);
    const place = new Map();
    for (const { stops } of Object.values(network.stops ?? {})) for (const stop of stops) place.set(stop.code, stop);
    const used = [...new Set(routes.flatMap(route => route.stops))].sort();
    const index = new Map(used.map((code, i) => [code, i]));
    return {
        data: {
            schema: BUSES_SCHEMA,
            feed: week.feed,
            stops: used.map(code => {
                const stop = place.get(code);
                return [code, round(stop.lat), round(stop.lng), stop.el, ownEnglish(stop)];
            }),
            routes: routes.map(({ line, mode, code, stops, profiles, patterns, days }) => ({
                line, mode, code, stops: stops.map(stop => index.get(stop)),
                runs: profiles.map(runOf), patterns: patterns.map(afterEach), days,
            })),
        },
        warnings: [
            `${untimed.length} of OASA's routes have no times in the feed, so the search leaves them out`,
            ...gone.length ? [`Lines of the feed OASA no longer runs: ${gone.join(', ')}`] : [],
        ],
    };
}
