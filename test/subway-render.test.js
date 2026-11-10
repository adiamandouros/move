import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { athensNow, planTrip, withSuburban, withTram } from '../tools/subway/client/network.js';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, notices, spoken } from './support/markup.js';
import { clockTime } from '../public/js/core/metro.js';

// What the subway page draws for a trip (tools/subway/client/render.js), in
// the real network at different times: a direct trip, a change of line,
// tomorrow's first trains, an old timetable and no route. Each state is also
// checked for accessibility and for strings shown as their keys.

const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
const trains = JSON.parse(readFileSync(new URL('./browser/data/trains.json', import.meta.url), 'utf8'));
const NOON = athensNow(new Date('2026-10-21T09:00:00Z')); // Wednesday 12:00 in Athens
const LATE = athensNow(new Date('2026-10-14T20:55:00Z')); // Wednesday 23:55

// Lifts out of service, as watchLifts() gives them (public/js/core/lifts.js)
const LIFTS = {
    stations: {
        kifisia: { status: 'partial', out: ['Αποβάθρα - Υπόγεια Διάβαση'] },
        aigaleo: { status: 'closed', out: ['Εξωτερικός', 'Προς Αγία Μαρίνα'] },
    },
    unavailable: false,
};

// [from, to, now, options]
const TRIPS = {
    'a direct trip': ['syntagma', 'airport', NOON],
    'a change of line': ['kifisia', 'aigaleo', NOON],
    'tomorrow\'s first trains': ['syntagma', 'airport', LATE],
    'an old timetable': ['omonia', 'piraeus', NOON, { expired: true }],
    // Three options, 4 and 6 minutes after the first
    'a slower option': ['kifisia', 'syntagma', NOON],
    'lifts out of service on the way': ['kifisia', 'aigaleo', NOON, { lifts: LIFTS }],
};
// With the tram: from, to, what it shows
const network = withTram(rail);
const TRAM_TRIPS = [
    ['kifisia', 'zappeio', 'two changes'],
    ['syntagma', 'zappeio', 'a walk first'],
    ['kifisia', 'neo-faliro', 'a walk last'],
    ['kifisia', 'evangelistria', 'a change on foot'],
    ['zappeio', 'fix', 'by tram alone'],
];
// With the suburban railway too (decision 41): from, to, what it shows
const suburban = withSuburban(network, trains, NOON.date);
const SUBURBAN_TRIPS = [
    ['megara', 'syntagma', 'a change to the metro on foot, from a station OASA\'s ticket doesn\'t cover'],
    ['piraeus-suburban', 'monastiraki', 'a walk first, with its note'],
    ['ano-liosia', 'chalkida', 'a change across SKA\'s footbridge'],
];
const drawTram = (render, from, to, now = NOON) => {
    const trip = planTrip(network, from, to, now);
    return { trip, html: String(render.renderResult(network, trip.plans.slice(0, 1), trip.now, { expired: false, tomorrow: trip.tomorrow, to })) };
};
const draw = (render, [from, to, now, options = {}]) => {
    const trip = planTrip(rail, from, to, now);
    return { trip, html: String(render.renderResult(rail, trip.plans, trip.now, { expired: false, tomorrow: trip.tomorrow, ...options })) };
};

for (const lang of ['en', 'el']) {
    const render = await browserModule('tools/subway/client/render.js', lang);
    const keys = Object.keys(strings(lang));
    for (const [what, trip] of Object.entries(TRIPS)) {
        test(`${lang}: ${what} is accessible and fully translated`, () => {
            const { trip: { plans, now, tomorrow }, html } = draw(render, trip);
            assert.deepEqual(markupProblems(html, { keys }), []);
            // Read out by the status line, which only screen readers have
            assert.deepEqual(markupProblems(`<p class="sr-only">${render.routeSummary(rail, plans, now, tomorrow)}</p>`, { keys }), []);
        });
    }
    for (const [from, to, why] of TRAM_TRIPS) {
        test(`${lang}: a trip with the tram (${why}) is accessible and fully translated`, () => {
            const { plans, now, tomorrow } = planTrip(network, from, to, NOON);
            assert.deepEqual(markupProblems(render.renderResult(network, plans, now, { expired: false, tomorrow, to }), { keys }), []);
            assert.deepEqual(markupProblems(`<p class="sr-only">${render.routeSummary(network, plans, now, tomorrow)}</p>`, { keys }), []);
        });
    }
    for (const [from, to, why] of SUBURBAN_TRIPS) {
        test(`${lang}: a trip by suburban train (${why}) is accessible and fully translated`, () => {
            const { plans, now, tomorrow } = planTrip(suburban, from, to, NOON);
            assert.deepEqual(markupProblems(render.renderResult(suburban, plans, now, { expired: false, tomorrow, from, to }), { keys }), []);
            assert.deepEqual(markupProblems(`<p class="sr-only">${render.routeSummary(suburban, plans, now, tomorrow)}</p>`, { keys }), []);
        });
    }
    test(`${lang}: no route, other messages and the intro`, () => {
        assert.deepEqual(markupProblems(render.renderResult(rail, [], NOON, { expired: false }), { keys }), []);
        assert.deepEqual(markupProblems(render.renderIntro(rail), { keys }), []);
        assert.deepEqual(markupProblems(render.renderIntro(rail, true, LIFTS, ['aigaleo']), { keys }), []);
        assert.deepEqual(markupProblems(render.renderMessage('subway.same-station'), { keys }), []);
        assert.deepEqual(markupProblems(render.renderError('subway.data-error'), { keys }), []);
        assert.deepEqual(markupProblems(render.renderWalkOnly(8), { keys }), []);
    });
}

