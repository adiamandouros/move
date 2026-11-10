import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, notices } from './support/markup.js';
import { aboutTime, minutesMark } from '../public/js/core/times.js';

// OASA's live times on the Trip page's way shown in full (decision 35): the
// way timed again with them in the worker (liveWay in
// tools/trip/client/buses.js), which stops are asked for and when (live.js,
// decision 34), and the way drawn with them (render.js), in both languages;
// and on a decision, the quicker way offered and taken (decision 36).
// Over the test data's metro, tram and the buses between Kallithea and
// Syntagma, on a Wednesday. The page's side: test/browser/trip.spec.js.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { cityPlanner, halfHour, halfView, LIVE_STOPS, liveWay, routeCodes, shownRows } = await browserModule('tools/trip/client/buses.js');
const live = await browserModule('tools/trip/client/live.js');
const { withTram } = await browserModule('tools/subway/client/network.js');
const { latinName } = await browserModule('public/js/core/text.js');
const network = withTram(rail);
const city = cityPlanner(rail, buses, 3);

const point = id => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1] });
const menelaou = { lat: 37.95463, lng: 23.71049 };
const at = hours => ({ weekday: 3, seconds: hours * 3600 });
const MIN = 60;

function answered(from, to, now) {
    const steps = halfHour(city, from, to, now);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}
const codeOf = stop => stop.id.replace('bus:', '');
// The buses of `line` that ride from `board` to `alight` (stop indexes), as OASA names their routes
const routesOf = (line, board, alight) => [...routeCodes(city, [line], board, new Set([alight])).keys()];

// From Menelaou to Syntagma at 10:00 it depends: any bus from near the door,
// the 040 then the M2 from Syggrou-Fix, or the Β2 then the M2
const depends = shownRows(answered(menelaou, point('syntagma'), at(10)));
const busThenTrain = depends.find(row => row.key.startsWith('040'));
const [bus, train] = busThenTrain.best[0].legs;
const BOARD = codeOf(city.stops[bus.board]);
const [ROUTE] = routesOf('040', bus.board, bus.alight);
const timed = (row, stops, now = at(10)) => liveWay(city, menelaou, point('syntagma'), row, 0, now, stops);

test('the rows the page shows are those the worker times again, in the same order', () => {
    const answer = answered(menelaou, point('syntagma'), at(10));
    assert.deepEqual(halfView(city, menelaou, point('syntagma'), answer).rows.map(row => row.range), shownRows(answer).map(row => row.range));
});

test('which of OASA\'s routes ride a bus: the line\'s routes that get from its stop to where it\'s left, not the way back', () => {
    const both = city.routes.filter(route => route.line === '040').map(route => route.code);
    assert.ok(both.length > 1, '040 has more than one route');
    const there = routesOf('040', bus.board, bus.alight);
    assert.ok(there.length > 0 && there.length < both.length, there.join());
    assert.deepEqual(routesOf('040', bus.alight, bus.board), [], 'nothing rides it backwards');
    assert.deepEqual(routesOf('Β2', bus.board, bus.alight), [], 'another line isn\'t one of them');
});

test('before the live times come: the way for leaving now on the timetable, its bus\'s stop to ask, nothing said', () => {
    const way = timed(busThenTrain, {});
    assert.deepEqual(way.asks, [{ stop: BOARD, at: null }]);
    assert.deepEqual(way.stops, []);
    assert.equal(way.option.rides[0].live, undefined);
    // The first 040 that can be walked to from now, as the search has it
    assert.equal(way.option.rides[0].boards, busThenTrain.best[0].legs[0].boards);
});

test('a bus OASA has coming later than the timetable boards then, and the train after it is timed from there', () => {
    const late = 10 * 3600 + 9 * MIN;
    const stops = { [BOARD]: { buses: [
        // Gone before the rider can walk there (2 min 50 s)
        { route: ROUTE, line: '040', at: 10 * 3600 + 1 * MIN },
        { route: ROUTE, line: '040', at: late },
        { route: ROUTE, line: '040', at: late + 11 * MIN },
    ] } };
    const way = timed(busThenTrain, stops);
    const [first, second] = way.option.rides;
    assert.equal(first.boards, late);
    assert.deepEqual(first.live, { at: late, next: late + 11 * MIN });
    // As long a ride as the timetable's from then
    const [timetable] = city.ride([bus], late);
    assert.equal(first.arrives - first.boards, timetable.arrives - timetable.boards);
    // The M2 the rider can make from it, later than the one the timetable had
    assert.ok(second.boards >= first.arrives + (train.walkBefore ?? 0), 'after the bus');
    assert.ok(second.boards > busThenTrain.best[0].legs[1].boards, 'a later train');
    assert.equal(second.live, undefined, 'a train has no live times');
    assert.deepEqual(way.asks, [{ stop: BOARD, at: late }], 'asked again by when that bus comes');
    assert.ok(way.option.arrives > timed(busThenTrain, {}).option.arrives);
});

