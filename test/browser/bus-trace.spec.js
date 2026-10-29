// Every request the bus page makes in a scripted visit, second by second:
// what it asks of /api/arrivals, and so of OASA, written down so a change to
// how the page polls (tools/buses/client/) can't change it unnoticed. A change
// that means to (new numbers, agreed first: decision 7) updates these lists.
import { onScreen, watchRequests } from './bus-requests.js';
import { expect, onlyOn, test } from './fixtures.js';

// Which stops are on screen depends on the device's fonts and sizes: one device
test.beforeEach(onlyOn('phone'));
test.use({ viewport: { width: 390, height: 600 } });

// The requests from now on, as [the second they were made in, stop code], in
// order (run() moves the clock on a whole second at a time from now)
async function recorder(page, asks) {
    const from = (await asks()).length;
    const t0 = await page.evaluate(() => Date.now());
    return async () => (await asks()).slice(from)
        .map(a => [Math.floor((a.at - t0) / 1000), a.code])
        .sort(([t1, c1], [t2, c2]) => t1 - t2 || c1.localeCompare(c2));
}

// After a scroll or a tap, the stops it asks for at once: the browser says
// which stops came on screen when it draws, in real time, so the clock waits
// for those first (each asked for at the second the scroll or tap came)
const askedFor = (page, codes) => page.waitForFunction(codes => codes.every(code => window.__asks.some(a => a.code === code)), codes);

test('the stops nearby: more stops, refreshes for 2 minutes, a scroll, a stop opened, empty stops hidden', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses');
    await expect(page.locator('.stop-item .time-badge').first()).toBeVisible();
    await run(1);
    const trace = await recorder(page, asks);

    await page.locator('#show-more-btn').click();
    await page.locator('#app-content').evaluate(m => m.scrollTo(0, 0));
    await askedFor(page, await onScreen(page));
    await run(125);
    await page.locator('#app-content').evaluate(m => m.scrollTo(0, m.scrollHeight));
    await askedFor(page, await onScreen(page));
    await run(5);
    const [first] = await onScreen(page);
    await page.locator(`[data-stop="${first}"] .stop-toggle`).click();
    await run(35);
    await page.locator('#toggle-empty-btn').click();
    await run(65);

    expect(await trace()).toEqual(NEARBY);
});

test('a line: nothing until a stop is opened, then that stop every 30 s', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses?line=040');
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await run(1);
    const trace = await recorder(page, asks);

    await run(10);
    const nearest = page.locator('.stop-item.stop-nearest');
    await nearest.locator('.stop-toggle').click();
    await askedFor(page, [await nearest.getAttribute('data-stop')]);
    await run(65);

    expect(await trace()).toEqual(LINE);
});

const NEARBY = [
    [0, '61335'],
    [30, '10341'], [30, '10361'], [30, '60718'], [30, '60991'], [30, '60998'],
    [32, '61335'],
    [60, '60002'],
    [62, '10341'], [62, '10361'], [62, '60718'], [62, '60991'], [62, '60998'],
    [64, '61335'],
    [94, '10341'], [94, '10361'], [94, '60718'], [94, '60991'], [94, '60998'],
    [96, '61335'],
    [122, '60002'],
    [125, '10343'], [125, '60015'], [125, '61020'], [125, '61197'], [125, '61357'],
    [126, '60998'],
    [128, '61335'],
    [157, '61197'], [157, '61357'],
    [158, '60998'],
    [160, '61335'],
    [187, '10343'], [187, '60015'],
    [189, '61197'], [189, '61357'],
    [190, '60998'],
    [192, '61335'],
    [221, '61197'], [221, '61357'],
    [222, '60998'],
    [224, '61335'],
];
const LINE = [[10, '10341'], [42, '10341'], [74, '10341']];
