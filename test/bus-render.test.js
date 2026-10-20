import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, spoken } from './support/markup.js';

// What the bus page draws for a stop in every state, in both languages
// (tools/buses/client/render.js): a stop's row, its next bus or why there's
// none, its minutes badge, and its list of arrivals. Each is also checked
// for accessibility, and for strings shown as their keys.

const stop = { code: '10361', name: { el: 'ΣΥΝΤΑΓΜΑ', en: 'SYNTAGMA' }, lat: 37.97491, lng: 23.73488, meters: 86, lines: ['040', 'Χ95'] };
const arrivals = [
    { line: 'Χ95', to: { el: 'ΣΥΝΤΑΓΜΑ - ΑΕΡΟΔΡΟΜΙΟ', en: 'SYNTAGMA - AIRPORT' }, minutes: 2 },
    { line: '040', to: { el: 'ΠΕΙΡΑΙΑΣ', en: 'PIRAEUS' }, minutes: 7 },
    { line: null, to: null, minutes: 15 },
];
const STATES = {
    'no answer yet': undefined,
    'buses on the way': { arrivals },
    'no buses': { arrivals: [] },
    'unavailable': { arrivals: [], unavailable: true },
};

for (const lang of ['en', 'el']) {
    const render = await browserModule('tools/buses/client/render.js', lang);
    const keys = Object.keys(strings(lang));
    const check = html => assert.deepEqual(markupProblems(html, { keys }), []);

    for (const [state, result] of Object.entries(STATES)) {
        test(`${lang}: a stop with ${state} is accessible and fully translated`, () => {
            check(render.stopItem(stop, 0));
            check(`<button type="button">${render.nextBus(result)}</button>`);
            check(render.headerBadge(result));
            check(`<ul>${render.arrivalRows(result)}</ul>`);
        });
    }
}

