import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, nothingUnder, notices } from './support/markup.js';
import { buildTrains } from '../server/data/build-suburban.js';
import { suburbanCurated, train } from './fixtures/railway.js';
import { aboutTime, minutesBadge, minutesMark } from '../public/js/core/times.js';
import { exitSign } from '../public/js/core/lines.js';

// The next half hour's answer as the trip page shows it (decision 33): what
// the worker picks from answer.js (halfView in tools/trip/client/buses.js),
// which departure the page shows as the clock goes on, and the answer drawn
// in both languages (render.js), its other ways timed with OASA's live
// times (decision 62). Over the test data's metro, tram and the
// buses between Kallithea and Syntagma, on a Wednesday.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { cityPlanner, halfHour, halfView, liveWay, otherWay, PAST_STOPS, routeCodes, shownRows } = await browserModule('tools/trip/client/buses.js');
const { planTrip, withTram } = await browserModule('tools/subway/client/network.js');
const { halfWays } = await browserModule('tools/trip/client/half.js');
const { walkingUrl } = await browserModule('public/js/core/html.js');
const { latinName } = await browserModule('public/js/core/text.js');
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
// From near Korydallos: the M3 to Syntagma, then any of the buses from the
// stops around it (Road · 17)
const korydallos = { lat: 37.9775, lng: 23.6522, title: 'Οδός 1', exact: null };
const afterMetro = viewOf(korydallos, menelaou, at(12));

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

test('from the tram to the M3: off at Neos Kosmos for two stops of M2 is one of the ways, by the 2′ walk measured there (Road · 12)', () => {
    // At the first guess's 4′ the tram to Syntagma was the one clear way, and Neos Kosmos never shown
    const tram = id => ({ lat: network.stations[id].coords[0], lng: network.stations[id].coords[1], station: id, title: id, exact: null });
    const view = viewOf(tram('agia-paraskevi-tram'), station('korydallos', 'Κορυδαλλός'), at(8.5));
    assert.equal(view.kind, 'depends');
    const ways = view.rows.map(row => row.options.find(Boolean).rides.map(ride => `${ride.line} ${ride.alight.station}`).join());
    assert.ok(ways.includes('T6 neos-kosmos-tram,M2 syntagma,M3 korydallos'), ways.join(' | '));
    assert.ok(ways.includes('T6 syntagma-tram,M3 korydallos'), ways.join(' | '));
});

test('each way has its key, as answer.js tells the kinds of way apart, so a way picked is found again in the next half hour (decision 64)', () => {
    const answer = answered(menelaou, syntagma, at(10));
    assert.deepEqual(depends.rows.map(row => row.key), shownRows(answer).map(row => row.key));
    assert.ok(depends.rows.every(row => typeof row.key === 'string' && row.key));
    assert.equal(new Set(depends.rows.map(row => row.key)).size, depends.rows.length, 'one way of each kind');
    // Ten minutes on, the same kinds of way have the same keys
    const later = viewOf(menelaou, syntagma, at(10 + 1 / 6));
    const same = later.rows.filter(row => depends.rows.some(each => each.key === row.key));
    assert.ok(same.length >= 2, later.rows.map(row => row.key).join(' | '));
});

test('nothing found in the half hour: nothing to show', () => {
    assert.deepEqual(halfView(city, menelaou, fix, { kind: 'none', rows: [], departures: [] }).rows, []);
});

