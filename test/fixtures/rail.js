// A small metro network in rail.json's format (server/data/build-rail.js), for
// the station page tests: L1 runs a → x → b and back, L2 runs x → c, with a
// change at x. L2 runs all night from Saturday into Sunday.

const H = 3600;
const trips = (from, to, every) => Array.from({ length: Math.floor((to - from) / every) + 1 }, (_, i) => [from + i * every, 0]);
const twoStops = { profiles: [{ stops: [0, 1], offsets: [0, 120] }] };

export const rail = {
    schema: 1,
    feed: { validFrom: '2026-09-01', validTo: '2099-12-31' },
    positions: ['back', 'center-back', 'center', 'center-front', 'front'],
    stations: {
        a: { name: { en: 'Alpha', el: 'Άλφα' }, coords: [37.9, 23.6], lines: ['L1'] },
        x: { name: { en: 'Cross', el: 'Κόμβος' }, coords: [38.0, 23.7], lines: ['L1', 'L2'] },
        b: { name: { en: 'Beta', el: 'Βήτα' }, coords: [38.1, 23.8], lines: ['L1'] },
        c: { name: { en: 'Gamma', el: 'Γάμμα' }, coords: [38.0, 23.9], lines: ['L2'] },
    },
    lines: {
        L1: {
            name: 'L1', color: '#4caf50',
            directions: {
                east: {
                    toward: { en: 'Beta', el: 'Βήτα' },
                    stops: [
                        { station: 'a', exits: ['front'] },
                        { station: 'x', exits: ['back'], elevators: ['center'], transfers: { 'L2/east': ['center-front'] }, note: 'Unreliable data' },
                        { station: 'b', exits: ['center'], centralPlatform: true },
                    ],
                    timetable: {
                        profiles: [{ stops: [0, 1, 2], offsets: [0, 120, 240] }],
                        // Weekdays 05:30–00:30, weekends 06:00–01:00
                        patterns: [trips(5.5 * H, 24.5 * H, H / 2), trips(6 * H, 25 * H, H / 2)],
                        days: [1, 0, 0, 0, 0, 0, 1],
                    },
                },
                west: {
                    toward: { en: 'Alpha', el: 'Άλφα' },
                    stops: [{ station: 'b', exits: [] }, { station: 'x', exits: ['front'] }, { station: 'a', exits: ['back'] }],
                    timetable: { profiles: [{ stops: [0, 1, 2], offsets: [0, 120, 240] }], patterns: [trips(5.5 * H, 24.5 * H, H / 2)], days: [0, 0, 0, 0, 0, 0, 0] },
                },
            },
        },
        L2: {
            name: 'L2', color: '#e53935',
            directions: {
                east: {
                    toward: { en: 'Gamma', el: 'Γάμμα' },
                    stops: [{ station: 'x', exits: [] }, { station: 'c', exits: ['back'] }],
                    timetable: {
                        ...twoStops,
                        // Sun–Fri 05:00–00:00; Saturday from 05:00 through to Sunday 05:00
                        patterns: [trips(5 * H, 24 * H, H), trips(5 * H, 29 * H, H)],
                        days: [0, 0, 0, 0, 0, 0, 1],
                    },
                },
            },
        },
    },
};
