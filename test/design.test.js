import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

// The sizes in style.css follow DESIGN.md: text on the six-size scale,
// corners from three radii, one shadow, and px only for what must stay thin
// (edges, the focus ring, shadows). Colours: accessibility.test.js. Text at
// 200%: test/browser/text-size.spec.js.

const STYLE = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every declaration, with the selector of its rule (rules inside @media too)
const DECLARATIONS = [...STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
    [...body.matchAll(/([\w-]+)\s*:\s*([^;]+?)\s*(?:!important)?\s*(?:;|$)/g)]
        .map(([, property, value]) => ({ selector: selector.trim(), property, value })));
const where = ({ selector, property, value }) => `${selector} { ${property}: ${value} }`;
const token = name => DECLARATIONS.find(d => d.selector === ':root' && d.property === name)?.value;

// What's still to move onto the tokens (step 1 of the visual overhaul,
// DESIGN.md). Each count may only go down: lower it when it does.
const NOT_YET = { fontSize: 77, radius: 37, shadow: 1, px: 174, media: 4 };

const notYet = (kind, found) => {
    assert.ok(found.length <= NOT_YET[kind], `more ${kind} outside the tokens than before (${found.length}, was ${NOT_YET[kind]}); use the tokens (DESIGN.md). All of them:\n${found.join('\n')}`);
    assert.equal(found.length, NOT_YET[kind], `fewer ${kind} outside the tokens now: set NOT_YET.${kind} to ${found.length}`);
};

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
    const found = DECLARATIONS.filter(d => d.property === 'font-size' && !/^(var\(--wh-fs-(xs|sm|md|lg|xl|2xl)\)|inherit|[\d.]+em)$/.test(d.value));
    notYet('fontSize', found.map(where));
});

// Corners: the three radii, or the inside of one (less the 1 px edge); the
// train diagram's shaped end cars keep their own
const RADIUS = /^(0|inherit|var\(--wh-radius-(sm|lg|round)\)|calc\(var\(--wh-radius-(sm|lg)\) - 1px\))$/;
const SHAPED = ['.train-car:first-child', '.train-car:last-child'];
test('corners come from the three radii', () => {
    const found = DECLARATIONS.filter(d => /radius$/.test(d.property) && !SHAPED.includes(d.selector))
        .filter(d => !d.value.split(/\s*\/\s*|\s+(?![^(]*\))/).every(part => RADIUS.test(part)));
    notYet('radius', found.map(where));
});

// Shadows: the one shadow, the focus ring, or an edge drawn as a ring
// (no offset, no blur)
const SHADOW = /^(none|var\(--wh-shadow\)|(inset )?var\(--focus-ring\)|(inset )?0 0 0 [\d.]+px .+)$/;
test('shadows are the one shadow, focus rings or edges', () => {
    const found = DECLARATIONS.filter(d => d.property === 'box-shadow' && !d.value.split(/,(?![^(]*\))/).every(part => SHADOW.test(part.trim())));
    notYet('shadow', found.map(where));
});

// px: only for edges, outlines and the maps' lines, 1 px things, shadows,
// and the shaped cars
test('px only for what must stay thin', () => {
    const found = DECLARATIONS.filter(d => /\dpx/.test(d.value))
        .filter(d => !/^(border|outline)(-(top|right|bottom|left))?(-width)?$|^outline-offset$|^stroke-width$|radius$|shadow$|^--focus-ring$/.test(d.property))
        .filter(d => !SHAPED.includes(d.selector))
        .filter(d => d.value.match(/-?[\d.]+px/g).some(px => !/^-?1px$/.test(px)));
    notYet('px', found.map(where));
});

test('breakpoints are in em', () => {
    const found = [...STYLE.matchAll(/@media[^{]*\d+px[^{]*/g)].map(m => m[0].trim());
    notYet('media', found);
});
