// The admin pages (server/admin/): the diagnostics page, its checks as the
// server would send them (server/diagnostics.js), not run for real here
import { ADMIN_TEST_PASSWORD } from '../support/test-site.js';
import { axe, expect, onlyOn, test } from './fixtures.js';

test.use({ scenario: 'admin' });
test.beforeEach(onlyOn('phone', 'desktop'));

const STOPPED = {
    summary: { status: 'warn', text: 'Something needs a look.' },
    report: 'Wayhop diagnostics',
    checks: [
        { group: 'Data', title: 'Last data build', status: 'ok', detail: '2026-10-20 08:46 UTC (1 h ago)' },
        {
            group: 'Data', title: 'Bus network from OASA', status: 'warn',
            detail: 'The fetch at 2026-10-20 08:20 UTC stopped after 26 min, with 812 of 1203 routes\' stops: route 3923: HTTP 502 (4 tries).',
            hint: 'Restart the app to try again now, or wait for the 04:30 build.',
            progress: { done: 812, total: 1203, label: 'Routes\' stops fetched' },
        },
    ],
};

test('diagnostics: a bus network fetch that stopped shows how far it got, as a bar', async ({ page }) => {
    await page.route('**/admin/api/diagnostics', route => route.fulfill({ json: STOPPED }));
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.goto('/admin/diagnostics');

    const bar = page.getByRole('progressbar', { name: 'Routes\' stops fetched' });
    await expect(bar).toHaveAttribute('value', '812');
    await expect(bar).toHaveAttribute('max', '1203');
    await expect(page.locator('.diag-progress')).toContainText('812 / 1203');
    // Only the check that has a progress gets a bar
    await expect(page.getByRole('progressbar')).toHaveCount(1);
    expect(await axe(page)).toEqual([]);
});

test('the station editor is accessible too', async ({ page }) => {
    await page.goto('/admin/login');
    expect(await axe(page)).toEqual([]);
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/admin\/stations$/);
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
});
