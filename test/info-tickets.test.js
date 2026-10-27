import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';

// The Info page's Tickets section: paying by bank card without a ticket, and
// the passes (prices checked by hand on oasa.gr, see info-facts.test.js)

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

for (const [path, noTicket, caption, days] of [
    ['/info', '<strong>No ticket needed:</strong> tap a contactless', 'Pass prices', 'days'],
    ['/el/info', '<strong>Χωρίς εισιτήριο:</strong> ακουμπήστε μια ανέπαφη', 'Τιμές καρτών απεριορίστων διαδρομών', 'ημερών'],
]) {
    test(`${path}: a bank card on the validator needs no ticket, said before the prices`, () => {
        const html = section(path);
        const at = html.indexOf(noTicket);
        assert.ok(at > 0, 'the no-ticket paragraph is there');
        assert.ok(at < html.indexOf('<table'), 'and comes before the first table');
        assert.match(html.slice(at + noTicket.length), /^[^<]*4[.,]10/, 'with the daily cap');
    });

    test(`${path}: the 30, 90, 180 and 365-day passes, full and reduced`, () => {
        assert.deepEqual(rows(section(path), caption), [
            [`30 ${days}`, '€27.00', '€13.50'],
            [`90 ${days}`, '€78.00', '€39.00'],
            [`180 ${days}`, '€155.00', '€77.50'],
            [`365 ${days}`, '€300.00', '€150.00'],
        ]);
        assert.match(section(path), /ATH\.ENA/);
    });
}
