// The sidebar on wider screens: the tools at the top; at the bottom the
// about, privacy, terms and contact links, one under the other, and the language
// button last.
import { expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('desktop'));

test('the site links sit stacked above the language button, which is last', async ({ page }) => {
    await page.goto('/subway');
    const links = page.locator('#side-nav .side-links a');
    await expect(links).toHaveText(['About', 'Privacy', 'Terms of use', 'Contact']);
    const boxes = await links.evaluateAll(as => as.map(a => a.getBoundingClientRect()).map(({ left, top, bottom }) => ({ left, top, bottom })));
    for (const [i, box] of boxes.entries()) {
        expect(box.left).toBe(boxes[0].left);
        if (i) expect(box.top).toBeGreaterThanOrEqual(boxes[i - 1].bottom);
    }
    const language = await page.locator('#side-nav .lang-toggle-btn').boundingBox();
    expect(language.y).toBeGreaterThanOrEqual(boxes.at(-1).bottom);
    // At the very bottom of the sidebar, as before
    const nav = await page.locator('#side-nav').boundingBox();
    expect(nav.y + nav.height - (language.y + language.height)).toBeLessThanOrEqual(16);
});
