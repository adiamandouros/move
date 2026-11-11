import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, nothingUnder, notices } from './support/markup.js';
import { buildTrains } from '../server/data/build-suburban.js';
import { suburbanCurated, train } from './fixtures/railway.js';
import { aboutTime, minutesBadge, minutesMark } from '../public/js/core/times.js';

// The next half hour's answer as the trip page shows it (decision 33): what
// the worker picks from answer.js (halfView in tools/trip/client/buses.js),
// which departure the page shows as the clock goes on, and the answer drawn
// in both languages (render.js). Over the test data's metro, tram and the
// buses between Kallithea and Syntagma, on a Wednesday.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { cityPlanner, halfHour, halfView } = await browserModule('tools/trip/client/buses.js');
const { planTrip, withTram } = await browserModule('tools/subway/client/network.js');
const { walkingUrl } = await browserModule('public/js/core/html.js');
const network = withTram(rail);
const city = cityPlanner(rail, buses, 3);

const station = (id, title) => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1], station: id, title, exact: null });
const menelaou = { lat: 37.95463, lng: 23.71049, title: 'Μενελάου 25', exact: null };
const fix = station('syggrou-fix', 'Συγγρού-Φιξ');
const syntagma = station('syntagma', 'Σύνταγμα');
const larissa = station('larissa-station', 'Σταθμός Λαρίσης');
const at = hours => ({ weekday: 3, seconds: hours * 3600 });

// The half hour's answer, as answer.js gives it, and as the page gets it from the worker
function answered(from, to, now) {
    const steps = halfHour(city, from, to, now);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}
const viewOf = (from, to, now, answer = answered(from, to, now)) => JSON.parse(JSON.stringify(halfView(city, from, to, answer)));

// One clear way, any of the buses from the stops near the door; it depends; by rail alone
const clear = viewOf(menelaou, fix, at(12));
const depends = viewOf(menelaou, syntagma, at(10));
const byRail = viewOf(syntagma, larissa, at(12));

// The suburban railway that Wednesday (decision 41): from Athens station to the airport every 10 minutes, 40 minutes on the way
const { trainDay } = await browserModule('tools/subway/client/city.js');
const DATE = '2026-10-21';
const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const trains = buildTrains({ [DATE]: { schedules: Array.from({ length: 8 }, (_, i) => train(DATE, `12${i}`, [['o2', hhmm(600 + i * 10)], ['o3', hhmm(640 + i * 10)]])) } }, suburbanCurated()).data;
const cityByTrain = cityPlanner(rail, buses, 3, trainDay(trains, DATE));
const athensStation = { lat: 37.99284, lng: 23.72015, title: 'Αθήνα', exact: null };
const airportStation = { lat: 37.93698, lng: 23.94481, title: 'Αεροδρόμιο', exact: null };
const byTrain = (() => {
    const steps = halfHour(cityByTrain, athensStation, airportStation, at(10));
    let step = steps.next();
    while (!step.done) step = steps.next();
    return JSON.parse(JSON.stringify(halfView(cityByTrain, athensStation, airportStation, step.value)));
})();

test('one clear way comes first: to Syggrou-Fix at noon, any of the buses from the stops near the door', () => {
    assert.equal(clear.kind, 'clear');
    const [first] = clear.rows;
    assert.ok(first.bundle && first.lines.length > 1, first.lines.join());
    assert.equal(first.options.length, 16, 'a way for each departure tried, every 2 minutes');
    assert.deepEqual(clear.departures, Array.from({ length: 16 }, (_, i) => 12 * 3600 + i * 120));
});

