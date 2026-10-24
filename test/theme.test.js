import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import vm from 'node:vm';
import { BAR_COLOURS, CHOICES, FIRST_PAINT_SCRIPT, resolveTheme } from '../public/js/core/theme.js';
import { inlineScripts } from '../server/csp.js';
import { renderPages } from '../server/pages/index.js';

// The colour mode: Auto follows the phone but is dark unless the phone asks
// for light; Light and Dark are the person's choice. The colours themselves:
// accessibility.test.js. What a person does with the switch: test/browser/theme.spec.js.

test('auto is dark unless the phone asks for light; light and dark are the person\'s choice', () => {
    assert.equal(resolveTheme(null, false), 'dark');
    assert.equal(resolveTheme('auto', false), 'dark');
    assert.equal(resolveTheme(null, true), 'light');
    assert.equal(resolveTheme('auto', true), 'light');
    assert.equal(resolveTheme('light', false), 'light');
    assert.equal(resolveTheme('dark', true), 'dark');
    // Anything else stored is no choice
    assert.equal(resolveTheme('purple', false), 'dark');
    assert.equal(resolveTheme('purple', true), 'light');
    assert.deepEqual(CHOICES, ['auto', 'light', 'dark']);
});

// The script in <head> runs before the page is drawn, so it can't import resolveTheme: run it for every case
function firstPaint({ stored, phoneAsksLight, storageBlocked = false }) {
    const meta = { content: BAR_COLOURS.dark };
    const root = { dataset: { bsTheme: 'dark' } };
    vm.runInNewContext(FIRST_PAINT_SCRIPT, {
        document: { documentElement: root, querySelector: selector => selector === 'meta[name=theme-color]' ? meta : null },
        localStorage: { getItem: key => { if (storageBlocked) throw new Error('blocked'); return key === 'theme' ? stored : null; } },
        matchMedia: query => ({ matches: query === '(prefers-color-scheme: light)' && phoneAsksLight }),
    });
    return { theme: root.dataset.bsTheme, bar: meta.content };
}

test('the script before the first paint picks the same mode as resolveTheme', () => {
    for (const stored of [null, 'auto', 'light', 'dark', 'nonsense']) {
        for (const phoneAsksLight of [false, true]) {
            const theme = resolveTheme(stored, phoneAsksLight);
            assert.deepEqual(firstPaint({ stored, phoneAsksLight }), { theme, bar: BAR_COLOURS[theme] }, `${stored}, phone light: ${phoneAsksLight}`);
        }
    }
});

test('when storage is blocked the page stays dark', () => {
    assert.deepEqual(firstPaint({ storageBlocked: true, phoneAsksLight: true }), { theme: 'dark', bar: BAR_COLOURS.dark });
});

const { pages } = renderPages();

test('every page has the script, the bar colour, and the switch in the menu and the sidebar, in its language', () => {
    for (const [path, html] of Object.entries(pages)) {
        assert.ok(inlineScripts(html).includes(FIRST_PAINT_SCRIPT), `${path} runs the script`);
        assert.match(html, /<html [^>]*data-bs-theme="dark"/, `${path} starts dark`);
        assert.ok(html.indexOf('name="theme-color"') < html.indexOf(FIRST_PAINT_SCRIPT), `${path}: the script comes after the bar's colour`);
        assert.equal((html.match(/class="theme-switch"/g) ?? []).length, 2, `${path} has the switch in the sidebar and the menu`);
        for (const choice of CHOICES) assert.equal((html.match(new RegExp(`data-theme-choice="${choice}"`, 'g')) ?? []).length, 2, `${path}: ${choice}`);
    }
    assert.match(pages['/'], /aria-label="Colours"/);
    assert.match(pages['/el'], /aria-label="Χρώματα"/);
    assert.match(pages['/el'], />Αυτόματα</);
});

test('the switch is hidden until its script runs, and says nothing is chosen', () => {
    const html = pages['/'];
    assert.match(html, /class="theme-switch"[^>]*\shidden>/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 0);
});

test('the bar\'s colour in the page is the dark mode\'s', () => {
    assert.match(pages['/'], new RegExp(`<meta name="theme-color" content="${BAR_COLOURS.dark}">`));
});

test('the logo comes in both colours, and only the one that fits shows', () => {
    assert.match(pages['/'], /logo-on-dark[^>]*>.*?logo-on-light/s);
    const style = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
    assert.match(style, /\[data-bs-theme="light"\] \.logo-on-dark,\s*\[data-bs-theme="dark"\] \.logo-on-light\s*\{\s*display: none;/);
    const light = readFileSync(new URL('../public/icon/logo-light.svg', import.meta.url), 'utf8');
    assert.match(light, /#e89b00/);
    assert.doesNotMatch(light, /#ffc107/);
});

// Both modes define the same colours (the light block is the dark one's twin)
test('the light mode sets every colour the dark mode sets, and nothing else', () => {
    const style = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const names = mode => new Set([...style.match(new RegExp(`\\[data-bs-theme="${mode}"\\]\\s*\\{([^}]*)\\}`))[1].matchAll(/(--[\w-]+):/g)].map(m => m[1]));
    const [dark, light] = [names('dark'), names('light')];
    // Bootstrap's own link colours differ only where its blue isn't readable on the light page
    const extra = [...light].filter(name => !dark.has(name));
    assert.deepEqual(extra.sort(), ['--bs-link-color', '--bs-link-color-rgb', '--bs-link-hover-color', '--bs-link-hover-color-rgb']);
    assert.deepEqual([...dark].filter(name => !light.has(name)), []);
});

test('forced colours: pills, signs and maps keep their own colours, and the car to ride in is outlined', () => {
    const style = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
    const block = style.slice(style.indexOf('@media (forced-colors: active)'));
    assert.match(block, /\.line-pill,\s*\.station-sign,\s*\.metro-map\s*\{\s*forced-color-adjust: none;/);
    assert.match(block, /\.train-car\.highlighted\s*\{[^}]*outline:/);
});
