import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { textOn } from '../public/js/core/html.js';
import { renderPages } from '../server/pages/index.js';
import { loadTools } from '../server/pages/registry.js';
import { renderStationPage } from '../server/pages/stations.js';
import { rail } from './fixtures/rail.js';
import { formProblems, headingProblems, iconProblems, idProblems, nameProblems, newTabProblems } from './support/markup.js';

// Accessibility checks on every public page as the server sends it (WCAG 2.2
// AA basics), and on the colours in style.css. Content drawn by the pages'
// scripts (announcements, routes, arrivals) is checked in real browsers by
// test/browser/ (axe-core and a keyboard walk on every page).

const { pages, notFound, render } = renderPages();
const tools = loadTools();
// The station pages, from a small network (the real rail.json isn't in the repository)
const stationPages = Object.fromEntries(['en', 'el'].flatMap(lang => [null, 'x', 'a', 'b', 'c'].map(id =>
    [`(station ${id ?? 'index'}, ${lang})`, renderStationPage(rail, id, lang, { render, tools })])));
// And the pages that have ads, with every ad setting on
const adPages = (() => {
    const keys = ['ADSENSE_CLIENT', 'ADSENSE_SLOT_HOME', 'ADSENSE_SLOT_INFO', 'ADSENSE_SLOT_STATION'];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    Object.assign(process.env, { ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_HOME: '1111111111', ADSENSE_SLOT_INFO: '2222222222', ADSENSE_SLOT_STATION: '3333333333' });
    try {
        const withAds = renderPages();
        return {
            '/ (with ads)': withAds.pages['/'], '/el/info (with ads)': withAds.pages['/el/info'],
            '/privacy (with ads)': withAds.pages['/privacy'], '/el/privacy (with ads)': withAds.pages['/el/privacy'],
            '(station x, with ads)': renderStationPage(rail, 'x', 'el', { render: withAds.render, tools }),
        };
    } finally {
        for (const k of keys) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k];
    }
})();
const all = { ...pages, '(404)': notFound('/nope'), '(404, Greek)': notFound('/el/nope'), ...stationPages, ...adPages };

// Every string in each language: the shell's, the station pages', each tool's and the tools' names
const STRINGS = { en: {}, el: {} };
{
    const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
    const tables = [read('../server/views/strings.json'), read('../server/views/stations.json'), ...tools.map(t => t.strings)];
    for (const lang of ['en', 'el']) {
        for (const table of tables) Object.assign(STRINGS[lang], table[lang]);
        for (const tool of tools) {
            STRINGS[lang][`tool.${tool.id}.title`] = tool.title[lang];
            STRINGS[lang][`tool.${tool.id}.short`] = (tool.shortTitle ?? tool.title)[lang];
            STRINGS[lang][`tool.${tool.id}.description`] = tool.description?.[lang];
        }
    }
}

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

    test(`${path}: every translated text exists in English and Greek`, () => {
        for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
            assert.ok(STRINGS.en[key], `"${key}" is missing in English`);
            assert.ok(STRINGS.el[key], `"${key}" is missing in Greek`);
        }
    });

    test(`${path}: text written in both languages is only there in the page's language`, () => {
        assert.doesNotMatch(html, /\sdata-lang="/);
    });
}

test('text written in both languages comes in pairs', () => {
    for (const tool of tools) {
        const count = lang => (tool.page.match(new RegExp(`\\sdata-lang="${lang}"`, 'g')) ?? []).length;
        assert.equal(count('en'), count('el'), `tools/${tool.id}/page.html: as many data-lang="en" as data-lang="el" blocks`);
    }
});

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

test('line badges are readable on every line colour', () => {
    const lines = JSON.parse(readFileSync(new URL('../data/curated/lines.json', import.meta.url), 'utf8'));
    // The metro lines (badges use textOn) and the tram colour in style.css (dark text)
    const pairs = [...Object.values(lines).map(l => [textOn(l.color), l.color]), ['#0f131c', '#e07b00']];
    for (const [text, background] of pairs) {
        const ratio = contrast(text, background);
        assert.ok(ratio >= 4.5, `${text} on ${background} is ${ratio.toFixed(2)}:1`);
    }
});
