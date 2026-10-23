// Roboto (the @font-face rules in style.css): every page uses it, both
// alphabets of it, and it's ready by the time the page has loaded, so
// what the tests measure is what people see.
import { expect, test } from './fixtures.js';

const roboto = page => page.evaluate(() => [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Roboto').map(f => f.status));

test('pages are in Roboto, its Latin and Greek letters loaded with the page', async ({ page }) => {
    for (const path of ['/subway?from=syntagma&to=airport', '/el/subway?from=syntagma&to=airport']) {
        await page.goto(path);
        // Loaded with the page (preloaded), not after it
        expect(await roboto(page), path).toEqual(['loaded', 'loaded']);
        expect(await page.locator('body').evaluate(e => getComputedStyle(e).fontFamily)).toMatch(/^"?Roboto"?, "?Roboto Fallback"?,/);
        for (const text of ['Syntagma 12:24', 'Σύνταγμα']) {
            expect(await page.evaluate(t => document.fonts.check('700 16px Roboto', t), text), text).toBe(true);
        }
    }
});
