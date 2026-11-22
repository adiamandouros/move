// OpenStreetMap's metro entrances, by the station they're at, for the exits
// the station editor's field trips haven't recorded yet (decision 57):
//   node scripts/osm-exits.js
// asks Overpass once and writes data/curated/osm.json, with where the
// stations are from the last data build (data/build/rail.json). Run by hand
// now and then; the site never asks Overpass.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from '../server/files.js';
import { formatJson } from '../server/data/format.js';
import { distanceMeters } from '../public/js/core/geo.js';
import { SAME_EXIT_M, nameParts } from '../public/js/core/osm-exits.js';
import { fetchOne } from './places/fetch.js';

const QUERY = 'nwr["railway"="subway_entrance"](area.a);out tags center;';
// An entrance farther than this from every metro station is another
// railway's (the suburban railway's underground stations)
const NEAR_M = 300;
// OpenStreetMap's entrance=exit and entrance=entrance: one way only
/** @type {Record<string, 'in' | 'out'>} */
const ONLY = { exit: 'out', entrance: 'in' };

const round = (/** @type {number} */ n) => Math.round(n * 1e5) / 1e5;

/**
 * Overpass's entrances as each station's exits: not the lifts (an entrance
 * that's an elevator) nor ones closed to the public, each at its nearest
 * station within NEAR_M, and a building's doors of the same name side by
 * side (within SAME_EXIT_M of each other) as one exit, as the station
 * editor records them. A name that's only the station's isn't an exit's.
 * @param {import('./places/fetch.js').OsmElement[]} elements @param {Record<string, { coords: [number, number], name: { el: string, en: string } }>} stations
 * @returns {Record<string, import('../public/js/core/osm-exits.js').OsmExit[]>}
 */
export function exitsByStation(elements, stations) {
    /** @type {Map<string, { key: string, doors: { id: string, coords: [number, number], el?: string, en?: string, only?: 'in' | 'out' }[] }[]>} */
    const byStation = new Map();
    const sorted = [...elements].sort((a, b) => `${a.type}${a.id}`.localeCompare(`${b.type}${b.id}`, 'en', { numeric: true }));
    for (const element of sorted) {
        const tags = element.tags ?? {};
        if (tags.railway !== 'subway_entrance' || tags.highway === 'elevator' || ['no', 'private'].includes(tags.access)) continue;
        const coords = /** @type {[number, number]} */ ([element.lat ?? element.center?.lat, element.lon ?? element.center?.lon]);
        if (!coords.every(Number.isFinite)) continue;
        const [station, away] = Object.entries(stations)
            .map(([id, s]) => /** @type {[string, number]} */ ([id, distanceMeters(...coords, ...s.coords)]))
            .reduce((a, b) => b[1] < a[1] ? b : a, ['', Infinity]);
        if (away > NEAR_M) continue;
        /** @param {string | undefined} name */
        const own = name => name && ![stations[station].name.el, stations[station].name.en].some(n => nameParts(n).join('/') === nameParts(name).join('/')) ? name : undefined;
        const el = own(tags['name:el'] ?? tags.name);
        const en = own(tags['name:en']);
        const door = { id: `${element.type[0]}${element.id}`, coords, el, en, only: ONLY[tags.entrance] };
        const key = nameParts(el ?? en).join('/');
        let exits = byStation.get(station);
        if (!exits) byStation.set(station, exits = []);
        const same = exits.find(exit => exit.key === key && exit.doors.some(d => distanceMeters(...d.coords, ...coords) <= SAME_EXIT_M));
        if (same) same.doors.push(door);
        else exits.push({ key, doors: [door] });
    }
    return Object.fromEntries([...byStation].sort(([a], [b]) => a.localeCompare(b)).map(([station, exits]) => [station, exits.map(({ doors }) => {
        const el = doors.find(d => d.el)?.el;
        const en = doors.find(d => d.en)?.en;
        const only = doors.every(d => d.only === doors[0].only) ? doors[0].only : undefined;
        const mean = (/** @type {0 | 1} */ i) => round(doors.reduce((sum, d) => sum + d.coords[i], 0) / doors.length);
        return {
            ids: doors.map(d => d.id),
            ...((el || en) && { name: { ...(el && { el }), ...(en && { en }) } }),
            coords: /** @type {[number, number]} */ ([mean(0), mean(1)]),
            ...(only && { only }),
        };
    })]));
}

async function main() {
    const root = new URL('../', import.meta.url);
    const rail = JSON.parse(readFileSync(new URL('data/build/rail.json', root), 'utf8'));
    const exits = exitsByStation(await fetchOne('metro entrances', { query: QUERY }), rail.stations);
    const file = fileURLToPath(new URL('data/curated/osm.json', root));
    writeFileAtomic(file, formatJson({ fetched: new Date().toISOString().slice(0, 10), exits }, 3) + '\n');
    const count = Object.values(exits).reduce((n, list) => n + list.length, 0);
    console.log(`${count} exits at ${Object.keys(exits).length} stations → data/curated/osm.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
