import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { loadConfig } from '../server/config.js';
import { renderPages } from '../server/pages/index.js';
import { mergeStrings } from '../server/pages/i18n.js';
import { loadTools, stringTables } from '../server/pages/registry.js';
import { stationPage } from '../server/pages/stations.js';
import { rail } from './fixtures/rail.js';
import { bareLineProblems, formProblems, headingProblems, iconProblems, idProblems, nameProblems, newTabProblems, untranslatedProblems } from './support/markup.js';

// Accessibility checks on every public page as the server sends it (WCAG 2.2
// AA basics), and on the colours in style.css. Content drawn by the pages'
// scripts (announcements, routes, arrivals) is checked in real browsers by
// test/browser/ (axe-core and a keyboard walk on every page).

const { pages, notFound, errorPage, renderPage } = renderPages();
const tools = loadTools();
// The station pages, from a small network (the real rail.json isn't in the repository)
const stationPages = Object.fromEntries(['en', 'el'].flatMap(lang => [null, 'x', 'a', 'b', 'c'].map(id =>
    [`(station ${id ?? 'index'}, ${lang})`, renderPage(stationPage(rail, id, { tools }), lang)])));
// And the pages that have ads, with every ad setting on
const adPages = (() => {
    const withAds = renderPages(tools, loadConfig({ ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_HOME: '1111111111', ADSENSE_SLOT_INFO: '2222222222', ADSENSE_SLOT_STATION: '3333333333' }));
    return {
        '/ (with ads)': withAds.pages['/'], '/el/info (with ads)': withAds.pages['/el/info'],
        '/privacy (with ads)': withAds.pages['/privacy'], '/el/privacy (with ads)': withAds.pages['/el/privacy'],
        '(station x, with ads)': withAds.renderPage(stationPage(rail, 'x', { tools }), 'el'),
    };
})();
const all = { ...pages, '(404)': notFound('/nope'), '(404, Greek)': notFound('/el/nope'), '(error)': errorPage('/subway/stations/x'), '(error, Greek)': errorPage('/el/subway/stations/x'), ...stationPages, ...adPages };

// Every string in each language: the shell's, the station pages', each tool's and the tools' names
const STRINGS = mergeStrings(...stringTables(tools));

const main = html => html.match(/<main[^>]*>([\s\S]*)<\/main>/)[1];

for (const [path, html] of Object.entries(all)) {
    test(`${path}: page language, title and one main heading`, () => {
        assert.match(html, /<html lang="(en|el)"/);
        assert.match(html, /<title>[^<]+<\/title>/);
        assert.equal((main(html).match(/<h1\b/g) ?? []).length, 1, 'exactly one <h1> in <main>');
    });

    test(`${path}: headings don't skip levels`, () => {
        assert.deepEqual(headingProblems(main(html)), []);
    });

    test(`${path}: buttons and links have names`, () => {
        assert.deepEqual(nameProblems(html), []);
    });

    test(`${path}: icons are hidden from screen readers, images have alt text`, () => {
        assert.deepEqual(iconProblems(html), []);
    });

    test(`${path}: links that open a new tab say so`, () => {
        assert.deepEqual(newTabProblems(html), []);
    });

    test(`${path}: ids are unique, and the ids that labels and ARIA refer to exist`, () => {
        assert.deepEqual(idProblems(html), []);
    });

    test(`${path}: form fields have labels, and nothing forces its own tab order`, () => {
        assert.deepEqual(formProblems(html), []);
    });

    // DESIGN.md: a line is always its pill
    test(`${path}: every line it names is shown by its pill`, () => {
        assert.deepEqual(bareLineProblems(html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1]), []);
    });

    // (Every string a view uses exists in both languages: templates.test.js)
    test(`${path}: no string shows as its key, and nothing is left of the templates`, () => {
        assert.deepEqual(untranslatedProblems(main(html), Object.keys(STRINGS.en)), []);
        assert.doesNotMatch(html, /\{\{|\sdata-(lang|i18n)/);
    });
}

// ── Colours ─────────────────────────────────────────────────────────────────

function luminance(hex) {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

// The colours of the dark mode: Bootstrap's own, then style.css's (which
// sets Bootstrap's variables and adds Wayhop's --wh- ones)
const STYLE = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
const TOKENS = (() => {
    const bootstrap = readFileSync(new URL('../node_modules/bootstrap/dist/css/bootstrap.css', import.meta.url), 'utf8');
    // The rules for :root and for the dark mode, in order
    const blocks = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selector]) => selector.split(';').pop().split(',').some(sel => /^(:root|\[data-bs-theme="?dark"?\])$/.test(sel.trim())))
        .map(m => m[2]);
    const tokens = {};
    for (const block of [...blocks(bootstrap), ...blocks(STYLE)]) {
        for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[name] = value.trim();
    }
    return tokens;
})();
// A colour as #rrggbb: written out, or a var(--name) of one
function resolve(value) {
    const name = value.match(/^var\((--[\w-]+)\)$/)?.[1];
    const colour = name ? TOKENS[name] : value;
    return /^#[0-9a-f]{3,6}$/i.test(colour ?? '') ? colour.toLowerCase() : null;
}