test('OASA with no bus the rider can catch: said, and the timetable\'s time stays; none to be had: nothing said', () => {
    // The 040 the other way, and a bus of a route the timetable doesn't have, at the same stop
    const away = city.routes.find(route => route.line === '040' && !routesOf('040', bus.board, bus.alight).includes(route.code)).code;
    const none = timed(busThenTrain, { [BOARD]: { buses: [{ route: away, line: '040', at: 10 * 3600 + 5 * MIN }, { route: '99999', line: '040', at: 10 * 3600 + 6 * MIN }] } });
    assert.deepEqual(none.option.rides[0].live, { none: true });
    assert.equal(none.option.rides[0].boards, timed(busThenTrain, {}).option.rides[0].boards);
    assert.deepEqual(none.asks, [{ stop: BOARD, at: null }]);

    const unavailable = timed(busThenTrain, { [BOARD]: { buses: [], unavailable: true } });
    assert.equal(unavailable.option.rides[0].live, undefined);
});

test('a way that can\'t be made from now, as its last bus has gone for the night, keeps its own times', () => {
    assert.equal(timed(busThenTrain, {}, at(27)), null);
    assert.equal(liveWay(city, menelaou, point('syntagma'), { ...busThenTrain, best: busThenTrain.best.map(() => null) }, 0, at(10), {}), null);
});

test('any bus from near the door: the stops with a bus the rider can catch first, by when it comes, the rest nearest first; at most 10 asked', () => {
    const fix = point('syggrou-fix');
    const [row] = shownRows(answered(menelaou, fix, at(12)));
    assert.ok(row.bundle && row.stops.length > LIVE_STOPS, `${row.stops.length} stops`);
    const doors = new Set(city.near(fix, 15 * MIN).filter((_, i) => i % 2 === 0));
    const busAt = ({ stop, walk, lines }, after) => {
        const [route] = routeCodes(city, lines, stop, doors);
        return { route: route[0], line: route[1], at: 12 * 3600 + walk + after };
    };
    const [nearest, second, third] = row.stops;
    const stops = {
        // Due 10 minutes after the rider gets there, and 2 minutes after, and gone a minute before
        [codeOf(city.stops[nearest.stop])]: { buses: [busAt(nearest, 10 * MIN)] },
        [codeOf(city.stops[third.stop])]: { buses: [busAt(third, 2 * MIN)] },
        [codeOf(city.stops[second.stop])]: { buses: [busAt(second, -MIN)] },
    };
    const way = liveWay(city, menelaou, fix, row, 0, at(12), stops);
    const order = way.stops.map(({ stop }) => stop.id);
    const ids = row.stops.map(({ stop }) => city.stops[stop].id);
    assert.deepEqual(order.slice(0, 2), [ids[2], ids[0]], 'the bus soonest first');
    assert.deepEqual(order.slice(2), ids.filter(id => id !== ids[0] && id !== ids[2]), 'then nearest first');
    assert.deepEqual(way.stops[0].buses, [{ line: busAt(third, 0).line, at: busAt(third, 2 * MIN).at }]);
    assert.deepEqual(way.stops[2].buses, [], 'answered, but its bus can\'t be caught');
    assert.equal(way.stops.at(-1).buses, null, 'not asked');
    // The nearest 10 asked, each by when the bus the rider can catch there comes
    assert.deepEqual(way.asks.map(({ stop }) => stop), ids.slice(0, LIVE_STOPS).map(id => id.replace('bus:', '')));
    assert.deepEqual(way.asks.slice(0, 3).map(({ at: when }) => when), [busAt(nearest, 10 * MIN).at, null, busAt(third, 2 * MIN).at]);
});

