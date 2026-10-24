import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

// The sizes in style.css follow DESIGN.md: text on the six-size scale,
// corners from three radii, one shadow, and px only for what must stay thin
// (edges, the focus ring, shadows), so everything else follows the text size
// a person has chosen. Colours: accessibility.test.js. Text at
// 200%: test/browser/text-size.spec.js.

const STYLE = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every declaration, with the selector of its rule (rules inside @media too)
const DECLARATIONS = [...STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
    [...body.matchAll(/([\w-]+)\s*:\s*([^;]+?)\s*(?:!important)?\s*(?:;|$)/g)]
        .map(([, property, value]) => ({ selector: selector.trim(), property, value })));
const where = ({ selector, property, value }) => `${selector} { ${property}: ${value} }`;
const token = name => DECLARATIONS.find(d => d.selector === ':root' && d.property === name)?.value;

test('found the declarations', () => {
    assert.ok(DECLARATIONS.length > 500);
});

test('the text sizes are the six of the scale, none under 12 px', () => {
    const scale = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'].map(size => token(`--wh-fs-${size}`));
    assert.deepEqual(scale, ['0.75rem', '0.875rem', '1rem', '1.125rem', '1.375rem', '1.75rem']);
});

test('the corners are the three radii', () => {
    assert.deepEqual(['sm', 'lg', 'round'].map(size => token(`--wh-radius-${size}`)), ['0.375rem', '0.75rem', '50rem']);
});

test('space is on a 4 px grid, in rem', () => {
    const space = DECLARATIONS.filter(d => d.selector === ':root' && d.property.startsWith('--wh-space-'));
    assert.equal(space.length, 7);
    for (const { property, value } of space) assert.equal(value, `${Number(property.split('-').pop()) / 4}rem`, property);
});

// Text sizes: a token, or em inside a component that grows with its own text
test('text sizes come from the scale', () => {
    const found = DECLARATIONS.filter(d => /^font-size$|^--bs-[\w-]*font-size$/.test(d.property) && !own(d) && !/^(var\(--wh-fs-(xs|sm|md|lg|xl|2xl)\)|inherit|[\d.]+em)$/.test(d.value));
    assert.deepEqual(found.map(where), []);
});

// Corners: the three radii, or the inside of one (less the 1 px edge)
const RADIUS = /^(0|inherit|var\(--wh-radius-(sm|lg|round)\)|calc\(var\(--wh-radius-(sm|lg)\) - 1px\))$/;
// What keeps its own sizes: the train diagram's shaped end cars, and the
// maps' labels, which are in the drawing's own units (its viewBox scales them)
const SHAPED = ['.train-car:first-child', '.train-car:last-child'];
const DRAWN = /^\.map-[\w-]+ text$/;
const own = ({ selector }) => SHAPED.includes(selector) || selector.split(',').every(sel => DRAWN.test(sel.trim()));
test('corners come from the three radii', () => {
    const found = DECLARATIONS.filter(d => /radius$/.test(d.property) && !own(d))
        .filter(d => !d.value.split(/\s*\/\s*|\s+(?![^(]*\))/).every(part => RADIUS.test(part)));
    assert.deepEqual(found.map(where), []);
});

// Shadows: the one shadow, the focus ring, or an edge drawn as a ring
// (no offset, no blur)
const SHADOW = /^(none|var\(--wh-shadow\)|(inset )?var\(--focus-ring\)|(inset )?0 0 0 [\d.]+px .+)$/;
test('shadows are the one shadow, focus rings or edges', () => {
    const found = DECLARATIONS.filter(d => d.property === 'box-shadow' && !d.value.split(/,(?![^(]*\))/).every(part => SHADOW.test(part.trim())));
    assert.deepEqual(found.map(where), []);
});

// px: only for edges, outlines and the maps' lines, 1 px things, shadows,
// and the shaped cars
test('px only for what must stay thin', () => {
    const found = DECLARATIONS.filter(d => /\dpx/.test(d.value))
        .filter(d => !/^(border|outline)(-(top|right|bottom|left))?(-width)?$|^outline-offset$|^stroke-width$|radius$|shadow$|^--focus-ring$/.test(d.property))
        .filter(d => !own(d))
        .filter(d => d.value.match(/-?[\d.]+px/g).some(px => !/^-?1px$/.test(px)));
    assert.deepEqual(found.map(where), []);
});

test('breakpoints are in em', () => {
    const found = [...STYLE.matchAll(/@media[^{]*\d+px[^{]*/g)].map(m => m[0].trim());
    assert.deepEqual(found, []);
});

// One notice component in four tones; the boxes it replaced have no style of their own
test('notices: four tones, and no other box of their own', () => {
    const tones = DECLARATIONS.flatMap(d => d.selector.split(',')).map(sel => sel.trim().match(/^\.notice-(\w+)/)?.[1]).filter(tone => tone && tone !== 'body');
    assert.deepEqual([...new Set(tones)].sort(), ['danger', 'info', 'ok', 'warn']);
    const old = DECLARATIONS.filter(d => /(^|[ ,.])(subway-message|tomorrow-notice|timetable-notice|disruption-banner|no-disruptions)\b/.test(d.selector) && /^(border|padding)(-radius)?$|^border/.test(d.property));
    assert.deepEqual(old.map(where), []);
});
