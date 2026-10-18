import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markupProblems } from './support/markup.js';

// The accessibility checks other tests rely on (support/markup.js) must
// catch what they're for; a check that passes everything would hide bugs.

const keys = ['buses.minutes', 'shell.new-tab'];
const flags = (html, expected) => assert.ok(markupProblems(html, { keys }).some(p => expected.test(p)), `${expected} for ${html}`);

test('good markup has no problems', () => {
    assert.deepEqual(markupProblems(`
        <h2>Stop</h2><h3>Line</h3>
        <button aria-controls="x" type="button">Open</button><div id="x"></div>
        <a href="/">Home</a> <a href="https://x" target="_blank">OASA<span class="sr-only"> (opens in a new tab)</span></a>
        <svg class="bi" aria-hidden="true"></svg> <img src="a.png" alt="">`, { keys }), []);
});

test('each problem is caught', () => {
    flags('<h2>a</h2><h4>b</h4>', /<h4> follows <h2>/);
    flags('<button type="button"><svg class="bi" aria-hidden="true"></svg></button>', /has no text or aria-label/);
    flags('<a href="/"></a>', /has no text or aria-label/);
    flags('<svg class="bi spin"></svg>', /needs aria-hidden/);
    flags('<img src="a.png">', /needs alt/);
    flags('<a href="https://x" target="_blank">OASA</a>', /opens a new tab without saying so/);
    flags('<span id="a"></span><span id="a"></span>', /duplicate id "a"/);
    flags('<button aria-controls="gone">x</button>', /nothing has id="gone"/);
    flags('<input id="q">', /has no label/);
    flags('<div tabindex="2"></div>', /positive tabindex/);
    flags('<span>3 buses.minutes</span>', /"buses\.minutes" shown instead of its text/);
    flags('<a href="/" aria-label="shell.new-tab">x</a>', /"shell\.new-tab" shown/);
});
