import { POSITIONS } from './validate.js';

// Checks on what a build made, before it replaces the files the site serves
// (runBuild in index.js). A build that fails them keeps the previous files,
// so a broken or half-published feed from OASA never reaches visitors.
//   checkOutput(name, data)          → problems with the file's shape (types/data.d.ts)
//   shrinkage(name, data, previous)  → a file much smaller than the last good one

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// #rgb or #rrggbb, as CSS takes them (and validate.js lets through)
const COLOR = /^#([0-9a-f]{3}){1,2}$/i;
// The bus API only accepts numeric stop codes (server/oasa/index.js)
export const STOP_CODE = /^\d{1,8}$/;
// Attica, with room to spare: anything outside is a broken coordinate
const inAttica = (lat, lng) => lat > 37 && lat < 39 && lng > 22.5 && lng < 25;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// A new file with fewer stations or stops than this share of the last one is held back
const MIN_SHARE = 0.8;
// Enough problems to see what's wrong, without listing thousands
const MAX_PROBLEMS = 10;

/** @param {string} name @param {any} data @returns {string[]} */
export function checkOutput(name, data) {
    const check = { 'rail.json': checkRail, 'bus-stops.json': checkBus, 'bus-lines.json': checkBusLines, 'bus-rides.json': checkBusRides, 'buses.json': checkBuses, 'trains.json': checkTrains }[name];
    const problems = check ? check(data) : [`${name}: no checks for this file`];
    return problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), `… and ${problems.length - MAX_PROBLEMS} more`] : problems;
}

/** @param {string} name @param {any} data @param {any} previous @returns {string[]} */
export function shrinkage(name, data, previous) {
    // Ride times come and go with the days of passes kept (build-rides.js),
    // and the trains' days move on each night, fewer while railway.gov.gr fails (railway.js)
    if (!previous || name === 'bus-rides.json' || name === 'trains.json') return [];
    const [count, what] = {
        'rail.json': [d => Object.keys(d?.stations ?? {}).length, 'stations'],
        'bus-lines.json': [d => d?.lines?.length ?? 0, 'lines'],
    }[name] ?? [d => d?.stops?.length ?? 0, 'stops'];
    const [now, before] = [count(data), count(previous)];
    return now < before * MIN_SHARE
        ? [`${name} has ${now} ${what}, the last good build had ${before}; if that's right, rebuild with --force`]
        : [];
}

/** @param {any} feed @param {string[]} problems */
function checkFeed(feed, problems) {
    if (!DATE.test(feed?.validFrom) || !DATE.test(feed?.validTo)) problems.push('feed: validFrom and validTo must be YYYY-MM-DD');
    else if (feed.validFrom > feed.validTo) problems.push(`feed: validFrom ${feed.validFrom} is after validTo ${feed.validTo}`);
}

// Text in both languages
const names = value => typeof value?.el === 'string' && value.el !== '' && typeof value?.en === 'string' && value.en !== '';

