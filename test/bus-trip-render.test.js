import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule, strings } from './support/browser-modules.js';
import { markupProblems, spoken } from './support/markup.js';

// What the trip finder draws (tools/buses/client/trip-render.js), in both
// languages: its addresses, the places found, the header, an option in each
// state, and no trip at all. Each is checked for accessibility, and for
// strings shown as their keys.

const stop = (code, en, meters) => ({ code, name: { el: en.toUpperCase(), en }, lat: 37.97, lng: 23.73, lines: ['040'], meters });
const option = {
    line: 'Χ95', direction: 0, to: { el: 'ΑΕΡΟΔΡΟΜΙΟ', en: 'AIRPORT' }, route: '2051',
    board: stop('10361', 'SYNTAGMA', 230), alight: stop('10705', 'AIR TERMINAL', 120), stops: 18,
};
const station = { key: 'station:airport', name: { el: 'Αεροδρόμιο', en: 'Airport' }, lat: 37.93, lng: 23.94, lines: [{ id: 'M3', name: 'M3' }] };
const place = { key: '10183', code: '10183', name: { el: 'ΠΕΙΡΑΙΑΣ', en: 'PEIRAIAS' }, lat: 37.93, lng: 23.63 };
// 12:00 in Athens
const NOON = 12 * 3600;

for (const lang of ['en', 'el']) {
    const r = await browserModule('tools/buses/client/trip-render.js', lang);
    const keys = Object.keys(strings(lang));
    const check = html => assert.deepEqual(markupProblems(String(html), { keys }), []);
    const prefix = lang === 'el' ? '/el' : '';

    test(`${lang}: the finder's addresses keep what's chosen`, () => {
        assert.equal(r.tripHref(), `${prefix}/buses?trip=`);
        assert.equal(r.tripHref({ to: 'station:airport', from: '10361' }), `${prefix}/buses?trip=&to=station%3Aairport&from=10361`);
        assert.equal(r.tripHref({ to: '10183', pick: 'from' }), `${prefix}/buses?trip=&to=10183&pick=from`);
    });

    test(`${lang}: places found, a station with its lines and a stop with its code, each a link`, () => {
        const html = r.placeResults({ stations: [station], stops: [stop('10183', 'PEIRAIAS', 1200)], href: key => r.tripHref({ to: key }) });
        check(html);
        assert.match(String(html), /class="line-pill pill-s line-m3">M3</);
        assert.match(String(html), /href="[^"]*to=station%3Aairport"/);
        assert.match(spoken(html), /10183/);
        assert.equal(String(r.placeResults({ stations: [], stops: [], href: () => '' })).trim(), '');
    });

    test(`${lang}: what was found, in words`, () => {
        assert.match(r.placeStatus('zz', 0, 0), /zz/);
        assert.equal(r.placeStatus('air', 1, 2), lang === 'en' ? 'Stations: 1 · Stops: 2' : 'Σταθμοί: 1 · Στάσεις: 2');
    });

    test(`${lang}: the header, from your location or a stop, saying the finder is a beta`, () => {
        check(r.tripHeader(station, null, r.tripHref()));
        assert.match(spoken(r.tripHeader(station, null, r.tripHref())), lang === 'en' ? /This is a beta/ : /Δοκιμαστική έκδοση/);
        check(r.betaTag());
        const fromStop = r.tripHeader(place, stop('10361', 'SYNTAGMA'), r.tripHref({ from: '10361' }));
        check(fromStop);
        assert.match(spoken(fromStop), /SYNTAGMA/);
    });

    test(`${lang}: an option with buses: the walk, the minutes, when you're off it or that it isn't predicted yet`, () => {
        const html = r.tripOption(option, [
            { vehicle: '1', minutes: 4, ride: 38, arrives: 42 },
            { vehicle: '2', minutes: 19, ride: null, arrives: null },
        ], { waiting: false, unavailable: false, nowSeconds: NOON });
        check(html);
        const text = spoken(html);
        assert.match(text, /12:42/);
        assert.match(text, /38/);
        assert.match(text, lang === 'en' ? /~3 min walk to SYNTAGMA/ : /~3 λεπτά/);
        assert.match(text, lang === 'en' ? /Ride not predicted yet/ : /δεν προβλέπεται/);
        assert.match(text, lang === 'en' ? /18 stops · then ~2 min walk/ : /18 στάσεις/);
    });

    test(`${lang}: an option with no bus: waiting, none predicted, or live times down; a stop where you are`, () => {
        const here = { ...option, board: { ...option.board, meters: 10 }, alight: { ...option.alight, meters: 10 }, stops: 1 };
        for (const live of [{ waiting: true, unavailable: false }, { waiting: false, unavailable: false }, { waiting: false, unavailable: true }]) {
            check(r.tripOption(here, [], { ...live, nowSeconds: NOON }));
        }
        const text = spoken(r.tripOption(here, [], { waiting: false, unavailable: false, nowSeconds: NOON }));
        assert.match(text, lang === 'en' ? /Board at SYNTAGMA/ : /Επιβίβαση/);
        assert.doesNotMatch(text, lang === 'en' ? /then ~/ : /μετά ~/);
    });

    test(`${lang}: a time after midnight wraps around`, () => {
        const html = r.tripOption(option, [{ vehicle: '1', minutes: 4, ride: 20, arrives: 24 }], { waiting: false, unavailable: false, nowSeconds: 23 * 3600 + 50 * 60 });
        assert.match(spoken(html), /00:14/);
    });

    test(`${lang}: no trip: the Subway for a station, nothing more for a stop`, () => {
        check(r.noTrip(station));
        assert.match(String(r.noTrip(station)), new RegExp(`href="${prefix}/subway\\?to=airport"`));
        assert.doesNotMatch(String(r.noTrip(place)), /subway/);
    });
}
