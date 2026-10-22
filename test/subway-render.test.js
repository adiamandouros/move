import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { athensNow, planTrip } from '../tools/subway/client/network.js';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, spoken } from './support/markup.js';

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
            assert.deepEqual(markupProblems(`<p>${render.routeSummary(rail, plans, now, tomorrow)}</p>`, { keys }), []);
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
    assert.match(text, /M3 toward Doukissis \/ Airport/);
    assert.match(text, /In\s*\d+ minutes/);
    assert.match(text, /Exit at Airport/);
    assert.equal((html.match(/<h2\b/g) ?? []).length, 1, 'one heading for the one leg');
    assert.match(html, /class="train-diagram|train-car/);
    assert.doesNotMatch(html, /tomorrow-notice|timetable-notice/);
});

test('a change of line: two legs, where to change, and a heading per option', async () => {
    const render = await browserModule('tools/subway/client/render.js', 'en');
    const { trip, html } = draw(render, TRIPS['a change of line']);
    const text = spoken(html).replace(/\s+/g, ' ');
    assert.ok(trip.plans.every(p => p.legs.length === 2));
    assert.match(text, /Option 1 · Transfer at \w+/);
    assert.match(html, /transfer-connector/);
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
    assert.match(summary(TRIPS['a direct trip']), /^M3 toward Doukissis \/ Airport, in \d+ minutes\.$/);
    assert.match(summary(TRIPS['tomorrow\'s first trains']), /^No more trains today\. These are tomorrow's first trains\. M3 toward Doukissis \/ Airport, at 0[5-7]:\d\d\.$/);
    assert.equal(render.routeSummary(rail, [], NOON), String(render.renderResult(rail, [], NOON, {})).replace(/<[^>]+>/g, ''));
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
