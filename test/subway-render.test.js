import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { athensNow, planTrip } from '../tools/subway/client/network.js';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, spoken } from './support/markup.js';
import { clockTime } from '../public/js/core/metro.js';

// What the subway page draws for a trip (tools/subway/client/render.js), in
// the real network at different times: a direct trip, a change of line,
// tomorrow's first trains, an old timetable and no route. Each state is also
// checked for accessibility and for strings shown as their keys.

const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
const NOON = athensNow(new Date('2026-10-21T09:00:00Z')); // Wednesday 12:00 in Athens
const LATE = athensNow(new Date('2026-10-14T20:55:00Z')); // Wednesday 23:55

// [from, to, now, options]
const TRIPS = {
    'a direct trip': ['syntagma', 'airport', NOON],
    'a change of line': ['kifisia', 'aigaleo', NOON],
    'tomorrow\'s first trains': ['syntagma', 'airport', LATE],
    'an old timetable': ['omonia', 'piraeus', NOON, { expired: true }],
    // Three options, 4 and 6 minutes after the first
    'a slower option': ['kifisia', 'syntagma', NOON],
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
    test(`${lang}: no route, and other messages`, () => {
        assert.deepEqual(markupProblems(render.renderResult(rail, [], NOON, { expired: false }), { keys }), []);
        assert.deepEqual(markupProblems(render.renderMessage('subway.same-station'), { keys }), []);
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
    // Under the results, what the trains show, open: this one has a way out and a lift
    assert.match(html, /<details class="diagram-legend" open>\s*<summary>What the train shows<\/summary>/);
    assert.match(text, /Ride in this part of the train[^]*The way up from the platform[^]*An elevator/);
    assert.doesNotMatch(text, /An escalator up|Stairs/);
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
    assert.match(spoken(english.html), /No more trains today\. These are tomorrow's first trains\./);
    assert.match(spoken(english.html), /At\s*0[5-7]:\d\d/);
    assert.match(spoken(draw(el, TRIPS['tomorrow\'s first trains']).html).replace(/\s+/g, ' '), /πρώτα δρομολόγια της επόμενης ημέρας[\s\S]*Στις\s*0[5-7]:\d\d/);
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
        '<span class="schedule-chip"><span aria-hidden="true">12\'</span><span class="sr-only">12 minutes,</span></span>');
    assert.equal(String(departureChip({ departs: 5.5 * 3600 + 120, isLast: true }, now, true)),
        '<span class="schedule-chip schedule-chip--last" title="Last train">05:32<span class="sr-only"> (Last train),</span></span>');
    const secondLast = String(departureChip({ departs: now.seconds + 5 * 60, isSecondLast: true }, now, false));
    assert.match(secondLast, /class="schedule-chip schedule-chip--second-last" title="Second to last train"/);
    assert.equal(spoken(secondLast), '5 minutes (Second to last train),');
    // A train that's already due: 0, never less
    assert.match(String(departureChip({ departs: now.seconds - 30 }, now, false)), />0'</);
});

test('the one-sentence summary for screen readers', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const summary = trip => { const { plans, now, tomorrow } = draw(render, trip).trip; return render.routeSummary(rail, plans, now, tomorrow); };
    assert.match(summary(TRIPS['a direct trip']), /^M3 toward Airport, in \d+ minutes\. Arrive about \d\d:\d\d, \d+ minutes\.$/);
    assert.match(summary(TRIPS['tomorrow\'s first trains']), /^No more trains today\. These are tomorrow's first trains\. M3 toward Airport, at 0[5-7]:\d\d\. Arrive about 0[6-8]:\d\d, \d+ minutes\.$/);
    assert.equal(render.routeSummary(rail, [], NOON), String(render.renderResult(rail, [], NOON, {})).replace(/<[^>]+>/g, ''));
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
        const via = rail.stations[plan.via].name.en;
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
    assert.equal(spoken(direct.html).match(/\d+ min\b/g), null);
    // With a change, each card still says how long its own ride is
    trip.plans.forEach(plan => plan.legs.forEach(({ departures: [train] }) =>
        assert.match(spoken(html).replace(/\s+/g, ' '), new RegExp(`, ${Math.round((train.arrives - train.departs) / 60)} min · \\d+ stops`))));

    const greek = await browserModule('tools/subway/client/render.js', 'el');
    assert.match(spoken(draw(greek, TRIPS['a change of line']).html), /Επιλογή 1, Μέσω \S+, Άφιξη περίπου \d\d:\d\d · \d+ λεπτά/);
    assert.match(spoken(draw(greek, TRIPS['a direct trip']).html), /^\s*Χωρίς αλλαγή, Άφιξη περίπου/);
});

test('each card says how many stops the ride is, on the right, with or without a change', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    // Syntagma to the Airport: 15 stops on M3, said after where to get off
    const direct = draw(render, TRIPS['a direct trip']);
    const [leg] = direct.trip.plans[0].legs;
    assert.equal(leg.toIndex - leg.fromIndex, 15);
    assert.match(direct.html, /<span class="leg-ride">15 stops<\/span>/);
    assert.match(spoken(direct.html).replace(/\s+/g, ' '), /Exit at Airport, 15 stops Doors open on the left/);
    // The Airport's central platform: on a line of its own, under that one
    assert.match(direct.html, /<span class="leg-ride">15 stops<\/span>\s*<\/div>\s*<p class="leg-doors text-center mb-3"><span class="central-platform-badge">/);
    // One stop: singular, in both languages
    const one = { fromIndex: 4, toIndex: 5 };
    assert.equal(render.stopCount(one), '1 stop');
    assert.equal(render.stopCount({ fromIndex: 4, toIndex: 7 }), '3 stops');
    const greek = await browserModule('tools/subway/client/render.js', 'el');
    assert.equal(greek.stopCount(one), '1 σταθμός');
    assert.equal(greek.stopCount({ fromIndex: 4, toIndex: 7 }), '3 σταθμοί');
    // With a change: each leg's own minutes, then its stops
    const change = draw(render, TRIPS['a change of line']);
    change.trip.plans.forEach(plan => plan.legs.forEach(leg => {
        const minutes = Math.round((leg.departures[0].arrives - leg.departures[0].departs) / 60);
        assert.ok(change.html.includes(`<span class="leg-ride">${minutes} min · ${leg.toIndex - leg.fromIndex} stops</span>`));
    }));
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
    assert.match(summary, /<span class="route-show">Show route<\/span><span class="route-hide">Hide route<\/span> · 6 min slower<\/summary>$/);
    assert.equal((details[0][2].match(/class="card result-card"/g) ?? []).length, trip.plans[2].legs.length);
    assert.match(html, /<\/h2><details class="route-details"/);
    // The user opened it: open on the next refresh too
    const opened = String(render.renderResult(rail, trip.plans, trip.now, { expired: false, open: { [render.routeKey(trip.plans[2])]: true } }));
    assert.match(opened, /<details class="route-details" data-route="[^"]+" open>/);

    const greek = await browserModule('tools/subway/client/render.js', 'el');
    assert.match(spoken(draw(greek, TRIPS['a slower option']).html), /Εμφάνιση διαδρομής\s*Απόκρυψη διαδρομής · 6 λεπτά πιο αργή/);
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

    const el = await browserModule('tools/subway/client/render.js', 'el');
    const greek = draw(el, TRIPS['a direct trip']).html;
    assert.match(greek, /<p class="leg-boarding">Στον σταθμό <a href="\/el\/subway\/stations\/syntagma">Σύνταγμα<\/a>:<\/p>/);
    // Short enough to stay on one line with the ride time on a phone
    const change = draw(el, TRIPS['a change of line']).html;
    assert.match(change, new RegExp(`Ανταπόκριση σε <strong><a href="/el/subway/stations/${trip.plans[0].legs[0].to}">`));
});

test('same station and no route: shown in the warnings\' yellow, not light grey', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    for (const html of [String(render.renderMessage('subway.same-station')), String(render.renderResult(rail, [], NOON, {}))]) {
        assert.match(html, /^<p class="subway-message mt-3"><svg [^]*<\/svg>/);
        assert.doesNotMatch(html, /text-body-secondary/);
    }
});