// Road · 17: after a metro ride, each stop a last bus can be caught at is
// walked to out of the station's exit nearest it, its own, as the planner
// timed the walk (decision 51); from the door, no exit
test('the stops a last bus can be caught at after a metro ride: each walked to by the exit nearest it', () => {
    const row = afterMetro.rows.find(({ key }) => key === 'M3 at Σύνταγμα, a bus');
    assert.ok(row?.bundle);
    const outs = row.stops.map(({ walk }) => walk?.out);
    assert.deepEqual(outs, [1, 0, 1], 'Amalias for two of them, Syntagma Square for the other');
    const { exits } = rail.stations.syntagma;
    for (const { stop, walk } of row.stops) {
        const nearest = exits.map((exit, i) => ({ i, away: (exit.at[0] - stop.lat) ** 2 + ((exit.at[1] - stop.lng) * Math.cos(stop.lat * Math.PI / 180)) ** 2 })).sort((a, b) => a.away - b.away)[0].i;
        assert.equal(walk.out, nearest, stop.id);
    }
    assert.ok(clear.rows[0].stops.every(({ walk }) => walk === null || !('out' in walk)), 'from the door, none');
    // The way shown, timed with OASA's live times (liveWay): stop by stop the same
    const answerRow = shownRows(answered(korydallos, menelaou, at(12))).find(({ key }) => key === row.key);
    const timed = liveWay(city, korydallos, menelaou, answerRow, 0, at(12), {});
    assert.deepEqual(Object.fromEntries(timed.stops.map(({ stop, walk }) => [stop.id, walk?.out])), Object.fromEntries(row.stops.map(({ stop, walk }) => [stop.id, walk?.out])));
});

// Road · 15: a last bus that can be any of several carries every ride it
// can be, each line from each of its stops to the stop nearest the door, so
// the page follows the rider onto whichever they board
test('a last bus that can be any of several carries every ride it can be: each line from each of its stops, to its stop nearest the door', () => {
    const row = afterMetro.rows.find(({ key }) => key === 'M3 at Σύνταγμα, a bus');
    const options = row.options.filter(Boolean);
    assert.ok(options.length > 0);
    const position = stop => [Math.round(stop.lat * 1e5) / 1e5, Math.round(stop.lng * 1e5) / 1e5];
    for (const option of options) {
        const last = option.rides.at(-1);
        assert.ok(last.any?.length, 'on the last bus');
        assert.ok(option.rides.slice(0, -1).every(ride => !ride.any), 'only there');
        // The way's own ride is one of them
        assert.ok(last.any.some(r => r.board === last.board.id && r.line === last.line && JSON.stringify(r.along) === JSON.stringify(last.along)), `${last.line} from ${last.board.id}`);
    }
    const { any } = options[0].rides.at(-1);
    // Every line at every stop of the step, from that stop
    for (const { stop, lines } of row.stops) {
        for (const line of lines) assert.ok(any.some(r => r.board === stop.id && r.line === line && JSON.stringify(r.along[0]) === JSON.stringify(position(stop))), `${line} from ${stop.id}`);
    }
    assert.ok(any.every(r => r.along.length >= 2 && r.past.length <= PAST_STOPS));
    // Once each
    assert.equal(new Set(any.map(r => `${r.line} ${JSON.stringify(r.along)}`)).size, any.length);
    // From the door, the same; a way with no bundle, none
    assert.ok(clear.rows[0].options.filter(Boolean).every(o => o.rides.at(-1).any?.length));
    const single = [...byRail.rows, ...depends.rows, ...afterMetro.rows].filter(row => !row.bundle);
    assert.ok(single.length > 0 && single.every(row => row.options.every(o => !o || o.rides.every(ride => !ride.any))));
    // Timed with OASA's live times (liveWay) too
    const answerRow = shownRows(answered(korydallos, menelaou, at(12))).find(({ key }) => key === row.key);
    assert.deepEqual(JSON.parse(JSON.stringify(liveWay(city, korydallos, menelaou, answerRow, 0, at(12), {}).option.rides.at(-1).any)), any);
});

// Road · 15 part 2 (decision 67): on one of a last bus's several, from
// another of its stops than the way's own, the way is that bus
const anyRow = shownRows(answered(korydallos, menelaou, at(12))).find(({ key }) => key === 'M3 at Σύνταγμα, a bus');
const anyWay = liveWay(city, korydallos, menelaou, anyRow, 0, at(12), {});
const ownRide = anyWay.option.rides.at(-1);
const otherRide = ownRide.any.find(r => r.board !== ownRide.board.id);
const onOther = { leg: 1, kind: 'ride', stop: 1, at: 12 * 3600 + 25 * 60, walk: 0, any: { route: otherRide.route, from: otherRide.from, to: otherRide.to } };
const boardedWay = liveWay(city, korydallos, menelaou, anyRow, 0, at(12), {}, { step: onOther });