test('any bus after a train: the M2 to Syggrou-Fix, then the stops there, each caught from when the train gets in', () => {
    const syntagma = point('syntagma');
    const [row] = shownRows(answered(syntagma, menelaou, at(8.5)));
    assert.equal(row.key, 'M2 at Συγγρού Φιξ, a bus');
    const before = liveWay(city, syntagma, menelaou, row, 0, at(8.5), {});
    const [m2] = before.option.rides;
    assert.equal(m2.line, 'M2');
    assert.deepEqual(before.asks.map(({ stop }) => stop), row.stops.map(({ stop }) => codeOf(city.stops[stop])), 'every stop there, and no train');
    // A bus at the nearest stop before the train gets in can't be caught; one after it can
    const [nearest] = row.stops;
    const doors = new Set(city.near(menelaou, 15 * MIN).filter((_, i) => i % 2 === 0));
    const [[route, line]] = routeCodes(city, nearest.lines, nearest.stop, doors);
    const code = codeOf(city.stops[nearest.stop]);
    const ready = m2.arrives + (nearest.walk ? nearest.walk + 60 : 30);
    const way = liveWay(city, syntagma, menelaou, row, 0, at(8.5), { [code]: { buses: [{ route, line, at: m2.arrives - MIN }, { route, line, at: ready + 4 * MIN }] } });
    assert.deepEqual(way.stops[0].buses, [{ line, at: ready + 4 * MIN }]);
});

// ── The page's side (live.js) ───────────────────────────────────────────────

test('a stop is asked for by itself, the trip\'s first request saying it starts a search', () => {
    assert.equal(live.arrivalsUrl('240115', true), '/api/arrivals?stops=240115&for=plan-start');
    assert.equal(live.arrivalsUrl('240115', false), '/api/arrivals?stops=240115&for=plan');
});

test('an answer\'s buses are due at a time of day, so they count down by themselves, and say when they were said; one that couldn\'t be had says so', () => {
    const came = 10 * 3600;
    assert.deepEqual(live.stopLive({ arrivals: [{ route: '3922', line: '040', minutes: 4 }, { route: '3922', line: null, minutes: 0 }] }, came),
        { buses: [{ route: '3922', line: '040', at: came + 4 * MIN }, { route: '3922', line: null, at: came }], asked: came });
    assert.deepEqual(live.stopLive({ arrivals: [], stale: true }, came), { buses: [], asked: came, stale: true });
    assert.deepEqual(live.stopLive({ arrivals: [], unavailable: true }, came), { buses: [], asked: came, unavailable: true });
    // Asking failed: the last answer, possibly old, or none
    const last = { buses: [{ route: '3922', line: '040', at: came }] };
    assert.deepEqual(live.unanswered(last), { ...last, stale: true });
    assert.deepEqual(live.unanswered(undefined), { buses: [], unavailable: true });
    assert.deepEqual(live.unanswered({ buses: [], unavailable: true }), { buses: [], unavailable: true });
});

test('how often a stop is asked: by the first bus the rider can catch there, on the Buses page\'s tiers', () => {
    const seconds = 10 * 3600;
    const asks = [
        { stop: 'soon', at: seconds + 5 * MIN },
        { stop: 'later', at: seconds + 15 * MIN },
        { stop: 'far', at: seconds + 25 * MIN },
        { stop: 'none', at: null },
        { stop: 'new', at: null },
        { stop: 'busy', at: null },
        { stop: 'down', at: null },
    ];
    const answers = new Map(['soon', 'later', 'far', 'none', 'busy'].map(stop => [stop, { buses: [] }]));
    answers.set('down', { buses: [], unavailable: true });
    const state = since => ({ asking: new Set(['busy']), answers, asked: new Map(['soon', 'later', 'far', 'none', 'busy', 'down'].map(stop => [stop, 1_000_000 - since])) });
    const due = since => live.dueStops(asks, state(since), 1_000_000, seconds);
    // Never asked: at once; being asked: never twice
    assert.deepEqual(due(0), ['new']);
    assert.deepEqual(due(31_000), ['new']);
    assert.deepEqual(due(32_000), ['soon', 'new', 'down'], 'due within 10 minutes, and none to be had: every 30 s');
    assert.deepEqual(due(62_000), ['soon', 'later', 'new', 'down'], 'within 20: every minute');
    assert.deepEqual(due(122_000), ['soon', 'later', 'far', 'none', 'new', 'down'], 'later or none: every 2 minutes');
});