test('a direct trip: the line, where it goes, when, where to get off and which part of the train', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(render, TRIPS['a direct trip']);
    assert.equal(trip.tomorrow, false);
    const text = spoken(html).replace(/\s+/g, ' ');
    // Toward where the line ends, as its signs say (not "Doukissis / Airport"), on the line's sign
    assert.match(text, /M3 toward Airport/);
    assert.match(html, /<span class="line-pill pill-l line-m3">M3<\/span>\s*<span class="direction-text"><span aria-hidden="true">→ <\/span><span class="sr-only">toward <\/span><span class="station-sign sign-m sign-top-m3">Airport<\/span><\/span>/);
    assert.match(text, /In\s*\d+ minutes/);
    assert.match(text, /Exit at Airport/);
    assert.equal((html.match(/<h2\b/g) ?? []).length, 1, 'one heading for the one leg');
    assert.match(html, /class="train-diagram|train-car/);
    // Under the results, what the trains show, open: Syntagma's M3 platform has an escalator up and a lift
    assert.match(html, /<details class="diagram-legend" open>\s*<summary>What the train shows<\/summary>/);
    assert.match(text, /Ride in this part of the train[^]*An escalator up[^]*An elevator/);
    assert.doesNotMatch(text, /The way up from the platform|Stairs/);
    assert.doesNotMatch(html, /tomorrow-notice|timetable-notice/);
});

test('a change of line: two legs, where to change, and a heading per option', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(render, TRIPS['a change of line']);
    const text = spoken(html).replace(/\s+/g, ' ');
    assert.ok(trip.plans.every(p => p.legs.length === 2));
    assert.match(text, /Option 1, Via \w+, Arrive about/);
    // Each leg's line is its large pill; the line to change to, between the cards, a medium one
    assert.match(html, /<h[23] class="leg-title">\s*<span class="line-pill pill-l line-m1">M1<\/span>/);
    assert.match(html, /Change to <span class="line-pill pill-m line-m3">M3<\/span>/);
    if (trip.plans.length > 1) {
        assert.equal((html.match(/<h2 class="route-option-label"/g) ?? []).length, trip.plans.length);
        assert.equal((html.match(/<h3\b/g) ?? []).length, trip.plans.length * 2);
    }
});