// The surfaces text sits on: page, map, card and raised elements
const SURFACES = ['--bs-body-bg', '--wh-map-bg', '--bs-tertiary-bg', '--bs-secondary-bg'];

// Text colours that are allowed below 4.5:1 on those surfaces, and why
const EXCEPTIONS = {
    'var(--wh-ink)': 'dark text, only used on the light line colours (checked below)',
    'var(--bs-border-color)': 'the decorative "/" between EN and ΕΛ, hidden from screen readers',
};

test('the dark mode\'s colours are all known', () => {
    for (const name of SURFACES) assert.ok(resolve(`var(${name})`), `${name} isn't a colour`);
});

test('every text colour in style.css meets WCAG AA (4.5:1) on every surface', () => {
    const colours = new Set([...STYLE.matchAll(/(?<![-\w])color:\s*([^;!]+?)\s*(?:!important)?;/gi)].map(m => m[1]));
    colours.delete('inherit');
    colours.delete('transparent');
    assert.ok(colours.size >= 10, 'found the text colours');
    for (const colour of colours) {
        if (EXCEPTIONS[colour]) continue;
        const hex = resolve(colour);
        assert.ok(hex, `${colour} isn't a colour or a variable of one`);
        for (const surface of SURFACES) {
            const ratio = contrast(hex, resolve(`var(${surface})`));
            assert.ok(ratio >= 4.5, `${colour} (${hex}) on ${surface} is ${ratio.toFixed(2)}:1`);
        }
    }
});

// Controls sit on the page and on cards, never on raised parts (chips, pills)
test('the edge of a control stands out where controls sit (3:1, WCAG 1.4.11)', () => {
    const edge = resolve('var(--wh-control-edge)');
    assert.ok(edge, '--wh-control-edge is a colour');
    for (const surface of ['--bs-body-bg', '--bs-tertiary-bg']) {
        const ratio = contrast(edge, resolve(`var(${surface})`));
        assert.ok(ratio >= 3, `--wh-control-edge on ${surface} is ${ratio.toFixed(2)}:1`);
    }
});

// The line colours in style.css (.line-m1 { background-color; color }), by line
const LINE_COLOURS = (() => {
    const rules = {};
    for (const [, selectors, body] of STYLE.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/((?:\s*\.line-[a-z]+\d+\s*,?)+)\{([^}]*)\}/g)) {
        const background = body.match(/background-color:\s*([^;]+);/)?.[1].trim();
        const color = body.match(/(?<![-\w])color:\s*([^;]+);/)?.[1].trim();
        for (const [, id] of selectors.matchAll(/\.line-([a-z]+\d+)/g)) rules[id] = { background, color };
    }
    return rules;
})();

