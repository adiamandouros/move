// Piraeus's exits as the field trip of 25 November found them (decision
// 73): two buildings, the M3's exits (the port's, by escalators only, and
// Odissou Square's) and the M1's, both unsigned (one toward the port, by a
// slight ramp, and one by stairs beside Odissou Square), as rail.json
// carries them
export const PIRAEUS_EXITS = [
    { name: { el: 'Λιμάνι Πειραιά', en: 'Piraeus Port' }, at: [37.94808, 23.64197], way: ['escalator-up', 'escalator-down'], lines: ['M3'] },
    { name: { el: 'Πλατεία Οδησσού', en: 'Odissou Square' }, at: [37.9478, 23.64253], lines: ['M3'] },
    { at: [37.94803, 23.64239], lines: ['M1'] },
    { at: [37.94787, 23.64267], way: ['stairs'], lines: ['M1'] },
];

// rail.json with Piraeus as two buildings
/** @template {{ stations: Record<string, object> }} R @param {R} rail @returns {R} */
export function withPiraeusExits(rail) {
    const copy = structuredClone(rail);
    Object.assign(copy.stations.piraeus, { exits: structuredClone(PIRAEUS_EXITS) });
    return copy;
}

// A small network for the city's search over `rail` (withPiraeusExits):
// the M3 from Maniatika to Piraeus at 10:00, the M1 from there to Faliro at
// 10:10, and the 040 from beside Faliro at 10:25 to `end`, so a way through
// Piraeus has a bus, as the city's ways have
/**
 * @param {typeof import('../../tools/subway/client/city.js').createPlanner} createPlanner
 * @param {import('../../types/data.js').Rail} rail
 */
export function piraeusPlanner(createPlanner, rail) {
    /** @param {string} id */
    const stop = id => {
        const { name, coords: [lat, lng], exits } = rail.stations[id];
        return { id: `rail:${id}`, station: id, lat, lng, name: name.el, names: name, ...exits && { exits } };
    };
    const [lat, lng] = rail.stations.faliro.coords;
    const beside = { id: 'bus:1', lat, lng: lng + 0.0005, name: 'Στάση', names: { el: 'Στάση', en: '' } };
    const end = { id: 'bus:2', lat: 37.95, lng: 23.68, name: 'Τέρμα', names: { el: 'Τέρμα', en: '' } };
    const planner = createPlanner({
        stops: [stop('maniatika'), stop('piraeus'), stop('faliro'), beside, end],
        routes: [
            { line: 'M3', dir: 'dimotiko', mode: 'metro', stops: [0, 1], trips: [[36_000, 36_120]], toward: rail.lines.M3.directions.dimotiko.toward },
            { line: 'M1', dir: 'kifisia', mode: 'metro', stops: [1, 2], trips: [[36_600, 36_900]], toward: rail.lines.M1.directions.kifisia.toward },
            { line: '040', mode: 'bus', stops: [3, 4], trips: [[37_500, 38_000]], toward: end.names },
        ],
    });
    return { planner, end: { lat: end.lat, lng: end.lng } };
}
