// The subway planner and the home page in a real browser. What the planner
// works out and draws at each time of day is tested in Node
// (subway-network.test.js, subway-render.test.js); here, that the page puts
// it together, on one phone.
import { axe, expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone'));

const content = page => page.locator('#app-content');

test.describe('23:55 on a Wednesday, after the airport branch has stopped', () => {
    test.use({ now: '2026-10-14T23:55:00+03:00' });

    test('tomorrow\'s first trains, as clock times', async ({ page }) => {
        await page.goto('/subway?from=syntagma&to=airport');
        await expect(content(page)).toContainText('No more trains today. These are tomorrow\'s first trains.');
        await expect(content(page)).toContainText(/At\s*0[5-7]:\d\d/);
        expect(await axe(page)).toEqual([]);
    });

});

test('a change of line', async ({ page }) => {
    await page.goto('/subway?from=kifisia&to=aigaleo');
    await expect(page.locator('.result-card').first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
});

test('the signpost walks you to the boarding station, and goes when there is none', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const walk = page.locator('#walk-btn');
    await expect(walk).toHaveAccessibleName('Walking directions to Syntagma (opens in a new tab)');
    await expect(walk).toHaveAttribute('href', /destination=37\.\d+,23\.\d+&travelmode=walking/);
    // The swap button sits right under it
    const centre = async locator => { const box = await locator.boundingBox(); return box.x + box.width / 2; };
    expect(Math.abs(await centre(walk) - await centre(page.locator('#swap-stations')))).toBeLessThan(1);
    const syntagma = await walk.getAttribute('href');
    await page.locator('#swap-stations').click();
    await expect(walk).toHaveAccessibleName(/Walking directions to Airport/);
    expect(await walk.getAttribute('href')).not.toBe(syntagma);
    await page.locator('#stop-search-from').fill('');
    await expect(walk).toBeHidden();
    expect(await axe(page)).toEqual([]);
});

test('names every object has in the address aren\'t stations: empty fields, no crash', async ({ page }) => {
    await page.goto('/subway?from=constructor&to=__proto__');
    await expect(page.locator('#stop-search-from')).toHaveValue('');
    await expect(page.locator('#stop-search-to')).toHaveValue('');
    await expect(page.locator('#walk-btn')).toBeHidden();
    await expect(page.locator('#subway-result')).toBeEmpty();
    await page.goto('/subway?from=toString&to=syntagma');
    await expect(page.locator('#stop-search-to')).toHaveValue('Syntagma');
    await expect(page.locator('#walk-btn')).toBeHidden();
});

test('home: intro and shortcuts, and no footer (the links are in the menu and the sidebar)', async ({ page }) => {
    await page.goto('/');
    await expect(content(page)).toContainText('Live bus arrivals at the stops around you');
    await expect(content(page)).toContainText('Metro stations');
    await expect(page.locator('footer')).toHaveCount(0);
    await page.goto('/el');
    await expect(content(page)).toContainText('Σταθμοί μετρό');
});
