import { stasyNameKey } from './stasy.js';

/** @typedef {import('../../types/data.js').CuratedLines} CuratedLines */

// Car positions, ordered from the back of the train to the front.
/** @type {import('../../types/data.js').Position[]} */
export const POSITIONS = ['back', 'center-back', 'center', 'center-front', 'front'];

// How a platform is reached from the street without steps, or 'no' (none);
// 'yes' when it is, but how isn't recorded. Left out: not known yet.
/** @type {import('../../types/data.js').StepFree[]} */
export const STEP_FREE = ['lift', 'ramp', 'level', 'yes', 'no'];

// A platform's elevators: this instead of the list when it has none. Left
// out: not known yet. A list holds each elevator as { at, name? }, its name
// as STASY's lift page writes it (server/info/lifts.js).
export const NO_ELEVATOR = 'none';
const ELEVATOR_KEYS = new Set(['at', 'name']);

const POSITION_KEYS = new Set(['exits', 'elevators', 'escalators', 'stairs', 'centralPlatform', 'stepFree', 'transfers', 'crossing', 'note']);

// How a street exit is reached from inside: up the stairs, an escalator up
// (toward the street), an escalator down
export const EXIT_WAYS = ['stairs', 'escalator-up', 'escalator-down'];

// A platform's way to the other side of the tracks (an M1 surface station's):
// over a footbridge or through an underpass, reached from the platform up
// or down the stairs, an escalator, an elevator or a ramp
export const CROSSING_VIA = ['bridge', 'underpass'];
export const CROSSING_WAYS = [...EXIT_WAYS, 'lift', 'ramp'];
const CROSSING_KEYS = ['at', 'via', 'way'];

// Where a place on the street can be, [lat, lng]: around the metro, wide.
// Outside it is a mistake (latitude and longitude swapped, a digit lost).
/** @type {{ lat: [number, number], lng: [number, number] }} */
export const ATHENS = { lat: [37.7, 38.3], lng: [23.4, 24.2] };
// Where a suburban railway station can be: from Kiato to Chalkida, wide
/** @type {{ lat: [number, number], lng: [number, number] }} */
const SUBURBAN = { lat: [37.8, 38.6], lng: [22.6, 24.1] };

