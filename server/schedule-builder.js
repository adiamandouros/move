import https from 'https';
import { createInterface } from 'readline';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = join(__dirname, '..', 'public', 'data');
const OUTPUT     = join(DATA_DIR, 'metro-schedule.json');

const GTFS_BASE = 'https://catalog.growthfund.gr/dataset/a7d0a0e8-2880-46c6-b85b-b4da482bd89e/resource';
const URLS = {
    routes:    `${GTFS_BASE}/35eb02d2-e327-4aed-8e76-bb97fbc677b9/download/routes.txt`,
    calendar:  `${GTFS_BASE}/6b7a35e4-9429-41e3-a153-95e743d18a47/download/calendar.txt`,
    trips:     `${GTFS_BASE}/21ec6d96-e9d9-4c3f-be32-5dac1e60deb4/download/trips.txt`,
    stop_times:`${GTFS_BASE}/85fa7cba-329d-43a7-a9cf-28f8e126a293/download/stop_times.txt`,
    stops:     `${GTFS_BASE}/6b088832-51e8-4ac2-a038-bfc9134782ac/download/stops.txt`,
};

// All rail routes — M1/M2/M3 now, T6/T7 tram ready for the future
const TARGET_ROUTES = new Set(['M1', 'M2', 'M3', 'T6', 'T7']);

// M1 weekend frequency table (Saturday and Sunday share the same schedule).
// Each entry: [from_minutes, to_minutes, interval_minutes].
// The 10'30" interval is encoded as 10.5.
const M1_WEEKEND_FREQ = [
    [5*60,       5*60+30,  15  ],   // 05:00–05:30
    [5*60+30,    23*60+30, 10.5],   // 05:30–23:30
    [23*60+30,   25*60,    15  ],   // 23:30–01:00 (next service day)
];

