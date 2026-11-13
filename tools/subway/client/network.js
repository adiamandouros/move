// Route finding and departure times over rail.json (see server/data/build-rail.js
// for the format). No DOM access, so it can be unit-tested in Node.

import { createPlanner } from './raptor.js';

/**
 * rail.json's metro, or the metro and the tram together (withTram). `walks`:
 * the stations a short walk from each other, with the minutes it takes;
 * `walkExits`: the metro station's exit one goes through, where it's said
 * @typedef {import('../../../types/data.js').Rail & { walks?: Record<string, Record<string, number>>, walkExits?: Record<string, Record<string, number>> }} Rail
 */
/** @typedef {import('../../../types/data.js').Stop} Stop */
/** @typedef {import('../../../types/data.js').Position} Position */
/**
 * A ride on one line, between stop indexes of one direction
 * @typedef {{ line: string, dir: string, from: string, to: string, fromIndex: number, toIndex: number }} Leg
 */
/** @typedef {{ departs: number, arrives: number, isLast: boolean, isSecondLast: boolean, train?: string }} Departure train: a suburban train's number (withSuburban) */
/**
 * legs: the rides, with a change between each two. walkFirst, walkLast: the
 * minutes on foot from where the trip starts to the first leg, and from the
 * last leg to where it ends, when those are other stations
 * @typedef {{ legs: Leg[], walkFirst?: number, walkLast?: number }} Route
 */
/** @typedef {Route & { legs: (Leg & { departures: Departure[] })[], arrives: number | null }} PlannedRoute */
/** @typedef {{ weekday: number, seconds: number, date: string }} AthensTime */
/** @typedef {import('../../../types/data.js').Timetable} Timetable */

const DAY = 86_400;
// Minimum time to change trains at an interchange
const TRANSFER_SECONDS = 180;
// OASA's feed sometimes has near-duplicate trips a few seconds apart
const DUPLICATE_SECONDS = 60;
const MAX_OPTIONS = 3;
// Two changes are enough between any two stations today (a test keeps that
// true); this is how far the search looks
const MAX_CHANGES = 3;
// How much sooner a route has to arrive to be worth another change
const WORTH_A_CHANGE = 300;
// How far the timetable's last train may be from STASY's and still be it
// (the timetable times some trains up to 3 minutes off STASY's)
const LAST_TRAIN_LEEWAY = 300;

// STASY's last train for a leg on one weekday's service, when its stop has
// STASY's hours (rail.json): to the nearest destination at least as far as
// the leg goes. Seconds, null when the trains run all night, or undefined
// when there are no STASY times there.
/** @param {Rail} rail @param {Leg} leg @param {number} weekday */
function stasyLast(rail, leg, weekday) {
    const { stops } = rail.lines[leg.line].directions[leg.dir];
    const to = stops[leg.fromIndex].hours?.find(h => stops.findIndex(s => s.station === h.to) >= leg.toIndex);
    return to ? to.last[weekday] : undefined;
}

// Made once: a new Intl.DateTimeFormat takes about 30 KB outside the
// JavaScript heap, where the garbage collector doesn't feel it, and the
// nightly build asks for every bus ride's hour (build-rides.js). With two
// formatters a call, 10,000 rides took it past the host's memory (9 Nov 2026).
const ATHENS_CLOCK = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});
const ATHENS_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' });

