// The admin pages (server/admin/): the diagnostics page, its checks as the
// server would send them (server/diagnostics.js), not run for real here
import { ADMIN_TEST_PASSWORD } from '../support/test-site.js';
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';

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

test('the use of OASA: today\'s row, the lines\' predictions and the pages opened, from what the app counted; its tables scroll and take the keyboard', async ({ page }, testInfo) => {
    // Someone looks at a stop: an answer the app counts
    await page.request.get('/api/arrivals?stops=10157');
    // and opens a Greek page
    await page.goto('/el/info');
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.goto('/admin/diagnostics');
    await page.getByRole('link', { name: 'Use of OASA' }).click();
    await expect(page).toHaveURL(/\/admin\/usage$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use of OASA');

    const asked = page.getByRole('region', { name: 'What Wayhop asked for' });
    const today = asked.getByRole('row').nth(1);
    await expect(today.getByRole('rowheader')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    // Different stops: one
    await expect(today.getByRole('cell').nth(7)).toHaveText('1');
    await expect(page.getByRole('region', { name: 'How OASA answered, per route' })).toBeVisible();
    // The stop's lines, and the most minutes ahead their buses were predicted
    const horizon = page.getByRole('region', { name: 'How far ahead OASA predicts, per line' });
    await expect(horizon.getByRole('rowheader').first()).toBeVisible();
    await expect(horizon.getByRole('row').nth(1).getByRole('cell').first()).toHaveText(/^\d+$/);
    // Today's pages, at least that one in Greek (other tests open pages too)
    const opened = page.getByRole('region', { name: 'Pages opened, by browser language' }).getByRole('row').nth(1);
    await expect(opened.getByRole('cell').nth(2)).toHaveText(/^[1-9]\d*$/);
    expect(await axe(page)).toEqual([]);
    if (testInfo.project.name !== 'iphone') {
        const walk = await keyboardWalk(page);
        expect(walk.problems, walk.stops.join(' → ')).toEqual([]);
        expect(walk.stops.join(' → ')).toMatch(/div "What Wayhop asked of OASA.*→ div "How each route to OASA.*→ div "How far ahead OASA predicts.*→ div "Pages opened per day/);
    }
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

test('the station editor records how each exit is reached: escalators up and stairs', async ({ page }) => {
    const saved = [];
    await page.route('**/admin/api/positions/**', route => {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { entry: route.request().postDataJSON().entry, edited: true } });
    });
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    // The first station is open; its back car is by an escalator, its front by stairs
    const escalators = page.getByRole('group', { name: 'Escalators up' });
    const stairs = page.getByRole('group', { name: 'Stairs' });
    await escalators.getByRole('button').first().click();
    await stairs.getByRole('button').last().click();
    await expect(escalators.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].entry).toMatchObject({ escalators: ['back'], stairs: ['front'] });
    expect(await axe(page)).toEqual([]);
});

test('the station editor records whether a platform is step-free, and "not known yet" saves nothing', async ({ page }) => {
    const saved = [];
    await page.route('**/admin/api/positions/**', route => {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { entry: route.request().postDataJSON().entry, edited: true } });
    });
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    const field = page.getByLabel('Step-free from the street (this platform)');
    await field.selectOption('ramp');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].entry.stepFree).toBe('ramp');

    await field.selectOption('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1].entry).not.toHaveProperty('stepFree');
});
