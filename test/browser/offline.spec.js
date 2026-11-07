// The offline cache (server/views/sw.js): the first visit says when it's
// ready, then the subway planner works without a connection, pages that
// aren't saved show the offline page in their language, and a connection that
// hangs (underground, no signal: requests get no answer, not an error) doesn't
// keep anyone waiting.
import { axe, expect, test } from './fixtures.js';
import { pickBoth } from './trip-page.js';

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

// Every request goes out and nothing ever comes back. Includes the service
// worker's own requests, which page.route() doesn't see
const noSignal = context => context.route('**/*', () => {});

test('offline: trips with the tram work too, and the switch', async ({ page, context }) => {
    await installed(page);
    await context.setOffline(true);

    await page.goto('/subway?from=kifisia&to=zappeio');
    await expect(page.locator('.result-card .line-t6').first()).toBeVisible();
    await page.getByRole('switch', { name: 'Tram' }).uncheck();
    await expect(page.locator('#stop-search-to')).toHaveValue('');
});

test('no signal: the app opens at once, in both languages', async ({ page, context }) => {
    await installed(page);
    await noSignal(context);

    for (const path of ['/', '/el']) {
        const started = Date.now();
        await page.goto(path);
        await expect(page.locator('.home-tiles a').first()).toBeVisible();
        expect(Date.now() - started, path).toBeLessThan(2_500);
    }
});

test('no signal: a page seen before comes from the cache, one that wasn\'t gets the offline page', async ({ page, context }) => {
    await installed(page);
    await page.goto('/about');
    const about = await page.locator('h1').textContent();
    await noSignal(context);

    await page.goto('/about');
    await expect(page.locator('h1')).toHaveText(about);
    await page.goto('/privacy');
    await expect(page.locator('h1')).toHaveText('You\'re offline');
});

test('a slow connection: a page not saved yet still arrives', async ({ page, context }) => {
    await installed(page);
    await context.route('**/about', async route => {
        await new Promise(resolve => setTimeout(resolve, 4_000));
        await route.continue();
    });
    await page.goto('/about');
    await expect(page.locator('h1')).not.toHaveText('You\'re offline');
});

test('a worker\'s own scripts come from the server each time, not from an older copy in the cache', async ({ page, context }) => {
    await installed(page);
    // The trip page's worker imports it without a version (tools/trip/client/worker.js)
    const asked = [];
    await context.route('**/tools/trip/searcher.js', route => {
        asked.push(route.request().url());
        return route.continue();
    });
    await page.goto('/trip');
    await expect.poll(() => asked.length).toBe(1);
    await page.goto('/trip');
    await expect.poll(() => asked.length).toBe(2);
});

// The version a deploy brings, installed in the background from `page`: a
// worker from another address stands in for it. It waits while `page` is open
async function newVersionWaiting(page) {
    return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.register('/sw.js?next');
        const worker = registration.installing ?? registration.waiting;
        await new Promise(resolve => {
            if (worker.state === 'installed') resolve();
            worker.addEventListener('statechange', () => worker.state === 'installed' && resolve());
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        return { waiting: registration.waiting?.state, active: registration.active?.scriptURL };
    });
}

test('a new version installs in the background: the open page is not reloaded', async ({ page }) => {
    await installed(page);
    await page.evaluate(() => { window.untouched = true; });

    const state = await newVersionWaiting(page);

    expect(state.waiting).toBe('installed');
    expect(state.active).toMatch(/\/sw\.js$/);
    expect(await page.evaluate(() => window.untouched)).toBe(true);
});

// The Trip page's searches as an older copy kept by a service worker from
// before they came from the server first (6 Nov 2026): they failed every trip
const OLD_SEARCHER = 'export const searcher = ({ post }) => message => { if (\'from\' in message) post({ id: message.id, error: true }); };';

test('the Trip page\'s bus searches failing with a newer version waiting: it says to close Wayhop and open it again', async ({ page, context }) => {
    await installed(page);
    await context.route('**/tools/trip/searcher.js', route => route.fulfill({ contentType: 'text/javascript', body: OLD_SEARCHER }));
    const failed = text => text.getByText('The bus times couldn\'t be loaded');
    const updated = text => text.getByText('Wayhop has been updated.');

    // Nothing newer: the times couldn't be loaded
    await pickBoth(page);
    await expect(failed(page)).toBeVisible();
    await expect(updated(page)).toHaveCount(0);

    // A newer version waiting while this page is open, and the trip again on another
    await newVersionWaiting(page);
    const other = await context.newPage();
    await pickBoth(other);
    await expect(updated(other)).toBeVisible();
    await expect(updated(other)).toContainText('Close it everywhere it\'s open, every tab and the app, then open it again for the buses.');
    await expect(failed(other)).toHaveCount(0);
    await expect(other.locator('.trip-card').first()).toBeVisible();
    expect(await axe(other)).toEqual([]);
});
