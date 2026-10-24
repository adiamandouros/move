// Every page, in both languages, once its scripts have drawn it: in the right
// language, no axe-core violations (WCAG 2.2 AA), and usable with the keyboard
// alone, with only the page scrolling. The pages: site-pages.js.
import { axe, expect, keyboardWalk, test } from './fixtures.js';
import { EVERY_PAGE, READY } from './site-pages.js';

for (const [path, lang, url] of EVERY_PAGE) {
    test(`${url}`, async ({ page }, testInfo) => {
        await page.goto(url);
        if (READY[path]) await expect(page.locator(READY[path]).first()).toBeAttached();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);

        expect(await axe(page), 'axe-core violations').toEqual([]);

        // Only the page scrolls, never the window with the navigation in it
        const window = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, height: innerHeight }));
        expect(window.scroll, 'the window scrolls').toBeLessThanOrEqual(window.height);

        // Phones have no keyboard, except that some people use one with them;
        // WebKit only tabs to links when Safari's setting is on, so it's skipped there
        if (testInfo.project.name !== 'iphone') {
            const walk = await keyboardWalk(page);
            expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
        }
    });
}

// The same pages in the light mode: the colours are the whole difference, so axe-core is what matters
test.describe('in the light mode', () => {
    test.use({ colorScheme: 'light' });
    for (const [path, lang, url] of EVERY_PAGE) {
        test(`${url}`, async ({ page }) => {
            await page.goto(url);
            if (READY[path]) await expect(page.locator(READY[path]).first()).toBeAttached();
            await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
            await expect(page.locator('html')).toHaveAttribute('lang', lang);
            expect(await axe(page), 'axe-core violations').toEqual([]);
        });
    }
});