test('after the last train: tomorrow\'s first trains, as clock times, in both languages', async () => {
    const en = await browserModule('tools/subway/client/render.js', 'en');
    const el = await browserModule('tools/subway/client/render.js', 'el');
    const english = draw(en, TRIPS['tomorrow\'s first trains']);
    assert.equal(english.trip.tomorrow, true);
    assert.match(spoken(english.html), /No more service today\. These are tomorrow's first departures\./);
    assert.match(spoken(english.html), /At\s*0[5-7]:\d\d/);
    assert.match(spoken(draw(el, TRIPS['tomorrow\'s first trains']).html).replace(/\s+/g, ' '), /πρώτα δρομολόγια της επόμενης ημέρας[\s\S]*Στις\s*0[5-7]:\d\d/);
});

test('lifts out of service where the trip starts, changes or ends: one notice, a warning when a station can\'t be reached step-free', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(render, TRIPS['lifts out of service on the way']);
    const text = spoken(html).replace(/\s+/g, ' ');
    assert.equal((html.match(/class="notice notice-warn closable-notice lift-notice/g) ?? []).length, 1, 'one warning, first');
    assert.match(html, /^\s*<details class="notice notice-warn closable-notice lift-notice mb-3" open>/);
    // Its first line names the stations, and stays when it's closed
    assert.match(html, /<summary><svg [^]*?<\/svg><span class="closable-summary">Step-free access: Kifisia, Aigaleo<\/span><svg class="icon closable-chevron"/);
    assert.match(text, /Kifisia: not every elevator works, but the station can still be reached by the others\. Out of service: «Αποβάθρα - Υπόγεια Διάβαση»\./);
    assert.match(text, /Aigaleo: no step-free access right now\. Out of service: «Εξωτερικός», «Προς Αγία Μαρίνα»\./);
    assert.match(html, /<span lang="el">«Εξωτερικός»<\/span>/);
    // Nothing under it says where the lifts' status comes from (decision 43)
    assert.doesNotMatch(html, /stasy\.gr|STASY/);
    // Screen readers hear it with the trip
    assert.match(render.routeSummary(rail, trip.plans, trip.now, trip.tomorrow, LIFTS), /\. Kifisia: not every elevator works[^.]+\. Aigaleo: no step-free access right now\.$/);

    // Only partly out: for information. None on the way, or none known: nothing
    const partly = { ...LIFTS, stations: { kifisia: LIFTS.stations.kifisia } };
    assert.match(draw(render, ['kifisia', 'aigaleo', NOON, { lifts: partly }]).html, /notice notice-info closable-notice lift-notice/);
    // Closed by the person before (liftsOpen()): drawn closed, still yellow
    assert.match(draw(render, ['kifisia', 'aigaleo', NOON, { lifts: LIFTS, liftsOpen: false }]).html, /^\s*<details class="notice notice-warn closable-notice lift-notice mb-3">\s*<summary>/);
    assert.doesNotMatch(draw(render, ['syntagma', 'airport', NOON, { lifts: LIFTS }]).html, /lift-notice/);
    assert.doesNotMatch(draw(render, TRIPS['a change of line']).html, /lift-notice/);
    // One station picked: its lifts, above what the page does
    const intro = String(render.renderIntro(rail, true, LIFTS, ['aigaleo']));
    assert.match(intro, /^<details class="notice notice-warn closable-notice lift-notice mb-3" open>[^]*subway-intro/);
    assert.match(String(render.renderIntro(rail, true, LIFTS, ['aigaleo'], false)), /^<details class="notice notice-warn closable-notice lift-notice mb-3">/);
    assert.match(spoken(intro), /Aigaleo: no step-free access/);
    assert.doesNotMatch(String(render.renderIntro(rail, true, LIFTS, ['syntagma'])), /lift-notice/);
});

test('a platform with steps only where the trip boards, changes or gets off: a warning, and that lifts can stop working', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    // As if Thiseio's platform toward Piraeus had steps only
    const steps = structuredClone(rail);
    steps.lines.M1.directions.piraeus.stops.find(s => s.station === 'thiseio').stepFree = 'no';
    const trip = planTrip(steps, 'omonia', 'thiseio', NOON);
    const html = String(render.renderResult(steps, trip.plans, trip.now, { expired: false }));
    assert.match(html, /^\s*<details class="notice notice-warn closable-notice lift-notice mb-3" open>\s*<summary>[^]*?Step-free access: Thiseio</);
    assert.match(spoken(html).replace(/\s+/g, ' '), /Thiseio: the platform toward Piraeus has steps only, no step-free access\./);
    // No lifts out of service, but that they can stop and where to see them
    assert.match(spoken(html), /Lifts can stop working at any time: see STASY's elevator page \(opens in a new tab\)\./);
    assert.match(render.routeSummary(steps, trip.plans, trip.now, false), /\. Thiseio: the platform toward Piraeus has steps only, no step-free access\.$/);
    // Passing through it: nothing; the other direction's platform: nothing
    const through = planTrip(steps, 'omonia', 'piraeus', NOON);
    assert.doesNotMatch(String(render.renderResult(steps, through.plans, through.now, { expired: false })), /lift-notice/);
    const back = planTrip(steps, 'thiseio', 'omonia', NOON);
    assert.doesNotMatch(String(render.renderResult(steps, back.plans, back.now, { expired: false })), /lift-notice/);
    // One station picked: its platforms with steps only, with its lifts out of service
    const intro = spoken(String(render.renderIntro(steps, true, null, ['thiseio'])));
    assert.match(intro, /Thiseio: the platform toward Piraeus has steps only/);
    // The real data has no such platform yet
    assert.doesNotMatch(String(render.renderIntro(rail, true, null, ['thiseio'])), /lift-notice/);
});

test('lifts out of service, in Greek: the Greek names', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'el');
    const { html } = draw(render, TRIPS['lifts out of service on the way']);
    assert.match(spoken(html).replace(/\s+/g, ' '), /Αιγάλεω: προς το παρόν χωρίς πρόσβαση με ανελκυστήρα\. Εκτός λειτουργίας: «Εξωτερικός», «Προς Αγία Μαρίνα»\./);
    assert.doesNotMatch(html, /stasy\.gr|ΣΤΑΣΥ/);
});

test('a station boarded after a walk from the tram counts too: its lifts out are said', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    // T7 to Dimarcheio, then a walk to M3's Dimotiko Theatro
    const trip = planTrip(network, 'evangelistria', 'kifisia', NOON);
    assert.ok(trip.plans.some(r => r.legs.some((leg, i) => leg.from === 'dimotiko-theatro' && r.legs[i - 1]?.to === 'dimarcheio')));
    const lifts = { stations: { 'dimotiko-theatro': { status: 'closed', out: ['Εξωτερικός'] } }, unavailable: false };
    const html = String(render.renderResult(network, trip.plans, trip.now, { expired: false, lifts }));
    assert.match(html, /Step-free access: Dimotiko Theatro</);
    assert.match(render.routeSummary(network, trip.plans, trip.now, false, lifts), /Dimotiko Theatro: no step-free access right now\.$/);
});

test('the lift status unavailable: an error above the step-free notice, for a trip or a station picked that the metro serves', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const stale = { ...LIFTS, unavailable: true };
    const { trip, html } = draw(render, TRIPS['lifts out of service on the way']);
    const drawn = String(render.renderResult(rail, trip.plans, trip.now, { expired: false, lifts: stale }));
    assert.deepEqual(notices(drawn)[0], { tone: 'danger', icon: 'error', text: 'Lift status unavailable right now, so lifts out of service aren\'t shown.' });
    // The outages known still listed, under it
    assert.match(drawn, /^\s*<div class="notice notice-danger lift-error mb-3">[^]*?<\/div><details class="notice notice-warn closable-notice lift-notice mb-3" open>/);
    assert.equal(drawn.replace(/^\s*<div class="notice notice-danger lift-error mb-3">[^]*?<\/div>(?=<details)/, ''), html);
    assert.match(render.routeSummary(rail, trip.plans, trip.now, false, stale), /\. Lift status unavailable right now, so lifts out of service aren't shown\. Kifisia/);
    // None known: the error alone
    const none = { stations: {}, unavailable: true };
    assert.deepEqual(notices(draw(render, ['syntagma', 'airport', NOON, { lifts: none }]).html).map(n => n.tone), ['danger']);
    // By tram alone: no metro station, nothing to say. With a metro ride too: said
    const tram = planTrip(network, 'zappeio', 'fix', NOON);
    assert.deepEqual(tram.plans.map(r => r.legs.map(leg => leg.line)), [['T6'], ['T6', 'M2']]);
    const ends = { from: 'zappeio', to: 'fix' };
    assert.doesNotMatch(String(render.renderResult(network, tram.plans.slice(0, 1), tram.now, { expired: false, lifts: none, ...ends })), /lift-/);
    assert.match(String(render.renderResult(network, tram.plans, tram.now, { expired: false, lifts: none, ...ends })), /lift-error/);
    // One station picked
    assert.match(String(render.renderIntro(rail, true, none, ['aigaleo'])), /^<div class="notice notice-danger lift-error mb-3">/);
    assert.doesNotMatch(String(render.renderIntro(network, true, none, ['zappeio'])), /lift-/);
});

