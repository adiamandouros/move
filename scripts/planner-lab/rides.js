// Measured ride times in the lab's timetable: where bus-rides.json (the
// nightly build's, server/data/build-rides.js) has enough rides for a
// stretch at that hour, a trip takes that long between its two stops, and the
// stops after it move with it. The feed's times stay everywhere else. Its
// median is a usual day; with badDay, its slowest tenth, which the planner
// ranks ways by (weights.js).
//
//   curl -o data/local/planner-lab/bus-rides.json https://wayhop.gr/data/bus-rides.json
//   node scripts/planner-lab/build-buses.js data/local/planner-lab/buses.json --rides data/local/planner-lab/bus-rides.json

// Fewer rides than this at an hour say too little
export const MIN_RIDES = 3;
const KINDS = ['su', 'wd', 'wd', 'wd', 'wd', 'wd', 'sa'];

/**
 * @param {import('./network.js').Buses} buses
 * @param {{ rides: { route: string, from: string, to: string, times: Record<string, [number, number, number]> }[] }} table
 * @param {{ minRides?: number, badDay?: boolean }} [options]
 * @returns {{ buses: import('./network.js').Buses, retimed: number }} retimed: trips with a measured stretch
 */
export function withRides(buses, table, { minRides = MIN_RIDES, badDay = false } = {}) {
    const column = badDay ? 2 : 1;
    const byRoute = new Map();
    for (const ride of table.rides) (byRoute.get(ride.route) ?? byRoute.set(ride.route, []).get(ride.route)).push(ride);
    const kind = KINDS[buses.day];
    let retimed = 0;
    const routes = buses.routes.map(route => {
        const rides = (byRoute.get(route.code ?? '') ?? [])
            .map(ride => ({ ...ride, i: route.stops.indexOf(ride.from), j: route.stops.indexOf(ride.to) }))
            .filter(ride => ride.i >= 0 && ride.j > ride.i)
            .sort((a, b) => a.i - b.i || a.j - b.j);
        if (!rides.length) return route;
        const profiles = [];
        const known = new Map();
        const trips = route.trips.map(([start, profile]) => {
            const offsets = [...route.profiles[profile]];
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
                    offsets[k] = k <= j ? Math.round(offsets[i] + (route.profiles[profile][k] - route.profiles[profile][i]) * scale) : offsets[k] + shift;
                }
                // (an empty stretch in the feed: the time goes on its last stop)
                if (was <= 0) offsets[j] = offsets[i] + time[column];
                done = j;
            }
            const key = offsets.join();
            if (key !== route.profiles[profile].join()) retimed++;
            if (!known.has(key)) known.set(key, profiles.push(offsets) - 1);
            return /** @type {[number, number]} */ ([start, known.get(key)]);
        });
        return { ...route, profiles, trips };
    });
    return { buses: { ...buses, routes }, retimed };
}
