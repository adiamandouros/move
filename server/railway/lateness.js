// How late each running suburban train is, worked out by Wayhop (decision
// 42): railway.gov.gr records a train's delay only once its trip is over, and
// it reads 0 while the train runs. Its live stream does say each train's next
// station, so from one look to the next:
//   - measured: a train whose next station has changed left the station
//     before it between the two looks, so its lateness there is the middle
//     of the two looks less that station's timetabled departure
//   - at least: a train still on its way to its next station after its
//     timetabled arrival there is at least that late
// The larger of the two counts, never below 0; it's measured when the
// measured one is the larger. A train seen for the first time (after a
// restart too) has only "at least" until its next station changes. A
// position back at a station the train has passed (its GPS jumping) counts
// as the furthest one seen.

/**
 * A day's board (railway.js) → its suburban trains on `corridors` that run,
 * by schedule number (as the stream names them): the train's number, and
 * each stop's OSE id with its timetabled arrival and departure (ms, null at
 * its first or last stop)
 * @param {{ schedules: any[] }} board @param {Set<string>} corridors
 * @returns {Map<string, { train: string, stops: [string, number | null, number | null][] }>}
 */
export function boardTrains(board, corridors) {
    const trains = new Map();
    for (const s of board?.schedules ?? []) {
        if (s.serviceType !== 'Suburban' || s.status === 'cancelled' || !corridors.has(s.corridor) || !s.scheduleNumber) continue;
        const time = iso => iso ? Date.parse(iso) : null;
        const stops = [...s.routeStations ?? []].sort((a, b) => a.index - b.index)
            .map(call => /** @type {[string, number | null, number | null]} */ ([call.stationId, time(call.scheduledArrival), time(call.scheduledDeparture)]));
        trains.set(s.scheduleNumber, { train: s.trainNumber, stops });
    }
    return trains;
}

// A train not seen for this long has ended, or lost its GPS: forgotten
const FORGET_MS = 2 * 3_600_000;

/**
 * Keeps what each train was last seen doing, from one look to the next.
 * update(positions, trains) → { [train number]: { late: seconds, exact } }
 * for each running train of `trains` (boardTrains) the look has, `exact`
 * when it was measured at a station; a position's own time counts, which
 * already has the stream's 10 seconds
 */
export function createTracker() {
    /** @type {Map<string, { stop: number, at: number, measured: number | null }>} */
    const seen = new Map();
    /**
     * @param {{ scheduleNumber?: string | null, nextStationId?: string | null, timestamp?: string }[]} positions
     * @param {ReturnType<typeof boardTrains>} trains
     * @returns {Record<string, { late: number, exact: boolean }>}
     */
    function update(positions, trains) {
        /** @type {Record<string, { late: number, exact: boolean }>} */
        const late = {};
        let newest = -Infinity;
        for (const p of positions) {
            const train = p.scheduleNumber ? trains.get(p.scheduleNumber) : undefined;
            const at = Date.parse(p.timestamp ?? '');
            const found = train ? train.stops.findIndex(([id]) => id === p.nextStationId) : -1;
            if (!train || found < 0 || !Number.isFinite(at)) continue;
            newest = Math.max(newest, at);
            const before = seen.get(p.scheduleNumber);
            const stop = Math.max(found, before?.stop ?? 0);
            let measured = before?.measured ?? null;
            if (before && stop > before.stop && train.stops[stop - 1][2] !== null) measured = (before.at + at) / 2 - train.stops[stop - 1][2];
            seen.set(p.scheduleNumber, { stop, at, measured });
            // Its first stop has no arrival: there, still waiting to leave
            const [, arrives, departs] = train.stops[stop];
            const due = stop === 0 ? departs : arrives;
            const atLeast = due === null ? 0 : at - due;
            const exact = measured !== null && measured >= atLeast;
            late[train.train] = { late: Math.max(0, Math.round((exact ? measured : atLeast) / 1000)), exact };
        }
        for (const [number, { at }] of seen) if (at < newest - FORGET_MS) seen.delete(number);
        return late;
    }
    return { update };
}
