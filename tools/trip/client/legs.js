import { departures, suburbanStation } from '/tools/subway/network.js';

// A way's metro, tram and suburban rides as the Subway page's legs
// (network.js), for its card on the Trip page (decisions 46 and 47). No DOM,
// so it's tested in Node.

// The modes drawn as the Subway page's card
const CARDS = new Set(['metro', 'tram', 'suburban']);

/**
 * When the cards' trains are: the weekday (0 = Sunday) and the date in
 * Athens, and how late the suburban trains run, by number, when the way is
 * timed with it (decision 47)
 * @typedef {{ weekday: number, date: string, trains?: Record<string, import('./trains.js').TrainLate> | null }} When
 */

// When a suburban train actually leaves or gets somewhere, `at` by the
// timetable: as late as it runs, `trains` by number (decision 47)
/** @param {When['trains']} trains @param {string | null | undefined} train @param {number} at */
export const asLate = (trains, train, at) => at + ((train && trains?.[train]?.late) || 0);

/**
 * A metro or tram ride of the city's search (buses.js) as a leg: its line and
 * direction, where it boards and gets off among the direction's stops, and
 * its trains from there, the one the way is timed on first, then the next.
 * Timed on the weekday's trains, as the city's search is (city.js), so the
 * first is the way's own
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
 * A suburban ride as a leg of `rail` with the day's trains joined
 * (withSuburban), in the direction of its train: where it ends. Its train
 * first, by its number and when it leaves by the timetable, then the next of
 * that direction, each when it actually leaves: as late as it runs, `trains`
 * by number (the rider's rule, 10 November 2026). Null when `rail` doesn't
 * have its train (trains.json not in yet, or another day's): a row then
 * @param {import('../../../types/data.js').Rail} rail
 * @param {{ line: string, board: { id: string }, alight: { id: string }, train?: string | null, timetable?: number }} ride
 * @param {When} when
 */
function trainLeg(rail, ride, { weekday, date, trains }) {
    const [from, to] = [ride.board, ride.alight].map(stop => suburbanStation(rail, stop.id.slice('train:'.length)));
    for (const [dir, { stops }] of Object.entries(rail.lines[ride.line]?.directions ?? {})) {
        const fromIndex = stops.findIndex(stop => stop.station === from);
        const toIndex = fromIndex < 0 ? -1 : stops.findIndex((stop, i) => i > fromIndex && stop.station === to);
        if (toIndex < 0) continue;
        const leg = { line: ride.line, dir, from, to, fromIndex, toIndex };
        const found = departures(rail, leg, { weekday, date, after: ride.timetable, count: 3 });
        const own = found.findIndex(d => ride.train ? d.train === ride.train : d.departs === ride.timetable);
        if (own < 0) continue;
        return { ...leg, departures: found.slice(own, own + 2).map(d => ({ ...d, departs: asLate(trains, d.train, d.departs), arrives: asLate(trains, d.train, d.arrives) })) };
    }
    return null;
}

/**
 * A way's rides drawn as cards, each with the ride after it when that's one
 * too (where to change, and the carriage nearest the way to it): a metro
 * option's legs (plan.js) as they are, a way of the city's search's metro,
 * tram and suburban rides made into legs. `card`: the ride's card, by its
 * place among the way's rides; null for a ride drawn as a row (a bus, or a
 * suburban train `rail` doesn't have)
 * @param {import('../../../types/data.js').Rail} rail @param {any} o @param {When} when
 * @returns {({ leg: any, next: any } | null)[]}
 */
export function wayLegs(rail, o, when) {
    const legs = o.city
        ? o.rides.map(ride => !CARDS.has(ride.mode) ? null : ride.mode === 'suburban' ? trainLeg(rail, ride, when) : rideLeg(rail, ride, when.weekday))
        : o.plan.legs;
    return legs.map((leg, i) => leg && { leg, next: legs[i + 1] ?? null });
}