test('an old timetable says so, with its last day', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const [y, m, d] = rail.feed.validTo.split('-');
    assert.match(draw(render, TRIPS['an old timetable']).html, new RegExp(`timetable-notice[\\s\\S]*${d}/${m}/${y}`));
});

test('one train: minutes on screen and in full for screen readers, or a clock time; the last ones marked', async () => {
    const { departureChip } = await browserModule('tools/subway/client/render.js', 'en');
    const now = { seconds: 12 * 3600 };
    assert.equal(String(departureChip({ departs: now.seconds + 12 * 60 + 30 }, now, false)),
        '<span class="time-badge time-later"><span aria-hidden="true">12\'</span><span class="sr-only">12 minutes,</span></span>');
    assert.equal(String(departureChip({ departs: 5.5 * 3600 + 120, isLast: true }, now, true)),
        '<span class="time-badge time-last" title="Last train">05:32<span class="sr-only"> (Last train),</span></span>');
    const secondLast = String(departureChip({ departs: now.seconds + 5 * 60, isSecondLast: true }, now, false));
    assert.match(secondLast, /class="time-badge time-second-last" title="Second to last train"/);
    assert.equal(spoken(secondLast), '5 minutes (Second to last train),');
    // The same green scale as the buses: due, close, later; a clock time is neutral
    const tier = (minutes, clock = false) => String(departureChip({ departs: now.seconds + minutes * 60 }, now, clock)).match(/time-(\S+?)"/)[1];
    assert.deepEqual([0, 3, 4, 8, 9, 30].map(m => tier(m)), ['due', 'due', 'close', 'close', 'later', 'later']);
    assert.equal(tier(2, true), 'later');
    // A train that's already due: 0, never less
    assert.match(String(departureChip({ departs: now.seconds - 30 }, now, false)), />0'</);
});

test('the one-sentence summary for screen readers', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const summary = trip => { const { plans, now, tomorrow } = draw(render, trip).trip; return render.routeSummary(rail, plans, now, tomorrow); };
    assert.match(summary(TRIPS['a direct trip']), /^M3 toward Airport, in \d+ minutes\. Arrive about \d\d:\d\d, \d+ minutes\.$/);
    assert.match(summary(TRIPS['tomorrow\'s first trains']), /^No more service today\. These are tomorrow's first departures\. M3 toward Airport, at 0[5-7]:\d\d\. Arrive about 0[6-8]:\d\d, \d+ minutes\.$/);
    assert.equal(render.routeSummary(rail, [], NOON), String(render.renderResult(rail, [], NOON, {})).replace(/<[^>]+>/g, ''));
});

test('each option\'s line names every change', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const network = withTram(rail);
    const { plans, now } = planTrip(network, 'kifisia', 'zappeio', NOON);
    const html = String(render.renderResult(network, plans, now, { expired: false }));
    const changes = plans[0].legs.slice(0, -1).map(leg => network.stations[leg.to].name.en);
    assert.equal(changes.length, 2);
    assert.match(html, new RegExp(`<span class="route-via">Via ${changes.join(', ')}</span>`));
});

test('each option\'s line: where to change, when it arrives and how long the whole trip takes', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(render, TRIPS['a change of line']);
    const headings = [...html.matchAll(/<h2 class="route-option-label">[^]*?<\/h2>/g)].map(([h]) => h);
    assert.equal(headings.length, trip.plans.length, 'one per option');
    trip.plans.forEach((plan, i) => {
        // Boarding the first train to getting off the last: both rides, the
        // change and the wait for the second train
        const [first, second] = plan.legs.map(leg => leg.departures[0]);
        const minutes = Math.round((second.arrives - first.departs) / 60);
        assert.ok(second.departs >= first.arrives + 180, 'time to change');
        const via = rail.stations[plan.legs[0].to].name.en;
        // Short on screen (it has to fit one line), in full for screen readers
        assert.equal(spoken(headings[i]), `Option ${i + 1}, Via ${via}, Arrive about ${clockTime(plan.arrives)} · ${minutes} minutes`);
        // On screen: where to change, then (on the right) the arrival
        const visible = headings[i].replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/ aria-hidden="true"/g, '');
        assert.match(visible, new RegExp(`<span class="route-via">Via ${via}</span><span class="route-total">Arrive <span>~</span>${clockTime(plan.arrives)} · <span>${minutes}'</span></span></h2>$`));
    });

    // One route: no option heading, but still the total
    const direct = draw(render, TRIPS['a direct trip']);
    const [{ departures: [train] }] = direct.trip.plans[0].legs;
    assert.match(direct.html, new RegExp(`<p class="route-option-label"><span class="route-via">No transfers</span><span class="sr-only">, </span><span class="route-total">Arrive [^]*?${Math.round((train.arrives - train.departs) / 60)}'`));
    assert.doesNotMatch(direct.html, /<h2 class="route-option-label"/);
    // Said once: not again on the leg's card
    assert.equal(spoken(direct.html).match(/\d+ minutes · \d+ stops/g), null);
    // With a change, each card still says how long its own ride is
    trip.plans.forEach(plan => plan.legs.forEach(({ departures: [train] }) =>
        assert.match(spoken(html).replace(/\s+/g, ' '), new RegExp(`, ${Math.round((train.arrives - train.departs) / 60)} minutes · \\d+ stops`))));

    const greek = await browserModule('tools/subway/client/render.js', 'el');
    assert.match(spoken(draw(greek, TRIPS['a change of line']).html), /Επιλογή 1, Μέσω \S+, Άφιξη περίπου \d\d:\d\d · \d+ λεπτά/);
    assert.match(spoken(draw(greek, TRIPS['a direct trip']).html), /^\s*Χωρίς αλλαγή, Άφιξη περίπου/);
});