// Check the hand-maintained files in data/curated for mistakes. Returns
// { errors, warnings }; any error fails the build. Kept independent of the
// GTFS feed so it can run in tests and before every build.
/** @param {import('../../types/data.js').Curated} curated */
export function validateCurated({ stations, lines, positions, airport, tram, street, suburban, osm }) {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];

    const stationIds = new Set(Object.keys(stations.stations ?? {}));
    /** @type {Map<string, string>} */
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
        for (const name of [s.name?.el, ...(Array.isArray(s.stasy) ? s.stasy : [])].flatMap(n => typeof n === 'string' ? [n] : [])) {
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

    /** @param {string} where @param {unknown} list */
    const checkPositions = (where, list) => {
        if (!Array.isArray(list)) { errors.push(`${where} must be a list`); return; }
        for (const p of list) if (!POSITIONS.includes(p)) errors.push(`${where}: unknown position "${p}" (use ${POSITIONS.join(', ')})`);
    };

    /** @param {string} where @param {unknown} elevators */
    const checkElevators = (where, elevators) => {
        if (elevators === NO_ELEVATOR) return;
        if (!Array.isArray(elevators)) { errors.push(`${where} must be "${NO_ELEVATOR}" or a list of elevators`); return; }
        for (const [i, lift] of elevators.entries()) {
            const at = `${where}[${i}]`;
            if (typeof lift !== 'object' || lift === null) { errors.push(`${at} must be { "at": position, "name": … }`); continue; }
            for (const key of Object.keys(lift)) if (!ELEVATOR_KEYS.has(key)) errors.push(`${at}: unknown field "${key}"`);
            if (!POSITIONS.includes(lift.at)) errors.push(`${at}.at: unknown position "${lift.at}" (use ${POSITIONS.join(', ')})`);
            if (lift.name !== undefined && (typeof lift.name !== 'string' || !lift.name.trim())) errors.push(`${at}.name must be text`);
        }
    };

    // Where to stand for it, what it is and how it's reached, each while the
    // others aren't known yet
    /** @param {string} where @param {import('../../types/data.js').Crossing} crossing */
    const checkCrossing = (where, crossing) => {
        if (typeof crossing !== 'object' || crossing === null || Array.isArray(crossing)) { errors.push(`${where} must be { "at": [positions], "via": …, "way": […] }`); return; }
        for (const key of Object.keys(crossing)) if (!CROSSING_KEYS.includes(key)) errors.push(`${where}: unknown field "${key}"`);
        if (crossing.at !== undefined) checkPositions(`${where}.at`, crossing.at);
        if (crossing.via !== undefined && !CROSSING_VIA.includes(crossing.via)) errors.push(`${where}.via must be one of ${CROSSING_VIA.join(', ')}`);
        if (crossing.way !== undefined && (!Array.isArray(crossing.way) || crossing.way.some(w => !CROSSING_WAYS.includes(w)))) errors.push(`${where}.way must be a list of ${CROSSING_WAYS.join(', ')}`);
    };

    // The lines that call at each station, as positions.json has them
    /** @type {Map<string, Set<string>>} */
    const linesAt = new Map();
    for (const [lineId, dirs] of Object.entries(positions)) {
        if (!lines[lineId]) { errors.push(`positions.json: unknown line ${lineId}`); continue; }
        for (const [dirKey, stops] of Object.entries(dirs)) {
            if (!lines[lineId].directions[dirKey]) { errors.push(`positions.json: unknown direction ${lineId}/${dirKey}`); continue; }
            for (const [stationId, p] of Object.entries(stops)) {
                const where = `positions.json: ${lineId}/${dirKey}/${stationId}`;
                if (!stationIds.has(stationId)) { errors.push(`${where}: unknown station`); continue; }
                let at = linesAt.get(stationId);
                if (!at) linesAt.set(stationId, at = new Set());
                at.add(lineId);
                for (const key of Object.keys(p)) if (!POSITION_KEYS.has(key)) errors.push(`${where}: unknown field "${key}"`);
                checkPositions(`${where}.exits`, p.exits ?? []);
                for (const key of /** @type {const} */ (['escalators', 'stairs'])) if (p[key]) checkPositions(`${where}.${key}`, p[key]);
                if (p.elevators !== undefined) checkElevators(`${where}.elevators`, p.elevators);
                if (p.note !== undefined && typeof p.note !== 'string') errors.push(`${where}.note must be text`);
                if (p.centralPlatform !== undefined && typeof p.centralPlatform !== 'boolean') errors.push(`${where}.centralPlatform must be true or false`);
                if (p.stepFree !== undefined && !STEP_FREE.includes(p.stepFree)) errors.push(`${where}.stepFree must be one of ${STEP_FREE.join(', ')}`);
                if (p.crossing !== undefined) checkCrossing(`${where}.crossing`, p.crossing);
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
    if (street !== undefined) checkStreet(street, stationIds, linesAt, errors);
    if (suburban !== undefined) checkSuburban(suburban, stationIds, street, errors, warnings);
    if (osm !== undefined) checkOsm(osm, stationIds, errors);
    return { errors, warnings };
}

// street.json: each station's exits to the street and its lifts there, each
// with its name (an exit's as its signs write it, in Greek and, when signed,
// English; a lift's as STASY's lift page does) and where it is, or one of
// them while the other isn't known yet; and `osm`, OpenStreetMap's exits
// there (osm.json) the field trips have dealt with, by their ids. An exit
// of a station that's two buildings says the lines it serves (`lines`), of
// those that call there (`linesAt`, decision 73)
/**
 * @param {import('../../types/data.js').CuratedStreet} street @param {Set<string>} stationIds
 * @param {Map<string, Set<string>>} linesAt @param {string[]} errors
 */
function checkStreet(street, stationIds, linesAt, errors) {
    /** @param {unknown} value */
    const text = value => typeof value === 'string' && value.trim() !== '';
    /** @param {string} where @param {unknown} coords */
    const checkCoords = (where, coords) => {
        if (coords === undefined) return;
        const [lat, lng] = Array.isArray(coords) ? coords : [];
        /** @param {unknown} n @param {[number, number]} range */
        const inside = (n, [min, max]) => typeof n === 'number' && n >= min && n <= max;
        if (!Array.isArray(coords) || coords.length !== 2 || !inside(lat, ATHENS.lat) || !inside(lng, ATHENS.lng)) {
            errors.push(`${where}.coords must be [latitude, longitude] around Athens, like [37.97552, 23.73481]`);
        }
    };
    /** @param {string} where @param {unknown} item @param {string[]} keys */
    const checkFields = (where, item, keys) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) { errors.push(`${where} must be an object`); return false; }
        for (const key of Object.keys(item)) if (!keys.includes(key)) errors.push(`${where}: unknown field "${key}"`);
        return true;
    };
    for (const [stationId, entry] of Object.entries(street ?? {})) {
        const where = `street.json: ${stationId}`;
        if (!stationIds.has(stationId)) { errors.push(`${where}: unknown station`); continue; }
        if (!checkFields(where, entry, ['exits', 'lifts', 'osm'])) continue;
        if (entry.osm !== undefined && (!Array.isArray(entry.osm) || entry.osm.some(id => !OSM_ID.test(id)))) errors.push(`${where}.osm must be a list of OpenStreetMap ids, like "n2484170076"`);
        for (const key of /** @type {const} */ (['exits', 'lifts'])) if (entry[key] !== undefined && !Array.isArray(entry[key])) errors.push(`${where}.${key} must be a list`);
        for (const [i, exit] of (Array.isArray(entry.exits) ? entry.exits : []).entries()) {
            const at = `${where}.exits[${i}]`;
            if (!checkFields(at, exit, ['name', 'coords', 'way', 'lines'])) continue;
            const serving = [...linesAt.get(stationId) ?? []];
            if (exit.lines !== undefined && (!Array.isArray(exit.lines) || !exit.lines.length || exit.lines.some(line => !serving.includes(line)))) {
                errors.push(`${at}.lines must list lines that call there (${serving.join(', ')})`);
            }
            const el = exit.name?.el, en = exit.name?.en;
            if (exit.name !== undefined && (!(text(el) || text(en)) || [el, en].some(n => n !== undefined && !text(n)))) errors.push(`${at}.name must be { "el": …, "en": … }, either one while the other isn't known`);
            if (exit.name === undefined && exit.coords === undefined) errors.push(`${at} needs its name or where it is`);
            checkCoords(at, exit.coords);
            if (exit.way !== undefined && (!Array.isArray(exit.way) || exit.way.some(w => !EXIT_WAYS.includes(w)))) errors.push(`${at}.way must be a list of ${EXIT_WAYS.join(', ')}`);
        }
        for (const [i, lift] of (Array.isArray(entry.lifts) ? entry.lifts : []).entries()) {
            const at = `${where}.lifts[${i}]`;
            if (!checkFields(at, lift, ['name', 'coords'])) continue;
            if (lift.name !== undefined && !text(lift.name)) errors.push(`${at}.name must be text`);
            if (lift.name === undefined && lift.coords === undefined) errors.push(`${at} needs its name or where it is`);
            checkCoords(at, lift.coords);
        }
    }
}

// An OpenStreetMap element: n, w or r (node, way, relation) and its number
const OSM_ID = /^[nwr][1-9]\d*$/;

// osm.json: OpenStreetMap's exits at each metro station that has any
// (scripts/osm-exits.js): each with the ids of its doors there, where it
// is, its name when it has one and, for an exit one way only, which
/** @param {import('../../types/data.js').CuratedOsm} osm @param {Set<string>} stationIds @param {string[]} errors */
function checkOsm(osm, stationIds, errors) {
    if (!/^\d{4}-\d\d-\d\d$/.test(osm?.fetched ?? '')) errors.push('osm.json: "fetched" must be a date, YYYY-MM-DD');
    for (const [stationId, exits] of Object.entries(osm?.exits ?? {})) {
        const where = `osm.json: ${stationId}`;
        if (!stationIds.has(stationId)) { errors.push(`${where}: unknown station`); continue; }
        for (const [i, exit] of (Array.isArray(exits) ? exits : []).entries()) {
            const at = `${where}[${i}]`;
            if (!Array.isArray(exit?.ids) || !exit.ids.length || exit.ids.some(id => !OSM_ID.test(id))) errors.push(`${at}.ids must list OpenStreetMap ids, like "n2484170076"`);
            const [lat = NaN, lng = NaN] = Array.isArray(exit?.coords) ? exit.coords : [];
            if (!(lat >= ATHENS.lat[0] && lat <= ATHENS.lat[1] && lng >= ATHENS.lng[0] && lng <= ATHENS.lng[1])) errors.push(`${at}.coords must be [latitude, longitude] around Athens`);
            if (exit?.only !== undefined && !['in', 'out'].includes(exit.only)) errors.push(`${at}.only must be "in" or "out"`);
        }
    }
}

// airport.json: STASY's airport trains (build-rail.js, addTimetabled), with
// where they came from, to check they haven't changed (airport-check.js)
/** @param {import('../../types/data.js').CuratedAirport} airport @param {Set<string>} stationIds @param {CuratedLines} lines @param {string[]} errors */
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

// tram.json: the tram's lines and stops (build-tram.js), in the style of
// lines.json and stations.json; `metro` is the metro station a stop changes to,
// and `walks` the stations and stops a short walk from it, each in one place
/** @param {import('../../types/data.js').CuratedTram} tram @param {Set<string>} stationIds @param {Map<string, string>} metroCodes @param {string[]} errors */
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
    /** @type {Map<string, string>} */
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
        else if (s.metro !== undefined && !s.walks?.some(walk => walk.metro === s.metro)) errors.push(`tram.json: ${id} needs a walk to ${s.metro}, the metro station it changes to`);
        for (const walk of s.walks ?? []) {
            const known = walk.metro ? stationIds.has(walk.metro) : Object.hasOwn(tram.stops, walk.stop ?? '');
            if (!known) errors.push(`tram.json: ${id} walks to an unknown station or stop "${walk.metro ?? walk.stop}"`);
            if (!Number.isInteger(walk.minutes) || walk.minutes < 1) errors.push(`tram.json: ${id}'s walk to ${walk.metro ?? walk.stop} needs whole minutes`);
            if (walk.exit !== undefined && (!walk.metro || typeof walk.exit !== 'string' || !walk.exit.trim())) errors.push(`tram.json: ${id}'s walk to ${walk.metro ?? walk.stop}: "exit" is the Greek name of the metro station's exit it uses, as in street.json`);
        }
    }
}

