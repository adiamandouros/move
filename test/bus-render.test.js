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

test('the stop row: name, distance, directions in a new tab, lines', async () => {
    const { stopItem } = await browserModule('tools/buses/client/render.js', 'en');
    const html = String(stopItem({ ...stop, meters: 1530 }, 3));
    assert.match(html, /data-stop="10361"/);
    assert.match(html, /aria-controls="stop-3"/);
    assert.match(spoken(html), /SYNTAGMA\s*,\s*1\.5 km/);
    // The signpost: named by its hidden text, which says it opens a new tab
    assert.equal(spoken(html.match(/<a [^>]*class="directions-btn[^]*?<\/a>/)[0]), 'Walking directions to SYNTAGMA (opens in a new tab)');
    assert.match(html, /<a href="[^"]+" class="directions-btn [^"]*" target="_blank" rel="noopener">/);
    assert.match(html, /destination=37\.97491,23\.73488&amp;travelmode=walking/);
    assert.match(html, /Lines: 040, Χ95/);
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

test('names from OASA are escaped', async () => {
    const { arrivalRows, stopItem } = await browserModule('tools/buses/client/render.js', 'en');
    const html = String(arrivalRows({ arrivals: [{ line: '<b>', to: { en: '<img src=x onerror=alert(1)>' }, minutes: 1 }] }))
        + String(stopItem({ ...stop, name: { en: 'A & <B>' } }, 0));
    assert.doesNotMatch(html, /<img|<b>/);
    assert.match(html, /&lt;img src=x/);
    assert.match(html, /A &amp; &lt;B&gt;/);
});
