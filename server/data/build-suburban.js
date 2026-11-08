// trains.json, the suburban railway's timetable for the Trip page's search
// (decision 40), from railway.gov.gr's boards (railway.js) and the stations
// in data/curated/suburban.json: the lines' corridors it takes, and each
// station's name, place and OSE ids. Each date's trains go by their stops,
// as buses.json's routes do (city.js's trainDay reads it): a route is a
// list of stations, its profiles the seconds from its first stop to each,
// and its trips [start, profile], start in seconds from that date's
// midnight in Athens (past 24:00 for a train still running after midnight).
// A cancelled train is left out; one calling at a station suburban.json
// doesn't have is left out with a warning, as is one whose times go back.
//
// {
//   schema: 1,
//   stations: { piraeus: [lat, lng, Greek, English], … },
//   dates: { '2026-11-08': [{ line: 'P', stops: ['piraeus', …], profiles: [[0, 300, …]], trips: [[33_840, 0], …] }, …] }
// }

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
 * @param {Record<string, { schedules: any[] }>} boards by date
 * @param {{ lines: Record<string, { corridors: string[] }>, stations: Record<string, { name: { el: string, en: string }, ose: string[], coords: [number, number] }> }} suburban
 * @returns {{ data: import('../../types/data.js').Trains, warnings: string[] }}
 */
export function buildTrains(boards, suburban) {
    const warnings = [];
    const stationOf = new Map(Object.entries(suburban.stations).flatMap(([id, s]) => s.ose.map(ose => [ose, id])));
    const lineOf = new Map(Object.entries(suburban.lines).flatMap(([line, { corridors }]) => corridors.map(corridor => [corridor, line])));
    const unknown = new Map();
    const dates = {};
    for (const [date, { schedules }] of Object.entries(boards).sort(([a], [b]) => a.localeCompare(b))) {
        const routes = new Map();
        for (const train of schedules) {
            const line = lineOf.get(train.corridor);
            if (!line || train.serviceType !== 'Suburban' || train.status === 'cancelled') continue;
            const calls = [...train.routeStations ?? []].sort((a, b) => a.index - b.index);
            const missing = calls.filter(call => !stationOf.has(call.stationId));
            if (missing.length) {
                for (const call of missing) unknown.set(call.stationId, call.nameGreek ?? call.name ?? '');
                continue;
            }
            // When it leaves each stop (arrives, at the last)
            const times = calls.map(call => athensSeconds(call.scheduledDeparture ?? call.scheduledArrival, date));
            if (calls.length < 2 || times.some((time, i) => !Number.isFinite(time) || (i && time < times[i - 1]))) {
                warnings.push(`Train ${train.trainNumber} on ${date} left out: its times don't go forward`);
                continue;
            }
            const stops = calls.map(call => stationOf.get(call.stationId));
            const key = `${line} ${stops.join(' ')}`;
            if (!routes.has(key)) routes.set(key, { line, stops, profiles: [], trips: [] });
            const route = routes.get(key);
            const offsets = times.map(time => time - times[0]);
            let profile = route.profiles.findIndex(p => p.every((offset, i) => offset === offsets[i]));
            if (profile < 0) profile = route.profiles.push(offsets) - 1;
            route.trips.push([times[0], profile]);
        }
        dates[date] = [...routes.values()].map(route => ({ ...route, trips: route.trips.sort((a, b) => a[0] - b[0] || a[1] - b[1]) }));
    }
    for (const [ose, name] of unknown) warnings.push(`Trains calling at "${name}" (OSE ${ose}) left out: it isn't in data/curated/suburban.json`);
    const stations = Object.fromEntries(Object.entries(suburban.stations).map(([id, { name, coords }]) => [id, /** @type {[number, number, string, string]} */ ([coords[0], coords[1], name.el, name.en])]));
    return { data: { schema: SCHEMA, stations, dates }, warnings };
}
