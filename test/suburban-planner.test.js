import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { departures, findRoutes, planTrip, suburbanStation, withSuburban, withTram } from '../tools/subway/client/network.js';

// The suburban railway in the subway planner (tools/subway/client/network.js,
// decision 41): withSuburban joins trains.json to the metro and the tram, on
// the browser tests' real network and their week of real trains; a timetable
// made up here shows the rules for trains that end at different stations.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const trains = JSON.parse(readFileSync(new URL('browser/data/trains.json', import.meta.url), 'utf8'));
const DATE = '2026-10-21';
const tram = withTram(rail);
const network = withSuburban(tram, trains, DATE);

const H = 3600;
// The Wednesday, at `hours` in Athens
const at = hours => ({ weekday: 3, seconds: hours * H, date: DATE });
const legs = plan => plan.legs.map(leg => `${leg.line} ${leg.from}>${leg.to}`);
const sorted = object => Object.keys(object).sort();
// Where a leg boards and gets off among its direction's stops
const indexes = (line, dir, from, to) => {
    const { stops } = network.lines[line].directions[dir];
    return { fromIndex: stops.findIndex(stop => stop.station === from), toIndex: stops.findIndex(stop => stop.station === to) };
};

test('withSuburban adds the railway and leaves the network as it was', () => {
    const before = structuredClone(tram);
    const joined = withSuburban(tram, trains, DATE);
    assert.deepEqual(tram, before);
    assert.equal(tram.stations.megara, undefined);
    assert.equal(tram.lines.A1, undefined);
    assert.deepEqual(sorted(joined.lines).filter(id => joined.lines[id].suburban), ['A1', 'A2', 'A3', 'A4']);
    assert.equal(joined.lines.M1, tram.lines.M1);
    assert.equal(joined.lines.T6, tram.lines.T6);
    assert.equal(Object.values(joined.stations).filter(station => station.suburban).length, 46);
    assert.ok(joined.stations.megara.suburban);
    assert.deepEqual(joined.stations.megara.name, { el: 'Μέγαρα', en: 'Megara' });
    // The metro first, so a full name typed finds the metro station
    assert.deepEqual(Object.keys(joined.stations).slice(0, Object.keys(tram.stations).length), Object.keys(tram.stations));
});

test('a station with a metro station\'s id has an id of its own and says it\'s the suburban railway\'s', () => {
    assert.deepEqual(Object.keys(network.stations).filter(id => id.endsWith('-suburban')).sort(), [
        'airport-suburban', 'doukissis-plakentias-suburban', 'irakleio-suburban', 'koropi-suburban', 'nerantziotissa-suburban',
        'paiania-kantza-suburban', 'pallini-suburban', 'piraeus-suburban', 'tavros-suburban',
    ]);
    assert.deepEqual(network.stations['piraeus-suburban'].name, { el: 'Πειραιάς (Προαστιακός)', en: 'Piraeus (suburban)' });
    // trains.json's ids as joined, for the Trip page's cards (decision 47)
    assert.deepEqual(['piraeus', 'megara'].map(id => suburbanStation(network, id)), ['piraeus-suburban', 'megara']);
    assert.equal(network.stations.piraeus.suburban, undefined);
    // Athens's metro station is Larissa Station: no clash
    assert.deepEqual(network.stations.athens.name, { el: 'Αθήνα', en: 'Athens' });
    assert.deepEqual(network.stations.athens.lines, ['A1', 'A3', 'A4']);
});

test('its walks go both ways, in minutes, with their notes; the stations outside OASA\'s ticket are marked', () => {
    assert.equal(network.walks.athens['larissa-station'], 4);
    assert.equal(network.walks['larissa-station'].athens, 4);
    assert.equal(network.walks.ska['ska-a3'], 6);
    assert.equal(network.walks['piraeus-suburban'].piraeus, 4);
    assert.match(network.walkNotes['piraeus-suburban'].piraeus.en, /with no signs/);
    assert.equal(network.walkNotes.piraeus['piraeus-suburban'], network.walkNotes['piraeus-suburban'].piraeus);
    assert.match(network.walkNotes['ska-a3'].ska.el, /πεζογέφυρα/);
    assert.equal(network.walkNotes.athens, undefined);
    // The tram's walks are still there
    assert.equal(network.walks.syntagma['syntagma-tram'], tram.walks.syntagma['syntagma-tram']);
    assert.equal(network.stations.megara.oasaTicket, false);
    assert.equal(network.stations['airport-suburban'].oasaTicket, false);
    assert.equal(network.stations.athens.oasaTicket, undefined);
    assert.equal(Object.values(network.stations).filter(station => station.oasaTicket === false).length, 22);
});

