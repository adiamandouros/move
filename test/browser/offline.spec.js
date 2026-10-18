// The offline cache (server/views/sw.js): the first visit says when it's
// ready, then the subway planner works without a connection, and pages that
// aren't saved show the offline page in their language.
import { axe, expect, test } from './fixtures.js';

test.use({ serviceWorkers: 'allow' });
test.beforeEach(({}, { project }) => test.skip(project.name === 'iphone', 'Playwright drives service workers in Chromium only'));

async function installed(page) {
    await page.goto('/');
    const toast = page.locator('.toast-message');
    await expect(toast).toContainText('Ready to use offline', { timeout: 15_000 });
    return toast;
}

test('the first visit says once it\'s ready, then the message goes', async ({ page }) => {
    const toast = await installed(page);
    expect(await axe(page)).toEqual([]);
    await page.clock.fastForward(5_000);
    await expect(toast).toHaveCount(0);
});

test('offline: the planner works, other pages show the offline page', async ({ page, context }) => {
    await installed(page);
    await context.setOffline(true);

    await page.goto('/subway?from=syntagma&to=airport');
    await expect(page.locator('.result-card').first()).toBeVisible();

    await page.goto('/about');
    await expect(page.locator('h1')).toHaveText('You\'re offline');
    await page.goto('/el/privacy');
    await expect(page.locator('h1')).toHaveText('Είστε εκτός σύνδεσης');
    expect(await axe(page)).toEqual([]);
});
