// /js/core/ready-buses.js in a page: the Trip page's buses.json fetched in the
// background once the page has loaded, not when the browser asks to save data
// (decision 39). Which pages load it: test/ready-buses.test.js.
import { expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone'));

// Every fetch of buses.json, counted in the page as it's made
async function counted(page, { saveData = false } = {}) {
    await page.addInitScript(saveData => {
        if (saveData) Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
        window.__buses = 0;
        const real = window.fetch;
        window.fetch = (url, ...rest) => {
            if (String(url).includes('/data/buses.json')) window.__buses++;
            return real(url, ...rest);
        };
    }, saveData);
    return async () => {
        // Past the longest wait for the page to be idle
        await page.clock.runFor(6_000);
        return page.evaluate(() => window.__buses);
    };
}

test('Home fetches it once it has loaded; the Info page, read only, doesn\'t', async ({ page }) => {
    const fetched = await counted(page);
    await page.goto('/');
    expect(await fetched()).toBe(1);
    await page.goto('/info');
    expect(await fetched()).toBe(0);
});

test('not when the browser asks to save data', async ({ page }) => {
    const fetched = await counted(page, { saveData: true });
    await page.goto('/buses');
    expect(await fetched()).toBe(0);
});