/** @param {any} rail @returns {string[]} */
function checkRail(rail) {
    const problems = [];
    if (typeof rail?.schema !== 'number') return ['rail.json: no schema number'];
    checkFeed(rail.feed, problems);
    for (const day of WEEKDAYS) if (!DATE.test(rail.feed?.week?.[day])) problems.push(`feed.week.${day} must be YYYY-MM-DD`);
    if (rail.hours !== undefined && !DATE.test(rail.hours?.fetched)) problems.push('hours.fetched must be YYYY-MM-DD');
    if (JSON.stringify(rail.positions) !== JSON.stringify(POSITIONS)) problems.push(`positions must be ${POSITIONS.join(', ')}`);

    const stations = rail.stations ?? {};
    const lines = rail.lines ?? {};
    if (!Object.keys(stations).length) problems.push('no stations');
    if (!Object.keys(lines).length) problems.push('no lines');

    for (const [id, s] of Object.entries(stations)) {
        if (!s.name?.en || !s.name?.el) problems.push(`station ${id}: needs a name in English and Greek`);
        const [lat, lng] = Array.isArray(s.coords) ? s.coords : [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inAttica(lat, lng)) problems.push(`station ${id}: coordinates ${JSON.stringify(s.coords)} aren't in Attica`);
        if (!Array.isArray(s.lines) || !s.lines.length) problems.push(`station ${id}: on no line`);
        for (const line of s.lines ?? []) if (!lines[line]) problems.push(`station ${id}: unknown line ${line}`);
    }

    for (const [lineId, line] of Object.entries(lines)) {
        if (!line.name || !COLOR.test(line.color ?? '')) problems.push(`line ${lineId}: needs a name and a #rgb or #rrggbb colour`);
        const directions = Object.entries(line.directions ?? {});
        if (!directions.length) problems.push(`line ${lineId}: no directions`);
        for (const [dirId, dir] of directions) {
            const where = `${lineId}/${dirId}`;
            if (!dir.toward?.en || !dir.toward?.el) problems.push(`${where}: needs "toward" in English and Greek`);
            const stops = dir.stops ?? [];
            if (stops.length < 2) problems.push(`${where}: fewer than two stops`);
            stops.forEach((stop, i) => {
                if (!stations[stop.station]) problems.push(`${where}: unknown station ${stop.station}`);
                for (const p of [...(stop.exits ?? []), ...(stop.elevators ?? []), ...(stop.escalators ?? []), ...(stop.stairs ?? [])]) if (!POSITIONS.includes(p)) problems.push(`${where}: ${stop.station} has an unknown position ${p}`);
                if (stop.hours !== undefined) checkHours(`${where}/${stop.station}`, stop.hours, stops.slice(i + 1).map(s => s.station), problems);
            });
            checkTimetable(where, dir.timetable, stops.length, problems);
        }
    }
    return problems;
}

// A stop's first and last trains (stasy.js): [{ to, first, last }], to a stop
// further on, a time (or null: all night) for each day
/** @param {string} where @param {any} hours @param {string[]} ahead @param {string[]} problems */
function checkHours(where, hours, ahead, problems) {
    if (!Array.isArray(hours) || !hours.length) return problems.push(`${where}: hours must be a list of destinations`);
    for (const h of hours) {
        if (!ahead.includes(h?.to)) problems.push(`${where}: hours to ${h?.to}, which isn't further on`);
        for (const kind of ['first', 'last']) {
            const values = h?.[kind];
            if (!Array.isArray(values) || values.length !== 7 || values.some(v => v !== null && !(Number.isInteger(v) && v >= 0 && v < 2 * 86_400))) {
                problems.push(`${where}: hours to ${h?.to} need a ${kind} time or null for each of the 7 days`);
            }
        }
    }
}

/** @param {string} where @param {any} t @param {number} stopCount @param {string[]} problems */
function checkTimetable(where, t, stopCount, problems) {
    const profiles = t?.profiles ?? [];
    const patterns = t?.patterns ?? [];
    if (!Array.isArray(t?.days) || t.days.length !== 7) return problems.push(`${where}: the timetable needs a pattern for each of the 7 days`);
    if (t.days.some(d => !Number.isInteger(d) || !patterns[d])) problems.push(`${where}: a day points at a pattern that doesn't exist`);
    if (t.dates !== undefined) {
        const dates = Object.entries(t.dates ?? {});
        if (!t.dates || typeof t.dates !== 'object' || dates.some(([date]) => !/^\d{4}-\d\d-\d\d$/.test(date))) problems.push(`${where}: dates need to be YYYY-MM-DD`);
        if (dates.some(([, d]) => !Number.isInteger(d) || !patterns[d])) problems.push(`${where}: a date points at a pattern that doesn't exist`);
    }
    profiles.forEach((p, i) => {
        if (!p.stops?.length || p.stops.length !== p.offsets?.length) problems.push(`${where}: profile ${i} needs as many offsets as stops`);
        if (p.stops?.some(s => !Number.isInteger(s) || s < 0 || s >= stopCount)) problems.push(`${where}: profile ${i} points at a stop that doesn't exist`);
        if (p.offsets?.some((o, j) => j > 0 && o < p.offsets[j - 1])) problems.push(`${where}: profile ${i} goes back in time`);
    });
    patterns.forEach((trips, i) => {
        if (trips.some(([start, profile]) => !Number.isFinite(start) || start < 0 || !profiles[profile])) problems.push(`${where}: pattern ${i} has a trip with a bad start or profile`);
    });
    if (!patterns.some(trips => trips.length)) problems.push(`${where}: no trips on any day`);
}