// suburban.json: the suburban railway's lines and stations (build-suburban.js,
// decision 41). A line takes the trains of one of railway.gov.gr's
// corridors, or with `stopsAt`, those of its trains that stop there (A2,
// the Piraeus–Airport corridor's trains at Ano Liosia): every corridor has
// one line without. A station has its names, OSE's ids for it, where it is
// (OpenStreetMap's), the metro station it shares, `walks` to stations a
// short walk away (in whole minutes, with a note where the way needs one;
// one to the metro station it shares, and the exit it goes through by its
// Greek name where it says, which street.json should have with a place: a
// warning, as the station editor is never blocked), and oasaTicket: false
// outside OASA's ticket. Two stations share an OSE id only with `lines` to
// tell them apart (SKA's two)
/**
 * @param {import('../../types/data.js').CuratedSuburban} suburban @param {Set<string>} stationIds
 * @param {import('../../types/data.js').CuratedStreet | undefined} street @param {string[]} errors @param {string[]} warnings
 */
function checkSuburban(suburban, stationIds, street, errors, warnings) {
    const lines = Object.entries(suburban?.lines ?? {});
    const stations = suburban?.stations ?? {};
    if (!lines.length) errors.push('suburban.json: no lines');
    /** @type {Map<string, string>} */
    const plain = new Map();
    for (const [lineId, line] of lines) {
        if (typeof line.name !== 'string' || !line.name || !/^#[0-9a-f]{6}$/i.test(line.color ?? '')) errors.push(`suburban.json: ${lineId} needs a name and a #rrggbb color`);
        if (typeof line.corridor !== 'string' || !line.corridor) errors.push(`suburban.json: ${lineId} needs the corridor it takes`);
        if (line.stopsAt !== undefined && !Object.hasOwn(stations, line.stopsAt)) errors.push(`suburban.json: ${lineId} stops at an unknown station "${line.stopsAt}"`);
        if (line.stopsAt === undefined) {
            if (plain.has(line.corridor)) errors.push(`suburban.json: corridor ${line.corridor} is taken by both ${plain.get(line.corridor)} and ${lineId}`);
            plain.set(line.corridor, lineId);
        }
    }
    for (const [lineId, line] of lines) if (line.corridor && !plain.has(line.corridor)) errors.push(`suburban.json: corridor ${line.corridor} needs a line without stopsAt for its other trains, beside ${lineId}`);
    /** @type {Map<string, string>} */
    const seen = new Map();
    /** @param {unknown} n @param {[number, number]} range */
    const inside = (n, [min, max]) => typeof n === 'number' && n >= min && n <= max;
    /** @param {import('../../types/data.js').Names} note */
    const isNote = note => typeof note?.el === 'string' && note.el !== '' && typeof note?.en === 'string' && note.en !== '';
    for (const [id, s] of Object.entries(stations)) {
        if (!s.name?.el || !s.name?.en) errors.push(`suburban.json: ${id} needs name.el and name.en`);
        if (!Array.isArray(s.ose) || !s.ose.length) errors.push(`suburban.json: ${id} has no OSE ids`);
        if (s.lines !== undefined && (!Array.isArray(s.lines) || !s.lines.length || s.lines.some(line => !suburban.lines?.[line]))) errors.push(`suburban.json: ${id}.lines must be a list of its lines`);
        for (const ose of s.ose ?? []) {
            const other = seen.get(ose);
            const otherLines = other ? stations[other].lines : undefined;
            const apart = otherLines && s.lines && !s.lines.some(line => otherLines.includes(line));
            if (other && !apart) errors.push(`suburban.json: OSE id ${ose} is used by both ${other} and ${id}, with no lines to tell them apart`);
            seen.set(ose, id);
        }
        const [lat, lng] = Array.isArray(s.coords) ? s.coords : [];
        if (s.coords?.length !== 2 || !inside(lat, SUBURBAN.lat) || !inside(lng, SUBURBAN.lng)) errors.push(`suburban.json: ${id}.coords must be [latitude, longitude] between Kiato and Chalkida, like [37.99284, 23.72015]`);
        if (s.metro !== undefined && !stationIds.has(s.metro)) errors.push(`suburban.json: ${id} shares an unknown metro station "${s.metro}"`);
        else if (s.metro !== undefined && !s.walks?.some(walk => walk.metro === s.metro)) errors.push(`suburban.json: ${id} needs a walk to ${s.metro}, the metro station it shares`);
        for (const walk of s.walks ?? []) {
            const to = walk.metro ?? walk.station;
            const known = walk.metro ? stationIds.has(walk.metro) : Object.hasOwn(stations, walk.station ?? '');
            if (!known) errors.push(`suburban.json: ${id} walks to an unknown station "${to}"`);
            if (!Number.isInteger(walk.minutes) || walk.minutes < 1) errors.push(`suburban.json: ${id}'s walk to ${to} needs whole minutes`);
            if (walk.note !== undefined && !isNote(walk.note)) errors.push(`suburban.json: ${id}'s walk to ${to} needs its note in both languages`);
            if (walk.exit !== undefined && (!walk.metro || typeof walk.exit !== 'string' || !walk.exit.trim())) errors.push(`suburban.json: ${id}'s walk to ${to}: "exit" is the Greek name of the metro station's exit it uses, as in street.json`);
            else if (walk.exit !== undefined && walk.metro && street && !street[walk.metro]?.exits?.some(exit => exit.name?.el === walk.exit && exit.coords)) {
                warnings.push(`suburban.json: ${id}'s walk to ${to} uses the exit "${walk.exit}", which street.json doesn't have with a place`);
            }
        }
        if (s.oasaTicket !== undefined && s.oasaTicket !== false) errors.push(`suburban.json: ${id}.oasaTicket is false outside OASA's ticket, and left out inside it`);
    }
}