// Current weekday (0 = Sunday) and seconds since midnight in Athens, wherever
// the device's clock is set.
/** @returns {AthensTime} */
export function athensNow(date = new Date()) {
    const parts = Object.fromEntries(ATHENS_CLOCK.formatToParts(date).map(p => [p.type, p.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return { weekday, seconds: +parts.hour * 3600 + +parts.minute * 60 + +parts.second, date: athensDate(date) };
}

export function athensDate(date = new Date()) {
    return ATHENS_DATE.format(date);
}

// The metro and the tram as one network, in rail.json's shape, so everything
// here works on either. rail itself stays as it is, and rail.stations and
// rail.lines the metro alone: that's what the station pages and the checks
// read. Without the tram's timetables (no tram in the build, or a copy from
// before they were added), it's rail.
// Every tram stop is a station of its own, metro stations first. One with a
// metro station's id and name, like Syntagma, gets an id of its own and says
// "(tram)" in its name. Each stop's `walks` go both ways, and `walkExits`
// says which of a metro station's exits one goes through, where tram.json says.
/** @param {Rail} rail @returns {Rail} */
export function withTram(rail) {
    const { tram } = rail;
    const directions = Object.values(tram?.lines ?? {}).flatMap(line => Object.values(line.directions));
    if (!directions.length || !directions.every(direction => direction.timetable)) return rail;

    const clashes = id => Object.hasOwn(rail.stations, id);
    const stationId = id => clashes(id) ? `${id}-tram` : id;
    const stations = { ...rail.stations };
    const walks = {};
    const walkExits = {};
    const addWalk = (a, b, minutes, exit) => {
        (walks[a] ??= {})[b] = minutes;
        (walks[b] ??= {})[a] = minutes;
        if (exit !== undefined) (walkExits[a] ??= {})[b] = (walkExits[b] ??= {})[a] = exit;
    };
    for (const [id, { name, coords, lines, walks: nearby = [] }] of Object.entries(tram.stations)) {
        stations[stationId(id)] = { name: clashes(id) ? { el: `${name.el} (τραμ)`, en: `${name.en} (tram)` } : name, coords, lines, tram: true };
        for (const { metro, stop, minutes, exit } of nearby) addWalk(stationId(id), metro ?? stationId(stop), minutes, exit);
    }
    const lines = { ...rail.lines };
    for (const [id, line] of Object.entries(tram.lines)) {
        lines[id] = {
            ...line,
            tram: true,
            directions: Object.fromEntries(Object.entries(line.directions).map(([dir, direction]) => [dir, {
                ...direction,
                stops: direction.stops.map(({ station }) => ({ station: stationId(station), exits: [] })),
            }])),
        };
    }
    return { ...rail, stations, lines, walks, walkExits };
}

// The stops of trains that end at the same station, in one order: the
// longest train's, with another's stations put in after the one they follow.
// null when two of them pass stations in opposite orders
/** @param {string[][]} sequences @returns {string[] | null} */
function mergeStops(sequences) {
    const [longest, ...others] = [...sequences].sort((a, b) => b.length - a.length);
    const order = [...longest];
    for (const stops of others) {
        stops.forEach((station, i) => {
            if (order.includes(station)) return;
            const before = stops.slice(0, i).findLast(s => order.includes(s));
            order.splice(before ? order.indexOf(before) + 1 : order.indexOf(stops.find(s => order.includes(s))), 0, station);
        });
        const at = stops.map(station => order.indexOf(station));
        if (at.some((index, i) => i && index <= at[i - 1])) return null;
    }
    return order;
}

// The suburban railway joined to `rail` (the metro, or the metro and the
// tram), in rail.json's shape, from trains.json (decision 41), so the planner
// works on it as on the tram. A line's trains go in a direction for each
// station they end at, as a train's direction names where it ends
// (DESIGN.md): its stops are those of every train ending there, in order, and
// each train's own stops a profile of them; each date trains.json holds has
// its trains on that date, and any other day none. Every station a train
// calls at is a row of its own; one with a metro station's or a tram stop's
// id gets an id of its own and says "(suburban)" in its name. Its walks are
// trains.json's, in minutes, and `walkNotes` the notes on them, both ways.
// Each train keeps its number, which its lateness goes by (decision 47).
// Without trains for `date` (or without trains.json), it's rail.
/**
 * @param {Rail} rail @param {import('../../../types/data.js').Trains | null} trains @param {string} date
 * @returns {Rail & { walkNotes?: Record<string, Record<string, import('../../../types/data.js').Names>> }}
 */
export function withSuburban(rail, trains, date) {
    if (!trains?.dates?.[date]?.length) return rail;
    const stationId = id => Object.hasOwn(rail.stations, id) ? `${id}-suburban` : id;

    // Each line's trains by where they end, and those that can't share an order apart
    const groups = [];
    for (const [day, routes] of Object.entries(trains.dates)) {
        for (const route of routes) {
            const end = route.stops.at(-1);
            const mine = groups.filter(group => group.line === route.line && group.end === end);
            let group = mine.find(g => mergeStops([...g.routes.map(r => r.stops), route.stops]));
            if (!group) groups.push(group = { line: route.line, end, dir: mine.length ? `${end}-${mine.length + 1}` : end, routes: [] });
            group.routes.push({ ...route, day });
        }
    }

    const lines = {};
    const calledAt = new Map();
    for (const { line, end, dir, routes } of groups) {
        const order = mergeStops(routes.map(route => route.stops));
        const profiles = [];
        const profileOf = new Map();
        // Pattern 0, with no trains, for the days trains.json doesn't hold
        const patterns = [[]];
        const dates = {};
        for (const { day, stops, profiles: offsets, trips } of routes) {
            const along = stops.map(station => order.indexOf(station));
            if (!(day in dates)) dates[day] = patterns.push([]) - 1;
            for (const [start, p, train] of trips) {
                const key = JSON.stringify([along, offsets[p]]);
                if (!profileOf.has(key)) profileOf.set(key, profiles.push({ stops: along, offsets: offsets[p] }) - 1);
                patterns[dates[day]].push(train ? [start, profileOf.get(key), train] : [start, profileOf.get(key)]);
            }
        }
        patterns.forEach(pattern => pattern.sort((a, b) => a[0] - b[0]));
        for (const station of order) calledAt.set(station, new Set(calledAt.get(station)).add(line));
        const [, , el, en] = trains.stations[end];
        // Its colour is the style sheet's (.line-a1 and the others)
        lines[line] ??= { name: line, color: '', suburban: true, directions: {} };
        lines[line].directions[dir] = {
            toward: { el, en },
            stops: order.map(station => ({ station: stationId(station), exits: [] })),
            timetable: { profiles, patterns, days: [0, 0, 0, 0, 0, 0, 0], dates },
        };
    }

    const outside = new Set(trains.outside);
    const stations = { ...rail.stations };
    for (const [id, line] of calledAt) {
        const [lat, lng, el, en] = trains.stations[id];
        const clash = stationId(id) !== id;
        stations[stationId(id)] = {
            name: clash ? { el: `${el} (Προαστιακός)`, en: `${en} (suburban)` } : { el, en },
            coords: [lat, lng], lines: [...line].sort(), suburban: true, ...(outside.has(id) && { oasaTicket: false }),
        };
    }
    const walks = Object.fromEntries(Object.entries(rail.walks ?? {}).map(([id, near]) => [id, { ...near }]));
    const walkNotes = {};
    const both = (record, a, b, value) => { (record[a] ??= {})[b] = value; (record[b] ??= {})[a] = value; };
    for (const [from, to, seconds, note] of trains.walks) {
        const [a, b] = [from, to].map(stop => stop.startsWith('rail:') ? stop.slice(5) : stationId(stop.slice(6)));
        if (!stations[a] || !stations[b]) continue;
        both(walks, a, b, seconds / 60);
        if (note) both(walkNotes, a, b, note);
    }
    return { ...rail, stations, lines: { ...rail.lines, ...lines }, walks, walkNotes };
}

// The id withSuburban gave trains.json's station `id` in `rail`, joined:
// its own, or with "-suburban" where a metro station or tram stop has it
/** @param {Rail} rail @param {string} id */
export const suburbanStation = (rail, id) => Object.hasOwn(rail.stations, `${id}-suburban`) ? `${id}-suburban` : id;

// Worked out once per network: at each station, the directions that call there
// and where it is among their stops, and the stations a route can change at
// (on two lines or more, or a short walk from another)
const stationsOf = new WeakMap();

/** @param {Rail} rail @returns {{ calls: Map<string, { line: string, dir: string, stops: Stop[], index: number }[]>, changes: Set<string> }} */
function calling(rail) {
    if (stationsOf.has(rail)) return stationsOf.get(rail);
    const calls = new Map();
    for (const [line, { directions }] of Object.entries(rail.lines)) {
        for (const [dir, { stops }] of Object.entries(directions)) {
            stops.forEach(({ station }, index) => {
                if (!calls.has(station)) calls.set(station, []);
                calls.get(station).push({ line, dir, stops, index });
            });
        }
    }
    const changes = new Set(Object.keys(rail.stations).filter(id => rail.stations[id].lines.length > 1 || rail.walks?.[id]));
    stationsOf.set(rail, { calls, changes });
    return stationsOf.get(rail);
}

/** @param {Rail} rail @param {string} id @returns {[string, number][]} */
const walksFrom = (rail, id) => Object.entries(rail.walks?.[id] ?? {});

// Every route from `from` to `to` with at most `limit` changes. It starts and
// ends at those stations or a short walk from them, changes where calling()
// says it can, and never gets off at a station it has already been through,
// so it doesn't ride past a station to come back to it. (A train may pass one
// again: from Acropolis to Faliro by Attiki goes through Omonia on both
// lines.) It may use a line twice, though not the same direction twice in a
// row: round T7's one-way loop in Piraeus, the way from Evangelistria to
// Skylitsi is on to the end of the line and back out. But it doesn't ride back
// over the same line: nobody takes M3 to Piraeus to come back through where
// they started. It doesn't change from one suburban train to another at the
// same station: their lines share track, so every station they share would be
// a change, and thousands of routes to time (decision 41). Those ways are the
// search's (fastestRoutes). On foot it does, across SKA's footbridge.
/** @param {Rail} rail @param {string} from @param {string} to @param {number} limit @returns {Route[]} */
function routesWithin(rail, from, to, limit) {
    const { calls, changes } = calling(rail);
    const ends = new Map([[to, 0], ...walksFrom(rail, to)]);
    const routes = [];
    const rideFrom = (at, seen, legs, walkFirst) => {
        for (const { line, dir, stops, index } of calls.get(at) ?? []) {
            if (legs.at(-1)?.line === line && legs.at(-1).dir === dir) continue;
            if (legs.at(-1)?.to === at && rail.lines[legs.at(-1).line].suburban && rail.lines[line].suburban) continue;
            const ridden = new Set(legs.filter(leg => leg.line === line)
                .flatMap(leg => rail.lines[line].directions[leg.dir].stops.slice(leg.fromIndex, leg.toIndex + 1).map(stop => stop.station)));
            const passed = new Set(seen);
            for (let i = index + 1; i < stops.length; i++) {
                const { station } = stops[i];
                if (ridden.has(station)) break;
                if (seen.has(station)) continue;
                passed.add(station);
                const leg = { line, dir, from: at, to: station, fromIndex: index, toIndex: i };
                if (ends.has(station)) {
                    routes.push({ legs: [...legs, leg], ...(walkFirst && { walkFirst }), ...(ends.get(station) && { walkLast: ends.get(station) }) });
                    if (station === to) break;
                } else if (legs.length < limit && changes.has(station)) {
                    for (const next of [station, ...walksFrom(rail, station).map(([id]) => id)]) {
                        if (next === station || !passed.has(next)) rideFrom(next, new Set(passed).add(next), [...legs, leg], walkFirst);
                    }
                }
            }
        }
    };
    rideFrom(from, new Set([from]), [], 0);
    for (const [start, minutes] of walksFrom(rail, from)) rideFrom(start, new Set([from, start]), [], minutes);
    return routes;
}

// The routes worth timing: those with the fewest changes the trip takes, or
// one more, as a route with another change can still get there first
// (planJourney decides). Routes that arrive together keep the order of the
// stations they change at.
/** @param {Rail} rail @param {string} from @param {string} to @returns {Route[]} */
export function findRoutes(rail, from, to) {
    if (!from || !to || from === to) return [];
    let fewest = 0;
    while (fewest < MAX_CHANGES && !routesWithin(rail, from, to, fewest).length) fewest++;
    const order = new Map(Object.keys(rail.stations).map((id, i) => [id, i]));
    const changedAt = route => route.legs.slice(0, -1).map(leg => order.get(leg.to));
    const byChanges = (a, b) => changedAt(a).reduce((found, at, i) => found || at - (changedAt(b)[i] ?? at), 0);
    return routesWithin(rail, from, to, Math.min(fewest + 1, MAX_CHANGES)).sort(byChanges);
}

// The ISO date `days` days after `date`
/** @param {string} date @param {number} days */
function addDays(date, days) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// A direction's trains, [start, profile]…, on the service day `dayOffset`
// days from `weekday`. With `date` (that weekday's, ISO), a day the timetable
// has its own trains for (a holiday) uses them; otherwise its weekday's.
/** @param {Timetable} timetable @param {number} weekday @param {string | undefined} date @param {number} dayOffset */
function trainsOn(timetable, weekday, date, dayOffset) {
    const own = date ? timetable.dates?.[addDays(date, dayOffset)] : undefined;
    return timetable.patterns[own ?? timetable.days[(weekday + dayOffset + 7) % 7]];
}

// When the suburban line's trains that end elsewhere leave for the same
// stretch as `leg`, on the service day `dayOffset` days from `weekday`: each
// end is a direction of its own (withSuburban), but a train is only the last
// if none of the line's leaves after it. None for the metro and the tram.
/** @param {Rail} rail @param {Leg} leg @param {number} weekday @param {string | undefined} date @param {number} dayOffset */
function othersOnLeg(rail, leg, weekday, date, dayOffset) {
    const line = rail.lines[leg.line];
    if (!line.suburban) return [];
    const { stops } = line.directions[leg.dir];
    const [from, to] = [stops[leg.fromIndex].station, stops[leg.toIndex].station];
    return Object.entries(line.directions).filter(([dir]) => dir !== leg.dir).flatMap(([, direction]) => {
        const i = direction.stops.findIndex(stop => stop.station === from);
        const j = direction.stops.findIndex(stop => stop.station === to);
        if (i === -1 || j <= i) return [];
        return trainsOn(direction.timetable, weekday, date, dayOffset).flatMap(([start, p]) => {
            const { stops: along, offsets } = direction.timetable.profiles[p];
            const at = along.indexOf(i);
            return at !== -1 && along.indexOf(j) > at ? [start + offsets[at] + dayOffset * DAY] : [];
        });
    });
}

// Upcoming departures for one leg at or after `after` seconds (relative to
// today's midnight). Includes yesterday's trips that run past midnight,
// unless ownDay (only the day's own service). With `date` (today's, ISO), a
// day the timetable has its own trains for (a holiday) uses them; otherwise
// its weekday's.
// Each result: { departs, arrives, isLast, isSecondLast }, and a suburban
// train's number, `train`, where it has one. The last ones are
// only flagged when STASY's last train agrees (the timetable misses the late
// airport trains, and there's no last one when the trains run all night), or
// when there are no STASY times; a suburban train, when none of its line's
// leaves for the same stretch after it (othersOnLeg).
/**
 * @param {Rail} rail @param {Leg} leg
 * @param {{ weekday: number, after: number, count?: number, ownDay?: boolean, date?: string }} when
 * @returns {Departure[]}
 */
export function departures(rail, leg, { weekday, after, count = 2, ownDay = false, date }) {
    const { timetable } = rail.lines[leg.line].directions[leg.dir];
    const found = [];
    for (const dayOffset of ownDay ? [0] : [-1, 0]) {
        const serviceDay = (weekday + dayOffset + 7) % 7;
        const trains = [];
        for (const [start, p, train] of trainsOn(timetable, weekday, date, dayOffset)) {
            const { stops, offsets } = timetable.profiles[p];
            const i = stops.indexOf(leg.fromIndex);
            const j = stops.indexOf(leg.toIndex);
            if (i === -1 || j <= i) continue;
            trains.push({ departs: start + offsets[i] + dayOffset * DAY, arrives: start + offsets[j] + dayOffset * DAY, ...(train && { train }) });
        }
        trains.sort((a, b) => a.departs - b.departs);
        const unique = trains.filter((d, k) => k === 0 || d.departs - trains[k - 1].departs >= DUPLICATE_SECONDS);
        const last = stasyLast(rail, leg, serviceDay);
        const lastKnown = last === undefined
            || (last !== null && unique.length > 0 && Math.abs(unique.at(-1).departs - dayOffset * DAY - last) <= LAST_TRAIN_LEEWAY);
        const others = othersOnLeg(rail, leg, weekday, date, dayOffset);
        unique.forEach((d, k) => {
            const after = unique.length - 1 - k + others.filter(departs => departs > d.departs).length;
            d.isLast = lastKnown && after === 0;
            d.isSecondLast = lastKnown && after === 1;
        });
        found.push(...unique.filter(d => d.departs >= after));
    }
    return found.sort((a, b) => a.departs - b.departs).slice(0, count);
}

// How long a change takes after leg, to the next one: within a station, or on
// foot to another (rail.walks)
/** @param {Rail} rail @param {Leg} leg @param {Leg} [next] */
const changeSeconds = (rail, leg, next) => next && leg.to !== next.from ? rail.walks[leg.to][next.from] * 60 : TRANSFER_SECONDS;

// Departures for every leg of a route, with each later leg timed from the
// arrival of the first upcoming train on the previous leg plus a change, and
// the first from the walk to it. `arrives` is the earliest arrival at the
// destination, the walk to it included, or null if no train makes the whole
// journey today.
// ownDay: only the day's own trains (see departures)
/** @param {Rail} rail @param {Route} route @param {AthensTime} now @param {boolean} [ownDay] @returns {PlannedRoute} */
function planRoute(rail, route, now, ownDay = false) {
    let after = now.seconds + (route.walkFirst ?? 0) * 60;
    let reachable = true;
    const legs = route.legs.map((leg, i) => {
        const next = reachable ? departures(rail, leg, { weekday: now.weekday, after, ownDay, date: now.date }) : [];
        if (next.length) after = next[0].arrives + changeSeconds(rail, leg, route.legs[i + 1]);
        else reachable = false;
        return { ...leg, departures: next };
    });
    const last = legs.at(-1).departures[0];
    return { ...route, legs, arrives: reachable && last ? last.arrives + (route.walkLast ?? 0) * 60 : null };
}

// The trip search (raptor.js) over one day's trains, made once per network
// and day: its stops are rail.stations, its walks rail.walks. Its routes say
// which line and direction they are, and `along`, which of the direction's
// stops each of theirs is. ownDay: only the day's own trains (see departures)
const searches = new WeakMap();

/** @param {Rail} rail @param {AthensTime} now @param {boolean} ownDay */
function searchFor(rail, now, ownDay) {
    if (!searches.has(rail)) searches.set(rail, new Map());
    const made = searches.get(rail);
    const key = `${now.weekday} ${now.date} ${ownDay}`;
    if (made.has(key)) return made.get(key);
    const ids = Object.keys(rail.stations);
    const index = new Map(ids.map((id, i) => [id, i]));
    const routes = [];
    for (const [line, { directions, tram, suburban }] of Object.entries(rail.lines)) {
        for (const [dir, { stops, timetable }] of Object.entries(directions)) {
            const byProfile = new Map();
            for (const dayOffset of ownDay ? [0] : [-1, 0]) {
                for (const [start, p] of trainsOn(timetable, now.weekday, now.date, dayOffset)) {
                    if (!byProfile.has(p)) byProfile.set(p, []);
                    byProfile.get(p).push(timetable.profiles[p].offsets.map(offset => start + offset + dayOffset * DAY));
                }
            }
            for (const [p, trips] of byProfile) {
                const along = timetable.profiles[p].stops;
                routes.push({ line, dir, along, mode: tram ? 'tram' : suburban ? 'suburban' : 'metro', stops: along.map(i => index.get(stops[i].station)), trips });
            }
        }
    }
    const walks = ids.map(id => walksFrom(rail, id).flatMap(([to, minutes]) => [index.get(to), minutes * 60]));
    const search = { ids, index, routes, planner: createPlanner({ stops: ids, routes, walks }) };
    made.set(key, search);
    return search;
}

// Whether a route gets off where it has already been: where it starts, where
// it walks to first, or a station a train took it through. findRoutes' never
// do; one of the search's could, riding out and back only to join two walks
/** @param {Rail} rail @param {string} from @param {Route} route */
function comesBack(rail, from, route) {
    const been = new Set([from, route.legs[0].from]);
    return route.legs.some(leg => {
        if (been.has(leg.to)) return true;
        rail.lines[leg.line].directions[leg.dir].stops.slice(leg.fromIndex, leg.toIndex + 1).forEach(stop => been.add(stop.station));
        return false;
    });
}

// The fastest route with each number of rides, up to MAX_CHANGES changes, in
// findRoutes' shape: the search isn't held to the fewest changes or one more,
// so it finds what's quicker with another change or two (decision 28). One
// that gets off where it has already been is left out
/** @param {Rail} rail @param {string} from @param {string} to @param {AthensTime} now @param {boolean} ownDay @returns {Route[]} */
function fastestRoutes(rail, from, to, now, ownDay) {
    const { ids, index, routes, planner } = searchFor(rail, now, ownDay);
    if (!index.has(from) || !index.has(to)) return [];
    const egress = around(rail, index, to);
    planner.search(around(rail, index, from), now.seconds, { egress });
    const found = [];
    let best = Infinity;
    for (let rides = 1; rides <= MAX_CHANGES + 1; rides++) {
        const { at, stop } = planner.arrival(egress, rides);
        if (at === null || at >= best) continue;
        const legs = planner.journey(stop, rides).legs.map(leg => {
            const { line, dir, along } = routes[leg.route];
            return { line, dir, from: ids[leg.board], to: ids[leg.alight], fromIndex: along[leg.boardIndex], toIndex: along[leg.alightIndex] };
        });
        const walkFirst = legs[0].from === from ? 0 : rail.walks[from][legs[0].from];
        const walkLast = legs.at(-1).to === to ? 0 : rail.walks[legs.at(-1).to][to];
        const route = { legs, ...(walkFirst && { walkFirst }), ...(walkLast && { walkLast }) };
        if (comesBack(rail, from, route)) continue;
        best = at;
        found.push(route);
    }
    return found;
}

// A station and those a walk from it, as the search takes them: [stop, seconds…]
/** @param {Rail} rail @param {Map<string, number>} index @param {string} id */
const around = (rail, index, id) => [index.get(id), 0, ...walksFrom(rail, id).flatMap(([stop, minutes]) => [index.get(stop), minutes * 60])];

// When the search gets to each of `ends` from `from`, leaving at `now`, with
// up to MAX_CHANGES changes: seconds from that day's midnight, or null if not
// today. Quick, for weighing many pairs of stations before planning the few
// that get there first (the Trip page)
/** @param {Rail} rail @param {string} from @param {string[]} ends @param {AthensTime} now @returns {(number | null)[]} */
export function arrivalsFrom(rail, from, ends, now) {
    const { index, planner } = searchFor(rail, now, false);
    if (!index.has(from)) return ends.map(() => null);
    planner.search(around(rail, index, from), now.seconds);
    return ends.map(end => index.has(end) ? planner.arrival(around(rail, index, end), MAX_CHANGES + 1).at : null);
}

/** @param {Route} route */
const routeKey = route => JSON.stringify([route.walkFirst ?? 0, route.legs.map(leg => [leg.line, leg.dir, leg.fromIndex, leg.toIndex]), route.walkLast ?? 0]);

// Plan every route, findRoutes' and the search's fastest, and keep the few
// that arrive first, fewer changes first when they arrive together; those
// arriving much later start closed (SLOWER_MINUTES in render.js). A trip with a
// tram offers its other ways like that, whatever their changes. Metro trains
// alone don't, nor with the suburban railway's: a route with more changes than
// the fewest stays only if it gets there WORTH_A_CHANGE sooner than every
// route with fewer, so a direct train stays the only answer. The same ride on
// suburban trains that end elsewhere is offered once, on the train that gets
// there first: each end is a direction of its own (withSuburban), and some
// have only a few trains, or none some days.
/** @param {Rail} rail @param {string} from @param {string} to @param {AthensTime} now @param {boolean} [ownDay] @returns {PlannedRoute[]} */
export function planJourney(rail, from, to, now, ownDay = false) {
    if (!from || !to || from === to) return [];
    const routes = findRoutes(rail, from, to);
    const known = new Set(routes.map(routeKey));
    routes.push(...fastestRoutes(rail, from, to, now, ownDay).filter(route => !known.has(routeKey(route))));
    const plans = routes.map(route => planRoute(rail, route, now, ownDay));
    const fewest = Math.min(...plans.map(plan => plan.legs.length));
    const hasTram = plan => plan.legs.some(leg => rail.lines[leg.line].tram);
    const worthIt = plan => plan.legs.length === fewest || hasTram(plan) || (plan.arrives !== null
        && plans.every(other => other.legs.length >= plan.legs.length || (other.arrives ?? Infinity) - plan.arrives >= WORTH_A_CHANGE));
    const rides = new Set();
    const firstRide = plan => {
        const ride = JSON.stringify([plan.walkFirst ?? 0, plan.legs.map(leg => [leg.line, leg.from, leg.to]), plan.walkLast ?? 0]);
        return !rides.has(ride) && Boolean(rides.add(ride));
    };
    return plans
        .filter(worthIt)
        .sort((a, b) => (a.arrives ?? Infinity) - (b.arrives ?? Infinity) || a.legs.length - b.legs.length)
        .filter(firstRide)
        .slice(0, MAX_OPTIONS);
}

// The day after `now`, from midnight
/** @param {AthensTime} now @returns {AthensTime} */
export function nextDay(now) {
    return { weekday: (now.weekday + 1) % 7, seconds: 0, date: addDays(now.date, 1) };
}

// When a planned route gets there, and how long it takes from boarding the
// first train to getting off the last (rides, changes, waits for the next
// train), with any walk at either end: on the first trains that make the whole
// trip, tomorrow's first ones when none does today (`arrives` then counts from
// today's midnight, so it compares with today's). null when none does tomorrow
// either.
/** @param {Rail} rail @param {PlannedRoute} route @param {AthensTime} now @returns {{ arrives: number, minutes: number } | null} */
export function tripTime(rail, route, now) {
    const tomorrow = route.arrives === null;
    const plan = tomorrow ? planRoute(rail, route, nextDay(now), true) : route;
    const first = plan.legs[0].departures[0];
    if (plan.arrives === null || !first) return null;
    return { arrives: plan.arrives + (tomorrow ? DAY : 0), minutes: Math.round((plan.arrives - first.departs) / 60) + (route.walkFirst ?? 0) };
}

// planJourney, and after the last train of the day (no route gets there
// today) the same trip on tomorrow's first trains. Tomorrow's own: tonight's
// trains after midnight can't make the trip, or today's plan would have.
// They'd only leave you waiting at a change until the morning.
/**
 * @param {Rail} rail @param {string} from @param {string} to @param {AthensTime} now
 * @returns {{ plans: PlannedRoute[], now: AthensTime, tomorrow: boolean }} now: the time the plans start from
 */
export function planTrip(rail, from, to, now) {
    const plans = planJourney(rail, from, to, now);
    if (!plans.length || plans.some(plan => plan.arrives !== null)) return { plans, now, tomorrow: false };
    const tomorrow = nextDay(now);
    return { plans: planJourney(rail, from, to, tomorrow, true), now: tomorrow, tomorrow: true };
}

// Where to stand on a leg: at an interchange, near the way to the next line;
// otherwise near the exit, with how it's reached (escalators, stairs: those
// are the exit's, not the change's)
/**
 * @param {Rail} rail @param {Leg} leg @param {Leg | null} next
 * @returns {{ stop: Stop, exits: Position[], elevators: Position[], escalators: Position[], stairs: Position[] }}
 */
export function legPositions(rail, leg, next) {
    const stop = rail.lines[leg.line].directions[leg.dir].stops[leg.toIndex];
    const exits = next ? stop.transfers?.[`${next.line}/${next.dir}`] ?? stop.exits : stop.exits;
    return { stop, exits, elevators: stop.elevators ?? [], escalators: next ? [] : stop.escalators ?? [], stairs: next ? [] : stop.stairs ?? [] };
}

// tram: true for the nearest tram stop, false for the nearest metro station
/** @param {Rail} rail @param {number} lat @param {number} lng @param {boolean} [tram] @returns {string} */
export function closestStation(rail, lat, lng, tram) {
    let best = null;
    let bestDist = Infinity;
    for (const [id, { coords, tram: isTram }] of Object.entries(rail.stations)) {
        if (tram !== undefined && Boolean(isTram) !== tram) continue;
        // Equirectangular approximation — plenty for picking the nearest station
        const x = (coords[1] - lng) * Math.cos((lat * Math.PI) / 180);
        const y = coords[0] - lat;
        const d = x * x + y * y;
        if (d < bestDist) { bestDist = d; best = id; }
    }
    return best;
}

/** @param {Rail} rail @param {AthensTime} now */
export function isTimetableExpired(rail, now) {
    return now.date > rail.feed.validTo;
}