// ── The quicker way on a decision (decision 36) ─────────────────────────────

// From Σταύρου 1 to Μενελάου 45 at noon: the directions stay on the T6 to
// Megalou Alexandrou for any bus there; the quicker way gets off at Agia
// Foteini for any of its buses
const stavrou = { lat: 37.9535, lng: 23.7255 };
const menelaou45 = { lat: 37.955, lng: 23.707 };
const NOON = at(12);
const decided = answered(stavrou, menelaou45, NOON);
const { decision } = decided;
const [directions] = shownRows(decided);
const DEPARTURE = directions.best.findIndex(Boolean);
const QUICKER = codeOf(city.stops[decision.stop]);
const offered = (stops, more = {}) => liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, stops, { decision, ...more });
// The quicker way's bus: its line, and a route of it that gets to where it's left
const [, OFF_BUS] = decision.getOff.best.find(Boolean).legs;
const [QUICKER_ROUTE] = routesOf(OFF_BUS.line, decision.stop, OFF_BUS.alight);
// Every stop asked answered with no bus, but the quicker way's: its buses due `after` seconds from noon
const quickerBus = (after, more = {}) => Object.fromEntries(offered({}).asks.map(({ stop }) => [stop, stop === QUICKER
    ? { buses: after.map(seconds => ({ route: QUICKER_ROUTE, line: OFF_BUS.line, at: NOON.seconds + seconds })), asked: NOON.seconds, ...more }
    : { buses: [], asked: NOON.seconds }]));

test('a decision whose directions have no bus to ask for of their own: the quicker way\'s stop is asked first, nothing offered before it answers', () => {
    assert.equal(decided.kind, 'decision');
    assert.equal(directions, decision.stayOn);
    const way = offered({});
    assert.equal(way.offer, null);
    assert.deepEqual(way.asks[0], { stop: QUICKER, at: null });
    // Then the stops of the directions' last bus, nearest first, as without the decision
    const own = directions.stops.map(({ stop }) => codeOf(city.stops[stop])).slice(0, LIVE_STOPS);
    assert.deepEqual(liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, {}).asks.map(({ stop }) => stop), own);
    assert.deepEqual(way.asks.slice(1).map(({ stop }) => stop), own.filter(stop => stop !== QUICKER));
});

test('OASA has the quicker way\'s bus coming in time, and nothing as quick staying on: offered, how much sooner, where to get off it, the walk', () => {
    const way = offered(quickerBus([16 * MIN, 31 * MIN]));
    const off = decision.getOff.best.find(Boolean);
    assert.equal(way.offer.line, OFF_BUS.line);
    assert.equal(way.offer.at, NOON.seconds + 16 * MIN);
    assert.ok(way.offer.sooner >= 180, `${way.offer.sooner} s`);
    assert.deepEqual(way.offer.ride, { line: 'T6', mode: 'tram' });
    assert.equal(way.offer.change.id, city.stops[off.legs[0].alight].id);
    assert.equal(way.offer.stop.id, city.stops[decision.stop].id);
    assert.equal(way.offer.walk.minutes, Math.max(1, Math.round(off.legs[1].walkBefore / 60)));
    assert.deepEqual(way.asks[0], { stop: QUICKER, at: NOON.seconds + 16 * MIN }, 'asked again by when that bus comes');
    // The directions stay as they are
    assert.deepEqual(way.option, offered({}).option);
});

