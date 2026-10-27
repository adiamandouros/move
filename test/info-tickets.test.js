import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { euro, fares, tripsFor } from '../server/pages/fares.js';
import { renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';

// The Info page's Tickets section: paying by bank card without a ticket, and
// the passes. The prices are typed once, in the info tool's data.json
// "fares" (checked by hand on oasa.gr, see info-facts.test.js), and
// server/pages/fares.js works out the rest

const info = loadTools().find(t => t.id === 'info');
const { pages } = renderPages(loadTools());
const section = path => {
    const html = pages[path];
    const start = html.indexOf('id="sec-tickets"');
    return html.slice(start, html.indexOf('id="sec-airport"', start));
};
const rows = (html, caption) => {
    const table = html.slice(html.indexOf(`<caption class="sr-only">${caption}</caption>`));
    const body = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'));
    return [...body.matchAll(/<th scope="row">(.*?)<\/th><td>(.*?)<\/td><td>(.*?)<\/td>/g)].map(m => m.slice(1));
};

test('prices as each language writes them', () => {
    assert.equal(euro(1.2, 'en'), '€1.20');
    assert.equal(euro(1.2, 'el'), '€1,20');
    assert.equal(euro(27, 'en'), '€27.00');
    assert.equal(euro(27, 'en', false), '€27');
    assert.equal(euro(77.5, 'el', false), '€77,50');
});

test('a pass pays off from the fewest trips that cost at least as much', () => {
    assert.equal(tripsFor(27, 1.2), 23); // 22.5 trips
    assert.equal(tripsFor(13.5, 0.5), 27); // exactly 27: the same price, so from there
    assert.equal(tripsFor(155, 1.2), 130); // 129.17
    assert.equal(tripsFor(0.3, 0.1), 3); // not 4: 0.3 / 0.1 is 2.9999… in floating point
});

test('the page\'s prices, from data.json', () => {
    const data = {
        single: { price: 1.2, reduced: 0.5 },
        day: { price: 4.1 },
        fiveDays: { price: 8.2 },
        tourist: { price: 20 },
        packs: [{ trips: 2, price: 2.3, reduced: 1 }, { trips: 11, price: 12, reduced: 5 }],
        passes: [{ days: 30, price: 27, reduced: 13.5, withAirport: 45 }, { days: 365, price: 300, reduced: 150, withAirport: 446 }],
    };
    assert.deepEqual(fares(data, 'el'), {
        single: { price: '€1,20', reduced: '€0,50' },
        day: { price: '€4,10', reduced: '–' },
        fiveDays: { price: '€8,20', reduced: '–' },
        tourist: { price: '€20,00', reduced: '–' },
        packs: { price: '€2,30 / €12,00', reduced: '€1,00 / €5,00' },
        passes: [
            { days: 30, price: '€27,00', reduced: '€13,50', trips: 23, reducedTrips: 27 },
            { days: 365, price: '€300,00', reduced: '€150,00', trips: 250, reducedTrips: 300 },
        ],
        withAirport: '€45 / €446',
    });
});

test('the Tickets section types no price of its own: they all come from data.json', () => {
    const hbs = readFileSync('tools/info/page.hbs', 'utf8');
    const tickets = hbs.slice(hbs.indexOf('id="tickets"'), hbs.indexOf('id="airport"'));
    // The fines are the only ones, as nothing is worked out from them
    assert.deepEqual(tickets.match(/€\d+(?:[.,]\d+)?/g), ['€100', '€50', '€100', '€50']);
    assert.equal(info.data.fares.passes.length, 4);
});

for (const [path, lang, noTicket, caption, days, from] of [
    ['/info', 'en', '<strong>No ticket needed:</strong> tap a contactless', 'Pass prices', 'days', 'from'],
    ['/el/info', 'el', '<strong>Χωρίς εισιτήριο:</strong> ακουμπήστε μια ανέπαφη', 'Τιμές καρτών απεριορίστων διαδρομών', 'ημερών', 'από'],
]) {
    const trips = n => `<span class="info-pays-off">${from} ${n} ${lang === 'en' ? 'trips' : 'διαδρομές'}</span>`;

    test(`${path}: a bank card on the validator needs no ticket, said before the prices`, () => {
        const html = section(path);
        const at = html.indexOf(noTicket);
        assert.ok(at > 0, 'the no-ticket paragraph is there');
        assert.ok(at < html.indexOf('<table'), 'and comes before the first table');
        assert.match(html.slice(at + noTicket.length), new RegExp(`^[^<]*${euro(1.2, lang)}[^<]*${euro(4.1, lang)}`), 'with the fare and the daily cap');
    });

    test(`${path}: the 30, 90, 180 and 365-day passes, full and reduced, and from how many trips each pays off`, () => {
        const p = n => euro(n, lang);
        assert.deepEqual(rows(section(path), caption), [
            [`30 ${days}`, p(27) + trips(23), p(13.5) + trips(27)],
            [`90 ${days}`, p(78) + trips(65), p(39) + trips(78)],
            [`180 ${days}`, p(155) + trips(130), p(77.5) + trips(155)],
            [`365 ${days}`, p(300) + trips(250), p(150) + trips(300)],
        ]);
        assert.match(section(path), /ATH\.ENA/);
        assert.match(section(path), new RegExp(`${euro(45, lang, false)} / ${euro(129, lang, false)} / ${euro(228, lang, false)} / ${euro(446, lang, false)}`));
    });
}