function normalise(s = '') {
    return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getDayType(yyyymmdd) {
    const y = +yyyymmdd.slice(0, 4);
    const m = +yyyymmdd.slice(4, 6) - 1;
    const d = +yyyymmdd.slice(6, 8);
    const dow = new Date(y, m, d).getDay(); // 0 = Sun, 6 = Sat
    if (dow === 0) return 'sunday';
    if (dow === 6) return 'saturday';
    if (dow === 5) return 'friday';
    return 'weekday'; // Mon–Thu
}

function formatTime(gtfsTime) {
    // GTFS allows >24:00 for overnight trips — wrap to 24-hour clock
    const [h, m] = gtfsTime.split(':');
    return `${String(+h % 24).padStart(2, '0')}:${m.padStart(2, '0')}`;
}

// Generate terminus departure times (in minutes-since-midnight) from a frequency table.
function genDepartures(freqTable) {
    const times = [];
    for (const [from, to, interval] of freqTable) {
        let t = from;
        while (t < to) { times.push(t); t += interval; }
    }
    return times;
}

// Fetch a URL, following redirects, and return the response stream
function fetchStream(url) {
    return new Promise((resolve, reject) => {
        function go(u) {
            https.get(u, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    go(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${u}`));
                    return;
                }
                resolve(res);
            }).on('error', reject);
        }
        go(url);
    });
}

// Parse a small CSV file fully into an array of row objects
async function parseFull(url) {
    const stream = await fetchStream(url);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const rows = [];
    let headers = null;
    for await (const line of rl) {
        if (!line.trim()) continue;
        const cols = line.split(',').map(c => c.trim().replace(/^\uFEFF/, '').replace(/^"|"$/g, ''));
        if (!headers) { headers = cols; continue; }
        rows.push(Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ''])));
    }
    return rows;
}

// HEAD the trips file and return the Last-Modified header value (or null)
export function fetchGtfsLastModified() {
    return new Promise(resolve => {
        function head(u) {
            const req = https.request(u, { method: 'HEAD' }, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    head(res.headers.location);
                    return;
                }
                resolve(res.headers['last-modified'] ?? null);
            });
            req.on('error', () => resolve(null));
            req.end();
        }
        head(URLS.trips);
    });
}

// Returns true if the schedule file is missing or the remote GTFS has been updated
export async function isScheduleStale() {
    if (!existsSync(OUTPUT)) return true;
    try {
        const existing = JSON.parse(readFileSync(OUTPUT, 'utf8'));
        const remote   = await fetchGtfsLastModified();
        if (!remote) return false; // can't verify — assume fresh
        return existing.gtfsLastModified !== remote;
    } catch {
        return true;
    }
}

export async function buildSchedule() {
    console.log('[schedule] Starting GTFS build…');

    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    const lastModified = await fetchGtfsLastModified();

    // ── 1. Routes ────────────────────────────────────────────────────────────
    console.log('[schedule] Fetching routes.txt…');
    const routeRows = await parseFull(URLS.routes);
    // numeric route_id → short name  e.g. '2' → 'M3'
    const routeById = new Map(
        routeRows
            .filter(r => TARGET_ROUTES.has(r.route_short_name))
            .map(r => [r.route_id, r.route_short_name])
    );

    // ── 2. Calendar ──────────────────────────────────────────────────────────
    console.log('[schedule] Fetching calendar.txt…');
    const calRows = await parseFull(URLS.calendar);
    // service_id → 'weekday' | 'saturday' | 'sunday'
    const serviceType = new Map();
    let brokenCalendar = false;
    if (calRows.length > 0) {
        const sample = calRows[0];
        if ('date' in sample) {
            // calendar_dates.txt format: one row per specific date
            for (const { service_id, date } of calRows) {
                if (service_id && date) serviceType.set(service_id, getDayType(date));
            }
        } else if (calRows.some(r => ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].some(d => r[d] === '1'))) {
            // calendar.txt with functional day-of-week flags
            const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
            for (const row of calRows) {
                if (!row.service_id) continue;
                if (WEEKDAYS.some(d => row[d] === '1'))  { serviceType.set(row.service_id, 'weekday');  continue; }
                if (row.saturday === '1')                 { serviceType.set(row.service_id, 'saturday'); continue; }
                if (row.sunday   === '1')                 { serviceType.set(row.service_id, 'sunday');   continue; }
            }
        } else {
            // calendar.txt with all day flags = 0 (broken/incomplete GTFS — known OASA issue).
            // Defer service_id mapping until after trips are loaded so we can pick only the
            // dominant service_ids (by trip count) and avoid merging different service patterns.
            brokenCalendar = true;
        }
    }

    // ── 3. Stops ─────────────────────────────────────────────────────────────
    console.log('[schedule] Fetching stops.txt…');
    const stopRows = await parseFull(URLS.stops);
    // stop_id → normalised Greek name
    const stopName = new Map();
    for (const s of stopRows) stopName.set(s.stop_id, normalise(s.stop_name));

    console.log(`[schedule] Routes: ${[...routeById.values()].join(', ')} | Services: pending | Stops: ${stopName.size}`);

    // ── 4. Trips ─────────────────────────────────────────────────────────────
    console.log('[schedule] Fetching trips.txt…');
    const tripRows = await parseFull(URLS.trips);
    // trip_id → { route, dir, svc }
    const tripMeta = new Map();
    for (const t of tripRows) {
        const route = routeById.get(t.route_id);
        if (route) tripMeta.set(t.trip_id, { route, dir: t.direction_id, svc: t.service_id });
    }

    // ── Broken-calendar fix ───────────────────────────────────────────────────
    // OASA publishes calendar.txt with all day-of-week flags set to 0.
    // In this feed, each service_id corresponds to exactly one calendar day,
    // numbered sequentially from start_date: service_id N → start_date + (N-1) days.
    // We infer the actual date — and therefore day type — from that mapping.
    if (brokenCalendar) {
        const startDate = calRows[0]?.start_date ?? null;
        if (startDate && /^\d{8}$/.test(startDate)) {
            const sy = +startDate.slice(0, 4);
            const sm = +startDate.slice(4, 6) - 1;
            const sd = +startDate.slice(6, 8);
            const epoch = new Date(sy, sm, sd).getTime();
            const MS_PER_DAY = 86400000;
            for (const { service_id } of calRows) {
                const n = parseInt(service_id, 10);
                if (!service_id || isNaN(n)) continue;
                const date = new Date(epoch + (n - 1) * MS_PER_DAY);
                const yyyymmdd = `${date.getFullYear()}` +
                    `${String(date.getMonth() + 1).padStart(2, '0')}` +
                    `${String(date.getDate()).padStart(2, '0')}`;
                serviceType.set(service_id, getDayType(yyyymmdd));
            }
            console.log(`[schedule] Broken calendar: inferred day types for ${serviceType.size} service_ids via sequential date mapping`);
        } else {
            // Absolute fallback — treat everything as weekday
            for (const { service_id } of calRows) {
                if (service_id) serviceType.set(service_id, 'weekday');
            }
            console.log(`[schedule] Broken calendar: fallback — all ${serviceType.size} service_ids mapped to weekday`);
        }
    }

    console.log(`[schedule] Services mapped: ${serviceType.size} | Trips: ${tripMeta.size}`);

    // ── 5. Stop times (large — stream line by line) ──────────────────────────
    console.log('[schedule] Streaming stop_times.txt (this may take a minute)…');

    // out[route][dir][normStopName][dayType] = Set<"HH:MM">
    const out = {};
    // termTracker['M3_0'] = { maxSeq, stopId }
    const termTracker = {};
    // m1TripTimes: `${dir}:${tripId}` → Map<stopName, minutes> — used for weekend synthesis
    const m1TripTimes = new Map();

    const stStream = await fetchStream(URLS.stop_times);
    const stRL = createInterface({ input: stStream, crlfDelay: Infinity });
    let stHeaders = null;
    let col = {};

    let dbgTotal = 0, dbgNoFields = 0, dbgNoTrip = 0, dbgNoStop = 0, dbgNoDay = 0, dbgAdded = 0;

    for await (const line of stRL) {
        if (!line.trim()) continue;
        const parts = line.split(',');

        if (!stHeaders) {
            stHeaders = parts.map(c => c.trim().replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim());
            stHeaders.forEach((h, i) => { col[h] = i; });
            continue;
        }

        dbgTotal++;

        const tripId  = parts[col.trip_id]?.trim().replace(/^"|"$/g, '');
        const depTime = parts[col.departure_time]?.trim().replace(/^"|"$/g, '');
        const stopId  = parts[col.stop_id]?.trim().replace(/^"|"$/g, '');
        const stopSeq = parseInt((parts[col.stop_sequence] ?? '').trim().replace(/^"|"$/g, '') || '0', 10);

        if (!tripId || !depTime || !stopId) { dbgNoFields++; continue; }

        const meta = tripMeta.get(tripId);
        if (!meta) { dbgNoTrip++; continue; }

        const stop    = stopName.get(stopId);
        if (!stop) { dbgNoStop++; continue; }

        const dayType = serviceType.get(meta.svc);
        if (!dayType) { dbgNoDay++; continue; }

        dbgAdded++;

        const { route, dir } = meta;

        // Collect per-trip stop times for M1 weekend synthesis
        if (route === 'M1') {
            const [hh, mm] = depTime.split(':');
            const mins = +hh * 60 + +mm; // keep GTFS >24h values intact
            const tk = `${dir}:${tripId}`;
            if (!m1TripTimes.has(tk)) m1TripTimes.set(tk, new Map());
            m1TripTimes.get(tk).set(stop, mins);
        }
        if (!out[route])             out[route]             = {};
        if (!out[route][dir])        out[route][dir]        = {};
        if (!out[route][dir][stop])  out[route][dir][stop]  = {};
        const bucket = out[route][dir][stop];
        if (!bucket[dayType])        bucket[dayType]        = new Set();
        bucket[dayType].add(formatTime(depTime));

        // Track the highest stop_sequence per route+dir to find each terminus
        const key = `${route}_${dir}`;
        if (!termTracker[key] || stopSeq > termTracker[key].maxSeq) {
            termTracker[key] = { maxSeq: stopSeq, stopId };
        }
    }

    console.log(`[schedule] stop_times: total=${dbgTotal} noFields=${dbgNoFields} noTrip=${dbgNoTrip} noStop=${dbgNoStop} noDay=${dbgNoDay} added=${dbgAdded}`);

    // ── M1 weekend synthesis ─────────────────────────────────────────────────
    // The GTFS feed only provides M1 trips for 2 weekdays. Synthesise Saturday
    // and Sunday schedules from the official frequency table:
    //   1. Compute average per-stop travel offsets from the terminus, using the
    //      existing weekday GTFS trip data.
    //   2. Generate terminus departure times from M1_WEEKEND_FREQ.
    //   3. Add offset to each departure to get per-stop times.
    if (out.M1) {
        // Step 1 — accumulate offsets (dir → stopName → [offset, ...])
        const rawOffsets = {}; // dir → Map<stopName, number[]>
        for (const [tk, stopTimes] of m1TripTimes) {
            const dir = tk.split(':')[0];
            if (stopTimes.size < 2) continue;
            const base = Math.min(...stopTimes.values()); // terminus departure
            for (const [stop, t] of stopTimes) {
                if (!rawOffsets[dir]) rawOffsets[dir] = new Map();
                const arr = rawOffsets[dir].get(stop) ?? [];
                arr.push(t - base);
                rawOffsets[dir].set(stop, arr);
            }
        }
        // Average each offset list → single number per stop
        const m1Offsets = {};
        for (const [dir, stopMap] of Object.entries(rawOffsets)) {
            m1Offsets[dir] = new Map();
            for (const [stop, list] of stopMap) {
                m1Offsets[dir].set(stop, Math.round(list.reduce((a, b) => a + b, 0) / list.length));
            }
        }

        // Step 2 — terminus departure times for Saturday/Sunday
        const terminusDeps = genDepartures(M1_WEEKEND_FREQ);

        // Step 3 — inject synthesised times into out.M1
        for (const [dir, stopOffsetMap] of Object.entries(m1Offsets)) {
            if (!out.M1[dir]) continue;
            for (const [stop, offset] of stopOffsetMap) {
                if (!out.M1[dir][stop]) continue;
                for (const dayType of ['saturday', 'sunday']) {
                    if (!out.M1[dir][stop][dayType]) out.M1[dir][stop][dayType] = new Set();
                    for (const base of terminusDeps) {
                        const total = Math.round(base + offset);
                        const h = Math.floor(total / 60) % 24;
                        const m = total % 60;
                        out.M1[dir][stop][dayType].add(
                            `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                        );
                    }
                }
            }
        }
        console.log('[schedule] M1 saturday/sunday synthesised from frequency table');
    }

    // ── Attach termini ───────────────────────────────────────────────────────
    // Stored at out[route]._termini = { "0": "normName", "1": "normName" }
    for (const [key, { stopId }] of Object.entries(termTracker)) {
        const [route, dir] = key.split('_');
        if (!out[route]) continue;
        if (!out[route]._termini) out[route]._termini = {};
        out[route]._termini[dir] = stopName.get(stopId) ?? null;
    }

    // ── Convert Sets → sorted arrays ─────────────────────────────────────────
    for (const [, routeData] of Object.entries(out)) {
        for (const [dirKey, dirData] of Object.entries(routeData)) {
            if (dirKey === '_termini') continue;
            for (const stopData of Object.values(dirData)) {
                for (const [dayType, set] of Object.entries(stopData)) {
                    stopData[dayType] = [...set].sort();
                }
            }
        }
    }

    writeFileSync(OUTPUT, JSON.stringify({
        generated:        new Date().toISOString(),
        gtfsLastModified: lastModified,
        routes:           out,
    }));

    console.log(`[schedule] Build complete → ${OUTPUT}`);
}
