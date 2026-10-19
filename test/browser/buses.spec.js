// The bus page's requests (see tools/buses/client/main.js): only stops on
// screen are asked for, each refreshed by when its next bus comes, and the
// minutes count down in between. The clock is moved on by the test, so
// minutes of refreshes take a second.
import { arrivalsAt } from '../support/test-site.js';
import { refreshEvery } from '../../tools/buses/client/timing.js';
import { onScreen, watchRequests } from './bus-requests.js';
import { expect, test } from './fixtures.js';

test.beforeEach(({}, { project }) => test.skip(project.name === 'desktop', 'needs a screen too short for every stop'));
// A short phone, so not every stop fits on screen
test.use({ viewport: { width: 390, height: 600 } });

test('only stops on screen are asked for, the rest once scrolled to', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses');
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await page.locator('#show-more-btn').click();
    await page.locator('#app-content').evaluate(m => m.scrollTo(0, 0));
    await run(4);

    const all = await page.locator('.stop-item').evaluateAll(items => items.map(e => e.dataset.stop));
    const shown = await onScreen(page);
    const below = all.filter(code => !shown.includes(code));
    const asked = new Set((await asks()).map(a => a.code));
    expect(below.length, 'some stops below the screen').toBeGreaterThan(0);
    expect(shown.filter(code => !asked.has(code)), 'stops on screen not asked for').toEqual([]);
    expect(below.filter(code => asked.has(code)), 'stops below the screen asked for').toEqual([]);

    for (const code of below) {
        await page.locator(`[data-stop="${code}"]`).scrollIntoViewIfNeeded();
        await run(2);
    }
    const askedNow = new Set((await asks()).map(a => a.code));
    expect(below.filter(code => !askedNow.has(code)), 'stops scrolled to, not asked for').toEqual([]);
});

test('each stop is refreshed by when its next bus comes; stops off screen aren\'t', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses');
    await expect(page.locator('.stop-item .arrival-badge').first()).toBeVisible();
    await page.locator('#show-more-btn').click();
    await page.locator('#app-content').evaluate(m => m.scrollTo(0, 0));
    await run(5);
    const shown = await onScreen(page);
    const from = await page.evaluate(() => Date.now());
    await run(150);

    const all = await asks();
    for (const code of shown) {
        const times = all.filter(a => a.code === code).map(a => a.at);
        const gaps = times.slice(1).map((t, i) => Math.round((t - times[i]) / 1000));
        const next = arrivalsAt(code)[0]?.minutes;
        // The tiers in timing.js (tested on their own in bus-timing.test.js); the page checks once a second
        const every = refreshEvery({ arrivals: next === undefined ? [] : [{ minutes: next }] }) / 1000;
        const what = `stop ${code} (next bus in ${next} min): gaps ${gaps}`;
        expect(gaps.length, what).toBeGreaterThan(0);
        for (const gap of gaps) {
            expect(gap, what).toBeGreaterThanOrEqual(every);
            expect(gap, what).toBeLessThanOrEqual(every + 1);
        }
    }
    const offScreen = all.filter(a => a.at > from && !shown.includes(a.code));
    expect(offScreen, 'refreshes of stops off screen').toEqual([]);
});

test('between refreshes the minutes count down; opening a stop catches up at once', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses');
    await expect(page.locator('.stop-item .arrival-badge').first()).toBeVisible();
    await run(3);
    const shown = await onScreen(page);
    // A stop refreshed every minute: its next bus 11–20 minutes away
    const slow = shown.find(code => arrivalsAt(code)[0]?.minutes > 10);
    expect(slow, 'a stop on screen with its next bus over 10 minutes away').toBeTruthy();
    const badge = page.locator(`[data-stop="${slow}"] .header-badge-wrap`);
    const minutes = async () => parseInt(await badge.textContent());
    const asksFor = async () => (await asks()).filter(a => a.code === slow);
    const before = await minutes();
    const asked = (await asksFor()).length;

    // The badge takes off whole minutes since the answer, and the stop is
    // refreshed after 62 s: at 60.5 s it shows one minute less, unasked
    const answered = (await asksFor()).at(-1).at;
    await run(Math.round((answered + 60_500 - await page.evaluate(() => Date.now())) / 1000));
    expect((await asksFor()).length, 'no new request yet').toBe(asked);
    expect(await minutes()).toBe(before - 1);

    // Older than 32 s, so opening it asks at once
    await page.locator(`[data-stop="${slow}"] .stop-toggle`).click();
    await run(1);
    expect((await asksFor()).length).toBe(asked + 1);
});
