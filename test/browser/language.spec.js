// The language link: switching keeps what's on the page, the choice is
// remembered, and English addresses then open in Greek.
import { expect, onlyOn, test } from './fixtures.js';

const path = page => { const u = new URL(page.url()); return u.pathname + u.search; };
const saved = page => page.evaluate(() => localStorage.getItem('language'));
// Wider screens have it in the sidebar, phones in the menu (opened first)
const languageLink = async (page, project) => {
    if (project === 'desktop') return page.locator('#side-nav .lang-toggle-btn');
    await page.locator('.menu-btn').click();
    return page.locator('#site-menu .menu-language');
};

test('switching keeps the route and is remembered', async ({ page }, { project }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    await expect(page.locator('.result-card')).toBeVisible();

    await (await languageLink(page, project.name)).click();
    await expect(page).toHaveURL(/:\d+\/el\/subway\?from=syntagma&to=airport$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'el');
    expect(await saved(page)).toBe('el');
    await expect(page.locator('#stop-search-from')).toHaveValue('Σύνταγμα');
    await expect(page.locator('.result-card').first()).toContainText('Αποβίβαση');

    // English addresses now open in Greek
    for (const url of ['/info', '/subway/stations/syntagma', '/nope']) {
        await page.goto(url);
        expect(path(page)).toBe(`/el${url}`);
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'el');
});

test('the keyboard switches back to English', async ({ page }, { project }) => {
    test.skip(project.name === 'iphone', 'WebKit only tabs to links with Safari\'s setting on');
    await page.goto('/el/subway?from=omonia&to=piraeus');
    await page.evaluate(() => localStorage.setItem('language', 'el'));
    await (await languageLink(page, project.name)).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/:\d+\/subway\?from=omonia&to=piraeus$/);
    expect(await saved(page)).toBe('en');
    await expect(await languageLink(page, project.name)).toContainText('Ελληνικά');
});

test.describe('on one phone (the same everywhere)', () => {
    test.beforeEach(onlyOn('phone'));

    test('both station names show in the suggestions', async ({ page }) => {
        await page.goto('/subway');
        // Ready once the boarding station comes from the location
        await expect(page.locator('#stop-search-from')).toHaveValue('Syntagma');
        await page.locator('#stop-search-to').pressSequentially('Synt');
        const names = page.locator('#stop-suggestions-to .suggestion-item').first().locator('.suggestion-names > span');
        await expect(names.filter({ visible: true })).toHaveText(['Σύνταγμα', 'Syntagma']);
    });

    test('the Greek map\'s station list links to Greek pages', async ({ page }) => {
        await page.goto('/el/info');
        await page.locator('#toggle-map').click();
        await page.locator('#toggle-station-list').click();
        await expect(page.locator('#station-list a').first()).toHaveAttribute('href', /^\/el\/subway\?to=/);
        await expect(page.locator('.map-btn').first()).toHaveAttribute('aria-label', 'Μεγέθυνση');
    });
});
