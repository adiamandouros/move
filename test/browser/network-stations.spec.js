// The tram's and the suburban railway's station pages in a real browser
// (decision 55): one page per network, joined by their walks, each planned
// from by the subway planner's id. What they show is tested in Node
// (network-stations.test.js); axe-core and the keyboard walk check them with
// every page (site-pages.js).
import { axe, expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone'));

test('from Syntagma the metro station to Syntagma the tram stop, on to the next stop, and planning from it', async ({ page }) => {
    await page.goto('/subway/stations/syntagma');
    const changes = page.locator('.station-changes');
    await expect(changes).toContainText('Syntagma');
    await changes.getByRole('link', { name: 'Syntagma' }).tap();
    await expect(page).toHaveURL(/\/tram\/stops\/syntagma$/);
    await expect(page.locator('h1')).toHaveText('Syntagma');
    await expect(page.locator('main')).toContainText('Tram stop on T6');
    await expect(page.locator('#lift-status')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    await page.locator('.station-direction').getByRole('link', { name: 'Zappio' }).tap();
    await expect(page).toHaveURL(/\/tram\/stops\/zappeio$/);
    await page.goBack();

    await page.getByRole('link', { name: 'Plan a trip from here' }).tap();
    await expect(page).toHaveURL(/\/subway\?from=syntagma-tram$/);
    await expect(page.locator('#stop-search-from')).toHaveValue(/Syntagma \(tram\)/);
});

test('the suburban railway\'s index, a station and the walk to its metro station, in Greek', async ({ page }) => {
    await page.goto('/el/suburban/stations');
    await expect(page.locator('h1')).toHaveText('Σταθμοί Προαστιακού');
    await page.locator('#line-a1 ~ ol').getByRole('link', { name: 'Πειραιάς' }).tap();
    await expect(page).toHaveURL(/\/el\/suburban\/stations\/piraeus$/);
    await expect(page.locator('main')).toContainText('Ο σταθμός του Προαστιακού δεν είναι στο κτίριο του μετρό');
    expect(await axe(page)).toEqual([]);
    await page.locator('.station-changes').getByRole('link', { name: 'Πειραιάς' }).tap();
    await expect(page).toHaveURL(/\/el\/subway\/stations\/piraeus$/);
});
