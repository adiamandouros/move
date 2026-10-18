// The subway planner at different times of day, and the home page.
import { axe, expect, test } from './fixtures.js';

const content = page => page.locator('#app-content');

test.describe('23:55 on a Wednesday, after the airport branch has stopped', () => {
    test.use({ now: '2026-10-14T23:55:00+03:00' });

    test('tomorrow\'s first trains, as clock times', async ({ page }) => {
        await page.goto('/subway?from=syntagma&to=airport');
        await expect(content(page)).toContainText('No more trains today. These are tomorrow\'s first trains.');
        await expect(content(page)).toContainText(/At\s*0[5-7]:\d\d/);
        expect(await axe(page)).toEqual([]);
    });

    test('in Greek too', async ({ page }) => {
        await page.goto('/el/subway?from=syntagma&to=airport');
        await expect(content(page)).toContainText('πρώτα δρομολόγια της επόμενης ημέρας');
        await expect(content(page)).toContainText(/Στις\s*0[5-7]:\d\d/);
    });
});

test.describe('01:30, before the first train', () => {
    test.use({ now: '2026-10-15T01:30:00+03:00' });

    test('the morning\'s first trains as clock times, not "In 240\'"', async ({ page }) => {
        await page.goto('/subway?from=omonia&to=piraeus');
        await expect(content(page)).toContainText(/At\s*0[5-6]:\d\d/);
        await expect(content(page)).not.toContainText('tomorrow');
    });
});

test('at noon, minutes', async ({ page }) => {
    await page.goto('/subway?from=omonia&to=piraeus');
    await expect(content(page)).toContainText(/In\s*\d+'/);
});

test('a change of line', async ({ page }) => {
    await page.goto('/subway?from=kifisia&to=aigaleo');
    await expect(page.locator('.result-card').first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
});

test('home: intro, shortcuts, and its own footer links', async ({ page }) => {
    await page.goto('/');
    await expect(content(page)).toContainText('Live bus arrivals at the stops around you');
    await expect(content(page)).toContainText('Metro stations');
    await expect(content(page)).toContainText('Privacy');
    await page.goto('/el');
    await expect(content(page)).toContainText('Σταθμοί μετρό');
    // Other pages keep only the language link, on phones
    await page.goto('/about');
    await expect(content(page)).not.toContainText('Contact · Privacy');
});