test('a line\'s trains go in a direction for each station they end at, named by it; each train\'s own stops are a profile', () => {
    const directions = id => sorted(network.lines[id].directions);
    assert.deepEqual(directions('A1'), ['airport', 'piraeus', 'tavros']);
    assert.deepEqual(directions('A2'), ['airport', 'ano-liosia']);
    assert.deepEqual(directions('A3'), ['afidnes', 'athens', 'chalkida', 'oinoi']);
    assert.deepEqual(directions('A4'), ['kiato', 'piraeus', 'tavros']);
    for (const line of ['A1', 'A2', 'A3', 'A4']) {
        for (const [dir, direction] of Object.entries(network.lines[line].directions)) {
            assert.equal(direction.stops.at(-1).station.replace(/-suburban$/, ''), dir);
            assert.deepEqual(direction.toward.en, trains.stations[dir][3]);
        }
    }
    // Some trains to Chalkida skip stations the others stop at
    const { stops, timetable } = network.lines.A3.directions.chalkida;
    assert.ok(timetable.profiles.some(profile => profile.stops.length < stops.length));
    assert.ok(timetable.profiles.every(profile => profile.stops.every((index, i) => !i || index > profile.stops[i - 1])));
});

test('each date\'s trains run on that date only; without trains for the day, or without trains.json, it\'s the network as it was', () => {
    const leg = { line: 'A4', dir: 'piraeus', from: 'megara', to: 'athens', fromIndex: 0, toIndex: 0 };
    const { stops } = network.lines.A4.directions.piraeus;
    leg.fromIndex = stops.findIndex(stop => stop.station === 'megara');
    leg.toIndex = stops.findIndex(stop => stop.station === 'athens');
    // Hourly from 06:08 to 22:08, each train with its number, which its lateness goes by (decision 47)
    const hourly = departures(network, leg, { weekday: 3, after: 0, date: DATE, count: 20 });
    assert.deepEqual(hourly.map(d => d.departs), Array.from({ length: 17 }, (_, i) => (6 + i) * H + 8 * 60));
    assert.deepEqual(hourly.slice(11, 13).map(d => d.train), ['1323', '1325']);
    assert.ok(hourly.every(d => /^\d+$/.test(d.train)));
    assert.ok(!('train' in departures(network, { line: 'M1', dir: 'kifisia', from: 'omonia', to: 'attiki', ...indexes('M1', 'kifisia', 'omonia', 'attiki') }, { weekday: 3, after: 10 * H, date: DATE })[0]), 'a metro train has none');
    // A Wednesday trains.json doesn't hold
    assert.deepEqual(departures(network, leg, { weekday: 3, after: 0, date: '2026-10-28' }), []);
    assert.equal(withSuburban(tram, trains, '2026-10-28'), tram);
    assert.equal(withSuburban(tram, null, DATE), tram);
    // With the metro alone, too
    assert.equal(withSuburban(rail, trains, DATE).stations['syntagma-tram'], undefined);
    assert.ok(withSuburban(rail, trains, DATE).stations.megara);
});

test('Megara to Syntagma: the A4 to Athens, the walk to Larissa Station, the M2', () => {
    const { plans, tomorrow } = planTrip(network, 'megara', 'syntagma', at(15));
    assert.equal(tomorrow, false);
    assert.deepEqual(legs(plans[0]), ['A4 megara>athens', 'M2 larissa-station>syntagma']);
    assert.equal(network.lines.A4.directions[plans[0].legs[0].dir].toward.en, 'Piraeus');
});

test('where two lines share the track, both are offered: Piraeus to Rouf by A4 and A1', () => {
    const { plans } = planTrip(network, 'piraeus-suburban', 'rouf', at(10));
    assert.deepEqual(plans.map(legs).sort(), [['A1 piraeus-suburban>rouf'], ['A4 piraeus-suburban>rouf']]);
});

test('a change across SKA\'s footbridge: Ano Liosia to Chalkida, by A2 and A3', () => {
    const { plans } = planTrip(network, 'ano-liosia', 'chalkida', at(10));
    assert.deepEqual(legs(plans[0]), ['A2 ano-liosia>ska', 'A3 ska-a3>chalkida']);
});

test('a change between suburban trains at one station is the search\'s: the Airport to Kiato by A2 and A4 at Ano Liosia', () => {
    const atOneStation = route => route.legs.some((leg, i) => i && leg.from === route.legs[i - 1].to
        && network.lines[leg.line].suburban && network.lines[route.legs[i - 1].line].suburban);
    assert.equal(findRoutes(network, 'airport-suburban', 'kiato').filter(atOneStation).length, 0);
    const { plans } = planTrip(network, 'airport-suburban', 'kiato', at(10));
    assert.deepEqual(legs(plans[0]), ['A2 airport-suburban>ano-liosia', 'A4 ano-liosia>kiato']);
});

