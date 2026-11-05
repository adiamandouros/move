import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { departures, findRoutes, planJourney, tripTime, withTram } from '../tools/subway/client/network.js';

// The route finder over the metro and the tram together (tools/subway/client/
// network.js), on the test data's real network: T7's one-way loop, the walks
// between stops, and two or more changes. All in a file of its own, as going
// through every pair takes a few seconds.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const network = withTram(rail);
const stations = Object.keys(network.stations);

// A Wednesday in the timetable, 08:30
const NOW = { weekday: 3, seconds: 8.5 * 3600, date: '2026-10-21' };
const legs = route => route.legs.map(leg => `${leg.line} ${leg.from}>${leg.to}`);
const everyPair = list => list.flatMap(a => list.filter(b => b !== a).map(b => [a, b]));

test('withTram adds the tram and leaves rail as it was', () => {
    const before = structuredClone(rail);
    const combined = withTram(rail);
    assert.deepEqual(rail, before);
    assert.equal(rail.stations.zappeio, undefined);
    assert.equal(rail.lines.T6, undefined);
    assert.ok(combined.stations.zappeio.tram);
    assert.ok(combined.lines.T7.tram);
    assert.equal(combined.lines.M1.tram, undefined);
    assert.equal(combined.stations.omonia.tram, undefined);
    // The metro first, so a full name typed finds the metro station
    assert.deepEqual(Object.keys(combined.stations).slice(0, Object.keys(rail.stations).length), Object.keys(rail.stations));
});

test('without the tram\'s timetables, or without the tram, it\'s the metro', () => {
    const metro = { ...rail };
    delete metro.tram;
    assert.equal(withTram(metro), metro);
    const old = structuredClone(rail);
    delete old.tram.lines.T7.directions.voula.timetable;
    assert.equal(withTram(old), old);
});

test('a stop with a metro station\'s name has an id of its own and says it\'s the tram', () => {
    for (const id of ['syntagma', 'neos-kosmos', 'agia-paraskevi', 'elliniko', 'kallithea', 'moschato']) {
        assert.equal(network.stations[id].tram, undefined, id);
        assert.deepEqual(network.stations[id].name, rail.stations[id].name, id);
        assert.equal(network.stations[`${id}-tram`].name.en, `${rail.stations[id].name.en} (tram)`);
        assert.equal(network.stations[`${id}-tram`].name.el, `${rail.stations[id].name.el} (τραμ)`);
    }
    assert.deepEqual(network.stations.fix.name, rail.tram.stations.fix.name);
    assert.ok(network.lines.T6.directions.syntagma.stops.some(stop => stop.station === 'syntagma-tram'));
    assert.ok(!network.lines.T6.directions.syntagma.stops.some(stop => stop.station === 'syntagma'));
});

test('walks go both ways, between stations and stops alike', () => {
    assert.equal(network.walks.syntagma['syntagma-tram'], 4);
    assert.equal(network.walks['syntagma-tram'].syntagma, 4);
    assert.equal(network.walks.piraeus['akti-poseidonos'], 8);
    assert.equal(network.walks.sef['neo-faliro'], 7);
    assert.equal(network.walks['neo-faliro'].sef, 7);
});

test('there is a way between any two stops, two changes are always enough, and few enough routes to time for a phone', () => {
    const found = everyPair(stations).map(([from, to]) => ({ trip: `${from}>${to}`, routes: findRoutes(network, from, to) }));
    const changes = ({ routes }) => Math.min(...routes.map(route => route.legs.length - 1));
    assert.deepEqual(found.filter(trip => !(changes(trip) <= 2)).map(({ trip }) => trip), []);
    const most = Math.max(...found.map(({ routes }) => routes.length));
    assert.ok(most <= 40, `${most}`);
});

test('two changes: a line away from both ends', () => {
    const [best] = planJourney(network, 'kifisia', 'zappeio', NOW);
    assert.equal(best.legs.length, 3);
    assert.equal(best.legs[0].line, 'M1');
    assert.equal(best.legs.at(-1).line, 'T6');
    // Each leg is caught after the one before it, with time to change
    const trains = best.legs.map(leg => leg.departures[0]);
    assert.ok(trains[1].departs >= trains[0].arrives + 180);
    assert.ok(trains[2].departs >= trains[1].arrives + 240, 'the walk to the tram');
});

test('round T7\'s one-way loop: on to the end of the line and back out, on the same line', () => {
    assert.deepEqual(legs(planJourney(network, 'evangelistria', 'skylitsi', NOW)[0]), ['T7 evangelistria>akti-poseidonos', 'T7 akti-poseidonos>skylitsi']);
    // The way behind you takes going round, or the metro
    const back = findRoutes(network, 'sef', 'agia-triada');
    assert.ok(back.some(route => route.legs.every(leg => leg.line === 'T7')));
    assert.ok(back.every(route => route.legs.length >= 2));
});

