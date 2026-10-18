import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { textOn } from '../public/js/core/html.js';
import { loadTools, renderPages } from '../server/pages.js';
import { renderStationPage } from '../server/stations.js';
import { rail } from './fixtures/rail.js';

// Accessibility checks on every public page as the server sends it (WCAG 2.2
// AA basics), and on the colours in style.css. Content drawn by the pages'
// scripts (announcements, routes, arrivals) isn't here: the "Check
// accessibility" button on /admin/diagnostics runs axe-core on the live pages.

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
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// Text a screen reader would read: tags removed, aria-hidden parts dropped
// (our markup doesn't nest an aria-hidden element inside one of the same tag)
function spoken(fragment) {
    return fragment
        .replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&\w+;/g, ' ')
        .trim();
}

// [{ open, inner }] for each <name …>…</name> (not nested in itself)
const elements = (html, name) => [...html.matchAll(new RegExp(`(<${name}\\b[^>]*>)([\\s\\S]*?)</${name}>`, 'g'))]
    .map(([, open, inner]) => ({ open, inner }));


for (const [path, html] of Object.entries(all)) {
    test(`${path}: page language, title and one main heading`, () => {
        assert.match(html, /<html lang="(en|el)"/);
        assert.match(html, /<title>[^<]+<\/title>/);
        assert.equal((main(html).match(/<h1\b/g) ?? []).length, 1, 'exactly one <h1> in <main>');
    });

    test(`${path}: headings don't skip levels`, () => {
        const levels = [...main(html).matchAll(/<h([1-6])\b/g)].map(m => Number(m[1]));
        levels.forEach((level, i) => {
            if (i > 0) assert.ok(level <= levels[i - 1] + 1, `<h${level}> follows <h${levels[i - 1]}>`);
        });
    });

    test(`${path}: buttons and links have names`, () => {
        for (const name of ['button', 'a']) {
            for (const { open, inner } of elements(html, name)) {
                const label = attr(open, 'aria-label') || attr(open, 'title') || spoken(inner);
                assert.ok(label, `${open} has no text or aria-label`);
            }
        }
    });

    test(`${path}: icons are hidden from screen readers, images have alt text`, () => {
        for (const icon of html.match(/<i class="bi [^"]*"[^>]*>/g) ?? []) {
            assert.match(icon, /aria-hidden="true"/, `${icon} needs aria-hidden="true"`);
        }
        for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /\salt="/, `${img} needs alt`);
    });

    test(`${path}: links that open a new tab say so`, () => {
        for (const { open, inner } of elements(html, 'a').filter(a => /target="_blank"/.test(a.open))) {
            assert.ok(/data-i18n="shell\.new-tab"/.test(inner) || /new tab|νέα καρτέλα/i.test(attr(open, 'aria-label') ?? ''),
                `${open} opens a new tab without saying so`);
        }
    });

    test(`${path}: ids are unique, and the ids that labels and ARIA refer to exist`, () => {
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate ids');
        for (const [, ref] of html.matchAll(/\s(?:for|aria-controls|aria-describedby|aria-labelledby)="([^"]+)"/g)) {
            for (const id of ref.split(' ')) assert.ok(ids.includes(id), `nothing has id="${id}"`);
        }
    });

    test(`${path}: form fields have labels, and nothing forces its own tab order`, () => {
        for (const input of html.match(/<(input|select|textarea)\b[^>]*>/g) ?? []) {
            if (/type="(hidden|submit|button)"/.test(input)) continue;
            const id = attr(input, 'id');
            assert.ok(attr(input, 'aria-label') || (id && html.includes(`for="${id}"`)), `${input} has no label`);
        }
        assert.doesNotMatch(html, /tabindex="[1-9]/, 'positive tabindex');
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

// The surfaces text sits on: page, map, card and raised elements
const SURFACES = ['#0f1117', '#0f131c', '#161b27', '#1e2538'];

// Text colours that are allowed below 4.5:1 on those surfaces, and why
const EXCEPTIONS = {
    '#0f131c': 'dark text, only used on the light line colours (checked below)',
    '#2a3350': 'the decorative "/" between EN and ΕΛ, hidden from screen readers',
};

test('every text colour in style.css meets WCAG AA (4.5:1) on every surface', () => {
    const css = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
    const colours = new Set([...css.matchAll(/(?<![-\w])color:\s*(#[0-9a-f]{3,6})\b/gi)].map(m => m[1].toLowerCase()));
    for (const colour of colours) {
        if (EXCEPTIONS[colour]) continue;
        for (const surface of SURFACES) {
            const ratio = contrast(colour, surface);
            assert.ok(ratio >= 4.5, `${colour} on ${surface} is ${ratio.toFixed(2)}:1`);
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
