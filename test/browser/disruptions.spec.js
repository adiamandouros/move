// The #disruptions box on Info (public/js/core/announcements.js):
// the yellow banner when a strike or closure is announced (apergia.gr's
// strikes among them, decision 71), a quiet box saying
// there's none otherwise; on Home (decision 81) one closed line, and
// "No disruptions" at the top right otherwise; and nothing when the announcements can't be read
// (failures.spec.js). Which announcements count is tested in Node
// (announcements.test.js). Whether the box shows doesn't depend on the
// device: one phone.
import { axe, expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone'));

const PAGES = ['/info', '/el/info'];

test.describe('a closure announced, and a strike on apergia.gr', () => {
    for (const path of PAGES) {
        test(`${path} shows both in the disruption banner, the strike first with whose words it is`, async ({ page }) => {
            await page.goto(path);
            const banner = page.locator('#disruptions .disruption-banner');
            await expect(banner).toContainText(path.startsWith('/el') ? 'Διακοπή λειτουργίας' : 'Service disruption');
            const items = banner.locator('li');
            await expect(items).toHaveCount(2);
            await expect(items.first()).toContainText('Μετρό (Γραμμές 2,3) Κινούνται έως 18:00');
            await expect(items.first()).toContainText(path.startsWith('/el') ? 'από το apergia.gr' : 'from apergia.gr');
            await expect(items.first().locator('a')).toHaveAttribute('href', 'https://apergia.gr/#/event/strike1');
            await expect(items.nth(1)).toContainText('Κλειστός ο σταθμός Πανεπιστήμιο');
            expect(await axe(page)).toEqual([]);
        });
    }
});

test.describe('no strike or closure announced', () => {
    test.use({ scenario: 'no-disruptions' });

    for (const path of PAGES) {
        test(`${path} says there are no disruption announcements`, async ({ page }) => {
            await page.goto(path);
            await expect(page.locator('#disruptions')).toHaveText(path.startsWith('/el')
                ? 'Καμία ανακοίνωση διακοπής λειτουργίας.'
                : 'No service disruption announcements.');
            await expect(page.locator('#disruptions .disruption-banner')).toHaveCount(0);
            expect(await axe(page)).toEqual([]);
        });
    }
});

// Decision 81: Home says the same in less room
test.describe('Home', () => {
    test('a closure and a strike: one closed line, the strike\'s title and "+1 more"; opened, both and the way to every announcement on Info', async ({ page }) => {
        await page.goto('/');
        const line = page.locator('#disruptions details.disruption-line');
        await expect(line).not.toHaveAttribute('open');
        await expect(line.locator('summary')).toContainText('Μετρό (Γραμμές 2,3) Κινούνται έως 18:00');
        await expect(line.locator('.disruption-more')).toHaveText('+1 more');
        await expect(page.locator('#home-status')).toBeEmpty();
        // One line, however long the title
        const summary = await line.locator('summary').boundingBox();
        expect(summary.height).toBeLessThan(60);
        expect(await axe(page)).toEqual([]);
        await line.locator('summary').click();
        await expect(line.locator('li')).toHaveCount(2);
        await expect(line.locator('li').nth(1)).toContainText('Κλειστός ο σταθμός Πανεπιστήμιο');
        await line.getByRole('link', { name: 'All announcements' }).click();
        await expect(page).toHaveURL(/\/info#announcements$/);
    });

    test.describe('none announced', () => {
        test.use({ scenario: 'no-disruptions' });

        test('"No disruptions" at the top, no line', async ({ page }) => {
            await page.goto('/el');
            await expect(page.locator('#home-status')).toHaveText('Χωρίς διακοπές');
            await expect(page.locator('#disruptions')).toBeEmpty();
            expect(await axe(page)).toEqual([]);
        });
    });
});