test('a bus that can be any of several: every stop it leaves from, nearest first, with its lines, and the ride carries them all', () => {
    const [first] = clear.rows;
    const walks = first.stops.map(({ walk }) => walk?.minutes ?? 0);
    assert.deepEqual(walks, [...walks].sort((a, b) => a - b), 'nearest first');
    assert.ok(first.stops.every(({ stop, lines }) => stop.names.el && lines.length > 0));
    assert.deepEqual([...new Set(first.stops.flatMap(({ lines }) => lines))].sort(), first.lines, 'each line at one stop or more');
    const option = first.options.find(Boolean);
    assert.deepEqual(option.rides.at(-1).lines, first.lines);
});

test('it depends: the ways in order by the weights, and none that was never within 3 minutes of the quickest', () => {
    const answer = answered(menelaou, syntagma, at(10));
    assert.equal(depends.kind, 'depends');
    const offered = answer.rows.filter(row => row.close > 0).slice(0, 3);
    assert.deepEqual(depends.rows.map(row => row.range), offered.map(row => row.range));
    // One never close is left out, wherever it is
    const never = answer.rows.map((row, i) => i === 1 ? { ...row, close: 0 } : row);
    const shown = viewOf(menelaou, syntagma, at(10), { ...answer, rows: never }).rows;
    assert.deepEqual(shown.map(row => row.range), never.filter(row => row.close > 0).slice(0, 3).map(row => row.range));
});

test('a decision: the directions that stay on come first, whatever the weights say, and the quicker way goes with them', () => {
    const answer = answered(menelaou, syntagma, at(10));
    assert.ok(answer.rows.length > 3, `${answer.rows.length} ways`);
    const [getOff, , stayOn] = answer.rows;
    const view = viewOf(menelaou, syntagma, at(10), { ...answer, kind: 'decision', decision: /** @type {any} */ ({ stayOn, getOff }) });
    assert.deepEqual(view.rows[0].range, stayOn.range);
    assert.equal(view.rows.length, 3);
    assert.deepEqual(view.quicker, view.rows[1], 'one of the ways shown');
    // One that isn't shown comes all the same
    const hidden = answer.rows.at(-1);
    assert.deepEqual(viewOf(menelaou, syntagma, at(10), { ...answer, kind: 'decision', decision: /** @type {any} */ ({ stayOn, getOff: hidden }) }).quicker.range, hidden.range);
    assert.equal(clear.quicker, null, 'no decision, nothing quicker');
});

test('nothing found in the half hour: nothing to show', () => {
    assert.deepEqual(halfView(city, menelaou, fix, { kind: 'none', rows: [], departures: [] }).rows, []);
});