const curatedLines = name => JSON.parse(readFileSync(new URL(`../data/curated/${name}.json`, import.meta.url), 'utf8'));
// Every line: the metro's (lines.json) and the tram's (tram.json)
const ALL_LINES = () => ({ ...curatedLines('lines'), ...curatedLines('tram').lines });

test('every line\'s colour in style.css is its colour in lines.json or tram.json', () => {
    const lines = ALL_LINES();
    for (const [id, line] of Object.entries(lines)) {
        assert.equal(resolve(LINE_COLOURS[id.toLowerCase()]?.background ?? ''), line.color.toLowerCase(), `.line-${id.toLowerCase()} in style.css`);
    }
    assert.ok(lines.T6 && lines.T7, 'and the tram');
});

test('a station sign\'s name is readable on its panel, and the panel stands out on the page', () => {
    const ratio = contrast(resolve('var(--wh-ink)'), resolve('var(--wh-sign)'));
    assert.ok(ratio >= 4.5, `--wh-ink on --wh-sign is ${ratio.toFixed(2)}:1`);
    for (const surface of ['--bs-body-bg', '--bs-tertiary-bg']) {
        const edge = contrast(resolve('var(--wh-sign)'), resolve(`var(${surface})`));
        assert.ok(edge >= 3, `--wh-sign on ${surface} is ${edge.toFixed(2)}:1`);
    }
});

test('the tram lines\' badges have dark text', () => {
    for (const id of Object.keys(curatedLines('tram').lines)) assert.equal(LINE_COLOURS[id.toLowerCase()].color, 'var(--wh-ink)', `.line-${id.toLowerCase()}`);
});

test('every line stands out on the maps\' background (3:1, as for graphics)', () => {
    for (const [id, line] of Object.entries(ALL_LINES())) {
        const ratio = contrast(line.color.toLowerCase(), resolve('var(--wh-map-bg)'));
        assert.ok(ratio >= 3, `${id}: ${line.color} on the map is ${ratio.toFixed(2)}:1`);
    }
});

test('the metro lines\' badges have white text', () => {
    const lines = JSON.parse(readFileSync(new URL('../data/curated/lines.json', import.meta.url), 'utf8'));
    for (const id of Object.keys(lines)) assert.equal(resolve(LINE_COLOURS[id.toLowerCase()].color), '#fff', `.line-${id.toLowerCase()}`);
});

test('line pills are readable on every line colour', () => {
    assert.ok(Object.keys(LINE_COLOURS).length >= 5);
    for (const [id, { background, color }] of Object.entries(LINE_COLOURS)) {
        const text = resolve(color ?? '');
        assert.ok(text, `.line-${id} sets its text colour`);
        const ratio = contrast(text, resolve(background));
        assert.ok(ratio >= 4.5, `.line-${id}: ${text} on ${background} is ${ratio.toFixed(2)}:1`);
    }
});

// The time badge's tiers (DESIGN.md): text on its own colour, on every
// surface it can sit on (a tint is 10% of its colour over the surface)
test('time badges are readable: solid green with dark text, tints over the page, cards and raised parts', () => {
    const hex = name => resolve(`var(${name})`);
    const rgb = hexColour => [1, 3, 5].map(i => parseInt(hexColour.slice(i, i + 2), 16));
    const tint = (colour, surface) => `#${rgb(colour).map((c, i) => Math.round(c * 0.1 + rgb(surface)[i] * 0.9).toString(16).padStart(2, '0')).join('')}`;
    assert.ok(contrast(hex('--wh-ink'), hex('--wh-close')) >= 4.5, 'dark text on the solid green');
    for (const name of ['--wh-close', '--wh-second-last', '--wh-last']) {
        assert.equal(TOKENS[`${name}-rgb`].replace(/\s/g, ''), rgb(hex(name)).join(','), `${name}-rgb is ${name}`);
        for (const surface of SURFACES.filter(s => s !== '--wh-map-bg')) {
            const ratio = contrast(hex(name), tint(hex(name), hex(surface)));
            assert.ok(ratio >= 4.5, `${name} on its tint over ${surface} is ${ratio.toFixed(2)}:1`);
        }
    }
});
