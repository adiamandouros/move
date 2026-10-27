import { stasyNameKey } from './stasy.js';

// Car positions, ordered from the back of the train to the front.
/** @type {import('../../types/data.js').Position[]} */
export const POSITIONS = ['back', 'center-back', 'center', 'center-front', 'front'];

// How a platform is reached from the street without steps, or 'no' (none);
// 'yes' when it is, but how isn't recorded. Left out: not known yet.
/** @type {import('../../types/data.js').StepFree[]} */
export const STEP_FREE = ['lift', 'ramp', 'level', 'yes', 'no'];

const POSITION_KEYS = new Set(['exits', 'elevators', 'escalators', 'stairs', 'centralPlatform', 'stepFree', 'transfers', 'note']);

// Check the hand-maintained files in data/curated for mistakes. Returns
// { errors, warnings }; any error fails the build. Kept independent of the
// GTFS feed so it can run in tests and before every build.
/** @param {{ stations: any, lines: any, positions: any, airport?: any, tram?: any }} curated */
export function validateCurated({ stations, lines, positions, airport, tram }) {
    const errors = [];
    const warnings = [];

    const stationIds = new Set(Object.keys(stations.stations ?? {}));
    const seenCodes = new Map();
    for (const [id, s] of Object.entries(stations.stations ?? {})) {
        if (!s.name?.el || !s.name?.en) errors.push(`stations.json: ${id} needs name.el and name.en`);
        if (!Array.isArray(s.gtfs) || !s.gtfs.length) errors.push(`stations.json: ${id} has no gtfs codes`);
        for (const code of s.gtfs ?? []) {
            if (seenCodes.has(code)) errors.push(`stations.json: gtfs code ${code} is used by both ${seenCodes.get(code)} and ${id}`);
            seenCodes.set(code, id);
        }
        if (s.stasy !== undefined && (!Array.isArray(s.stasy) || s.stasy.some(name => typeof name !== 'string' || !name.trim()))) {
            errors.push(`stations.json: ${id}.stasy must be a list of names`);
        }
    }
    // How STASY writes a name must lead to one station
    const named = new Map();
    for (const [id, s] of Object.entries(stations.stations ?? {})) {
        for (const name of [s.name?.el, ...(Array.isArray(s.stasy) ? s.stasy : [])].filter(n => typeof n === 'string')) {
            const key = stasyNameKey(name);
            if (named.has(key) && named.get(key) !== id) errors.push(`stations.json: the name "${name}" is used by both ${named.get(key)} and ${id}`);
            named.set(key, id);
        }
    }

    const directionRefs = new Set();
    for (const [lineId, line] of Object.entries(lines)) {
        if (!line.name || !line.color) errors.push(`lines.json: ${lineId} needs name and color`);
        const gtfsDirs = new Set();
        for (const [dirKey, dir] of Object.entries(line.directions ?? {})) {
            directionRefs.add(`${lineId}/${dirKey}`);
            if (!dir.toward?.el || !dir.toward?.en) errors.push(`lines.json: ${lineId}/${dirKey} needs toward.el and toward.en`);
            if (gtfsDirs.has(dir.gtfsDirection)) errors.push(`lines.json: ${lineId} has two directions with gtfsDirection ${dir.gtfsDirection}`);
            gtfsDirs.add(dir.gtfsDirection);
        }
    }

    const checkPositions = (where, list) => {
        if (!Array.isArray(list)) { errors.push(`${where} must be a list`); return; }
        for (const p of list) if (!POSITIONS.includes(p)) errors.push(`${where}: unknown position "${p}" (use ${POSITIONS.join(', ')})`);
    };

    for (const [lineId, dirs] of Object.entries(positions)) {
        if (!lines[lineId]) { errors.push(`positions.json: unknown line ${lineId}`); continue; }
        for (const [dirKey, stops] of Object.entries(dirs)) {
            if (!lines[lineId].directions[dirKey]) { errors.push(`positions.json: unknown direction ${lineId}/${dirKey}`); continue; }
            for (const [stationId, p] of Object.entries(stops)) {
                const where = `positions.json: ${lineId}/${dirKey}/${stationId}`;
                if (!stationIds.has(stationId)) { errors.push(`${where}: unknown station`); continue; }
                for (const key of Object.keys(p)) if (!POSITION_KEYS.has(key)) errors.push(`${where}: unknown field "${key}"`);
                checkPositions(`${where}.exits`, p.exits ?? []);
                for (const key of ['elevators', 'escalators', 'stairs']) if (p[key]) checkPositions(`${where}.${key}`, p[key]);
                if (p.note !== undefined && typeof p.note !== 'string') errors.push(`${where}.note must be text`);
                if (p.centralPlatform !== undefined && typeof p.centralPlatform !== 'boolean') errors.push(`${where}.centralPlatform must be true or false`);
                if (p.stepFree !== undefined && !STEP_FREE.includes(p.stepFree)) errors.push(`${where}.stepFree must be one of ${STEP_FREE.join(', ')}`);
                for (const [ref, list] of Object.entries(p.transfers ?? {})) {
                    if (!directionRefs.has(ref)) errors.push(`${where}.transfers: unknown direction "${ref}"`);
                    else if (ref.startsWith(`${lineId}/`)) errors.push(`${where}.transfers: "${ref}" is on the same line`);
                    checkPositions(`${where}.transfers.${ref}`, list);
                }
            }
        }
    }

    if (airport !== undefined) checkAirport(airport, stationIds, lines, errors);
    if (tram !== undefined) checkTram(tram, stationIds, seenCodes, errors);
    return { errors, warnings };
}

