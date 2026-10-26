// Favourites in a real browser: the star on the pages, kept on the device
// (/js/core/favourites.js), and the starred stations first where the tools
// offer stations. What's kept and in what order is tested in Node
// (favourites.test.js, station-search.test.js).
import { axe, expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone'));

const star = page => page.locator('.station-actions [data-favourite="station"]');

test('a station starred on its page comes first in the subway planner\'s lists, marked, and stays starred', async ({ page }) => {
    await page.goto('/subway/stations/kerameikos');
    await expect(star(page)).toBeVisible();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(star(page)).toHaveAccessibleName('Favourite');
    await star(page).tap();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(star(page).locator('use')).toHaveAttribute('href', /#favourite-filled$/);
    expect(await axe(page)).toEqual([]);
    await page.reload();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/subway');
    await page.locator('#stop-search-to').tap();
    const first = page.locator('#stop-suggestions-to .suggestion-item').first();
    await expect(first.locator('.suggestion-name-en')).toHaveText('Kerameikos');
    await expect(first.locator('.suggestion-favourite')).toBeVisible();
    await expect(first).toContainText(', favourite');
    // The interchanges follow, as before
    await expect(page.locator('#stop-suggestions-to .suggestion-name-en').nth(1)).toHaveText('Attiki');
    expect(await axe(page)).toEqual([]);
});

test('a starred station comes before the ones picked lately, and isn\'t offered twice', async ({ page }) => {
    await page.goto('/subway?from=syntagma');
    await page.locator('#stop-search-to').fill('Kerame');
    await page.locator('#stop-suggestions-to .suggestion-item').first().tap();
    await page.goto('/subway/stations/airport');
    await star(page).tap();
    await page.goto('/subway/stations/kerameikos');
    await star(page).tap();
    await page.goto('/subway');
    await page.locator('#stop-search-from').tap();
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en').first()).toHaveText('Kerameikos');
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en').nth(1)).toHaveText('Airport');
    await expect(page.locator('#stop-suggestions-from .suggestion-favourite')).toHaveCount(2);
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en', { hasText: 'Kerameikos' })).toHaveCount(1);
});

test('with the keyboard alone: the star is reached with Tab and pressed with Space or Enter, and unstarring takes it off the list', async ({ page }) => {
    await page.goto('/el/subway/stations/kerameikos');
    await expect(star(page)).toHaveAccessibleName('Αγαπημένο');
    for (let i = 0; i < 40 && !(await star(page).evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(star(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/el/subway');
    await page.locator('#stop-search-from').tap();
    await expect(page.locator('#stop-suggestions-from .suggestion-favourite')).toHaveCount(0);
});
