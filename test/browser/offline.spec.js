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
    // Still in Roboto
    expect(await page.evaluate(() => [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Roboto').map(f => f.status))).toEqual(['loaded', 'loaded']);

    await page.goto('/about');
    await expect(page.locator('h1')).toHaveText('You\'re offline');
    await page.goto('/el/privacy');
    await expect(page.locator('h1')).toHaveText('Είστε εκτός σύνδεσης');
    expect(await axe(page)).toEqual([]);
});

test('a new version installs in the background: the open page is not reloaded', async ({ page }) => {
    await installed(page);
    await page.evaluate(() => { window.untouched = true; });

    // A worker from another address stands in for the one a deploy brings
    const state = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.register('/sw.js?next');
        const worker = registration.installing ?? registration.waiting;
        await new Promise(resolve => {
            if (worker.state === 'installed') resolve();
            worker.addEventListener('statechange', () => worker.state === 'installed' && resolve());
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        return { waiting: registration.waiting?.state, active: registration.active?.scriptURL };
    });

    expect(state.waiting).toBe('installed');
    expect(state.active).toMatch(/\/sw\.js$/);
    expect(await page.evaluate(() => window.untouched)).toBe(true);
});