test('on one of a last bus\'s several, from another of its stops: the way is that bus, from that stop to where it gets off, its own bus asked there (decision 67)', () => {
    assert.ok(otherRide, 'a ride from another stop than the way\'s own');
    const last = boardedWay.option.rides.at(-1);
    assert.equal(last.boarded, true);
    assert.deepEqual([last.line, last.board.id, last.lines], [otherRide.line, otherRide.board, [otherRide.line]]);
    assert.deepEqual(last.along, otherRide.along, 'its stops as followed');
    assert.equal(last.stops, otherRide.to - otherRide.from);
    assert.deepEqual(boardedWay.stops, [], 'no stops to catch it at any more');
    assert.ok(last.arrives > onOther.at, 'gets off after now');
    assert.deepEqual(boardedWay.option.rides.slice(0, -1).map(ride => ride.line), anyWay.option.rides.slice(0, -1).map(ride => ride.line), 'the rides before it as they were');
    assert.equal(last.any.length, ownRide.any.length, 'still every ride it can be, for following');
    // The rider's own bus, by its vehicle code, asked where this bus gets off
    const asked = liveWay(city, korydallos, menelaou, anyRow, 0, at(12), {}, { step: onOther, own: { leg: 1, vehicle: 'V1' } }).asks;
    assert.ok(asked.some(a => a.stop === last.alight.id.slice('bus:'.length) && a.ride), JSON.stringify(asked));
    // Not boarded: the way's own, as before
    assert.ok(!ownRide.boarded && anyWay.stops.length > 0);
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

    test(`${lang}: a timetable that has ended: one closed line above the ways, open once opened`, () => {
        const ways = halfWays(clear, at(12).seconds);
        const drawn = shown => String(r.renderHalf(network, clear.kind, ways, fix, { ...at(12), now: at(12).seconds, expired: true, ...shown }));
        assert.match(drawn({}), /<details class="notice notice-warn closable-notice timetable-notice mb-3">/);
        assert.ok(drawn({}).includes(`<span class="closable-summary">${s['trip.timetable-ended']}</span>`));
        assert.match(drawn({ timetableOpen: true }), /<details class="notice notice-warn closable-notice timetable-notice mb-3" open>/);
        assert.ok(drawn({}).indexOf('timetable-notice') < drawn({}).indexOf('trip-total'), 'above the answer');
    });

    test(`${lang}: the clear way, its range, "best on most departures", and the nearest 3 stops with their buses`, () => {
        const ways = halfWays(clear, at(12).seconds);
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

    test(`${lang}: after a metro ride, each stop of "Then any of these buses" says its own way out, above its row (Road · 17)`, () => {
        const ways = halfWays(afterMetro, at(12).seconds);
        const index = afterMetro.rows.findIndex(({ key }) => key === 'M3 at Σύνταγμα, a bus');
        const view = String(r.renderHalf(network, afterMetro.kind, [ways[index]], menelaou, { ...at(12), now: at(12).seconds }));
        check(view);
        assert.ok(view.includes(s['trip.any-bus-then']));
        const { exits } = rail.stations.syntagma;
        const outs = [...view.matchAll(/<div class="trip-stop-exit">([^<]*<span class="station-sign exit-sign sign-m">[^<]*<\/span>)<\/div>\s*<div class="accordion-item stop-item" data-stop="(\d+)"/g)].map(([, said, code]) => [code, said]);
        assert.deepEqual(outs, afterMetro.rows[index].stops.map(({ stop, walk }) => [stop.id.slice('bus:'.length), s['trip.way-out'].replace('{exit}', String(exitSign(exits[walk.out].name[lang])))]));
        // From the door, none
        const fromDoor = String(r.renderHalf(network, clear.kind, halfWays(clear, at(12).seconds), fix, { ...at(12), now: at(12).seconds }));
        assert.ok(!fromDoor.includes('trip-stop-exit'));
    });

    test(`${lang}: on one of "Then any of these buses", that bus's ride card: Exit at where it gets off, its stops, no list of stops (decision 67)`, () => {
        const ways = halfWays(afterMetro, at(12).seconds);
        const index = afterMetro.rows.findIndex(({ key }) => key === 'M3 at Σύνταγμα, a bus');
        const drawn = way => String(r.renderHalf(network, afterMetro.kind, [ways[index]], menelaou, { ...at(12), now: onOther.at, live: { way: JSON.parse(JSON.stringify(way)) }, following: { kind: 'ride', ride: 1 } }));
        const view = drawn(boardedWay);
        check(view);
        const last = boardedWay.option.rides.at(-1);
        const name = lang === 'el' ? last.alight.names.el : last.alight.names.en || latinName(last.alight.names.el);
        assert.ok(!view.includes(s['trip.any-bus-then']) && !view.includes('trip-stop'), 'no stops to catch it at');
        assert.ok(view.includes(`${s['subway.exit-at']} <strong>${name}</strong>`), `Exit at ${name}`);
        assert.ok(view.includes(`data-leg="bus/${last.line}/${last.board.id}/${last.alight.id}"`), 'its stops');
        // Not boarded yet: the list, as before
        assert.ok(drawn(anyWay).includes(s['trip.any-bus-then']));
    });

    test(`${lang}: it depends, said above the way first by the weights; the others on a line each, with their range`, () => {
        const ways = halfWays(depends, at(10).seconds);
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

    test(`${lang}: another way OASA times says its minutes and when it gets there, and its bus's badge; the soonest there first; none OASA has, said so`, () => {
        const ways = halfWays(depends, at(10).seconds);
        // The 040 then the M2, timed with OASA's 040 well after the timetable's
        const row = shownRows(answered(menelaou, syntagma, at(10)))[1];
        const [bus] = row.best[0].legs;
        const code = city.stops[bus.board].id.replace('bus:', '');
        const [route] = routeCodes(city, ['040'], bus.board, new Set([bus.alight])).keys();
        const late = at(10).seconds + 25 * 60;
        const timedWay = JSON.parse(JSON.stringify(otherWay(city, menelaou, syntagma, row, 0, at(10), { [code]: { buses: [{ route, line: '040', at: late }] } })));
        const othersTimed = new Map([[depends.rows[1], timedWay]]);
        const view = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds, othersTimed }));
        check(view);
        const { option } = timedWay;
        assert.ok(view.includes(`<h3 class="trip-total trip-total-small">${mark(option.minutes, { about: true })}</h3>`), 'its minutes, from now');
        assert.ok(view.includes(s['trip.arrive'].replace('{time}', clock(option.arrives))));
        assert.ok(view.includes(`<span class="trip-live">${String(minutesBadge(25, key => s[key], { at: null, exact: false }))}</span>`), 'the 040\'s badge, as OASA has it');
        // Later now than the Β2 way, by the half hour's: after it
        const others = view.slice(view.indexOf(s['trip.other-ways']));
        assert.ok(option.arrives > ways[2].o.arrives);
        assert.ok(others.indexOf('Β2') < others.indexOf('040'), 'the soonest there first');

        const gone = JSON.parse(JSON.stringify(otherWay(city, menelaou, syntagma, row, 0, at(10), { [code]: { buses: [{ route, line: '040', at: at(10).seconds + 60 }] } })));
        const none = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds, othersTimed: new Map([[depends.rows[1], gone]]) }));
        check(none);
        assert.ok(none.includes(` · ${s['trip.live-none']}</p>`));
        // Untimed, in the half hour's order, with their ranges
        const untimed = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds }));
        const after = untimed.slice(untimed.indexOf(s['trip.other-ways']));
        assert.ok(after.indexOf('040') < after.indexOf('Β2'));
        assert.ok(!untimed.includes('trip-live'));
    });

    // The ways a view's buttons take, by their keys, as the page reads them back
    const takes = view => [...String(view).matchAll(/<button type="button" class="trip-card trip-take" data-way="([^"]*)" aria-disabled="(?:true|false)">/g)]
        .map(([, key]) => key.replace(/&#x3D;/g, '=').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

    test(`${lang}: to be taken, each other way is one button, its key, "Take this way:" for a screen reader and a chevron; nothing in it but words (T18, decision 64)`, () => {
        const ways = halfWays(depends, at(10).seconds);
        const view = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds, take: true }));
        check(view);
        assert.deepEqual(takes(view), depends.rows.slice(1).map(row => row.key), 'each other way, by its key; never the way shown');
        const buttons = view.match(/<button type="button" class="trip-card trip-take"[\s\S]*?<\/button>/g);
        for (const button of buttons) {
            assert.ok(button.includes(`<span class="sr-only">${s['trip.take-way']} </span>`), 'said as taking it');
            assert.ok(button.includes('trip-take-chevron'), 'the chevron at its right');
            assert.ok(!/<(h\d|p|div|ul|li|a|button)[\s>]/.test(button.slice(1)), 'only words in a button');
            assert.ok(button.includes('<span class="way-strip way-strip-small" aria-hidden="true">'), 'its small strip, hidden from screen readers (decision 77)');
        }
        assert.ok(view.slice(0, view.indexOf('trip-take')).includes('<span class="way-strip" aria-hidden="true">'), 'the way shown has the big one');
        for (const row of depends.rows.slice(1)) assert.ok(view.includes(`<span class="trip-total trip-total-small">${range(row.range)}</span>`), row.range.join());
        // Its bus being checked as it's taken: said in the chevron's place, the button doing nothing meanwhile
        const checking = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds, take: true, checking: depends.rows[1].key }));
        check(checking);
        assert.deepEqual(takes(checking), takes(view));
        assert.equal(checking.split('aria-disabled="true"').length - 1, 1, 'that one only');
        assert.equal(checking.split('trip-take-chevron').length - 1, depends.rows.length - 2, 'the others as they were');
        assert.ok(checking.includes(`<span class="trip-take-checking">${s['trip.take-checking']}</span>`));
        // Not to be taken (a rider followed with no other ways from where they are yet): as before
        const plain = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds }));
        assert.deepEqual(takes(plain), []);
        assert.ok(!plain.includes('trip-take'));
        assert.equal(plain.split('<span class="way-strip way-strip-small"').length - 1, depends.rows.length - 1, 'each other way its small strip');
    });

    test(`${lang}: a way taken is the way shown in full, "The way you picked", and the one it replaced is among the other ways to take back`, () => {
        const ways = halfWays(depends, at(10).seconds);
        const picked = [ways[1], ways[0], ...ways.slice(2)];
        const view = String(r.renderHalf(network, depends.kind, picked, syntagma, { ...at(10), now: at(10).seconds, take: true, picked: true }));
        check(view);
        const head = view.slice(0, view.indexOf(s['trip.other-ways']));
        assert.ok(head.includes(`<h2 class="trip-total" tabindex="-1">${range(depends.rows[1].range)}</h2>`));
        assert.ok(head.includes(`<span class="trip-arrives">${s['trip.picked']}</span>`));
        assert.ok(head.includes('040'), 'its rides in full');
        assert.deepEqual(takes(view), [depends.rows[0].key, ...depends.rows.slice(2).map(row => row.key)]);
        // Not picked: no such words
        assert.ok(!String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds, take: true })).includes(s['trip.picked']));
        // On a clear answer, a way picked over the clear one isn't "best on most departures"
        const clearWays = [halfWays(depends, at(10).seconds)[1], ...halfWays(clear, at(12).seconds)];
        const overClear = String(r.renderHalf(network, 'clear', clearWays, fix, { ...at(12), now: at(12).seconds, take: true, picked: true }));
        assert.ok(!overClear.includes(s['trip.half-best']));
        assert.ok(overClear.includes(s['trip.picked']));
    });

    test(`${lang}: a way that leads by OASA's live times is the way shown in full, said above it in place of "it depends", its heading its minutes and when it gets there by them (decision 72)`, () => {
        const ways = halfWays(depends, at(10).seconds);
        const leading = [ways[1], ways[0], ...ways.slice(2)];
        const arrives = 10 * 3600 + 33 * 60;
        const live = { way: { option: ways[1].o, stops: [], asks: [], offer: null, switchTo: null, train: null, rank: { arrives, cost: arrives } } };
        const view = String(r.renderHalf(network, depends.kind, leading, syntagma, { ...at(10), now: at(10).seconds, live, lead: true }));
        check(view);
        assert.ok(view.includes(`<p class="trip-intro">${s['trip.lead'].replace(/'/g, '&#39;')}</p>`));
        assert.ok(!view.includes(s['trip.half-depends-intro']));
        const head = view.slice(0, view.indexOf(s['trip.other-ways']));
        assert.ok(head.includes(`<h2 class="trip-total" tabindex="-1">${mark(33, { about: true })}</h2>`), head.slice(0, 600));
        assert.ok(head.includes(`<span class="trip-arrives">${s['trip.arrive'].replace('{time}', clock(arrives))}</span>`));
        assert.ok(head.includes('040'), 'its rides in full');
        // Not timed yet: its range; on a clear answer, not "best on most departures"
        const untimed = String(r.renderHalf(network, depends.kind, leading, syntagma, { ...at(10), now: at(10).seconds, lead: true }));
        assert.ok(untimed.includes(`<h2 class="trip-total" tabindex="-1">${range(depends.rows[1].range)}</h2>`));
        const clearWays = [halfWays(depends, at(10).seconds)[1], ...halfWays(clear, at(12).seconds)];
        const overClear = String(r.renderHalf(network, 'clear', clearWays, fix, { ...at(12), now: at(12).seconds, lead: true }));
        assert.ok(!overClear.includes(s['trip.half-best']));
        assert.ok(overClear.includes(s['trip.lead'].replace(/'/g, '&#39;')));
    });

    test(`${lang}: a way picked that can't be caught any more is said above the answer`, () => {
        const ways = halfWays(depends, at(10).seconds);
        const view = String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds, take: true, lost: true }));
        check(view);
        assert.ok(notices(view).some(({ tone, text }) => tone === 'warn' && text.includes(s['trip.picked-lost'])), JSON.stringify(notices(view)));
        assert.ok(view.indexOf(s['trip.picked-lost']) < view.indexOf('trip-card'));
        assert.ok(!String(r.renderHalf(network, depends.kind, ways, syntagma, { ...at(10), now: at(10).seconds, take: true })).includes(s['trip.picked-lost']));
    });

    test(`${lang}: a bus that's one line has its time by the clock, as an estimate; the train after it is a card, its first badge the train the way is timed on`, () => {
        // The 040 then the M2 first
        const view = { ...depends, rows: depends.rows.slice(1) };
        const ways = halfWays(view, at(10).seconds);
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
        const ways = halfWays(view, at(10).seconds);
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
        const ways = halfWays(byRail, at(12).seconds);
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
        const ways = halfWays(byRail, at(12).seconds);
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
        const taken = String(r.renderHalf(network, two.kind, halfWays(two, at(10).seconds), syntagma, { ...at(10), now: at(10).seconds, taken: two.rows[1], lifts: { stations: { 'syggrou-fix': { status: 'partial', out: [] } }, unavailable: true } }));
        assert.deepEqual(notices(taken), [{ tone: 'danger', icon: 'error', text: s['lifts.unavailable'] }]);
        assert.match(taken, /lift-notice/);
        // Any of the buses: no station, nothing to say
        assert.doesNotMatch(String(r.renderHalf(network, clear.kind, halfWays(clear, at(12).seconds), fix, { ...at(12), now: at(12).seconds, lifts: { stations: {}, unavailable: true } })), /lift-/);
    });

    test(`${lang}: the answer for leaving now says the half hour is being checked, while it is`, async () => {
        const { doorToDoor } = await browserModule('tools/trip/client/plan.js', lang);
        const trip = doorToDoor(network, menelaou, syntagma, { ...at(10), date: '2026-10-21' });
        assert.ok(String(r.renderTrip(network, trip, syntagma, { ...at(10), now: at(10).seconds, checking: true })).includes(s['trip.half-checking']));
        assert.ok(!String(r.renderTrip(network, trip, syntagma, { ...at(10), now: at(10).seconds })).includes(s['trip.half-checking']));
    });

    test(`${lang}: a way by suburban railway in the half hour's answer has its pill, nothing under it of where its times are from; with no trains today, an error above says they're left out`, () => {
        const ways = halfWays(byTrain, at(10).seconds);
        assert.ok(ways.some(({ o }) => o.rides.some(ride => ride.mode === 'suburban')), 'a way by train is shown');
        const view = String(r.renderHalf(network, byTrain.kind, ways, airportStation, { ...at(10), now: at(10).seconds }));
        check(view);
        assert.ok(view.includes('line-a1">A1<'));
        assert.equal(view.includes('railway.gov.gr'), false, 'credited on the About page, not under the answer');
        assert.ok(nothingUnder(view), 'nothing under the answer');
        assert.deepEqual(notices(view), []);
        const none = String(r.renderHalf(network, clear.kind, halfWays(clear, at(12).seconds), fix, { ...at(12), now: at(12).seconds, noTrains: true }));
        check(none);
        assert.deepEqual(notices(none), [{ tone: 'danger', icon: 'error', text: s['trip.no-trains-today'] }]);
        assert.ok(none.indexOf('notice-danger') < none.indexOf('trip-card'), 'above the answer');
    });
}