// The stops at the end of a card: a button that opens the leg's stations
const stopsButton = (count, open = false) => new RegExp(`<button type="button" class="leg-stops-toggle" data-leg="[^"]+" aria-expanded="${open}" aria-controls="stations-[\\w-]+">${count} stops<svg[^]*?</svg></button>`);

test('each card ends with where to get off and how many stops the ride is, on the right, with or without a change', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    // Syntagma to the Airport: 15 stops on M3, said after where to get off
    const direct = draw(render, TRIPS['a direct trip']);
    const [leg] = direct.trip.plans[0].legs;
    assert.equal(leg.toIndex - leg.fromIndex, 15);
    assert.match(direct.html, new RegExp(`<span class="leg-ride">${stopsButton(15).source}</span>`));
    assert.match(spoken(direct.html).replace(/\s+/g, ' '), /Exit at Airport, 15 stops Doors open on the left/);
    // At the bottom of the card: after the train, then the stations on the
    // way (closed), then the Airport's central platform on a line of its own
    assert.match(direct.html, /class="train-diagram"[^]*<div class="leg-action mt-3">/);
    assert.match(direct.html, /<\/button><\/span>\s*<\/div>\s*<ol class="leg-stations[^]*?<\/ol>\s*<p class="leg-doors text-center mt-2 mb-0"><span class="tag">[^]*?<\/p>\s*<\/div><\/div>/);
    // One stop: singular, in both languages
    const one = { fromIndex: 4, toIndex: 5 };
    assert.equal(render.stopCount(one), '1 stop');
    assert.equal(render.stopCount({ fromIndex: 4, toIndex: 7 }), '3 stops');
    const greek = await browserModule('tools/subway/client/render.js', 'el');
    assert.equal(greek.stopCount(one), '1 σταθμός');
    assert.equal(greek.stopCount({ fromIndex: 4, toIndex: 7 }), '3 σταθμοί');
    // With a change: each leg's own minutes, as on the boards ("12'"), then its stops
    const change = draw(render, TRIPS['a change of line']);
    change.trip.plans.forEach(plan => plan.legs.forEach(leg => {
        const minutes = Math.round((leg.departures[0].arrives - leg.departures[0].departs) / 60);
        assert.match(change.html, new RegExp(`<span class="leg-ride"><span aria-hidden="true">${minutes}'</span><span class="sr-only">${minutes} minutes</span> · ${stopsButton(leg.toIndex - leg.fromIndex).source}</span>`));
    }));
});

test('a leg\'s stops open the stations on the way: in order, from boarding to getting off, linked, with the other lines where they meet', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    // Kifisia to Aigaleo: M1 to Omonia or Monastiraki, then on
    const { trip, html } = draw(render, TRIPS['a change of line']);
    const lists = [...html.matchAll(/<ol class="leg-stations strip-(m\d)" id="([\w-]+)" aria-label="Stations on the way" hidden>([^]*?)<\/ol>/g)];
    const legs = trip.plans.flatMap(plan => plan.legs);
    assert.equal(lists.length, legs.length, 'one closed list per leg');
    lists.forEach(([, strip, id, items], i) => {
        const leg = legs[i];
        assert.equal(strip, leg.line.toLowerCase());
        // Its button points at it
        assert.ok(html.includes(`aria-controls="${id}"`));
        const stations = [...items.matchAll(/<li><a href="\/subway\/stations\/([\w-]+)">/g)].map(m => m[1]);
        assert.equal(stations.length, leg.toIndex - leg.fromIndex + 1, 'the stops, and where it boards');
        assert.equal(stations[0], leg.from);
        assert.equal(stations.at(-1), leg.to);
        assert.deepEqual(stations, rail.lines[leg.line].directions[leg.dir].stops.slice(leg.fromIndex, leg.toIndex + 1).map(s => s.station));
    });
    // Where it meets another line, that line's pill, not the leg's own
    const [first] = lists;
    assert.match(first[3], /<li><a href="\/subway\/stations\/attiki">Attiki<\/a> <span class="line-pill pill-s line-m2">M2<\/span><\/li>/);
    assert.doesNotMatch(first[3], /line-m1/);
    // Opened by the user (legKey), it stays open through the refresh
    const key = render.legKey(trip.plans[0], 0);
    const again = String(render.renderResult(rail, trip.plans, trip.now, { expired: false, stations: { [key]: true } }));
    assert.match(again, stopsButton(legs[0].toIndex - legs[0].fromIndex, true));
    assert.match(again, /<ol class="leg-stations strip-m1" id="[\w-]+" aria-label="Stations on the way">/);
    assert.equal((again.match(/aria-expanded="true"/g) ?? []).length, 1, 'only that one');
});

