// trains.json, the suburban railway's timetable for the Trip page's search
// (decision 41), from railway.gov.gr's boards (railway.js) and the lines and
// stations in data/curated/suburban.json. A train's line is the one of its
// corridor whose `stopsAt` it stops at, or else its corridor's other one (the
// boards don't name A1–A4); each of its stops is the station with that OSE
// id, the one for its line where two share an id (SKA's two). Each date's
// trains go by their line and stops, as buses.json's routes do (city.js's
// trainDay reads it): a route is a list of stations, its profiles the
// seconds from its first stop to each, and its trips [start, profile, train],
// start in seconds from that date's midnight in Athens (past 24:00 for a train
// still running after midnight), train its number on railway.gov.gr, which
// its live times name (decision 42). A cancelled train is left out; one calling
// at a station suburban.json doesn't have for its line is left out with a
// warning, as is one whose times go back.
//
// {
//   schema: 1,
//   stations: { piraeus: [lat, lng, Greek, English], … },
//   walks: [['train:piraeus', 'rail:piraeus', 240, { el, en }], ['train:athens', 'rail:larissa-station', 240], …],
//   outside: ['airport', …],
//   dates: { '2026-11-08': [{ line: 'A1', stops: ['piraeus', …], profiles: [[0, 300, …]], trips: [[33_840, 0, '1228'], …] }, …] }
// }
// walks: suburban.json's, both ways round in the search, in seconds, as the
// search names its stops, each with its note where it has one; outside: the
// stations OASA's ticket doesn't cover

export const SCHEMA = 1;

const ATHENS_CLOCK = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * When `iso` is, in seconds from the midnight in Athens that starts `date`
 * ('YYYY-MM-DD'): the clock's time, plus a day for each day later it is
 * @param {string} iso @param {string} date
 */
export function athensSeconds(iso, date) {
    const p = Object.fromEntries(ATHENS_CLOCK.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
    const days = (Date.UTC(+p.year, +p.month - 1, +p.day) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
    return days * 86_400 + +p.hour * 3600 + +p.minute * 60 + +p.second;
}

/**
 * @typedef {{ name: { el: string, en: string }, ose: string[], lines?: string[], coords: [number, number], metro?: string,
 *   walks?: { metro?: string, station?: string, minutes: number, note?: { el: string, en: string } }[], oasaTicket?: false }} SuburbanStation
 */

/**
 * @param {Record<string, { schedules: any[] }>} boards by date
 * @param {{ lines: Record<string, { corridor: string, stopsAt?: string }>, stations: Record<string, SuburbanStation> }} suburban
 * @returns {{ data: import('../../types/data.js').Trains, warnings: string[] }}
 */
export function buildTrains(boards, suburban) {
    const warnings = [];
    // OSE id → the stations with it, each with the lines it's for (none: every line)
    const stationsOf = new Map();
    for (const [id, { ose, lines }] of Object.entries(suburban.stations)) {
        for (const code of ose) stationsOf.set(code, [...stationsOf.get(code) ?? [], { id, lines }]);
    }
    const lines = Object.entries(suburban.lines);
    const lineOf = (corridor, calls) => {
        const mine = lines.filter(([, line]) => line.corridor === corridor);
        const at = new Set(calls.flatMap(call => (stationsOf.get(call.stationId) ?? []).map(s => s.id)));
        return (mine.find(([, line]) => line.stopsAt && at.has(line.stopsAt)) ?? mine.find(([, line]) => !line.stopsAt))?.[0];
    };
    const stationFor = (code, line) => {
        const all = stationsOf.get(code) ?? [];
        return (all.find(s => s.lines?.includes(line)) ?? all.find(s => !s.lines))?.id;
    };
    const unknown = new Map();
    const dates = {};
    for (const [date, { schedules }] of Object.entries(boards).sort(([a], [b]) => a.localeCompare(b))) {
        const routes = new Map();
        for (const train of schedules) {
            if (train.serviceType !== 'Suburban' || train.status === 'cancelled') continue;
            const calls = [...train.routeStations ?? []].sort((a, b) => a.index - b.index);
            const line = lineOf(train.corridor, calls);
            if (!line) continue;
            const stops = calls.map(call => stationFor(call.stationId, line));
            const missing = calls.filter((_, i) => !stops[i]);
            if (missing.length) {
                for (const call of missing) unknown.set(`${call.stationId} ${line}`, { name: call.nameGreek ?? call.name ?? '', ose: call.stationId, line });
                continue;
            }
            // When it leaves each stop (arrives, at the last)
            const times = calls.map(call => athensSeconds(call.scheduledDeparture ?? call.scheduledArrival, date));
            if (calls.length < 2 || times.some((time, i) => !Number.isFinite(time) || (i && time < times[i - 1]))) {
                warnings.push(`Train ${train.trainNumber} on ${date} left out: its times don't go forward`);
                continue;
            }
            const key = `${line} ${stops.join(' ')}`;
            if (!routes.has(key)) routes.set(key, { line, stops, profiles: [], trips: [] });
            const route = routes.get(key);
            const offsets = times.map(time => time - times[0]);
            let profile = route.profiles.findIndex(p => p.every((offset, i) => offset === offsets[i]));
            if (profile < 0) profile = route.profiles.push(offsets) - 1;
            route.trips.push([times[0], profile, train.trainNumber]);
        }
        dates[date] = [...routes.values()].map(route => ({ ...route, trips: route.trips.sort((a, b) => a[0] - b[0] || a[1] - b[1]) }));
    }
    for (const { name, ose, line } of unknown.values()) warnings.push(`${line} trains calling at "${name}" (OSE ${ose}) left out: data/curated/suburban.json has no station with that id for ${line}`);
    const entries = Object.entries(suburban.stations);
    const stations = Object.fromEntries(entries.map(([id, { name, coords }]) => [id, /** @type {[number, number, string, string]} */ ([coords[0], coords[1], name.el, name.en])]));
    const walks = entries.flatMap(([id, s]) => (s.walks ?? []).map(walk => /** @type {import('../../types/data.js').Trains['walks'][number]} */ ([
        `train:${id}`, walk.metro ? `rail:${walk.metro}` : `train:${walk.station}`, walk.minutes * 60, ...walk.note ? [walk.note] : [],
    ])));
    const outside = entries.filter(([, s]) => s.oasaTicket === false).map(([id]) => id);
    return { data: { schema: SCHEMA, stations, walks, outside, dates }, warnings };
}