test('few enough routes to time for a phone, and a way between a suburban station and any other', () => {
    const all = Object.keys(network.stations);
    const suburban = all.filter(id => network.stations[id].suburban);
    const others = all.filter((id, i) => i % 6 === 0);
    let most = 0;
    for (const a of suburban) {
        for (const b of others.filter(id => id !== a)) {
            for (const [from, to] of [[a, b], [b, a]]) {
                const routes = findRoutes(network, from, to);
                most = Math.max(most, routes.length);
            }
        }
    }
    assert.ok(most <= 300, `${most}`);
    const none = suburban.flatMap(a => others.filter(b => b !== a && !network.walks[a]?.[b])
        .filter(b => !planTrip(network, a, b, at(10)).plans.length));
    assert.deepEqual(none, []);
});

// Made up: A4 trains from Kiato to Piraeus, and one ending at Tavros, through
// Athens; and a day with none to Tavros
const MADE_UP = {
    schema: 1,
    stations: {
        kiato: [37.9983, 22.7526, 'Κιάτο', 'Kiato'],
        athens: [37.99284, 23.72015, 'Αθήνα', 'Athens'],
        tavros: [37.9617, 23.7031, 'Ταύρος', 'Tavros'],
        piraeus: [37.94913, 23.64372, 'Πειραιάς', 'Piraeus'],
    },
    walks: [],
    outside: ['kiato'],
    dates: {
        [DATE]: [
            { line: 'A4', stops: ['kiato', 'athens', 'tavros', 'piraeus'], profiles: [[0, 3000, 3300, 3600]], trips: [[8 * H, 0], [9 * H, 0]] },
            { line: 'A4', stops: ['kiato', 'athens', 'tavros'], profiles: [[0, 3000, 3300]], trips: [[8.5 * H, 0]] },
        ],
    },
};

test('a train is marked the last only when none of its line leaves for the same stretch after it, whatever its end', () => {
    const madeUp = withSuburban(rail, MADE_UP, DATE);
    const leg = dir => ({ line: 'A4', dir, from: 'kiato', to: 'athens', fromIndex: 0, toIndex: 1 });
    const flags = list => list.map(d => [d.departs / H, d.isLast ? 'last' : d.isSecondLast ? 'second to last' : '']);
    assert.deepEqual(flags(departures(madeUp, leg('piraeus'), { weekday: 3, after: 7 * H, date: DATE })), [[8, ''], [9, 'last']]);
    // The 08:30 to Tavros isn't the last train from Kiato to Athens: the 09:00 to Piraeus is
    assert.deepEqual(flags(departures(madeUp, leg('tavros'), { weekday: 3, after: 7 * H, date: DATE })), [[8.5, 'second to last']]);
});

test('the same ride on trains that end at different stations is one option, on the train that gets there first', () => {
    const madeUp = withSuburban(rail, MADE_UP, DATE);
    // Each direction named by trains.json's id for where it ends, as `toward` names it
    assert.deepEqual(sorted(madeUp.lines.A4.directions), ['piraeus', 'tavros']);
    assert.equal(madeUp.lines.A4.directions.tavros.stops.at(-1).station, 'tavros-suburban');
    // Both directions go from Kiato to Athens: the 08:30 to Tavros is the first at 08:10
    const { plans } = planTrip(madeUp, 'kiato', 'athens', at(8 + 1 / 6));
    assert.deepEqual(plans.map(plan => [plan.legs[0].dir, plan.legs[0].departures[0].departs / H]), [['tavros', 8.5]]);
});

test('trains ending at the same station that pass stations in opposite orders go in directions of their own', () => {
    const crossed = structuredClone(MADE_UP);
    crossed.dates[DATE].push({ line: 'A4', stops: ['tavros', 'athens', 'piraeus'], profiles: [[0, 600, 1800]], trips: [[10 * H, 0]] });
    const joined = withSuburban(rail, crossed, DATE);
    assert.deepEqual(sorted(joined.lines.A4.directions), ['piraeus', 'piraeus-2', 'tavros']);
    assert.deepEqual(joined.lines.A4.directions['piraeus-2'].stops.map(stop => stop.station), ['tavros-suburban', 'athens', 'piraeus-suburban']);
    assert.equal(joined.lines.A4.directions['piraeus-2'].toward.en, 'Piraeus');
});