test('times follow the clock: the way for the next departure tried, up to a minute late, or the first after it that has one', () => {
    const start = at(12).seconds;
    assert.equal(halfWays(clear, start + 50)[0].o, clear.rows[0].options[0], 'a departure a minute ago still counts');
    assert.equal(halfWays(clear, start + 300)[0].o, clear.rows[0].options[2]);
    // A way not found for that departure: its next one
    const gaps = { ...clear, rows: [{ ...clear.rows[0], options: [clear.rows[0].options[0], null, null, clear.rows[0].options[3]] }] };
    assert.equal(halfWays(gaps, start + 120)[0].o, clear.rows[0].options[3]);
    assert.deepEqual(halfWays(clear, start + 3600), [], 'past the half hour: nothing');
});

test('each ride carries where its stops are, boarding to getting off, and the two after, for following the rider along it (Plan 7)', () => {
    const rides = clear.rows.flatMap(row => row.options.filter(Boolean).flatMap(o => o.rides));
    assert.ok(rides.length > 0);
    for (const ride of rides) {
        assert.equal(ride.along.length, ride.stops + 1, `${ride.line}: one position per stop ridden, and where it boards`);
        assert.deepEqual(ride.along[0], [ride.board.lat, ride.board.lng].map(n => Math.round(n * 1e5) / 1e5));
        assert.deepEqual(ride.along.at(-1), [ride.alight.lat, ride.alight.lng].map(n => Math.round(n * 1e5) / 1e5));
        assert.ok(ride.past.length <= PAST_STOPS);
        for (const [lat, lng] of [...ride.along, ...ride.past]) assert.ok(lat > 37 && lat < 39 && lng > 23 && lng < 25, 'in Attica');
    }
    assert.ok(rides.some(ride => ride.past.length === PAST_STOPS), 'a ride that gets off before the line ends has the stops after');
});

test('a range of one minute is said as that minute, about', async () => {
    const r = await browserModule('tools/trip/client/render.js');
    assert.equal(r.rangeText({ range: [12, 12] }), 'about 12 minutes');
    assert.equal(r.rangeText({ range: [11, 15] }), '11 to 15 minutes');
    const el = await browserModule('tools/trip/client/render.js', 'el');
    assert.equal(el.rangeText({ range: [11, 15] }), '11 έως 15 λεπτά');
});