test('a stop a walk from where you start: the trip starts with the walk, and the tram after it', () => {
    const [plan] = planJourney(network, 'syntagma', 'zappeio', NOW);
    assert.deepEqual(legs(plan), ['T6 syntagma-tram>zappeio']);
    assert.equal(plan.walkFirst, 4);
    const train = plan.legs[0].departures[0];
    assert.ok(train.departs >= NOW.seconds + 4 * 60);
    assert.equal(tripTime(network, plan, NOW).minutes, Math.round((train.arrives - train.departs) / 60) + 4);
});

test('a stop a walk from where you end: the walk is in the arrival', () => {
    const [plan] = planJourney(network, 'kifisia', 'neo-faliro', NOW);
    assert.deepEqual(legs(plan), ['M1 kifisia>faliro']);
    assert.equal(plan.walkLast, 7);
    assert.equal(plan.arrives, plan.legs[0].departures[0].arrives + 7 * 60);
    assert.equal(tripTime(network, plan, NOW).arrives, plan.arrives);
});

test('T7 from Voula to SEF: to Neo Faliro, then a walk, as those trams count as ending there', () => {
    const [plan] = planJourney(network, 'asklipieio-voulas', 'sef', NOW);
    assert.deepEqual(legs(plan), ['T7 asklipieio-voulas>neo-faliro']);
    assert.equal(plan.walkLast, 7);
});

test('a change on foot takes the walk\'s time, and the next leg leaves from the other stop', () => {
    const [plan] = planJourney(network, 'kifisia', 'evangelistria', NOW);
    assert.deepEqual(legs(plan), ['M1 kifisia>faliro', 'T7 gipedo-karaiskaki>evangelistria']);
    const [first, second] = plan.legs.map(leg => leg.departures[0]);
    assert.ok(second.departs >= first.arrives + 3 * 60);
});

test('a route never gets off at a station it has already been through, but a train may pass one again', () => {
    for (const [from, to] of [['kifisia', 'faliro'], ['monastiraki', 'zappeio'], ['piraeus', 'pikrodafni']]) {
        for (const route of findRoutes(network, from, to)) {
            const through = new Set([from]);
            for (const leg of route.legs) {
                assert.ok(!through.has(leg.to), `${legs(route)}`);
                const { stops } = network.lines[leg.line].directions[leg.dir];
                stops.slice(leg.fromIndex, leg.toIndex + 1).forEach(stop => through.add(stop.station));
            }
        }
    }
    // Through Omonia on M2 and again on M1: today's planner offers it
    assert.ok(findRoutes(rail, 'acropolis', 'faliro').some(route => route.legs[0].to === 'attiki'));
});

test('a way with a tram is offered whatever its changes: slower ones start closed, they aren\'t dropped', () => {
    const ways = when => planJourney(network, 'korydallos', 'agia-paraskevi-tram', { ...NOW, seconds: when * 3600 }).map(plan => plan.legs.map(leg => `${leg.line} ${leg.to}`).join());
    // 10:03: both catch the same tram at Neos Kosmos. Fewer changes first, the M2 way still there
    const tied = ways(10.05);
    assert.equal(tied[0], 'M3 syntagma,T6 agia-paraskevi-tram');
    assert.ok(tied.includes('M3 syntagma,M2 neos-kosmos,T6 agia-paraskevi-tram'), tied.join(' | '));
    // 10:00: the M2 way catches the tram ahead, so it comes first
    assert.ok(ways(10)[0].includes('M2'), ways(10).join(' | '));
    assert.ok(planJourney(network, 'korydallos', 'agia-paraskevi-tram', NOW).length <= 3);
});

test('metro trains alone stay as they were beside the tram', () => {
    // Attiki and Omonia, one M1 and one M2 train: both, as today
    const metro = planJourney(network, 'kifisia', 'syntagma', NOW).filter(plan => plan.legs.every(leg => leg.line[0] === 'M')).map(plan => plan.legs[0].to);
    assert.deepEqual(metro, planJourney(rail, 'kifisia', 'syntagma', NOW).map(plan => plan.legs[0].to).slice(0, metro.length));
    // A direct train doesn't gain a metro detour
    assert.deepEqual(planJourney(network, 'syntagma', 'monastiraki', NOW).map(legs), planJourney(rail, 'syntagma', 'monastiraki', NOW).map(legs));
});

test('the quickest way can take three changes: from Zappeio to Evangelistria, the metro beats two trams', () => {
    const answer = now => planJourney(network, 'zappeio', 'evangelistria', now);
    // 24 minutes sooner than T6 and T7, which still follow it
    const [quickest, ...others] = answer(NOW);
    assert.deepEqual(legs(quickest), ['T6 zappeio>syntagma-tram', 'M2 syntagma>omonia', 'M1 omonia>faliro', 'T7 gipedo-karaiskaki>evangelistria']);
    assert.deepEqual(others.map(plan => plan.legs.map(leg => leg.line).join()), ['T6,T7', 'T6,T7']);
    assert.equal(Math.round((others[0].arrives - quickest.arrives) / 60), 24);
    // At 23:30 the trams can't make it tonight; the metro still can
    const late = answer({ ...NOW, seconds: 23.5 * 3600 });
    assert.notEqual(late[0].arrives, null);
    assert.ok(late.slice(1).every(plan => plan.arrives === null), late.map(legs).join(' | '));
});