/** @param {any} bus @returns {string[]} */
function checkBus(bus) {
    const problems = [];
    if (typeof bus?.schema !== 'number') return ['bus-stops.json: no schema number'];
    if (JSON.stringify(bus.fields) !== JSON.stringify(['code', 'lat', 'lng', 'el', 'en', 'lines'])) problems.push('fields must be code, lat, lng, el, en, lines');
    const stops = Array.isArray(bus.stops) ? bus.stops : [];
    if (!stops.length) problems.push('no stops');
    const seen = new Set();
    for (const row of stops) {
        const [code, lat, lng, el, en, lines] = Array.isArray(row) ? row : [];
        const which = `stop ${JSON.stringify(code)}`;
        if (typeof code !== 'string' || !STOP_CODE.test(code)) problems.push(`${which}: the code must be numeric`);
        else if (seen.has(code)) problems.push(`${which}: listed twice`);
        seen.add(code);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inAttica(lat, lng)) problems.push(`${which}: coordinates [${lat}, ${lng}] aren't in Attica`);
        if (typeof el !== 'string' || !el) problems.push(`${which}: no Greek name`);
        if (typeof en !== 'string') problems.push(`${which}: the English name must be text (it may be empty)`);
        if (!Array.isArray(lines) || !lines.length || lines.some(l => typeof l !== 'string' || !l)) problems.push(`${which}: needs its line numbers`);
    }
    return problems;
}

/** @param {any} bus @returns {string[]} */
function checkBusLines(bus) {
    const problems = [];
    if (typeof bus?.schema !== 'number') return ['bus-lines.json: no schema number'];
    const lines = Array.isArray(bus.lines) ? bus.lines : [];
    if (!lines.length) problems.push('no lines');
    const seen = new Set();
    for (const entry of lines) {
        const which = `line ${JSON.stringify(entry?.line)}`;
        if (typeof entry?.line !== 'string' || !entry.line) problems.push(`${which}: needs its number`);
        else if (seen.has(entry.line)) problems.push(`${which}: listed twice`);
        seen.add(entry?.line);
        if (!names(entry?.name)) problems.push(`${which}: needs its name in Greek and English`);
        const directions = Array.isArray(entry?.directions) ? entry.directions : [];
        if (directions.length < 1 || directions.length > 2) problems.push(`${which}: needs one or two directions`);
        directions.forEach((d, i) => {
            if (!names(d?.to)) problems.push(`${which}, direction ${i}: needs where it goes, in Greek and English`);
            if (typeof d?.route !== 'string' || !/^\d+$/.test(d.route)) problems.push(`${which}, direction ${i}: needs its OASA route code`);
            const stops = Array.isArray(d?.stops) ? d.stops : [];
            if (stops.length < 2) problems.push(`${which}, direction ${i}: fewer than two stops`);
            if (stops.some(code => typeof code !== 'string' || !STOP_CODE.test(code))) problems.push(`${which}, direction ${i}: stop codes must be numeric`);
        });
    }
    return problems;
}

/** @param {any} data @returns {string[]} */
function checkBusRides(data) {
    if (typeof data?.schema !== 'number') return ['bus-rides.json: wrong schema number'];
    if (!Array.isArray(data.rides)) return ['bus-rides.json: no rides list'];
    const problems = [];
    for (const r of data.rides) {
        const where = `bus-rides.json: route ${r?.route} ${r?.from}→${r?.to}`;
        if (!/^\d+$/.test(r?.route ?? '') || !STOP_CODE.test(r?.from ?? '') || !STOP_CODE.test(r?.to ?? '')) problems.push(`${where}: bad route or stop code`);
        else if (!Object.values(r.times ?? {}).length || !Object.values(r.times).every(t => Array.isArray(t) && t.length === 3 && t.every(n => Number.isInteger(n) && n > 0))) {
            problems.push(`${where}: times must be [rides, median, slowest tenth] in whole seconds`);
        }
    }
    return problems;
}

