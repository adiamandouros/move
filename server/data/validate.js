import { DAY_NAMES } from './calendar.js';

// Car positions, ordered from the back of the train to the front.
export const POSITIONS = ['back', 'center-back', 'center', 'center-front', 'front'];

const POSITION_KEYS = new Set(['exits', 'elevators', 'centralPlatform', 'transfers', 'note']);
const HHMM = /^\d{1,2}:\d{2}$/;

// Check the hand-maintained files in data/curated for mistakes. Returns
// { errors, warnings }; any error fails the build. Kept independent of the
// GTFS feed so it can run in tests and before every build.
export function validateCurated({ stations, lines, positions, overrides }) {
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
                if (p.elevators) checkPositions(`${where}.elevators`, p.elevators);
                if (p.note !== undefined && typeof p.note !== 'string') errors.push(`${where}.note must be text`);
                if (p.centralPlatform !== undefined && typeof p.centralPlatform !== 'boolean') errors.push(`${where}.centralPlatform must be true or false`);
                for (const [ref, list] of Object.entries(p.transfers ?? {})) {
                    if (!directionRefs.has(ref)) errors.push(`${where}.transfers: unknown direction "${ref}"`);
                    else if (ref.startsWith(`${lineId}/`)) errors.push(`${where}.transfers: "${ref}" is on the same line`);
                    checkPositions(`${where}.transfers.${ref}`, list);
                }
            }
        }
    }

    for (const [i, o] of (overrides.headways ?? []).entries()) {
        const where = `overrides.json: headways[${i}]`;
        if (!lines[o.line]) errors.push(`${where}: unknown line ${o.line}`);
        if (!o.reason) warnings.push(`${where}: no reason given`);
        for (const d of o.days ?? []) if (!DAY_NAMES.includes(d)) errors.push(`${where}: unknown day "${d}" (use ${DAY_NAMES.join(', ')})`);
        if (!o.days?.length) errors.push(`${where}: no days`);
        if (!o.periods?.length) errors.push(`${where}: no periods`);
        for (const period of o.periods ?? []) {
            const [from, to, minutes] = period;
            if (!HHMM.test(from) || !HHMM.test(to) || !(minutes > 0)) errors.push(`${where}: bad period ${JSON.stringify(period)} (use ["HH:MM", "HH:MM", minutes])`);
        }
    }

    return { errors, warnings };
}
