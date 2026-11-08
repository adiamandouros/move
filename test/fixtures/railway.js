// The suburban railway for tests (decision 40): a small suburban.json, and
// railway.gov.gr's schedule boards in its own shape (server/data/railway.js),
// with a fake of the site that answers a board for any date.

// Piraeus, Athens (beside the fixture metro's B, a walk with a note) and the
// airport (outside OASA's ticket) on A1, as OSE's ids o1, o2 and o3; Ano
// Liosia (o4), where A2 trains stop; SKA, OSE's o5, as two stations, A2's and
// A3's, a walk apart
export function suburbanCurated() {
    return {
        lines: {
            A1: { name: 'A1', color: '#ffcd00', corridor: 'PIRAIR' },
            A2: { name: 'A2', color: '#753bbd', corridor: 'PIRAIR', stopsAt: 'liosia' },
            A3: { name: 'A3', color: '#78be20', corridor: 'CHALKIDA' },
        },
        stations: {
            piraeus: { name: { el: 'Πειραιάς', en: 'Piraeus' }, ose: ['o1'], coords: [37.94913, 23.64372] },
            athens: { name: { el: 'Αθήνα', en: 'Athens' }, ose: ['o2'], coords: [37.99284, 23.72015], metro: 'b', walks: [{ metro: 'b', minutes: 4, note: { el: 'Απέναντι', en: 'Across the road' } }] },
            airport: { name: { el: 'Αεροδρόμιο', en: 'Airport' }, ose: ['o3', 'o3b'], coords: [37.93698, 23.94481], oasaTicket: false },
            liosia: { name: { el: 'Άνω Λιόσια', en: 'Ano Liosia' }, ose: ['o4'], coords: [38.07077, 23.70985] },
            ska2: { name: { el: 'ΣΚΑ-Αχαρναί', en: 'SKA-Acharnai' }, ose: ['o5'], lines: ['A2'], coords: [38.06565, 23.73777], walks: [{ station: 'ska3', minutes: 6 }] },
            ska3: { name: { el: 'ΣΚΑ', en: 'SKA' }, ose: ['o5'], lines: ['A3'], coords: [38.06813, 23.73774] },
        },
    };
}

/**
 * When `hhmm` on `date` in Athens is, as railway.gov.gr writes times (UTC,
 * ISO). Past 24:00 is the next day
 * @param {string} date 'YYYY-MM-DD' @param {string} hhmm
 */
export function athensIso(date, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (const offset of [3, 2]) {
        const at = Date.parse(`${date}T00:00:00+0${offset}:00`) + (h * 60 + m) * 60_000;
        if (clock.format(at) === `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`) return new Date(at).toISOString();
    }
    throw new Error(`no such time in Athens: ${date} ${hhmm}`);
}

/**
 * One train on a board: its number, and each stop's OSE id and time ('HH:MM'
 * in Athens), as railway.gov.gr has them
 * @param {string} date @param {string} number @param {[string, string][]} calls
 * @param {{ corridor?: string, serviceType?: string, status?: string, delay?: number }} [more]
 */
export function train(date, number, calls, { corridor = 'PIRAIR', serviceType = 'Suburban', status = 'scheduled', delay = 0 } = {}) {
    const times = calls.map(([, hhmm]) => athensIso(date, hhmm));
    return {
        _id: `id-${number}-${date}`, scheduleNumber: `${number}-${date.replaceAll('-', '')}-0000`, trainNumber: number, serviceType, corridor, status, delay,
        scheduledDeparture: times[0], scheduledArrival: times.at(-1), actualDeparture: null, actualArrival: null,
        origin: { name: calls[0][0], nameGreek: calls[0][0] }, destination: { name: calls.at(-1)[0], nameGreek: calls.at(-1)[0] },
        routeStations: calls.map(([stationId], i) => ({
            stationId, name: `Station ${stationId}`, nameGreek: `Σταθμός ${stationId}`,
            role: i === 0 ? 'origin' : i === calls.length - 1 ? 'destination' : 'stop',
            scheduledArrival: i ? times[i] : null, scheduledDeparture: i < calls.length - 1 ? times[i] : null, index: i,
        })),
        routeAdjusted: false, segment: null,
    };
}

// A day's board: two trains to the airport and one back, and a freight train
/** @param {string} date */
export function board(date) {
    return {
        schedules: [
            train(date, '1200', [['o1', '08:00'], ['o2', '08:15'], ['o3', '09:05']]),
            train(date, '1202', [['o1', '09:00'], ['o2', '09:15'], ['o3', '10:05']]),
            train(date, '1201', [['o3', '08:30'], ['o2', '09:20'], ['o1', '09:35']]),
            train(date, '9000', [['o1', '10:00'], ['o3', '11:00']], { serviceType: 'Freight' }),
        ],
    };
}

/**
 * railway.gov.gr, as the fetch the build asks it with: a board for every
 * date, `boardOf(date)`. `calls` lists each URL asked for and its headers;
 * fail(date, { times, status }) makes a date's board fail (HTTP 502 unless
 * said), `times` times or always; down() every request
 * @param {{ boardOf?: (date: string) => any }} [options]
 */
export function fakeRailway({ boardOf = board } = {}) {
    const calls = [];
    const failing = new Map();
    let isDown = false;
    return {
        calls,
        get dates() { return calls.map(call => new URL(call.url).searchParams.get('date')); },
        fail(date, { times = Infinity, status = 502 } = {}) { failing.set(date, { times, status }); },
        down(down = true) { isDown = down; },
        /** @type {typeof globalThis.fetch} */
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), headers: /** @type {Record<string, string>} */ (init.headers ?? {}) });
            const date = new URL(String(url)).searchParams.get('date') ?? '';
            if (isDown) throw new TypeError('fetch failed');
            const failure = failing.get(date);
            if (failure && failure.times-- > 0) return new Response('Bad Gateway', { status: failure.status });
            return Response.json(boardOf(date));
        },
    };
}