// The buses' timetable for the trip search (bus-timetable.js)
/** @param {any} data @returns {string[]} */
function checkBuses(data) {
    if (typeof data?.schema !== 'number') return ['buses.json: wrong schema number'];
    const problems = [];
    checkFeed(data.feed, problems);
    const stops = Array.isArray(data.stops) ? data.stops : [];
    const routes = Array.isArray(data.routes) ? data.routes : [];
    if (!stops.length || !routes.length) return [...problems, 'buses.json: no stops or no routes'];
    stops.forEach((stop, i) => {
        const [code, lat, lng, el, en] = Array.isArray(stop) ? stop : [];
        if (!STOP_CODE.test(code ?? '') || !inAttica(lat, lng) || typeof el !== 'string' || !el || typeof en !== 'string') {
            problems.push(`buses.json: stop ${i} must be [numeric code, lat, lng in Attica, Greek name, English name or '']`);
        }
    });
    const index = (n, length) => Number.isInteger(n) && n >= 0 && n < length;
    const seconds = n => Number.isInteger(n) && n >= 0;
    for (const route of routes) {
        const where = `buses.json: line ${route?.line} route ${route?.code}`;
        if (typeof route?.line !== 'string' || !route.line || !['bus', 'trolley'].includes(route.mode) || !/^\d+$/.test(route.code ?? '')) {
            problems.push(`${where}: needs its line, bus or trolley, and its OASA route code`);
            continue;
        }
        const along = Array.isArray(route.stops) ? route.stops : [];
        if (along.length < 2 || !along.every(stop => index(stop, stops.length))) problems.push(`${where}: needs two stops or more, from the list`);
        const runs = Array.isArray(route.runs) ? route.runs : [];
        if (!runs.length || !runs.every(run => Array.isArray(run) && run.length === along.length - 1 && run.every(seconds))) {
            problems.push(`${where}: each run needs a time in whole seconds to each next stop`);
        }
        const patterns = Array.isArray(route.patterns) ? route.patterns : [];
        if (!patterns.every(trips => Array.isArray(trips) && trips.every(trip => Array.isArray(trip) && seconds(trip[0]) && index(trip[1], runs.length)))) {
            problems.push(`${where}: each trip needs its seconds after the one before and a run`);
        }
        if (!Array.isArray(route.days) || route.days.length !== 7 || !route.days.every(day => index(day, patterns.length))) problems.push(`${where}: needs a pattern for each weekday`);
    }
    return problems;
}

/** @param {any} data @returns {string[]} */
function checkTrains(data) {
    if (typeof data?.schema !== 'number') return ['trains.json: wrong schema number'];
    const problems = [];
    const stations = data.stations && typeof data.stations === 'object' ? data.stations : {};
    if (!Object.keys(stations).length) problems.push('trains.json: no stations');
    for (const [id, station] of Object.entries(stations)) {
        const [lat, lng, el, en] = Array.isArray(station) ? station : [];
        if (!inAttica(lat, lng) || typeof el !== 'string' || !el || typeof en !== 'string' || !en) problems.push(`trains.json: station ${id} must be [lat, lng, Greek name, English name]`);
    }
    const dates = data.dates && typeof data.dates === 'object' ? data.dates : {};
    const seconds = n => Number.isInteger(n) && n >= 0;
    for (const [date, routes] of Object.entries(dates)) {
        if (!DATE.test(date) || !Array.isArray(routes)) { problems.push(`trains.json: ${date} must be YYYY-MM-DD with a list of routes`); continue; }
        for (const route of routes) {
            const where = `trains.json: ${date} line ${route?.line}`;
            const along = Array.isArray(route?.stops) ? route.stops : [];
            if (typeof route?.line !== 'string' || along.length < 2 || !along.every(stop => Object.hasOwn(stations, stop))) {
                problems.push(`${where}: needs its line and two of the stations or more`);
                continue;
            }
            const profiles = Array.isArray(route.profiles) ? route.profiles : [];
            if (!profiles.length || !profiles.every(p => Array.isArray(p) && p.length === along.length && p[0] === 0 && p.every((t, i) => seconds(t) && (!i || t >= p[i - 1])))) {
                problems.push(`${where}: each profile needs the seconds from its first stop to each, going forward`);
            }
            const trips = Array.isArray(route.trips) ? route.trips : [];
            if (!trips.length || !trips.every(trip => Array.isArray(trip) && seconds(trip[0]) && Number.isInteger(trip[1]) && trip[1] >= 0 && trip[1] < profiles.length)) {
                problems.push(`${where}: each trip needs its start in seconds and a profile`);
            }
        }
    }
    return problems;
}
