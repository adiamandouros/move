import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, nothingUnder, notices, spoken } from './support/markup.js';
import { buildTrains } from '../server/data/build-suburban.js';
import { suburbanCurated, train } from './fixtures/railway.js';
import { aboutTime, minutesBadge, minutesMark } from '../public/js/core/times.js';

// What the trip page draws (tools/trip/client/render.js), in both languages:
// how exact an address is, the trip, and the hard cases. Each is checked for
// accessibility, and for strings shown as their keys.

const rail = JSON.parse(readFileSync(new URL('browser/data/rail.json', import.meta.url), 'utf8'));
const NOW = { weekday: 3, seconds: 10 * 3600, date: '2026-10-21' };
const menelaou = { lat: 37.95463, lng: 23.71049, title: 'Μενελάου 25', exact: 'About here' };
const syntagma = { lat: rail.stations.syntagma.coords[0], lng: rail.stations.syntagma.coords[1], station: 'syntagma', title: 'Σύνταγμα', exact: null };
const street = (kind, more = {}) => ({ type: 'street', name: 'Μενελάου', n: 25, town: 'Καλλιθέας', kind, numbers: 4, ...more });

const { withTram } = await browserModule('tools/subway/client/network.js');
const network = withTram(rail);
const buses = JSON.parse(readFileSync(new URL('browser/data/buses.json', import.meta.url), 'utf8'));
const { busOptions, cityPlanner } = await browserModule('tools/trip/client/buses.js');
const city = cityPlanner(rail, buses, 3);
// The suburban railway that Wednesday (decision 41): from Athens station to the airport every 15 minutes
const { createPlanner, trainDay } = await browserModule('tools/subway/client/city.js');
const trains = buildTrains({ [NOW.date]: { schedules: ['10:05', '10:20', '10:35'].map((at, i) => train(NOW.date, `12${i}`, [['o2', at], ['o3', `${10 + (i ? 1 : 0)}:${['45', '00', '15'][i]}`]])) } }, suburbanCurated()).data;
const withTrains = cityPlanner(rail, buses, 3, trainDay(trains, NOW.date));
const athensStation = { lat: 37.99284, lng: 23.72015, title: 'Αθήνα', exact: null };
const airportStation = { lat: 37.93698, lng: 23.94481, title: 'Αεροδρόμιο', exact: null };
// A bus, then the known walk to a station, with its note, then an A1 train
// to a station outside OASA's ticket: a network of its own, so it's the way
const changing = createPlanner({
    stops: [
        { id: 'bus:1', lat: 37.97, lng: 23.70, name: 'Στάση 1', names: { el: 'Στάση 1', en: '' } },
        { id: 'bus:2', lat: 37.98, lng: 23.70, name: 'Στάση 2', names: { el: 'Στάση 2', en: '' } },
        { id: 'train:athens', lat: 38.00, lng: 23.70, name: 'Αθήνα', names: { el: 'Αθήνα', en: 'Athens' } },
        { id: 'train:airport', lat: 38.05, lng: 23.70, name: 'Αεροδρόμιο', names: { el: 'Αεροδρόμιο', en: 'Airport' }, oasaTicket: false },
    ],
    routes: [
        { line: '040', mode: 'bus', stops: [0, 1], trips: [[36_000, 36_300]], toward: { el: 'Στάση 2', en: '' } },
        { line: 'A1', mode: 'suburban', stops: [2, 3], trips: [[36_900, 38_700]], toward: { el: 'Αεροδρόμιο', en: 'Airport' } },
    ],
    knownWalks: [[1, 2, 240, { el: 'Απέναντι, χωρίς σήμανση', en: 'Across the road, with no signs' }]],
});
const { latinName: latin } = await browserModule('public/js/core/text.js');
const { format, localName } = await browserModule('public/js/core/html.js');

