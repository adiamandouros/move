// Motion where it shows what changed (Design · A step 7): each motion plays
// only when the phone hasn't asked for less (reduced motion), and none
// loops. Playwright's pages ask for no preference unless a test says so.
import { expect, test } from './fixtures.js';

// Decision 82: moving between pages, a view transition the browser plays by
// itself between two of Wayhop's pages (CSS's @view-transition); the new
// page says whether one played (pagereveal's viewTransition)
test.describe('moving between pages', () => {
    test.beforeEach(({}, { project }) => test.skip(project.name === 'iphone', 'Playwright\'s WebKit plays no transitions between pages'));

    const played = page => page.evaluate(() => window.__transition);
    const watch = page => page.addInitScript(() => {
        window.__transition = null;
        addEventListener('pagereveal', e => { window.__transition = Boolean(e.viewTransition); });
    });

    test('a tab tapped: the page cross-fades, the current tab\'s highlight slides to the new one, the bars stay put', async ({ page }) => {
        await watch(page);
        await page.goto('/subway');
        await page.locator('nav:visible a[data-tool="buses"]').click();
        await expect(page).toHaveURL(/\/buses$/);
        await expect.poll(() => played(page)).toBe(true);
        // Named, so it moves rather than fading: one highlight, and the bar it's in
        const names = await page.evaluate(() => [...document.querySelectorAll('*')]
            .filter(el => el.checkVisibility() && getComputedStyle(el).viewTransitionName !== 'none')
            .map(el => getComputedStyle(el).viewTransitionName));
        expect(names.sort()).toEqual(expect.arrayContaining(['nav-current']));
        expect(names.filter(name => name === 'nav-current')).toHaveLength(1);
        expect(names.some(name => name === 'bottom-nav' || name === 'side-nav')).toBe(true);
    });

    test.describe('with reduced motion', () => {
        test.use({ reducedMotion: 'reduce' });

        test('pages just switch', async ({ page }) => {
            await watch(page);
            await page.goto('/subway');
            await page.locator('nav:visible a[data-tool="buses"]').click();
            await expect(page).toHaveURL(/\/buses$/);
            await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
            expect(await played(page)).toBe(false);
        });
    });
});