test('not offered: a bus gone before the tram gets there, one as soon staying on, an older answer, or none to be had', () => {
    assert.equal(offered(quickerBus([MIN])).offer, null, 'gone');
    // Staying on, any of its buses will do: sooner than one of them by the timetable isn't enough
    assert.ok(offered(quickerBus([22 * MIN])).offer);
    assert.equal(offered(quickerBus([24 * MIN])).offer, null, 'no sooner than the first of the directions\' buses');
    assert.equal(offered(quickerBus([16 * MIN], { stale: true })).offer, null, 'older');
    assert.equal(offered(quickerBus([], { unavailable: true })).offer, null, 'none to be had');
    // A bus at the directions' own stops as soon: staying on is as quick
    const stops = quickerBus([16 * MIN]);
    for (const { stop, lines } of directions.stops) {
        const [route] = routeCodes(city, lines, stop, new Set(city.near(menelaou45, 15 * MIN).filter((_, i) => i % 2 === 0)));
        stops[codeOf(city.stops[stop])] = { buses: [{ route: route[0], line: route[1], at: NOON.seconds + 16 * MIN }], asked: NOON.seconds };
    }
    assert.equal(offered(stops).offer, null, 'as soon');
    // Its line the other way, or a bus of a route the timetable doesn't have, isn't the quicker way's
    const away = city.routes.find(route => route.line === OFF_BUS.line && route.code !== QUICKER_ROUTE && !route.stops.includes(decision.stop));
    const other = quickerBus([16 * MIN]);
    other[QUICKER].buses = [away?.code ?? '99999', '99999'].map(route => ({ route, line: OFF_BUS.line, at: NOON.seconds + 16 * MIN }));
    assert.equal(offered(other).offer, null, 'not its route');
});

test('the quicker way taken: it\'s the way timed, from the same tram, with its own stops asked, and nothing more offered', () => {
    const stops = quickerBus([16 * MIN]);
    const taken = offered(stops, { taken: true });
    const directed = offered(stops);
    assert.equal(taken.offer, null);
    assert.deepEqual(taken.option.rides[0].alight, city.stops[decision.getOff.best.find(Boolean).legs[0].alight], 'off the tram sooner');
    assert.equal(taken.option.rides[0].boards, directed.option.rides[0].boards, 'the same tram');
    assert.ok(taken.stops.some(({ stop, buses }) => stop.id === city.stops[decision.stop].id && buses?.[0]?.at === NOON.seconds + 16 * MIN), 'its bus at its stop');
    assert.ok(taken.asks.some(({ stop }) => stop === QUICKER));
    // The directions' bus ride can't be left, so there's nothing to take
    assert.equal(liveWay(city, stavrou, menelaou45, directions, DEPARTURE, NOON, stops, { decision: { ...decision, getOff: { ...decision.getOff, best: decision.getOff.best.map(() => null) } }, taken: true }), null);
});

test('what\'s said above the answer: paused, none to be had anywhere, or older times', () => {
    const asks = [{ stop: 'a', at: null }, { stop: 'b', at: null }];
    const answers = entries => new Map(entries);
    assert.equal(live.liveStatus(asks, answers([]), true), 'paused');
    assert.equal(live.liveStatus(asks, answers([]), false), null);
    assert.equal(live.liveStatus(asks, answers([['a', { buses: [], unavailable: true }]]), false), 'unavailable');
    assert.equal(live.liveStatus(asks, answers([['a', { buses: [], unavailable: true }], ['b', { buses: [] }]]), false), null);
    assert.equal(live.liveStatus(asks, answers([['a', { buses: [], stale: true }], ['b', { buses: [] }]]), false), 'stale');
});

// ── Drawn ───────────────────────────────────────────────────────────────────