// Every option of a sample of trips: none gets off where it has already been,
// on foot or by train, the start and the station walked to first included.
// Late at night a ride out and back would join two walks: at the start from
// Gipedo Karaiskaki, in the middle on M1 from Faliro on a Friday
for (const [when, now] of [
    ['a morning', NOW],
    ['a Wednesday night', { ...NOW, seconds: 23.5 * 3600 }],
    ['a Friday night', { weekday: 5, seconds: 23.83 * 3600, date: '2026-10-23' }],
]) {
    test(`no option gets off where it has already been, on ${when}`, () => {
        const pairs = everyPair(stations).filter(([from, to], i) => i % 11 === 0 && !network.walks[from]?.[to]);
        pairs.push(['gipedo-karaiskaki', 'agia-skepi'], ['34ou-syntagmatos', 'gipedo-karaiskaki']);
        for (const [from, to] of pairs) {
            for (const plan of planJourney(network, from, to, now)) {
                const been = new Set([from, plan.legs[0].from]);
                for (const leg of plan.legs) {
                    assert.ok(!been.has(leg.to), `${from}>${to}: ${legs(plan)}`);
                    network.lines[leg.line].directions[leg.dir].stops.slice(leg.fromIndex, leg.toIndex + 1).forEach(stop => been.add(stop.station));
                }
            }
        }
    });
}

test('a route doesn\'t ride back over the line it came on', () => {
    const lines = route => route.legs.map(leg => leg.line).join();
    // M3 out to Piraeus, then M3 back through Korydallos
    assert.deepEqual(findRoutes(network, 'korydallos', 'agia-paraskevi-tram').filter(route => lines(route).startsWith('M3,M3')), []);
    // On past Neo Faliro to Edem on T7, then back through Neo Faliro on T7
    const routes = findRoutes(network, 'skylitsi', 'evangelistria');
    assert.ok(routes.some(route => route.legs[0].to === 'neo-faliro'));
    assert.deepEqual(routes.filter(route => route.legs.some(leg => leg.line === 'T7' && ['edem', 'pikrodafni'].includes(leg.to))), []);
});

// The route finder as it was before the tram: direct routes if there are any,
// otherwise every one-change route. The metro's answers have to stay these.
function metroAnswers(from, to, now) {
    const between = (a, b) => Object.entries(rail.lines).flatMap(([line, { directions }]) => Object.entries(directions).flatMap(([dir, { stops }]) => {
        const fromIndex = stops.findIndex(s => s.station === a);
        const toIndex = stops.findIndex(s => s.station === b);
        return fromIndex !== -1 && toIndex > fromIndex ? [{ line, dir, from: a, to: b, fromIndex, toIndex }] : [];
    }));
    const direct = between(from, to).map(leg => [leg]);
    const routes = direct.length ? direct : Object.entries(rail.stations).flatMap(([via, { lines }]) => lines.length < 2 || via === from || via === to ? []
        : between(from, via).flatMap(first => between(via, to).filter(second => first.line !== second.line).map(second => [first, second])));
    const timed = routes.map(route => {
        let after = now.seconds;
        const times = route.map(leg => {
            const train = departures(rail, leg, { weekday: now.weekday, after, date: now.date })[0];
            if (train) after = train.arrives + 180;
            return train;
        });
        return { route, arrives: times.every(Boolean) ? times.at(-1).arrives : Infinity };
    });
    return timed.sort((a, b) => a.arrives - b.arrives).slice(0, 3).map(({ route }) => route.map(leg => `${leg.line} ${leg.from}>${leg.to}`));
}

// A sample, as all of them take seconds on every commit: every third trip on a
// morning, every seventh at the hours the last and first trains come into it
for (const [when, now, every] of [
    ['a morning', NOW, 3],
    ['a Friday night', { weekday: 5, seconds: 23.4 * 3600, date: '2026-10-23' }, 7],
    ['early on a Sunday', { weekday: 0, seconds: 6 * 3600, date: '2026-10-25' }, 7],
]) {
    test(`metro trips get the same answers as before the tram, in the same order, on ${when}`, () => {
        const pairs = everyPair(Object.keys(rail.stations)).filter((_, i) => i % every === 0);
        for (const [from, to] of pairs) assert.deepEqual(planJourney(rail, from, to, now).map(legs), metroAnswers(from, to, now), `${from}>${to}`);
    });
}