test('an option no train makes tonight is timed on tomorrow\'s first trains', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    // 23:30: Kifisia → Aigaleo still gets there tonight one way, not the other
    const { trip, html } = draw(render, ['kifisia', 'aigaleo', athensNow(new Date('2026-10-21T20:30:00Z'))]);
    assert.equal(trip.tomorrow, false);
    const stranded = trip.plans.findIndex(plan => plan.arrives === null);
    assert.notEqual(stranded, -1, 'refreshed test data still needs an option with no connection at 23:30');
    const heading = [...html.matchAll(/<h2 class="route-option-label">[^]*?<\/h2>/g)][stranded][0];
    assert.match(spoken(heading), /Arrive about 0[5-7]:\d\d · \d+ minutes$/);
});

test('an option more than 5 minutes slower starts closed, saying by how much', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(render, TRIPS['a slower option']);
    const later = trip.plans.map(plan => Math.floor(plan.arrives / 60) - Math.floor(trip.plans[0].arrives / 60));
    assert.deepEqual(later, [0, 4, 6], 'refreshed test data still needs options 4 and 6 minutes later');
    assert.equal(render.SLOWER_MINUTES, 5);
    // Only the third: closed, its heading (where to change, when it arrives) outside
    const details = [...html.matchAll(/<details class="route-details" data-route="([^"]+)">([^]*?)<\/details>/g)];
    assert.equal(details.length, 1);
    assert.equal(details[0][1], render.routeKey(trip.plans[2]));
    // "Show route" while closed, "Hide route" while open (CSS hides the other)
    const summary = details[0][2].match(/<summary[^]*?<\/summary>/)[0];
    assert.match(summary, /<span class="route-show">Show route<\/span><span class="route-hide">Hide route<\/span><span>· <span aria-hidden="true">6'<\/span><span class="sr-only">6 minutes<\/span> slower<\/span><\/summary>$/);
    assert.match(spoken(summary), /· 6 minutes slower$/);
    assert.equal((details[0][2].match(/class="card result-card"/g) ?? []).length, trip.plans[2].legs.length);
    assert.match(html, /<\/h2><details class="route-details"/);
    // The user opened it: open on the next refresh too
    const opened = String(render.renderResult(rail, trip.plans, trip.now, { expired: false, open: { [render.routeKey(trip.plans[2])]: true } }));
    assert.match(opened, /<details class="route-details" data-route="[^"]+" open>/);

    const greek = await browserModule('tools/subway/client/render.js', 'el');
    assert.match(spoken(draw(greek, TRIPS['a slower option']).html), /Εμφάνιση διαδρομής\s*Απόκρυψη διαδρομής\s*· 6 λεπτά πιο αργή/);
    assert.match(draw(greek, TRIPS['a slower option']).html, /<span aria-hidden="true">6'<\/span><span class="sr-only">6 λεπτά<\/span> πιο αργή/);
});

test('an option that misses its connection tonight starts closed, saying so', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(render, ['kifisia', 'aigaleo', athensNow(new Date('2026-10-21T20:30:00Z'))]);
    const stranded = trip.plans.findIndex(plan => plan.arrives === null);
    assert.notEqual(stranded, -1, 'refreshed test data still needs an option with no connection at 23:30');
    const details = [...html.matchAll(/<details class="route-details" data-route="([^"]+)">[^]*?<summary[^]*?<\/summary>/g)];
    assert.deepEqual(details.map(([, key]) => key), [render.routeKey(trip.plans[stranded])]);
    assert.match(spoken(details[0][0]), /· No connection tonight$/);
});

test('the signpost beside the boarding station: walking directions to it', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const [lat, lng] = rail.stations.syntagma.coords;
    assert.equal(render.walkingUrl(rail, 'syntagma'), `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`);
});