for (const lang of ['en', 'el']) {
    const r = await browserModule('tools/trip/client/render.js', lang);
    const keys = Object.keys(strings(lang));
    const s = strings(lang);
    const check = view => assert.deepEqual(markupProblems(String(view), { keys }), []);
    const escaped = text => text.replace(/'/g, '&#39;');
    // Minutes as every page writes them (/js/core/times.js), and a time that's a guess
    const mark = (minutes, options) => String(minutesMark(minutes, key => s[key], options));
    const about = time => String(aboutTime(time, key => s[key]));
    // Nothing under the answer (decision 43): it ends with its last way
    const nothingUnder = html => assert.ok(html.trimEnd().endsWith('</div>'), 'nothing under the answer');
    const view = viewOf => JSON.parse(JSON.stringify(viewOf));
    const now = 10 * 3600;
    const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
    const half = view(halfView(city, menelaou, point('syntagma'), answered(menelaou, point('syntagma'), at(10))));
    // The 040 then the M2 first, as the way shown in full
    const shown = { ...half, rows: half.rows.filter(row => !row.bundle) };
    const ways = r.halfWays(shown, now);
    const drawn = way => String(r.renderHalf(network, shown.kind, ways, point('syntagma'), { live: { way: view(way), now } }));

    test(`${lang}: a bus OASA has coming, by its time, its minutes and the next one's`, () => {
        const way = timed(busThenTrain, { [BOARD]: { buses: [{ route: ROUTE, line: '040', at: now + 6 * MIN + 30 }, { route: ROUTE, line: '040', at: now + 14 * MIN }] } });
        const html = drawn(way);
        check(html);
        assert.ok(html.includes(`<span class="trip-step-when">${clock(now + 6 * MIN + 30)}</span>`), 'no "~": it\'s OASA\'s');
        assert.ok(html.includes(`<span class="time-badge time-close"><span aria-hidden="true">6'</span><span class="sr-only">${s['shell.minutes'].replace('{minutes}', 6)}</span></span>`));
        assert.ok(html.includes(s['trip.live-next'].replace('{minutes}', mark(14))), 'the next one, "14\'" too');
        assert.ok(html.includes(`<span class="trip-step-when">${clock(way.option.rides[1].boards)}</span>`), 'the train after it, timed from it');
        nothingUnder(html);
    });

    test(`${lang}: a bus due in 3 minutes or less says so; one that's the last on the road has no "next"`, () => {
        const html = drawn(timed(busThenTrain, { [BOARD]: { buses: [{ route: ROUTE, line: '040', at: now + 3 * MIN }] } }));
        check(html);
        assert.ok(html.includes(`<span class="time-badge time-due"><span aria-hidden="true">3'</span><span class="sr-only">${s['shell.minutes'].replace('{minutes}', 3)}, ${s['shell.arriving-soon']}</span></span>`));
        const [times] = html.match(/<div class="trip-live">.*?<\/div>/s);
        assert.ok(!times.includes('trip-step-note'), 'no "next"');
    });

    test(`${lang}: no bus on OASA's live times yet: said, with the timetable's "~" time, "about" to a screen reader`, () => {
        const way = timed(busThenTrain, { [BOARD]: { buses: [] } });
        const html = drawn(way);
        check(html);
        assert.ok(html.includes(s['trip.live-none']));
        assert.ok(html.includes(`<span class="trip-step-when">${about(clock(way.option.rides[0].boards))}</span>`));
        nothingUnder(html);
    });

    test(`${lang}: any bus from near the door, the stops with a bus first, each line with its minutes`, () => {
        const fix = point('syggrou-fix');
        const half12 = view(halfView(city, menelaou, fix, answered(menelaou, fix, at(12))));
        const [row] = shownRows(answered(menelaou, fix, at(12)));
        const [nearest, second] = row.stops;
        const doors = new Set(city.near(fix, 15 * MIN).filter((_, i) => i % 2 === 0));
        const [[route, line]] = routeCodes(city, second.lines, second.stop, doors);
        const way = liveWay(city, menelaou, fix, row, 0, at(12), {
            [codeOf(city.stops[second.stop])]: { buses: [{ route, line, at: 12 * 3600 + second.walk + 9 * MIN }] },
            [codeOf(city.stops[nearest.stop])]: { buses: [] },
        });
        const html = String(r.renderHalf(network, half12.kind, r.halfWays(half12, 12 * 3600), fix, { live: { way: view(way), now: 12 * 3600 } }));
        check(html);
        // After "Any of these buses": the stop with a bus, its line with its minutes; then the nearest, answered with none
        const [first, next] = html.split('<li class="trip-step">').slice(2);
        assert.ok(first.includes(`<span class="trip-live-bus"><span class="bus-plate pill-s">${line}</span> <span class="time-badge time-later">`), first);
        assert.ok(next.includes(s['trip.live-none']));
    });

    // From Σταύρου 1 to Μενελάου 45 at noon, a decision (decision 36)
    const decidedView = view(halfView(city, stavrou, menelaou45, decided));
    const decidedWays = r.halfWays(decidedView, NOON.seconds);
    const target = { ...menelaou45, title: 'Μενελάου 45', exact: null };
    const drawnDecided = (way, more = {}) => String(r.renderHalf(network, decidedView.kind, decidedWays, target, { live: way && { way: view(way), now: NOON.seconds }, ...more }));
    const stopNamed = stop => lang === 'el' ? stop.names.el : stop.names.en || latinName(stop.names.el);

    test(`${lang}: the quicker way offered under the directions: how much sooner, where to get off the tram for which bus, the walk, the choice`, () => {
        const way = offered(quickerBus([16 * MIN]));
        const html = drawnDecided(way, { offer: true });
        check(html);
        const [directed, offer] = html.split('<div class="trip-card" id="trip-quicker">');
        assert.ok(directed.includes('<h2 class="trip-total" tabindex="-1">'), 'the directions first');
        assert.ok(offer.includes(`<h2 class="trip-total trip-total-small">${s['trip.quicker-title'].replace('{minutes}', mark(Math.floor(way.offer.sooner / 60)))}</h2>`));
        assert.equal(r.quickerSummary(way.offer), s['trip.quicker-title'].replace('{minutes}', s['shell.minutes'].replace('{minutes}', Math.floor(way.offer.sooner / 60))), 'in words for a screen reader');
        // Off the T6 at its stop, a tram's ("στη στάση" in Greek, not a station's)
        assert.ok(offer.includes('line-t6'));
        const change = network.stations[way.offer.change.station].name[lang];
        assert.ok(offer.includes(escaped(s['trip.quicker-off'].split('{ride}')[1].replace('{change}', change))), change);
        // For the bus, at its stop, by OASA's time, after the walk
        assert.ok(offer.includes(`<span class="bus-plate pill-s">${OFF_BUS.line}</span>`));
        assert.ok(offer.includes(escaped(s['trip.quicker-bus'].split('{bus}')[1]
            .replace('{stop}', stopNamed(way.offer.stop)).replace('{time}', clock(way.offer.at))).replace('{minutes}', mark(way.offer.walk.minutes, { about: true }))));
        assert.ok(offer.includes(`<button type="button" id="trip-quicker-take" class="btn btn-primary btn-sm rounded-pill px-4">${escaped(s['trip.quicker-take'])}</button>`));
        assert.ok(offer.includes(`<button type="button" id="trip-quicker-keep" class="btn btn-sm locate-btn">${escaped(s['trip.quicker-keep'])}</button>`));
        // Kept, or none in time: the directions alone
        assert.ok(!drawnDecided(way, { offer: false }).includes('trip-quicker'));
        assert.ok(!drawnDecided(offered({}), { offer: true }).includes('trip-quicker'));
    });

    test(`${lang}: the quicker way taken: its steps in the directions' place, said, with the way back; before its live times, the half hour's own`, () => {
        const taken = offered(quickerBus([16 * MIN]), { taken: true });
        const html = drawnDecided(taken, { offer: true, taken: decidedView.quicker });
        check(html);
        const [low, high] = decidedView.quicker.range;
        assert.ok(html.includes(`<h2 class="trip-total" tabindex="-1">${low === high ? mark(low, { about: true }) : mark([low, high])}</h2>`));
        assert.ok(html.includes(`<span class="trip-arrives">${escaped(s['trip.quicker-taken'])}</span>`));
        assert.ok(html.includes(`<button type="button" id="trip-quicker-back" class="btn btn-sm locate-btn trip-stand">${escaped(s['trip.quicker-back'])}</button>`));
        assert.ok(!html.includes('trip-quicker-take'), 'nothing more offered');
        assert.ok(html.includes(`<span class="bus-plate pill-s">${OFF_BUS.line}</span> <span class="time-badge`), 'its bus with its minutes');
        const waiting = drawnDecided(null, { taken: decidedView.quicker });
        check(waiting);
        assert.ok(waiting.includes(escaped(s['trip.quicker-back'])) && waiting.includes(escaped(s['trip.any-bus-then'])));
    });

    test(`${lang}: paused, unavailable or older live times, said above the answer: an error when they can't be had, a warning when the answer may be off; paused with a button`, () => {
        check(r.liveNotice('paused'));
        assert.match(String(r.liveNotice('paused')), new RegExp(`${s['trip.live-paused']} <button type="button" class="btn btn-link btn-sm p-0 align-baseline">${s['trip.live-resume']}</button>`));
        assert.deepEqual(notices(r.liveNotice('paused')).map(({ tone, icon }) => [tone, icon]), [['warn', 'warning']]);
        assert.deepEqual(notices(r.liveNotice('unavailable')), [{ tone: 'danger', icon: 'error', text: s['trip.live-unavailable'] }]);
        assert.deepEqual(notices(r.liveNotice('stale')), [{ tone: 'warn', icon: 'warning', text: s['trip.live-stale'] }]);
        assert.equal(r.liveNotice(null), '');
    });
}
