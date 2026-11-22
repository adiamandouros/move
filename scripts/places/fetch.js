// What address search needs from OpenStreetMap, from Overpass: a few big
// questions once a week, tried again on another server when one is busy, and
// never on a person's search (decision 22).

import { messageOf } from '../../server/errors.js';

const AREA = 'area["ISO3166-2"="GR-I"]->.a;';
const PLACES = [
    'nwr["place"~"^(square|neighbourhood|suburb|quarter|village|town|locality)$"]["name"](area.a);out tags center;',
    'nwr["amenity"~"^(hospital|university|college|townhall|library|theatre|courthouse|embassy|clinic)$"]["name"](area.a);out tags center;',
    'nwr["tourism"~"^(museum|attraction)$"]["name"](area.a);out tags center;',
    'nwr["leisure"~"^(park|stadium)$"]["name"](area.a);out tags center;',
    'nwr["shop"="mall"]["name"](area.a);out tags center;',
].join('');

export const QUERIES = {
    addresses: 'nwr["addr:housenumber"](area.a);out tags center;way["addr:interpolation"](area.a);out tags geom;',
    streets: 'way["highway"]["name"](area.a);out tags geom;',
    // A relation's members only come with "out geom"; "out tags geom" drops them
    municipalities: 'relation["boundary"="administrative"]["admin_level"="7"](area.a);out geom;',
    places: PLACES,
    airports: 'nwr["aeroway"="aerodrome"](area.a);out tags center;',
};

// Two independent servers. overpass.private.coffee was months behind when tried.
const SERVERS = ['https://overpass-api.de', 'https://overpass.kumi.systems'];
const TIMEOUT = 400_000;
const USER_AGENT = 'Wayhop/1.0 (https://wayhop.gr)';

/**
 * An element of Overpass's answer as these questions ask for it: each asks
 * for elements with a tag, so each has tags; a node has lat and lon, a way
 * or a relation its center (out center), a way its points and a relation
 * its members' (out geom)
 * @typedef {{ lat: number, lon: number }} OsmPoint
 * @typedef {{ type: 'node' | 'way' | 'relation', id: number, tags: Record<string, string>, lat?: number, lon?: number, center?: OsmPoint, geometry?: OsmPoint[], members?: { type: string, geometry?: OsmPoint[] }[] }} OsmElement
 * @typedef {keyof typeof QUERIES} Question
 * @typedef {Record<Question, OsmElement[]>} Answers every question's elements (fetchAll)
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} Get
 */

// The elements of an answer, or null if it isn't whole: Overpass says "200"
// and gives a remark when it runs out of time partway through
/** @param {string} text @returns {OsmElement[] | null} */
export function elementsOf(text) {
    try {
        const { elements, remark } = JSON.parse(text);
        return !remark && elements?.length ? elements : null;
    } catch (err) {
        return null;
    }
}

const pause = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));

/** @param {string} server @param {string} query @param {Get} get */
async function ask(server, query, get) {
    const body = new URLSearchParams({ data: `[out:json][timeout:360];${AREA}${query}` });
    const response = await get(`${server}/api/interpreter`, {
        method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT),
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    return response.ok ? elementsOf(await response.text()) : null;
}

/**
 * How to ask: get (fetch), wait between tries, log, rounds of every server
 * @typedef {{ get?: Get, wait?: (ms: number) => Promise<unknown>, log?: (message: string) => void, rounds?: number }} Asking
 */

// `query`: one of its own, for another script's question (osm-exits.js)
/** @param {string} name @param {Asking & { query?: string }} [options] */
export async function fetchOne(name, { query = QUERIES[/** @type {Question} */ (name)], get = fetch, wait = pause, log = console.log, rounds = 4 } = {}) {
    for (let round = 1; round <= rounds; round++) {
        for (const server of SERVERS) {
            log(`${name}: ${server}, round ${round}`);
            const elements = await ask(server, query, get).catch(err => { log(`  ${messageOf(err)}`); return null; });
            if (elements) return elements;
            await wait(45_000);
        }
    }
    throw new Error(`No whole answer for ${name}`);
}

// Everything, one at a time, with a rest between: these are heavy questions
/** @param {Asking} [options] */
export async function fetchAll(options = {}) {
    const { wait = pause } = options;
    const raw = /** @type {Answers} */ ({});
    for (const name of /** @type {Question[]} */ (Object.keys(QUERIES))) {
        raw[name] = await fetchOne(name, options);
        await wait(20_000);
    }
    return raw;
}
