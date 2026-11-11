import { departures } from '/tools/subway/network.js';

// A way's metro and tram rides as the Subway page's legs (network.js), for
// its card on the Trip page (decision 46). No DOM, so it's tested in Node.

// The modes drawn as the Subway page's card
const CARDS = new Set(['metro', 'tram']);

/**
 * A ride of the city's search (buses.js) as a leg: its line and direction,
 * where it boards and gets off among the direction's stops, and its trains
 * from there, the one the way is timed on first, then the next. Timed on the
 * weekday's trains, as the city's search is (city.js), so the first is the
 * way's own
 * @param {import('../../../types/data.js').Rail} rail
 * @param {{ line: string, dir: string, board: { station: string }, alight: { station: string }, boards: number }} ride
 * @param {number} weekday 0 = Sunday
 */
function rideLeg(rail, ride, weekday) {
    const { stops } = rail.lines[ride.line].directions[ride.dir];
    const fromIndex = stops.findIndex(stop => stop.station === ride.board.station);
    const toIndex = stops.findIndex((stop, i) => i > fromIndex && stop.station === ride.alight.station);
    const leg = { line: ride.line, dir: ride.dir, from: ride.board.station, to: ride.alight.station, fromIndex, toIndex };
    return { ...leg, departures: departures(rail, leg, { weekday, after: ride.boards }) };
}

/**
 * A way's rides drawn as cards, each with the ride after it when that's one
 * too (where to change, and the carriage nearest the way to it): a metro
 * option's legs (plan.js) as they are, a way of the city's search's metro
 * and tram rides made into legs. `card`: the ride's card, by its place among
 * the way's rides; null for a ride drawn as a row (a bus, a suburban train)
 * @param {import('../../../types/data.js').Rail} rail @param {any} o @param {number} weekday
 * @returns {({ leg: any, next: any } | null)[]}
 */
export function wayLegs(rail, o, weekday) {
    const legs = o.city ? o.rides.map(ride => CARDS.has(ride.mode) ? rideLeg(rail, ride, weekday) : null) : o.plan.legs;
    return legs.map((leg, i) => leg && { leg, next: legs[i + 1] ?? null });
}
