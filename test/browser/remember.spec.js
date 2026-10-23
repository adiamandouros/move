// The tools open where they were left (public/js/core/remember.js): the
// subway's stations and the bus stop or line come back after another page,
// for this tab only. What's kept and where the links go is tested in Node
// (remember.test.js); here, what a person does with the navigation.
import { axe, expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone', 'desktop'));

// The navigation that shows: the bottom bar on phones, the sidebar on wider screens
const nav = (page, tool) => page.locator(`nav:visible a[data-tool="${tool}"]`);

async function choose(page, field, name) {
    await page.locator(`#stop-search-${field}`).fill(name);
    await page.locator(`#stop-search-${field}`).press('Enter');
}

test.describe('the subway', () => {
    test('a planned route is there again after another page, in either language', async ({ page }) => {
        await page.goto('/subway');
        await choose(page, 'from', 'Omonia');
        await choose(page, 'to', 'Airport');
        await expect(page.locator('.result-card').first()).toBeVisible();

        await nav(page, 'info').click();
        await expect(page).toHaveURL(/\/info$/);
        await nav(page, 'subway').click();
        await expect(page).toHaveURL(/\/subway\?from=omonia&to=airport$/);
        await expect(page.locator('#stop-search-from')).toHaveValue('Omonia');
        await expect(page.locator('#stop-search-to')).toHaveValue('Airport');
        await expect(page.locator('.result-card').first()).toBeVisible();
        expect(await axe(page)).toEqual([]);

        await page.goto('/el/info');
        await expect(nav(page, 'subway')).toHaveAttribute('href', '/el/subway?from=omonia&to=airport');
    });

    test('a boarding station that follows the location isn’t kept: by then it may be another one', async ({ page }) => {
        await page.goto('/subway');
        await expect(page.locator('#stop-search-from')).toHaveValue('Syntagma');
        await choose(page, 'to', 'Airport');
        await expect(page.locator('.result-card').first()).toBeVisible();
        await nav(page, 'info').click();
        await expect(nav(page, 'subway')).toHaveAttribute('href', '/subway?to=airport');
    });

    test('the subway tab, tapped on the subway, starts over; a station page’s link says where it goes', async ({ page }) => {
        await page.goto('/subway');
        await choose(page, 'from', 'Omonia');
        await choose(page, 'to', 'Airport');
        await expect(nav(page, 'subway')).toHaveAttribute('href', '/subway');
        await nav(page, 'subway').click();
        await expect(page.locator('#stop-search-to')).toHaveValue('');
        await expect(page.locator('#stop-search-from')).toHaveValue('Syntagma');

        await choose(page, 'to', 'Airport');
        await page.goto('/subway/stations/omonia');
        await expect(nav(page, 'subway')).toHaveAttribute('href', '/subway?to=airport');
        await page.getByRole('link', { name: 'Plan a trip from here' }).click();
        await expect(page).toHaveURL(/\/subway\?from=omonia$/);
        await expect(page.locator('#stop-search-to')).toHaveValue('');
    });
});

test.describe('the buses', () => {
    test('a stop picked from the search is there again after another page, not the stops nearby', async ({ page }) => {
        await page.goto('/buses');
        await page.getByLabel('Find a stop by name or code, or a line').fill('10341');
        await page.locator('#search-results a[href*="?stop=10341"]').click();
        await expect(page).toHaveURL(/\/buses\?stop=10341$/);

        await nav(page, 'subway').click();
        await expect(page).toHaveURL(/\/subway/);
        await nav(page, 'buses').click();
        await expect(page).toHaveURL(/\/buses\?stop=10341$/);
        await expect(page.locator('.stop-item')).toHaveCount(1);
        await expect(page.locator('.stop-item')).toContainText('10341');
    });

    test('a line in its other direction comes back the same, from the home page’s tiles too', async ({ page }) => {
        await page.goto('/buses?line=040&dir=1');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        await page.goto('/');
        await expect(page.locator('a.tool-tile[data-tool="buses"]')).toHaveAttribute('href', '/buses?line=040&dir=1');
        await page.locator('a.tool-tile[data-tool="buses"]').click();
        await expect(page).toHaveURL(/\/buses\?line=040&dir=1$/);
        await expect(page.locator('#view-header [data-direction="1"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('going back to the stops nearby forgets the stop; so does the buses tab, tapped on the buses', async ({ page }) => {
        await page.goto('/buses?stop=10341');
        await expect(page.locator('.stop-item')).toHaveCount(1);
        await page.locator('.back-link').click();
        await expect(page).toHaveURL(/\/buses$/);
        await page.goto('/info');
        await expect(nav(page, 'buses')).toHaveAttribute('href', '/buses');

        await page.goto('/buses?stop=10341');
        await nav(page, 'buses').click();
        await expect(page).toHaveURL(/\/buses$/);
        await page.goto('/info');
        await expect(nav(page, 'buses')).toHaveAttribute('href', '/buses');
    });
});

test('only for this tab, and a page brought back with Back has the latest', async ({ page }) => {
    await page.goto('/info');
    await page.goto('/buses?stop=10341');
    await expect(page.locator('.stop-item')).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(/\/info$/);
    await expect(nav(page, 'buses')).toHaveAttribute('href', '/buses?stop=10341');

    const other = await page.context().newPage();
    await other.goto('/info');
    await expect(nav(other, 'buses')).toHaveAttribute('href', '/buses');
    await other.close();
});