for (const lang of ['en', 'el']) {
    const r = await browserModule('tools/trip/client/render.js', lang);
    const subway = await browserModule('tools/subway/client/render.js', lang);
    const keys = Object.keys(strings(lang));
    const s = strings(lang);
    const check = view => assert.deepEqual(markupProblems(String(view), { keys }), []);
    // Minutes as every page writes them (/js/core/times.js): a range, "16–19'", or one, "~17'"
    const mark = (minutes, options) => String(minutesMark(minutes, key => s[key], options));
    const range = ([low, high]) => low === high ? mark(low, { about: true }) : mark([low, high]);
    // A time that's a guess (/js/core/times.js): "~12:06", "about 12:06" for screen readers
    const about = time => String(aboutTime(time, key => s[key]));
    // When a ride leaves, on the left of its step, strong
    const leaves = time => `<span class="trip-step-when trip-step-leaves">${time}</span>`;
    const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
    // A train's badge, counted from `now`, as the Subway page's card has it
    const badge = (departs, now) => String(subway.departureChip({ departs, isLast: false, isSecondLast: false }, { seconds: now }, false));

    test(`${lang}: the clear way, its range, "best on most departures", and the nearest 3 stops with their buses`, () => {
        const ways = r.halfWays(clear, at(12).seconds);
        const view = String(r.renderHalf(network, clear.kind, ways, fix, { ...at(12), now: at(12).seconds }));
        check(view);
        const [first] = clear.rows;
        assert.ok(view.includes(`<h2 class="trip-total" tabindex="-1">${range(first.range)}</h2>`));
        assert.ok(view.includes(s['trip.half-best']));
        assert.ok(view.includes(s['trip.any-bus']), 'from the door, so no "then"');
        // The bus has no time by the clock: any of them will do
        assert.ok(!/trip-step-when[^"]*"><span aria-hidden="true">~\d\d:\d\d/.test(view));
        // Each stop has walking directions there, its name plain text: the
        // nearest 3 shown, the rest behind "N more stops"
        const [shown, more] = view.split('<details class="trip-more">');
        assert.ok(view.match(/<a href="https:\/\/www\.google\.com\/maps[^>]*>/g).every(a => a.includes('class="directions-btn ')), 'no stop\'s name is a link');
        const link = ({ stop }) => walkingUrl(stop.lat, stop.lng).replace(/&/g, '&amp;');
        for (const stop of first.stops.slice(0, 3)) assert.ok(shown.includes(link(stop)), stop.stop.id);
        for (const stop of first.stops.slice(3)) assert.ok(more.includes(link(stop)) && !shown.includes(link(stop)), stop.stop.id);
        assert.ok(more.includes(s['trip.more-stops'].replace('{count}', first.stops.length - 3)));
        assert.ok(nothingUnder(view), 'nothing under the answer');
    });

    test(`${lang}: it depends, said above the way first by the weights; the others on a line each, with their range`, () => {
        const ways = r.halfWays(depends, at(10).seconds);
        const view = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds }));
        check(view);
        assert.ok(view.includes(s['trip.half-depends-intro']));
        assert.ok(!view.includes(s['trip.half-best']));
        assert.ok(view.includes(s['trip.other-ways']));
        for (const row of depends.rows.slice(1)) assert.ok(view.includes(`<h3 class="trip-total trip-total-small">${range(row.range)}</h3>`), row.range.join());
        // The first, any bus from near the door; the next, the 040 then the M2, from where it's caught
        assert.ok(depends.rows[0].bundle && !depends.rows[1].bundle);
        assert.ok(view.includes(s['trip.any-bus']));
        const second = ways[1].o;
        assert.deepEqual(second.rides.map(ride => ride.line), ['040', 'M2']);
        assert.ok(view.includes(s['trip.walk-short'].replace('{minutes}', mark(second.firstWalk.minutes, { about: true }))), 'walking there, "~" an estimate');
    });

    test(`${lang}: a bus that's one line has its time by the clock, as an estimate; the train after it is a card, its first badge the train the way is timed on`, () => {
        // The 040 then the M2 first
        const view = { ...depends, rows: depends.rows.slice(1) };
        const ways = r.halfWays(view, at(10).seconds);
        const html = String(r.renderHalf(network, view.kind, ways, syntagma, { ...at(10), now: at(10).seconds }));
        check(html);
        const [bus, train] = ways[0].o.rides;
        assert.ok(html.includes(leaves(about(clock(bus.boards)))));
        assert.ok(!html.includes(leaves(clock(train.boards))), 'no time on the left of a train');
        const card = html.slice(html.indexOf('<li class="trip-leg">'));
        assert.ok(card.includes(`<span class="schedule-chips">${badge(train.boards, at(10).seconds)}`), 'from the M2 the rider can catch after the bus, counted from now');
    });

    test(`${lang}: a bus by the timetable has its badge and the next one's at the right of its heading, counted from now; none an hour or more away`, () => {
        // The 040 then the M2 first
        const view = { ...depends, rows: depends.rows.slice(1) };
        const ways = r.halfWays(view, at(10).seconds);
        const [bus] = ways[0].o.rides;
        assert.ok(bus.next > bus.boards, 'the timetable has the next 040');
        const drawn = now => String(r.renderHalf(network, view.kind, ways, syntagma, { now, weekday: 3 }));
        const badges = (...minutes) => `<span class="trip-step-badges">${minutes.map((m, i) => String(minutesBadge(m, key => s[key], { said: i ? s['trip.next-in'] : undefined }))).join('')}</span>`;
        const minutesTo = (at, now) => Math.floor((at - now) / 60);
        const now = at(10).seconds;
        const html = drawn(now);
        check(html);
        const head = html.slice(html.indexOf('<div class="trip-step-head">'), html.indexOf('<li class="trip-leg">'));
        assert.ok(head.includes(badges(minutesTo(bus.boards, now), minutesTo(bus.next, now))), head);
        assert.ok(head.indexOf('bus-plate pill-m') < head.indexOf('trip-step-badges'), 'after its plate and where it goes');
        // The next one an hour away: the first alone
        const later = bus.next - 60 * 60;
        assert.ok(drawn(later).includes(badges(minutesTo(bus.boards, later))));
        // An hour or more away: none, the clock time says it
        assert.ok(!drawn(bus.boards - 60 * 60).includes('trip-step-badges'));
    });

    test(`${lang}: by rail alone, the Subway page's own card, where to stand on the train included, and the legend under the way`, () => {
        assert.equal(byRail.kind, 'clear');
        const ways = r.halfWays(byRail, at(12).seconds);
        const view = String(r.renderHalf(network, byRail.kind, ways, larissa, { ...at(12), now: at(12).seconds }));
        check(view);
        // As the Subway page draws Syntagma to Larissa Station at noon, with its ride's minutes
        const { plans: [plan] } = planTrip(network, 'syntagma', 'larissa-station', at(12));
        assert.deepEqual(ways[0].o.rides.map(ride => ride.line), plan.legs.map(leg => leg.line));
        for (const [i, leg] of plan.legs.entries()) {
            const card = String(subway.legCard(network, leg, plan.legs[i + 1] ?? null, { seconds: at(12).seconds }, 3, false, true, `${leg.line}/${leg.dir}/${leg.from}/${leg.to}`, false));
            assert.ok(view.includes(`<li class="trip-leg">${card}</li>`), leg.line);
        }
        assert.ok(!view.includes('/subway?from='), 'no "Where to stand" button: the card shows it');
        assert.ok(view.indexOf('<details class="diagram-legend" open>') > view.indexOf('trip-leg'), 'the legend under the way');
        // Its stations on the way opened by the rider stay open
        const [leg] = plan.legs;
        const opened = String(r.renderHalf(network, byRail.kind, ways, larissa, { ...at(12), now: at(12).seconds, stations: { [`${leg.line}/${leg.dir}/${leg.from}/${leg.to}`]: true } }));
        assert.match(opened, /aria-expanded="true"/);
    });

    test(`${lang}: the step-free notice above the half hour's answer, for the stations of every way shown; none for buses alone`, () => {
        const lifts = { stations: { syntagma: { status: 'closed', out: ['Εξωτερικός'] } }, unavailable: false };
        const ways = r.halfWays(byRail, at(12).seconds);
        const view = String(r.renderHalf(network, byRail.kind, ways, larissa, { ...at(12), now: at(12).seconds, lifts }));
        check(view);
        assert.match(view, /^\s*<details class="notice notice-warn closable-notice lift-notice mb-3" open>/);
        // Where the M2's platform at Larissa has steps only
        const steps = structuredClone(network);
        steps.lines.M2.directions.anthoupoli.stops.find(stop => stop.station === 'larissa-station').stepFree = 'no';
        const gap = String(r.renderHalf(steps, byRail.kind, ways, larissa, { ...at(12), now: at(12).seconds, lifts: { stations: {}, unavailable: false } }));
        assert.ok(gap.includes(s['lifts.no-step-free'].split('{station}')[1].split('{toward}')[0]), 'the platform with steps only');
        // The rider took the quicker way (the 040 then the M2) over the
        // directions (any bus): its stations
        const two = { ...depends, rows: depends.rows.slice(0, 2) };
        const taken = String(r.renderHalf(network, two.kind, r.halfWays(two, at(10).seconds), syntagma, { ...at(10), now: at(10).seconds, taken: two.rows[1], lifts: { stations: { 'syggrou-fix': { status: 'partial', out: [] } }, unavailable: true } }));
        assert.deepEqual(notices(taken), [{ tone: 'danger', icon: 'error', text: s['lifts.unavailable'] }]);
        assert.match(taken, /lift-notice/);
        // Any of the buses: no station, nothing to say
        assert.doesNotMatch(String(r.renderHalf(network, clear.kind, r.halfWays(clear, at(12).seconds), fix, { ...at(12), now: at(12).seconds, lifts: { stations: {}, unavailable: true } })), /lift-/);
    });

    test(`${lang}: the answer for leaving now says the half hour is being checked, while it is`, async () => {
        const { doorToDoor } = await browserModule('tools/trip/client/plan.js', lang);
        const trip = doorToDoor(network, menelaou, syntagma, { ...at(10), date: '2026-10-21' });
        assert.ok(String(r.renderTrip(network, trip, syntagma, { ...at(10), now: at(10).seconds, checking: true })).includes(s['trip.half-checking']));
        assert.ok(!String(r.renderTrip(network, trip, syntagma, { ...at(10), now: at(10).seconds })).includes(s['trip.half-checking']));
    });

    test(`${lang}: a way by suburban railway in the half hour's answer has its pill, nothing under it of where its times are from; with no trains today, an error above says they're left out`, () => {
        const ways = r.halfWays(byTrain, at(10).seconds);
        assert.ok(ways.some(({ o }) => o.rides.some(ride => ride.mode === 'suburban')), 'a way by train is shown');
        const view = String(r.renderHalf(network, byTrain.kind, ways, airportStation, { ...at(10), now: at(10).seconds }));
        check(view);
        assert.ok(view.includes('line-a1">A1<'));
        assert.equal(view.includes('railway.gov.gr'), false, 'credited on the About page, not under the answer');
        assert.ok(nothingUnder(view), 'nothing under the answer');
        assert.deepEqual(notices(view), []);
        const none = String(r.renderHalf(network, clear.kind, r.halfWays(clear, at(12).seconds), fix, { ...at(12), now: at(12).seconds, noTrains: true }));
        check(none);
        assert.deepEqual(notices(none), [{ tone: 'danger', icon: 'error', text: s['trip.no-trains-today'] }]);
        assert.ok(none.indexOf('notice-danger') < none.indexOf('trip-card'), 'above the answer');
    });
}