test('the stop row: name, code, distance, directions in a new tab, lines', async () => {
    const { stopItem } = await browserModule('tools/buses/client/render.js', 'en');
    const html = String(stopItem({ ...stop, meters: 1530 }, 3));
    assert.match(html, /data-stop="10361"/);
    assert.match(html, /aria-controls="stop-3"/);
    assert.match(html, /aria-expanded="false"/);
    // The code tells same-named stops apart, as on the stop's sign
    assert.match(spoken(html.match(/<button[^]*?<\/button>/)[0]), /^SYNTAGMA\s*, stop code 10361\s*,\s*1\.5 km/);
    // The signpost: named by its hidden text, which says it opens a new tab
    assert.equal(spoken(html.match(/<a [^>]*class="directions-btn[^]*?<\/a>/)[0]), 'Walking directions to SYNTAGMA (opens in a new tab)');
    assert.match(html, /<a href="[^"]+" class="directions-btn [^"]*" target="_blank" rel="noopener">/);
    assert.match(html, /destination=37\.97491,23\.73488&amp;travelmode=walking/);
    // Each line links to its stops, in the page's language
    assert.match(html, /Lines: <a href="\/buses\?line=040" data-view>040<\/a>, <a href="\/buses\?line=%CE%A795" data-view>Χ95<\/a>/);
    assert.match(String((await browserModule('tools/buses/client/render.js', 'el')).stopItem(stop, 0)), /href="\/el\/buses\?line=040"/);
    assert.match(String((await browserModule('tools/buses/client/render.js', 'el')).stopItem(stop, 0)), /ΣΥΝΤΑΓΜΑ/);
});

test('the next bus, as a screen reader hears the stop button', async () => {
    const en = await browserModule('tools/buses/client/render.js', 'en');
    const el = await browserModule('tools/buses/client/render.js', 'el');
    assert.equal(spoken(en.nextBus({ arrivals })).replace(/\s+/g, ' '), '. Next bus: line Χ95, SYNTAGMA - AIRPORT, 2 minutes');
    assert.equal(spoken(el.nextBus({ arrivals })).replace(/\s+/g, ' '), '. Επόμενο λεωφορείο: γραμμή Χ95, ΣΥΝΤΑΓΜΑ - ΑΕΡΟΔΡΟΜΙΟ, 2 λεπτά');
    assert.equal(spoken(en.nextBus({ arrivals: [] })), '. No arrivals');
    assert.match(spoken(en.nextBus({ arrivals: [], unavailable: true })), /unavailable/i);
    assert.match(String(en.nextBus(undefined)), /class="bi[^"]* spin"/);
    // A line's stop nobody opened isn't asked for: no spinner, but how to get its times
    assert.equal(spoken(en.nextBus(undefined, { waiting: false })), '. Open for live times');
    assert.doesNotMatch(String(en.nextBus(undefined, { waiting: false })), /spin/);
});

test('the minutes badge: colour by how soon, short on screen, in full for screen readers, in the page\'s language', async () => {
    const en = await browserModule('tools/buses/client/render.js', 'en');
    const el = await browserModule('tools/buses/client/render.js', 'el');
    const badge = (r, m) => String(r.headerBadge({ arrivals: [{ line: '1', minutes: m }] }));
    assert.match(badge(en, 3), /arrival-soon/);
    assert.match(badge(en, 4), /arrival-close/);
    assert.match(badge(en, 8), /arrival-close/);
    assert.match(badge(en, 9), /arrival-later/);
    assert.match(badge(en, 9), /<span aria-hidden="true">9 min<\/span><span class="sr-only">9 minutes<\/span>/);
    assert.match(badge(el, 9), /<span aria-hidden="true">9 λεπ\.<\/span><span class="sr-only">9 λεπτά<\/span>/);
    assert.match(badge(en, 2), /<span class="sr-only">2 minutes, arriving soon<\/span>/);
    assert.equal(String(en.headerBadge({ arrivals: [] })), '');
});

test('one arrival: line, destination and minutes, as a screen reader hears it', async () => {
    const el = await browserModule('tools/buses/client/render.js', 'el');
    const row = String(el.arrivalRow(arrivals[1]));
    assert.match(row, /^\s*<li class="arrival-row /);
    assert.match(row, /arrival-close/);
    assert.equal(spoken(row).replace(/\s+/g, ' '), 'Γραμμή 040 , ΠΕΙΡΑΙΑΣ, 7 λεπτά');
});

test('every arrival is listed; an unknown line or destination says so', async () => {
    const { arrivalRows } = await browserModule('tools/buses/client/render.js', 'en');
    const html = String(arrivalRows({ arrivals }));
    assert.equal((html.match(/class="arrival-row/g) ?? []).length, 3);
    assert.match(spoken(html), /\?/);
    assert.match(html, /Unknown line|unknown/i);
    assert.match(String(arrivalRows({ arrivals: [], unavailable: true })), /unavailable/i);
    assert.equal(String(arrivalRows(undefined)), '');
});

test('names from OASA and what was typed are escaped', async () => {
    const { arrivalRows, lineHeader, searchResults, searchStatus, stopItem } = await browserModule('tools/buses/client/render.js', 'en');
    const evil = { line: '<b>', name: { el: '<img src=x onerror=alert(1)>', en: '<img src=x onerror=alert(1)>' }, directions: [{ to: { el: '<b>', en: '<b>' }, stops: [] }, { to: { el: '<img src=x>', en: '<img src=x>' }, stops: [] }] };
    const html = String(arrivalRows({ arrivals: [{ line: '<b>', to: { en: '<img src=x onerror=alert(1)>' }, minutes: 1 }] }))
        + String(stopItem({ ...stop, name: { en: 'A & <B>' }, lines: ['<b>'] }, 0))
        + String(searchResults([evil], [{ ...stop, name: { en: 'A & <B>' }, lines: ['<b>'] }], 20))
        + String(lineHeader(evil, 0));
    assert.doesNotMatch(html, /<img|<b>/);
    assert.match(html, /&lt;img src=x/);
    assert.match(html, /A &amp; &lt;B&gt;/);
    // In an address too
    assert.match(html, /\?line=%3Cb%3E/);
    // The status line is text (textContent), never HTML
    assert.equal(searchStatus('<b>', [], []), 'No stop or line matches “<b>”.');
});

test('a stop row without a location has no distance; opened and nearest when asked', async () => {
    const { stopItem } = await browserModule('tools/buses/client/render.js', 'en');
    const somewhere = { ...stop, meters: undefined };
    const plain = String(stopItem(somewhere, 0));
    assert.match(spoken(plain.match(/<button[^]*?<\/button>/)[0]), /^SYNTAGMA\s*, stop code 10361\s*\.?/);
    assert.doesNotMatch(plain, / m<|km/);
    const opened = String(stopItem(somewhere, 0, { open: true, nearest: true }));
    assert.match(opened, /aria-expanded="true"/);
    assert.match(opened, /class="accordion-collapse collapse show"/);
    assert.doesNotMatch(opened, /stop-toggle collapsed/);
    assert.match(opened, /stop-item stop-nearest/);
    assert.match(spoken(opened.match(/<button[^]*?<\/button>/)[0]), /stop code 10361\s*,\s*Nearest to you/);
});

const line = {
    line: '040', name: { el: 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ', en: 'PEIRAIAS - SYNTAGMA' },
    directions: [{ to: { el: 'ΠΕΙΡΑΙΑΣ', en: 'PEIRAIAS' }, stops: ['10341', '1'] }, { to: { el: 'ΣΥΝΤΑΓΜΑ', en: 'SYNTAGMA' }, stops: ['1', '10341'] }],
};
const circular = { line: 'Κ1', name: { el: 'ΚΥΚΛΟΣ', en: 'KYKLOS' }, directions: [{ to: { el: 'ΚΥΚΛΟΣ', en: 'KYKLOS' }, stops: ['5', '6'] }] };

for (const lang of ['en', 'el']) {
    test(`${lang}: search results, the line header and the way back are accessible and fully translated`, async () => {
        const render = await browserModule('tools/buses/client/render.js', lang);
        const keys = Object.keys(strings(lang));
        const check = html => assert.deepEqual(markupProblems(String(html), { keys }), []);
        check(render.searchResults([line, circular], [stop, { ...stop, code: '10341', meters: undefined }], 20));
        check(render.searchResults([], [stop, stop, stop], 2));
        check(render.lineHeader(line, 1));
        check(render.lineHeader(circular, 0));
        check(render.backLink());
    });
}

test('a found stop says its name, code, distance and lines, all in its link', async () => {
    const { stopResult } = await browserModule('tools/buses/client/render.js', 'en');
    const html = String(stopResult(stop));
    assert.match(html, /<a class="[^"]*search-result" href="\/buses\?stop=10361" data-view>/);
    assert.equal(spoken(html).replace(/\s+/g, ' ').trim(), 'SYNTAGMA , stop code 10361 , 86 m , Lines: 040, Χ95');
    const somewhere = { ...stop, meters: undefined };
    assert.equal(spoken(String(stopResult(somewhere))).replace(/\s+/g, ' ').trim(), 'SYNTAGMA , stop code 10361 , Lines: 040, Χ95');
});

test('a found line: its number and its name in the page\'s language', async () => {
    const en = await browserModule('tools/buses/client/render.js', 'en');
    const el = await browserModule('tools/buses/client/render.js', 'el');
    const html = String(en.lineResult(line));
    assert.match(html, /href="\/buses\?line=040"/);
    assert.equal(spoken(html).replace(/\s+/g, ' ').trim(), 'Line 040, PEIRAIAS - SYNTAGMA');
    assert.equal(spoken(String(el.lineResult(line))).replace(/\s+/g, ' ').trim(), 'Γραμμή 040, ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ');
    assert.match(String(el.lineResult(line)), /href="\/el\/buses\?line=040"/);
});

test('results: lines, then the first stops, and a button for more', async () => {
    const { searchResults } = await browserModule('tools/buses/client/render.js', 'en');
    const html = String(searchResults([line], [stop, stop, stop], 2));
    assert.deepEqual([...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map(m => m[1]), ['Lines', 'Stops']);
    assert.equal(html.match(/\?stop=/g).length, 2);
    assert.match(html, /class="[^"]*more-results"[^>]*>Show more stops</);
    assert.doesNotMatch(String(searchResults([], [stop], 20)), /Lines<|more-results/);
});

test('what the search found, for the status line', async () => {
    const en = await browserModule('tools/buses/client/render.js', 'en');
    const el = await browserModule('tools/buses/client/render.js', 'el');
    assert.equal(en.searchStatus('040', [line], [stop, stop]), 'Lines: 1 · Stops: 2');
    assert.equal(en.searchStatus('x', [], [stop]), 'Stops: 1');
    assert.equal(en.searchStatus(' zzz ', [], []), 'No stop or line matches “zzz”.');
    assert.equal(el.searchStatus('zzz', [], []), 'Καμία στάση ή γραμμή δεν ταιριάζει με «zzz».');
});

test('the line header: back, the line, and a switch between its two directions', async () => {
    const { lineHeader } = await browserModule('tools/buses/client/render.js', 'en');
    const html = String(lineHeader(line, 1));
    assert.match(html, /<a class="[^"]*back-link" href="\/buses" data-view>/);
    assert.match(html, /<h2 class="line-heading[^"]*" tabindex="-1">/);
    assert.match(html, /role="group" aria-label="Direction"/);
    assert.deepEqual([...html.matchAll(/data-direction="(\d)" aria-pressed="(\w+)">([^]*?)<\/button>/g)].map(m => [m[1], m[2], spoken(m[3])]), [['0', 'false', 'To PEIRAIAS'], ['1', 'true', 'To SYNTAGMA']]);
    // A circular line has one direction: no switch
    const one = String(lineHeader(circular, 0));
    assert.doesNotMatch(one, /data-direction/);
    assert.match(spoken(one), /To KYKLOS/);
});

