import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { textOn } from '../public/js/core/html.js';
import { renderPages } from '../server/pages.js';

// Accessibility checks on every public page as the server sends it (WCAG 2.2
// AA basics), and on the colours in style.css. Content drawn by the pages'
// scripts (announcements, routes, arrivals) isn't here: the "Check
// accessibility" button on /admin/diagnostics runs axe-core on the live pages.

const { pages, notFound } = renderPages();
const all = { ...pages, '(404)': notFound };

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

const strings = html => JSON.parse(html.match(/<script type="application\/json" id="strings">([\s\S]*?)<\/script>/)[1]);

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
        const { en, el } = strings(html);
        for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
            assert.ok(en[key], `"${key}" is missing in English`);
            assert.ok(el[key], `"${key}" is missing in Greek`);
        }
    });

    test(`${path}: text written in both languages comes in pairs`, () => {
        const count = lang => (main(html).match(new RegExp(`\\slang="${lang}"(?![^>]*any-lang)`, 'g')) ?? []).length;
        assert.equal(count('en'), count('el'), 'as many lang="en" as lang="el" blocks');
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
