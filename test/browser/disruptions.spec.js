// The #disruptions box on Home and Info (public/js/core/announcements.js):
// the yellow banner when a strike or closure is announced, a quiet box saying
// there's none otherwise, and nothing when the announcements can't be read
// (failures.spec.js). Which announcements count is tested in Node
// (announcements.test.js).
import { axe, expect, test } from './fixtures.js';

const PAGES = ['/', '/info', '/el', '/el/info'];

test.describe('a closure announced', () => {
    for (const path of PAGES) {
        test(`${path} shows it in the disruption banner`, async ({ page }) => {
            await page.goto(path);
            const banner = page.locator('#disruptions .disruption-banner');
            await expect(banner).toContainText('Κλειστός ο σταθμός Πανεπιστήμιο');
            await expect(banner).toContainText(path.startsWith('/el') ? 'Διακοπή λειτουργίας' : 'Service disruption');
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