for (const lang of ['en', 'el']) {
    const r = await browserModule('tools/trip/client/render.js', lang);
    const subway = await browserModule('tools/subway/client/render.js', lang);
    const { doorToDoor } = await browserModule('tools/trip/client/plan.js', lang);
    const { listNote } = await browserModule('tools/trip/client/picker.js', lang);
    const keys = Object.keys(strings(lang));
    const check = view => assert.deepEqual(markupProblems(String(view), { keys }), []);
    const s = strings(lang);
    // The answer as the page draws it at NOW, the buses' minutes counted from then
    const drawTrip = (planned, trip, to, shown = {}) => r.renderTrip(planned, trip, to, { now: NOW.seconds, weekday: NOW.weekday, ...shown });
    // A time that's a guess (/js/core/times.js): "~12:06", "about 12:06" for screen readers
    const about = time => String(aboutTime(time, key => s[key]));
    // When a ride leaves, on the left of its step, strong
    const leaves = time => `<span class="trip-step-when trip-step-leaves">${time}</span>`;
    const clock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
    // A metro or tram ride as the Trip page draws it (decision 46): the
    // Subway page's own card, with its ride's minutes, its badges counted
    // from `now`, its stations closed unless `open`
    const legKey = leg => `${leg.line}/${leg.dir}/${leg.from}/${leg.to}`;
    const subwayCard = (planned, leg, next, now, { morning = false, open = false } = {}) =>
        String(subway.legCard(planned, leg, next, { seconds: now }, 3, morning, true, legKey(leg), open));

    test(`${lang}: an exact number needs no words, the rest say how far to trust them`, () => {
        assert.equal(r.howExact(street('exact')), null);
        assert.equal(r.howExact(street('range')), null);
        assert.equal(r.howExact(street('between', { lo: 23, hi: 27 })).words, s['trip.exact-between'].replace('{lo}', 23).replace('{hi}', 27));
        assert.equal(r.howExact(street('beyond', { near: 45 })).words, s['trip.exact-beyond'].replace('{near}', 45));
        assert.equal(r.howExact(street('nearest', { near: 31 })).words, s['trip.exact-nearest'].replace('{near}', 31));
        assert.deepEqual(r.howExact(street('street')), { words: s['trip.exact-street'], warn: true });
    });

    test(`${lang}: a street without a number is simply that street`, () => {
        assert.equal(r.howExact(street('street', { n: null })), null);
        assert.equal(r.placeTitle(street('street', { n: null })), 'Μενελάου');
        assert.equal(r.placeTitle(street('exact')), 'Μενελάου 25');
    });

    test(`${lang}: places say what they are, when it matters`, () => {
        assert.equal(r.howExact({ type: 'place', placeKind: 'metro' }).words, s['trip.kind-metro']);
        assert.equal(r.howExact({ type: 'place', placeKind: 'tram' }).words, s['trip.kind-tram']);
        assert.equal(r.howExact({ type: 'place', placeKind: 'airport' }).words, s['trip.kind-airport']);
        assert.equal(r.howExact({ type: 'place', placeKind: 'park' }), null);
    });

    test(`${lang}: a row of the list: name, town, how exact, and a station's lines`, () => {
        const row = String(r.placeOption(street('street'), 0, rail, 'list'));
        for (const text of ['Μενελάου 25', 'Καλλιθέας', s['trip.exact-street'].replace(/'/g, '&#39;'), 'trip-exact-warn']) assert.ok(row.includes(text), text);
        const station = { type: 'place', placeKind: 'metro', name: 'Σύνταγμα', town: 'Αθηναίων', n: null, lineNames: ['M2', 'M3'] };
        assert.match(String(r.placeOption(station, 1, rail, 'list')), /line-m2[\s\S]*line-m3/);
        assert.deepEqual(markupProblems(`<ul role="listbox" aria-label="x">${r.placeOption(street('street'), 0, rail, 'list')}</ul>`, { keys }), []);
    });

    test(`${lang}: the note over the list`, () => {
        const one = [{}];
        assert.equal(listNote({ results: [] }), s['trip.nothing-found']);
        assert.equal(listNote({ results: one, noSuchTown: true, notInTown: 'x' }), s['trip.no-such-town']);
        assert.equal(listNote({ results: one, notInTown: 'x' }), s['trip.not-in-town']);
        assert.equal(listNote({ results: one, corrected: true }), s['trip.mended']);
        assert.equal(listNote({ results: one }), '');
    });

    test(`${lang}: the trip: the walk, then each train as the Subway page's own card, where to stand on it included`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        const view = String(drawTrip(rail, trip, syntagma));
        check(view);
        assert.match(view, /trip-total/);
        assert.match(view, /google\.com\/maps\/dir/, 'the walk has walking directions');
        // In the trip's card, each in its ride's place, with nothing on the left:
        // the train the way is timed on first, its ride's minutes said
        const { plan } = trip.options[0];
        const way = view.slice(0, view.indexOf(s['trip.other-ways']));
        plan.legs.forEach((leg, i) => assert.ok(way.includes(`<li class="trip-leg">${subwayCard(rail, leg, plan.legs[i + 1] ?? null, NOW.seconds)}</li>`), leg.line));
        assert.ok(!way.includes('trip-step-leaves'), 'no time on the left of a train');
        assert.ok(way.includes('class="train-diagram'), 'where to stand on the train');
        assert.ok(!view.includes('/subway?from='), 'no "Where to stand" button: the card shows it');
        // The other ways' lines medium, as in a sentence
        const others = view.slice(view.indexOf(s['trip.other-ways']));
        assert.ok(others.includes('pill-m') && !others.includes('pill-s') && !others.includes('pill-l'));
        assert.ok(nothingUnder(view), 'nothing under the answer');
    });

    test(`${lang}: a train's badges count from now; the morning's first trains by the clock`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        const [leg] = trip.options[0].plan.legs;
        const later = NOW.seconds + 60;
        const view = String(drawTrip(rail, trip, syntagma, { now: later }));
        assert.ok(view.includes(subwayCard(rail, leg, trip.options[0].plan.legs[1] ?? null, later)), 'a minute on, a minute less');
        // After the last train, the first ones of the morning
        const night = { weekday: 3, seconds: 2 * 3600, date: NOW.date };
        const morning = doorToDoor(rail, menelaou, syntagma, night);
        const o = morning.options[0];
        assert.ok(o.morning);
        const drawn = String(drawTrip(rail, morning, syntagma, { now: night.seconds }));
        check(drawn);
        assert.ok(drawn.includes(subwayCard(rail, o.plan.legs[0], o.plan.legs[1] ?? null, night.seconds - o.dayStart, { morning: true })));
        assert.ok(drawn.includes(s['subway.schedule-at']), 'at a clock time');
    });

    test(`${lang}: the stations on a train's way stay open as the rider left them, and the legend under the way`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        const { plan } = trip.options[0];
        const [leg] = plan.legs;
        const open = String(drawTrip(rail, trip, syntagma, { stations: { [legKey(leg)]: true } }));
        assert.ok(open.includes(subwayCard(rail, leg, plan.legs[1] ?? null, NOW.seconds, { open: true })));
        assert.match(open, /aria-expanded="true"/);
        // What the trains show, in words, right under the way's card and
        // before the other ways; closed when the rider closed it
        const view = String(drawTrip(rail, trip, syntagma));
        const legend = view.indexOf('<details class="diagram-legend" open>');
        assert.ok(legend > view.indexOf('trip-leg') && legend < view.indexOf(s['trip.other-ways']), 'under the way, before the others');
        assert.ok(String(drawTrip(rail, trip, syntagma, { legend: false })).includes('<details class="diagram-legend">'));
    });

    test(`${lang}: a walk: its minutes on the left, "Walk to …" in plain text with the distance under it, walking directions at the far right`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        const { start } = trip.options[0];
        const view = String(drawTrip(rail, trip, syntagma));
        const step = view.slice(view.indexOf('<li class="trip-step">'), view.indexOf('</li>') + 5);
        const place = localName(rail.stations[start.station].name, lang);
        assert.ok(step.includes(`<span class="trip-step-when">${minutesMark(start.walk.minutes, key => s[key], { about: true })}</span>`), 'its minutes, quiet, an estimate');
        assert.ok(step.includes(`<div>${format(s['trip.walk-to'], { place })}</div>`), 'in plain text, not a link');
        const meters = Math.round(start.walk.meters / 50) * 50;
        const distance = meters < 1000 ? format(s['trip.walk-meters'], { meters }) : format(s['trip.walk-km'], { km: (meters / 1000).toFixed(1) });
        assert.ok(step.includes(`<div class="trip-step-note">${distance}</div>`), 'the distance under it');
        // The last thing in the row, as on a bus stop's: the walking figure, named for a screen reader
        const [link] = step.match(/<a [^>]*class="directions-btn [^]*?<\/a><\/li>$/) ?? [];
        assert.ok(link, step);
        const [lat, lng] = rail.stations[start.station].coords;
        assert.ok(link.startsWith(`<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${lat},${lng}&amp;travelmode=walking"`));
        assert.ok(link.includes('<svg'), 'the walking figure');
        assert.equal(spoken(link), `${format(s['trip.walking-directions-to'], { place })} ${s['shell.new-tab']}`);
    });

    test(`${lang}: by tram: the walk from the metro station to the stop is a step, and the tram's card has no train diagram`, () => {
        // Omirou to Kyprou: two minutes to Neos Kosmos, four more to its tram stop, T6
        const omirou = { lat: 37.958, lng: 23.73, title: 'Ομήρου 10', exact: null };
        const kyprou = { lat: 37.9595, lng: 23.7185, title: 'Κύπρου 1', exact: null };
        const trip = doorToDoor(network, omirou, kyprou, NOW);
        assert.deepEqual(trip.options[0].plan.legs.map(leg => leg.line), ['T6']);
        const view = String(drawTrip(network, trip, kyprou));
        check(view);
        const card = view.slice(view.indexOf('trip-card'), view.indexOf(s['trip.other-ways']));
        const stop = s['trip.walk-to'].replace('{place}', lang === 'el' ? 'Νέος Κόσμος (τραμ)' : 'Neos Kosmos (tram)');
        assert.ok(card.includes(stop), 'the walk to the tram stop');
        assert.ok(card.indexOf(stop) < card.indexOf('line-t6'), 'before the tram');
        assert.ok(card.includes(`<li class="trip-leg">${subwayCard(network, trip.options[0].plan.legs[0], null, NOW.seconds)}</li>`), 'the Subway page\'s card');
        assert.ok(!card.includes('train-diagram'), 'a tram has no front or back');
        assert.ok(!view.includes('diagram-legend'), 'so nothing to explain');
    });

    test(`${lang}: a change on foot and a last walk to a stop are steps, each in its place`, () => {
        const named = id => lang === 'el' ? network.stations[id].name.el : network.stations[id].name.en;
        const walkTo = id => s['trip.walk-to'].replace('{place}', named(id));
        const station = id => ({ lat: network.stations[id].coords[0], lng: network.stations[id].coords[1], station: id, title: named(id), exact: null });
        // M1 to Faliro, on foot to Gipedo Karaiskaki, T7
        const change = String(drawTrip(network, doorToDoor(network, station('kifisia'), station('evangelistria'), NOW), station('evangelistria')));
        check(change);
        assert.ok(change.indexOf('line-m1') < change.indexOf(walkTo('gipedo-karaiskaki')) && change.indexOf(walkTo('gipedo-karaiskaki')) < change.indexOf('line-t7'), 'between the trains');
        // M1 and M2 to Neos Kosmos, then on foot to its tram stop
        const last = String(drawTrip(network, doorToDoor(network, station('kifisia'), station('neos-kosmos-tram'), NOW), station('neos-kosmos-tram')));
        check(last);
        assert.ok(last.indexOf('line-m2') < last.indexOf(walkTo('neos-kosmos-tram')), 'after the last train');
    });

    test(`${lang}: a way by bus: the walk to its stop, its plate, its time with "~" ("about" to a screen reader), where it goes, nothing under it`, () => {
        const trip = doorToDoor(network, menelaou, syntagma, NOW, { buses: busOptions(city, menelaou, syntagma, NOW) });
        const view = String(drawTrip(network, trip, syntagma));
        check(view);
        const card = view.slice(view.indexOf('trip-card'), view.indexOf(s['trip.other-ways']));
        const [ride] = trip.options[0].rides;
        const stop = lang === 'el' ? ride.board.names.el : ride.board.names.en || latin(ride.board.names.el);
        assert.ok(card.includes(s['trip.walk-to'].replace('{place}', stop)), 'the walk to its stop, by name');
        assert.match(card, /<span class="bus-plate pill-m">040<\/span>/);
        assert.ok(card.includes(leaves(about(clock(ride.boards)))), 'its time strong, an estimate, said in words too (decision 11)');
        assert.ok(card.includes(s['trip.towards'].split('{end}')[0]), 'where it goes');
        // Its badge, by the timetable, counted from now, and the next one's
        const minutes = [ride.boards, ride.next].filter(at => at !== null).map(at => Math.floor((at - NOW.seconds) / 60)).filter(m => m < 60);
        assert.ok(minutes.length > 0, 'within the hour');
        assert.ok(card.includes(`<span class="trip-step-badges">${minutes.map((m, i) => minutesBadge(m, key => s[key], { said: i ? s['trip.next-in'] : undefined })).join('')}</span>`), 'not marked live');
        assert.ok(nothingUnder(view), 'nothing under the answer');
    });

    test(`${lang}: the same ride on two buses shows both, and doesn't say where one of them goes`, () => {
        const acropolis = { lat: 37.9686, lng: 23.7295, title: 'Ακρόπολη', exact: null };
        const trip = doorToDoor(network, menelaou, acropolis, NOW, { buses: busOptions(city, menelaou, acropolis, NOW) });
        const both = trip.options.find(o => o.city && o.rides.some(ride => ride.lines.length > 1));
        const ride = both.rides.find(one => one.lines.length > 1);
        const view = String(drawTrip(network, { ...trip, options: [both] }, syntagma));
        check(view);
        for (const line of ride.lines) assert.ok(view.includes(`<span class="bus-plate pill-m">${line}</span>`), line);
        // Of the rides drawn as rows (a train is a card, with its sign)
        const heads = view.match(/<div class="trip-step-head"><span>.*?<\/span>/g);
        const towards = s['trip.towards'].split('{end}')[0];
        assert.equal(heads.filter(head => head.includes(towards)).length, both.rides.filter(one => one.lines.length === 1 && !['metro', 'tram'].includes(one.mode)).length);
    });

    test(`${lang}: a way by suburban railway: its pill, its time from the timetable, where it goes, and nothing under it of where its times are from`, () => {
        const way = busOptions(withTrains, athensStation, airportStation, NOW).find(o => o.rides.some(ride => ride.mode === 'suburban'));
        assert.ok(way, 'the search found the train');
        const trip = doorToDoor(network, athensStation, airportStation, NOW, { buses: [way] });
        const view = String(drawTrip(network, { ...trip, options: [way] }, airportStation));
        check(view);
        const ride = way.rides.find(one => one.mode === 'suburban');
        assert.ok(view.includes('<span class="line-pill pill-m line-a1">A1</span>'));
        // From the timetable, as the metro's: no "~"
        assert.ok(view.includes(leaves(clock(ride.boards))));
        assert.ok(view.includes(s['trip.towards'].replace('{end}', lang === 'el' ? 'Αεροδρόμιο' : 'Airport')));
        assert.equal(view.includes('railway.gov.gr'), false, 'credited on the About page, not under the answer');
        assert.ok(nothingUnder(view), 'nothing under the answer');
        // The airport is outside OASA's ticket
        assert.ok(view.includes(s['trip.train-ticket'].replace('{station}', lang === 'el' ? 'Αεροδρόμιο' : 'Airport').replace(/'/g, '&#39;')));
    });

    test(`${lang}: a change on foot to the suburban railway says what the way needs, and a train only within OASA's ticket says nothing of tickets`, () => {
        const [way] = busOptions(changing, { lat: 37.9701, lng: 23.70 }, { lat: 38.0501, lng: 23.70 }, { weekday: 3, seconds: 35_900 });
        assert.deepEqual(way.rides.map(ride => [ride.line, ride.walkNote]), [['040', null], ['A1', { el: 'Απέναντι, χωρίς σήμανση', en: 'Across the road, with no signs' }]]);
        const view = String(drawTrip(network, { options: [way], walk: { meters: 9000, minutes: 112 }, walkFirst: false, longWalk: false }, airportStation));
        check(view);
        const walk = view.slice(view.indexOf(s['trip.walk-to'].replace('{place}', lang === 'el' ? 'Αθήνα' : 'Athens')));
        assert.ok(walk.indexOf(lang === 'el' ? 'Απέναντι, χωρίς σήμανση' : 'Across the road, with no signs') < walk.indexOf('line-a1'), 'on the walk, before the train');
        assert.ok(view.includes(s['trip.train-ticket'].split('{station}')[0].replace(/'/g, '&#39;')));
        // Within the ticket, nothing
        const inside = structuredClone(way);
        delete inside.rides[1].alight.oasaTicket;
        assert.equal(String(drawTrip(network, { options: [inside], walk: { meters: 9000, minutes: 112 }, walkFirst: false, longWalk: false }, airportStation)).includes(s['trip.train-ticket'].split('{station}')[0].replace(/'/g, '&#39;')), false);
    });

    test(`${lang}: when the suburban railway has no times for today, an error above the answer says it's left out`, () => {
        const view = String(drawTrip(network, doorToDoor(network, menelaou, syntagma, NOW), syntagma, { noTrains: true }));
        check(view);
        assert.deepEqual(notices(view), [{ tone: 'danger', icon: 'error', text: s['trip.no-trains-today'] }]);
        assert.ok(view.indexOf('notice-danger') < view.indexOf('trip-card'), 'above the answer');
        assert.ok(nothingUnder(view), 'nothing under the answer');
        assert.deepEqual(notices(drawTrip(network, doorToDoor(network, menelaou, syntagma, NOW), syntagma)), []);
    });

    test(`${lang}: without the buses' times, an error says the trip is by metro and tram`, () => {
        const view = String(drawTrip(network, doorToDoor(network, menelaou, syntagma, NOW), syntagma, { noBuses: true }));
        check(view);
        assert.deepEqual(notices(view), [{ tone: 'danger', icon: 'error', text: s['trip.buses-error'] }]);
    });

    test(`${lang}: without the searches, with a newer Wayhop waiting, it says to close it and open it again, not that the times failed`, () => {
        const view = String(drawTrip(network, doorToDoor(network, menelaou, syntagma, NOW), syntagma, { noBuses: 'updated' }));
        check(view);
        assert.deepEqual(notices(view), [{ tone: 'info', icon: 'bus', text: s['trip.updated'] }], 'how to read it, about the buses');
    });

    test(`${lang}: to an address, the last walk is there too`, () => {
        const trip = doorToDoor(rail, syntagma, menelaou, NOW);
        const view = String(drawTrip(rail, trip, menelaou));
        check(view);
        assert.ok(view.includes('Μενελάου 25'));
    });

    test(`${lang}: what's chosen, with how exact it is`, () => {
        const view = String(r.renderChosen(menelaou, syntagma));
        check(view);
        for (const text of ['Μενελάου 25', 'About here', 'Σύνταγμα', s['trip.change']]) assert.ok(view.includes(text), text);
    });

    test(`${lang}: close enough to walk`, () => {
        const near = { lat: syntagma.lat + 0.002, lng: syntagma.lng };
        const view = String(drawTrip(rail, doorToDoor(rail, near, syntagma, NOW), syntagma));
        check(view);
        assert.ok(view.indexOf(s['trip.walk-quicker']) < view.indexOf(s['trip.other-ways']) || !view.includes(s['trip.other-ways']));
    });

    test(`${lang}: a long walk says so, and points to the buses nearby`, () => {
        const far = { lat: 37.97805, lng: 23.62674 };
        const view = String(drawTrip(rail, doorToDoor(rail, far, syntagma, NOW), syntagma));
        check(view);
        assert.ok(view.includes(s['trip.look-for-buses']));
    });

    test(`${lang}: after the last train it says so, with the morning's times`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, { ...NOW, seconds: 2.5 * 3600 });
        const view = String(drawTrip(rail, trip, syntagma));
        check(view);
        assert.ok(view.includes(s['trip.no-trains']));
        assert.equal(view.includes('trip-total'), false, 'no count of minutes until the morning');
    });

    test(`${lang}: a timetable that has ended is said`, () => {
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        assert.ok(String(drawTrip(rail, trip, syntagma, { expired: true })).includes(s['trip.timetable-ended']));
    });
    // ── The step-free notice (DESIGN.md, the Guide's T12) ──
    const named = id => localName(network.stations[id].name, lang);
    const lifts = (stations, unavailable = false) => ({ stations, unavailable });
    const liftError = { tone: 'danger', icon: 'error', text: s['lifts.unavailable'] };

    test(`${lang}: by metro, the step-free notice above the answer for every station its ways use, after its messages`, () => {
        // Each way: M1 to Monastiraki, then M3 to Syntagma
        const trip = doorToDoor(rail, menelaou, syntagma, NOW);
        assert.ok(trip.options.every(o => o.plan.legs.map(leg => leg.to).join() === 'monastiraki,syntagma'));
        const view = String(drawTrip(rail, trip, syntagma, { expired: true, lifts: lifts({ monastiraki: { status: 'partial', out: ['Προς Πειραιά'] } }) }));
        check(view);
        assert.match(view, /<details class="notice notice-info closable-notice lift-notice mb-3" open>/);
        assert.ok(view.includes(`${format(s['lifts.summary'], { stations: named('monastiraki') })}<`), 'named in its first line');
        assert.ok(view.indexOf(s['trip.timetable-ended']) < view.indexOf('lift-notice') && view.indexOf('lift-notice') < view.indexOf('trip-card'), 'after the messages, above the answer');
        assert.ok(nothingUnder(view), 'nothing under the answer');
        // Closed before (liftsOpen()): drawn closed
        assert.match(String(drawTrip(rail, trip, syntagma, { lifts: lifts({ syntagma: { status: 'closed', out: [] } }), liftsOpen: false })), /<details class="notice notice-warn closable-notice lift-notice mb-3">/);
        // A platform with steps only where the ways board: a warning, and that lifts can stop working
        const steps = structuredClone(rail);
        steps.lines.M3.directions.doukissis.stops.find(stop => stop.station === 'monastiraki').stepFree = 'no';
        const gap = String(drawTrip(steps, doorToDoor(steps, menelaou, syntagma, NOW), syntagma, { lifts: lifts({}) }));
        assert.match(gap, /notice-warn closable-notice lift-notice/);
        assert.ok(spoken(gap).includes(format(s['lifts.no-step-free'], { station: named('monastiraki'), toward: named('airport') })));
        // Their lifts all working: nothing
        assert.doesNotMatch(String(drawTrip(rail, trip, syntagma, { lifts: lifts({ kerameikos: { status: 'closed', out: [] } }) })), /lift-/);
    });

    test(`${lang}: a way with a bus: the stations of its metro ride; by bus alone, nothing, even with no lift status`, () => {
        // By the 040 alone, then two ways by bus and M2 from Syggrou-Fix
        const trip = doorToDoor(network, menelaou, syntagma, NOW, { buses: busOptions(city, menelaou, syntagma, NOW) });
        const [byBus] = trip.options;
        assert.ok(byBus.city && byBus.rides.every(ride => !ride.board.station));
        const withMetro = trip.options.find(o => o.rides?.some(ride => ride.mode === 'metro'));
        assert.equal(withMetro.rides.find(ride => ride.mode === 'metro').dir, 'anthoupoli', 'a metro ride knows its direction');
        const view = String(drawTrip(network, trip, syntagma, { lifts: lifts({ 'syggrou-fix': { status: 'closed', out: ['Εξωτερικός'] } }, true) }));
        check(view);
        assert.deepEqual(notices(view), [liftError]);
        assert.ok(view.includes(`${format(s['lifts.summary'], { stations: named('syggrou-fix') })}<`));
        assert.ok(view.indexOf('lift-error') < view.indexOf('lift-notice'), 'the error first, what\'s known under it');
        // For a screen reader, after the trip's summary
        assert.equal(r.stepFreeSummary(network, trip.options, lifts({ 'syggrou-fix': { status: 'closed', out: [] } }, true)),
            `${s['lifts.unavailable']} ${format(s['lifts.closed'], { station: named('syggrou-fix') })}`);
        const busOnly = { ...trip, options: [byBus] };
        assert.doesNotMatch(String(drawTrip(network, busOnly, syntagma, { lifts: lifts({}, true) })), /lift-/);
        assert.equal(r.stepFreeSummary(network, busOnly.options, lifts({}, true)), '');
        // A suburban train's stations have no lift status
        const byTrain = busOptions(withTrains, athensStation, airportStation, NOW).find(o => o.rides.every(ride => ride.mode === 'suburban'));
        assert.doesNotMatch(String(drawTrip(network, { options: [byTrain], walk: { meters: 9000, minutes: 112 }, walkFirst: false, longWalk: false }, airportStation, { lifts: lifts({}, true) })), /lift-/);
    });
}