test('each leg says where to board, and station names link to their pages', async () => {
    const en = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(en, TRIPS['a change of line']);
    const [first, second] = trip.plans[0].legs;
    const name = id => rail.stations[id].name.en;
    const text = spoken(html).replace(/\s+/g, ' ');
    assert.ok(text.includes(`At ${name(first.from)}:`), text);
    assert.ok(text.includes(`At ${name(second.from)}:`), text);
    assert.match(html, new RegExp(`<p class="leg-boarding">At <a href="/subway/stations/${first.from}">`));
    assert.match(html, new RegExp(`Transfer at <strong><a href="/subway/stations/${first.to}">`));
    assert.match(html, new RegExp(`Exit at <strong><a href="/subway/stations/${second.to}">`));
    // Only the names are links, never a whole card
    assert.equal((html.match(/<a\b/g) ?? []).length, (html.match(/<a href="\/subway\/stations\/[^"]+">[^<]+<\/a>/g) ?? []).length);

    // In Greek without «σταθμός» (the count of stops keeps it: never «στάσεις»):
    // «Σε Σύνταγμα:», «Αλλαγή σε …», «Έξοδος σε …»
    const el = await browserModule('tools/subway/client/render.js', 'el');
    const greek = draw(el, TRIPS['a direct trip']).html;
    assert.match(greek, /<p class="leg-boarding">Σε <a href="\/el\/subway\/stations\/syntagma">Σύνταγμα<\/a>:<\/p>/);
    assert.match(greek, /Έξοδος σε <strong><a href="\/el\/subway\/stations\/airport">/);
    const change = draw(el, TRIPS['a change of line']).html;
    assert.match(change, new RegExp(`Αλλαγή σε <strong><a href="/el/subway/stations/${trip.plans[0].legs[0].to}">`));
    for (const html of [greek, change]) assert.deepEqual(spoken(html).match(/[Σσ]ταθμ\S*/g)?.filter(word => !/^σταθμ(ός|οί)$/.test(word)) ?? [], []);
});

test('same station and no route: shown in the warnings\' yellow, not light grey', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    for (const html of [String(render.renderMessage('subway.same-station')), String(render.renderResult(rail, [], NOON, {}))]) {
        assert.match(html, /^<div class="notice notice-warn subway-message mt-3"><svg [^]*<\/svg><div class="notice-body">/);
        assert.doesNotMatch(html, /text-body-secondary/);
    }
});

test('the subway data not loaded: an error, as the page is missing what it needs (decision 43)', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    assert.deepEqual(notices(render.renderError('subway.data-error')), [{ tone: 'danger', icon: 'error', text: strings('en')['subway.data-error'] }]);
});

test('the last trains are also said in words on a line of their own, with their clock times', async () => {
    const { lastTrainWords } = await browserModule('tools/subway/client/render.js', 'en');
    const now = { seconds: 23 * 3600 };
    const both = String(lastTrainWords([{ departs: now.seconds + 600, isSecondLast: true }, { departs: now.seconds + 1500, isLast: true }]));
    assert.match(both, /aria-hidden="true"><span class="last-train last-train-second-last"><svg [^]*<\/svg>Second to last train 23:10<\/span><span class="last-train last-train-last"><svg [^]*<\/svg>Last train 23:25<\/span>/);
    assert.doesNotMatch(String(lastTrainWords([{ departs: now.seconds + 600 }])), /last-train/);
});

test('before two stations are picked: what the planner does, and what the trains show, open unless closed before', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const intro = String(render.renderIntro(rail));
    assert.match(intro, /^<div class="subway-intro"><p>Pick where you get on and where you get off\. You&#39;ll see<\/p>\s*<ul><li>next trains<\/li><li>when you&#39;ll arrive<\/li><li>which part of the train to ride in<\/li><li>where to change lines<\/li><li>accessibility warnings<\/li><\/ul><\/div>\s*<details class="diagram-legend" open>/);
    // Every symbol some stop has: the test data has ways out and lifts
    assert.match(spoken(intro), /Ride in this part of the train[^]*The way up from the platform[^]*An elevator/);
    assert.match(String(render.renderIntro(rail, false)), /<details class="diagram-legend">/);
    // After a trip too
    const { trip } = draw(render, TRIPS['a direct trip']);
    assert.match(String(render.renderResult(rail, trip.plans, trip.now, { expired: false, legend: false })), /<details class="diagram-legend">/);
    const greek = await browserModule('tools/subway/client/render.js', 'el');
    assert.match(String(greek.renderIntro(rail)), /^<div class="subway-intro"><p>Επιλέξτε πού επιβιβάζεστε[^]*<li>προειδοποιήσεις προσβασιμότητας<\/li><\/ul><\/div>/);
});

test('a tram has no train diagram and nothing about where to stand; a metro leg beside it keeps its own', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = drawTram(render, 'kifisia', 'zappeio');
    const legs = trip.plans[0].legs;
    const cards = html.split('class="card result-card"').slice(1);
    assert.equal(cards.length, legs.length);
    legs.forEach((leg, i) => {
        const tram = Boolean(network.lines[leg.line].tram);
        assert.equal(cards[i].includes('train-diagram'), !tram, leg.line);
        assert.equal(cards[i].includes(strings('en')['subway.no-position-data']), false, leg.line);
    });

    const alone = drawTram(render, 'zappeio', 'fix').html;
    assert.doesNotMatch(alone, /train-diagram|diagram-legend/);
    assert.ok(!alone.includes(strings('en')['subway.no-position-data']));
    assert.match(alone, /line-t6/);
});

test('tram stops are named, not linked: they have no page of their own', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { html } = drawTram(render, 'kifisia', 'zappeio');
    assert.match(html, /href="\/subway\/stations\/kifisia"/);
    assert.doesNotMatch(html, /stations\/zappeio|stations\/syntagma-tram|stations\/fix"/);
    assert.match(spoken(html), /Exit at Zappio/);
});

test('walks: before the first leg, between two, and after the last', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const first = drawTram(render, 'syntagma', 'zappeio').html;
    assert.match(spoken(first), /Walk to Syntagma \(tram\) about 4 minutes/);
    assert.ok(first.indexOf('Walk to') < first.indexOf('result-card'));

    const last = drawTram(render, 'kifisia', 'neo-faliro').html;
    assert.match(spoken(last), /Walk to Neo Faliro about 7 minutes/);
    assert.ok(last.indexOf('Walk to') > last.indexOf('result-card'));

    const middle = drawTram(render, 'kifisia', 'evangelistria').html;
    assert.match(spoken(middle), /Transfer at Faliro[^]*Walk to Gipedo Karaiskaki about 3 minutes[^]*At Gipedo Karaiskaki:/);
});