test('times follow the clock: the way for the next departure tried, up to a minute late, or the first after it that has one', async () => {
    const r = await browserModule('tools/trip/client/render.js');
    const start = at(12).seconds;
    assert.equal(r.halfWays(clear, start + 50)[0].o, clear.rows[0].options[0], 'a departure a minute ago still counts');
    assert.equal(r.halfWays(clear, start + 300)[0].o, clear.rows[0].options[2]);
    // A way not found for that departure: its next one
    const gaps = { ...clear, rows: [{ ...clear.rows[0], options: [clear.rows[0].options[0], null, null, clear.rows[0].options[3]] }] };
    assert.equal(r.halfWays(gaps, start + 120)[0].o, clear.rows[0].options[3]);
    assert.deepEqual(r.halfWays(clear, start + 3600), [], 'past the half hour: nothing');
});

test('a range of one minute is said as that minute, about', async () => {
    const r = await browserModule('tools/trip/client/render.js');
    assert.equal(r.rangeText({ range: [12, 12] }), 'about 12 minutes');
    assert.equal(r.rangeText({ range: [11, 15] }), '11 to 15 minutes');
    const el = await browserModule('tools/trip/client/render.js', 'el');
    assert.equal(el.rangeText({ range: [11, 15] }), '11 έως 15 λεπτά');
});
