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
    const check = { 'rail.json': checkRail, 'bus-stops.json': checkBus, 'bus-lines.json': checkBusLines }[name];
    const problems = check ? check(data) : [`${name}: no checks for this file`];
    return problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), `… and ${problems.length - MAX_PROBLEMS} more`] : problems;
}

/** @param {string} name @param {any} data @param {any} previous @returns {string[]} */
export function shrinkage(name, data, previous) {
    if (!previous) return [];
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

/** @param {any} fetched @param {string[]} problems */
function checkFetched(fetched, problems) {
    if (typeof fetched !== 'string' || Number.isNaN(Date.parse(fetched))) problems.push('fetched must be when the network was fetched (an ISO time)');
}

// Text in both languages
const names = value => typeof value?.el === 'string' && value.el !== '' && typeof value?.en === 'string' && value.en !== '';

/** @param {any} rail @returns {string[]} */
function checkRail(rail) {
    const problems = [];
    if (typeof rail?.schema !== 'number') return ['rail.json: no schema number'];
    checkFeed(rail.feed, problems);
    for (const day of WEEKDAYS) if (!DATE.test(rail.feed?.week?.[day])) problems.push(`feed.week.${day} must be YYYY-MM-DD`);
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
            for (const stop of stops) {
                if (!stations[stop.station]) problems.push(`${where}: unknown station ${stop.station}`);
                for (const p of [...(stop.exits ?? []), ...(stop.elevators ?? [])]) if (!POSITIONS.includes(p)) problems.push(`${where}: ${stop.station} has an unknown position ${p}`);
            }
            checkTimetable(where, dir.timetable, stops.length, problems);
        }
    }
    return problems;
}

/** @param {string} where @param {any} t @param {number} stopCount @param {string[]} problems */
function checkTimetable(where, t, stopCount, problems) {
    const profiles = t?.profiles ?? [];
    const patterns = t?.patterns ?? [];
    if (!Array.isArray(t?.days) || t.days.length !== 7) return problems.push(`${where}: the timetable needs a pattern for each of the 7 days`);
    if (t.days.some(d => !Number.isInteger(d) || !patterns[d])) problems.push(`${where}: a day points at a pattern that doesn't exist`);
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
    checkFetched(bus.fetched, problems);
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
    checkFetched(bus.fetched, problems);
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
            const stops = Array.isArray(d?.stops) ? d.stops : [];
            if (stops.length < 2) problems.push(`${which}, direction ${i}: fewer than two stops`);
            if (stops.some(code => typeof code !== 'string' || !STOP_CODE.test(code))) problems.push(`${which}, direction ${i}: stop codes must be numeric`);
        });
    }
    return problems;
}
