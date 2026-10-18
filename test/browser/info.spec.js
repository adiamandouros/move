// The Info page: its sections (Bootstrap's accordion) with the keyboard, the
// map, and every section open passing axe.
import { axe, expect, test } from './fixtures.js';

for (const lang of ['', '/el']) {
    test(`${lang || '/'}info sections, map and station list`, async ({ page }, { project }) => {
        await page.goto(`${lang}/info`);
        await expect(page.locator('#toggle-announcements')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#sec-announcements')).toBeVisible();
        await expect(page.locator('#toggle-map')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#sec-map')).toBeHidden();

        // Enter opens the map; Space the station list (a click on the iPhone)
        const press = async (selector, key) => {
            if (project.name === 'iphone') return page.locator(selector).click();
            await page.locator(selector).focus();
            await page.keyboard.press(key);
        };
        await press('#toggle-map', 'Enter');
        await expect(page.locator('#toggle-map')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#metro-map > .map-svg .map-station').first()).toBeAttached();
        // The zoom buttons hold only their icons
        const button = page.locator('.map-btn').first();
        await expect(button).toHaveText('');
        expect((await button.locator('svg').boundingBox()).width).toBeLessThan(30);

        await press('#toggle-station-list', ' ');
        await expect(page.locator('#toggle-station-list')).toHaveAttribute('aria-expanded', 'true');
        expect(await page.locator('#station-list li').count()).toBeGreaterThan(50);
        await expect(page.locator('#toggle-map')).toHaveAttribute('aria-expanded', 'true');

        await page.locator('#toggle-announcements').click();
        await expect(page.locator('#sec-announcements')).toBeHidden();

        // Every section open
        const closed = page.locator('.accordion-button.collapsed');
        for (let n = await closed.count(); n > 0; n--) await closed.first().click();
        await expect(closed).toHaveCount(0);
        expect(await axe(page)).toEqual([]);
    });
}

test('a bus stop opens', async ({ page }) => {
    await page.goto('/buses');
    const first = page.locator('.stop-toggle').first();
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
});