test('a walk first is said to screen readers too', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { plans, now } = planTrip(network, 'syntagma', 'zappeio', NOON);
    assert.match(render.routeSummary(network, plans, now), /Option 1: Walk to Syntagma \(tram\), about 4 minutes\. T6 toward Pikrodafni, in \d+ minutes\./);
});

test('a tram leg says trams and, in Greek, «στάσεις»; a metro leg stays as it was', async () => {
    // 00:30 on a Thursday: the last T6 toward Syntagma, from Wednesday night
    const night = athensNow(new Date('2026-10-21T21:30:00Z'));
    const [en, el] = await Promise.all(['en', 'el'].map(lang => browserModule('tools/subway/client/render.js', lang)));
    const english = spoken(drawTram(en, 'fix', 'zappeio', night).html);
    assert.match(english, /Last tram/);
    assert.doesNotMatch(english, /Last train/);
    assert.match(spoken(drawTram(el, 'edem', 'zappeio').html), /\d+ στάσεις/);
    assert.match(spoken(drawTram(el, 'kifisia', 'zappeio').html), /\d+ σταθμοί[^]*\d+ στάσ/);
});

test('a tram leg with nothing more today says trams', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { plans, now } = planTrip(network, 'zappeio', 'fix', NOON);
    const stopped = { ...plans[0], arrives: null, legs: plans[0].legs.map(leg => ({ ...leg, departures: [] })) };
    assert.match(String(render.renderResult(network, [stopped], now, { expired: false, to: 'fix' })), /No more trams today/);
});

test('two stops a short walk apart are one message, not a route', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    assert.equal(render.walkOnly(8), 'These two are a short walk apart: about 8 minutes.');
    assert.match(String(render.renderWalkOnly(8)), /notice-info[^]*about 8 minutes/);
});

test('each line, the tram\'s too, has its strip under a leg\'s stations', () => {
    const css = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
    for (const id of Object.keys(network.lines)) assert.ok(css.includes(`.strip-${id.toLowerCase()} {`), id);
});

test('a trip by suburban train: its line toward where the train ends, as signed, no train diagram, the ticket it needs, its walks\' notes, and nothing of where its times are from', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { plans, now, tomorrow } = planTrip(suburban, 'megara', 'syntagma', NOON);
    const html = String(render.renderResult(suburban, plans.slice(0, 1), now, { expired: false, tomorrow, from: 'megara', to: 'syntagma' }));
    const text = spoken(html).replace(/\s+/g, ' ');
    // Toward Piraeus, not "Piraeus (suburban)", as the station list tells the two apart
    assert.match(html, /<span class="line-pill pill-l line-a4">A4<\/span>\s*<span class="direction-text"><span aria-hidden="true">→ <\/span><span class="sr-only">toward <\/span><span class="station-sign sign-m">Piraeus<\/span>/);
    assert.match(text, /Needs a Hellenic Train ticket, as OASA's ticket doesn't cover Megara\./);
    assert.match(text, /Walk to Larissa Station about 4 minutes/);
    // The M2's card has its train diagram, the A4's none; the suburban stations aren't links
    assert.equal((html.match(/class="train-diagram/g) ?? []).length, 1);
    assert.match(html, /At Megara:/);
    assert.match(html, /Transfer at <strong>Athens<\/strong>/);
    assert.match(html, /<a href="\/subway\/stations\/larissa-station">Larissa Station<\/a>/);
    assert.doesNotMatch(html, /railway\.gov\.gr/, 'credited on the About page, not under the answer (decision 43)');
    assert.match(render.routeSummary(suburban, plans, now, tomorrow), /A4 toward Piraeus/);
    // From Piraeus's suburban station, the walk to the metro says it isn't signed; a metro trip doesn't mention the railway
    const fromPiraeus = planTrip(suburban, 'piraeus-suburban', 'monastiraki', NOON);
    const walk = spoken(String(render.renderResult(suburban, fromPiraeus.plans, fromPiraeus.now, { expired: false, from: 'piraeus-suburban', to: 'monastiraki' })));
    assert.match(walk.replace(/\s+/g, ' '), /Walk to Piraeus about 4 minutes The suburban railway’s station isn’t in the metro’s building: about 2 minutes on foot, across a busy road, with no signs\./);
    assert.doesNotMatch(walk, /railway\.gov\.gr/);
});

test('in Greek, the footbridge at SKA and the ticket beyond it', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'el');
    const { plans, now } = planTrip(suburban, 'ano-liosia', 'chalkida', NOON);
    const text = spoken(String(render.renderResult(suburban, plans.slice(0, 1), now, { expired: false, from: 'ano-liosia', to: 'chalkida' }))).replace(/\s+/g, ' ');
    assert.match(text, /Περπάτημα ως Σιδηροδρομικό Κέντρο Αχαρνών περίπου 6 λεπτά Οι δύο σταθμοί του ΣΚΑ ενώνονται μόνο με μια στενή πεζογέφυρα/);
    assert.match(text, /A3 προς Χαλκίδα/);
    assert.match(text, /δεν καλύπτει τον σταθμό Χαλκίδα\./);
    assert.doesNotMatch(text, /railway\.gov\.gr/);
});
