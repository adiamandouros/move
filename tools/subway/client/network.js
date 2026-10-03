// Route finding and departure times over rail.json (see server/data/build-rail.js
// for the format). No DOM access, so it can be unit-tested in Node.

const DAY = 86_400;
// Minimum time to change trains at an interchange
export const TRANSFER_SECONDS = 180;
// OASA's feed sometimes has near-duplicate trips a few seconds apart
const DUPLICATE_SECONDS = 60;
const MAX_OPTIONS = 3;

// Current weekday (0 = Sunday) and seconds since midnight in Athens, wherever
// the device's clock is set.
export function athensNow(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Athens', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    }).formatToParts(date).map(p => [p.type, p.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return { weekday, seconds: +parts.hour * 3600 + +parts.minute * 60 + +parts.second, date: athensDate(date) };
}

export function athensDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(date);
}

// Every way to ride one line from `from` to `to` without changing.
function legsBetween(rail, from, to) {
    const legs = [];
    for (const [line, { directions }] of Object.entries(rail.lines)) {
        for (const [dir, { stops }] of Object.entries(directions)) {
            const fromIndex = stops.findIndex(s => s.station === from);
            const toIndex = stops.findIndex(s => s.station === to);
            if (fromIndex !== -1 && toIndex > fromIndex) legs.push({ line, dir, from, to, fromIndex, toIndex });
        }
    }
    return legs;
}

// Direct routes if there are any, otherwise every one-change route. All three
// metro lines cross each other, so one change is always enough.
export function findRoutes(rail, from, to) {
    if (!from || !to || from === to) return [];
    const direct = legsBetween(rail, from, to);
    if (direct.length) return direct.map(leg => ({ legs: [leg] }));

    const routes = [];
    for (const [via, station] of Object.entries(rail.stations)) {
        if (station.lines.length < 2 || via === from || via === to) continue;
        for (const first of legsBetween(rail, from, via)) {
            for (const second of legsBetween(rail, via, to)) {
                if (first.line !== second.line) routes.push({ via, legs: [first, second] });
            }
        }
    }
    return routes;
}

// Upcoming departures for one leg at or after `after` seconds (relative to
// today's midnight). Includes yesterday's trips that run past midnight.
// Each result: { departs, arrives, isLast, isSecondLast }.
export function departures(rail, leg, { weekday, after, count = 2 }) {
    const { timetable } = rail.lines[leg.line].directions[leg.dir];
    const found = [];
    for (const dayOffset of [-1, 0]) {
        const pattern = timetable.patterns[timetable.days[(weekday + dayOffset + 7) % 7]];
        const serviceDay = [];
        for (const [start, p] of pattern) {
            const { stops, offsets } = timetable.profiles[p];
            const i = stops.indexOf(leg.fromIndex);
            const j = stops.indexOf(leg.toIndex);
            if (i === -1 || j <= i) continue;
            serviceDay.push({ departs: start + offsets[i] + dayOffset * DAY, arrives: start + offsets[j] + dayOffset * DAY });
        }
        serviceDay.sort((a, b) => a.departs - b.departs);
        const unique = serviceDay.filter((d, k) => k === 0 || d.departs - serviceDay[k - 1].departs >= DUPLICATE_SECONDS);
        unique.forEach((d, k) => {
            d.isLast = k === unique.length - 1;
            d.isSecondLast = k === unique.length - 2;
        });
        found.push(...unique.filter(d => d.departs >= after));
    }
    return found.sort((a, b) => a.departs - b.departs).slice(0, count);
}

// Departures for every leg of a route, with each later leg timed from the
// arrival of the first upcoming train on the previous leg plus a change.
// `arrives` is the earliest arrival at the destination, or null if no train
// makes the whole journey today.
export function planRoute(rail, route, now) {
    let after = now.seconds;
    let reachable = true;
    const legs = route.legs.map(leg => {
        const next = reachable ? departures(rail, leg, { weekday: now.weekday, after }) : [];
        if (next.length) after = next[0].arrives + TRANSFER_SECONDS;
        else reachable = false;
        return { ...leg, departures: next };
    });
    const last = legs.at(-1).departures[0];
    return { ...route, legs, arrives: reachable && last ? last.arrives : null };
}

// Plan every route and keep the few that arrive first.
export function planJourney(rail, from, to, now) {
    return findRoutes(rail, from, to)
        .map(route => planRoute(rail, route, now))
        .sort((a, b) => (a.arrives ?? Infinity) - (b.arrives ?? Infinity))
        .slice(0, MAX_OPTIONS);
}

// Where to stand on a leg: at an interchange, near the way to the next line;
// otherwise near the exit.
export function legPositions(rail, leg, next) {
    const stop = rail.lines[leg.line].directions[leg.dir].stops[leg.toIndex];
    const exits = next ? stop.transfers?.[`${next.line}/${next.dir}`] ?? stop.exits : stop.exits;
    return { stop, exits, elevators: stop.elevators ?? [] };
}

export function closestStation(rail, lat, lng) {
    let best = null;
    let bestDist = Infinity;
    for (const [id, { coords }] of Object.entries(rail.stations)) {
        // Equirectangular approximation — plenty for picking the nearest station
        const x = (coords[1] - lng) * Math.cos((lat * Math.PI) / 180);
        const y = coords[0] - lat;
        const d = x * x + y * y;
        if (d < bestDist) { bestDist = d; best = id; }
    }
    return best;
}

export function isTimetableExpired(rail, now) {
    return now.date > rail.feed.validTo;
}
