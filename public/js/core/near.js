import { localName } from './html.js';
import { closestStation, departures, stationByKey } from '/tools/subway/network.js';
import { nearestStops } from '/tools/buses/stops.js';
import { distanceMeters } from './geo.js';

// What Home's "Near you" shows (decision 81), worked out with no page, so
// it's tested in Node (near.test.js): the station nearest the rider with
// each line's next trains from it, the bus stop nearest them, and the
// starred stations Home offers to plan a trip to. home.js asks and draws.

/** @typedef {import('/tools/subway/network.js').Rail} Rail */
/** @typedef {import('/tools/subway/network.js').AthensTime} AthensTime */
/** @typedef {import('/tools/subway/network.js').Departure} Departure */
/** @typedef {import('/tools/buses/stops.js').BusStop} BusStop */

// Trains shown a line and direction: the next and the one after
const TRAINS_SHOWN = 2;

// The metro station or tram stop nearest the rider, and how far it is in
// metres. `rail`: the metro with the tram (withTram), or alone
/** @param {Rail} rail @param {number} lat @param {number} lng */
export function nearestStation(rail, lat, lng) {
    const id = closestStation(rail, lat, lng);
    const [sLat, sLng] = rail.stations[id].coords;
    return { id, meters: Math.round(distanceMeters(lat, lng, sLat, sLng)) };
}

/**
 * A line's trains from a station one way: the line, the direction, and the
 * next ones (departures in network.js, any train going on from here, so
 * those that turn back sooner count too)
 * @typedef {{ line: string, dir: string, departures: Departure[] }} TrainRow
 */

// Every line and direction leaving `id` (not those ending there), in the
// order of their lines, each with its next trains; a direction with none
// left today is left out
/** @param {Rail} rail @param {string} id @param {AthensTime} now @returns {TrainRow[]} */
export function stationTrains(rail, id, now) {
    /** @type {TrainRow[]} */
    const rows = [];
    for (const [line, { directions }] of Object.entries(rail.lines)) {
        for (const [dir, { stops }] of Object.entries(directions)) {
            const at = stops.findIndex(stop => stop.station === id);
            if (at === -1 || at === stops.length - 1) continue;
            const leg = { line, dir, from: id, to: stops[at + 1].station, fromIndex: at, toIndex: at + 1 };
            const next = departures(rail, leg, { weekday: now.weekday, after: now.seconds, count: TRAINS_SHOWN, date: now.date });
            if (next.length) rows.push({ line, dir, departures: next });
        }
    }
    return rows;
}

// The bus stop nearest the rider, with how far it is in metres
/** @param {BusStop[]} stops @param {number} lat @param {number} lng */
export function nearestBusStop(stops, lat, lng) {
    const [stop] = nearestStops(stops, lat, lng, { limit: 1, min: 1 });
    return stop ? { ...stop, meters: Math.round(stop.meters) } : null;
}

// The starred stations (favourites.js keys) Home can name, in the order
// they were starred, each with its name in `lang`; a suburban station's
// once trains.json is in (null till then), a key neither file knows never
/**
 * @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Trains | null} trains
 * @param {string[]} keys @param {'el' | 'en'} lang @returns {{ key: string, name: string }[]}
 */
export function starredStations(rail, trains, keys, lang) {
    return keys.flatMap(key => {
        const station = stationByKey(rail, trains, key);
        return station ? [{ key, name: localName(station.name, lang) }] : [];
    });
}