// airport.json: STASY's airport trains (build-rail.js, addTimetabled), with
// where they came from, to check they haven't changed (airport-check.js)
function checkAirport(airport, stationIds, lines, errors) {
    if (!/^\d{4}-\d\d-\d\d$/.test(airport?.checked ?? '')) errors.push('airport.json: "checked" must be a date, YYYY-MM-DD');
    if (!/^https:\/\/www\.stasy\.gr\//.test(airport?.page ?? '')) errors.push('airport.json: "page" must be the STASY page that links the PDFs');
    for (const [lineId, directions] of Object.entries(airport?.lines ?? {})) {
        for (const [dirKey, d] of Object.entries(directions)) {
            const where = `airport.json: ${lineId}/${dirKey}`;
            if (!lines[lineId]?.directions?.[dirKey]) { errors.push(`${where}: unknown direction`); continue; }
            if (!/^https:\/\/www\.stasy\.gr\/wp-content\/uploads\/.+\.pdf$/.test(d.pdf ?? '')) errors.push(`${where}: "pdf" must be the address of STASY's PDF`);
            if (!/^[0-9a-f]{64}$/.test(d.sha256 ?? '')) errors.push(`${where}: "sha256" must be the PDF's SHA-256, in hex`);
            const list = Array.isArray(d.stations) ? d.stations : [];
            if (!list.length) errors.push(`${where}: "stations" must list the stations in travel order`);
            for (const s of list.filter(s => !stationIds.has(s))) errors.push(`${where}: unknown station ${s}`);
            if (!list.includes(d.serves)) errors.push(`${where}: "serves" must be one of its stations`);
            for (const [i, train] of (Array.isArray(d.trains) ? d.trains : []).entries()) {
                const times = Array.isArray(train?.times) ? train.times : [];
                const name = `${where}: train ${i + 1}${train?.train ? ` (${train.train})` : ''}`;
                if (times.length !== list.length) errors.push(`${name} needs one time per station`);
                else if (times.some(t => !/^\d\d:[0-5]\d$/.test(t))) errors.push(`${name}: times must be HH:MM (after midnight 24:05)`);
                else if (times.some((t, k) => k > 0 && t < times[k - 1])) errors.push(`${name} goes back in time`);
            }
            if (!Array.isArray(d.trains) || !d.trains.length) errors.push(`${where}: "trains" must list its trains`);
        }
    }
}

// tram.json: the tram map's lines and stops (build-tram.js), in the style of
// lines.json and stations.json; `metro` is the metro station a stop changes to
function checkTram(tram, stationIds, metroCodes, errors) {
    for (const [lineId, line] of Object.entries(tram?.lines ?? {})) {
        if (!line.name || !/^#[0-9a-f]{6}$/i.test(line.color ?? '')) errors.push(`tram.json: ${lineId} needs a name and a #rrggbb color`);
        const gtfsDirs = new Set();
        for (const [dirKey, dir] of Object.entries(line.directions ?? {})) {
            if (!dir.toward?.el || !dir.toward?.en) errors.push(`tram.json: ${lineId}/${dirKey} needs toward.el and toward.en`);
            if (gtfsDirs.has(dir.gtfsDirection)) errors.push(`tram.json: ${lineId} has two directions with gtfsDirection ${dir.gtfsDirection}`);
            gtfsDirs.add(dir.gtfsDirection);
        }
        if (!gtfsDirs.size) errors.push(`tram.json: ${lineId} has no directions`);
    }
    const seen = new Map();
    for (const [id, s] of Object.entries(tram?.stops ?? {})) {
        if (!s.name?.el || !s.name?.en) errors.push(`tram.json: ${id} needs name.el and name.en`);
        if (!Array.isArray(s.gtfs) || !s.gtfs.length) errors.push(`tram.json: ${id} has no gtfs codes`);
        for (const code of s.gtfs ?? []) {
            const user = seen.get(code) ?? metroCodes.get(code);
            if (user) errors.push(`tram.json: gtfs code ${code} is used by both ${user} and ${id}`);
            seen.set(code, id);
        }
        if (s.metro !== undefined && !stationIds.has(s.metro)) errors.push(`tram.json: ${id} changes to an unknown metro station "${s.metro}"`);
    }
}
