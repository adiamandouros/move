// Buses without the location (tools/buses/client/main.js): finding a stop by
// name or code and a line by its number, a stop's live times, a line's stops
// in order, and what each asks of OASA: searching nothing, a stop or a line
// only the stops opened. Which names match is tested in Node
// (bus-search.test.js); here, what a person does.
import { watchRequests } from './bus-requests.js';
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';

const search = page => page.getByLabel('Find a stop by name or code, or a line');
const results = page => page.locator('#search-results');
const stopLinks = page => results(page).locator('a[href*="?stop="]');

test.describe('searching', () => {
    test.beforeEach(onlyOn('phone', 'desktop'));

    test('by Greek or Latin name, with or without accents, or by code: our data only, nothing asked of OASA', async ({ page }) => {
        const { asks } = await watchRequests(page);
        await page.goto('/buses');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        const before = (await asks()).length;
        for (const query of ['Σύνταγμα', 'syntagma', 'SYNTAGMA']) {
            await search(page).fill(query);
            await expect(stopLinks(page).first()).toContainText('SYNTAGMA');
            // Eight stops called SYNTAGMA, each told apart by its code
            await expect(stopLinks(page).filter({ hasText: /^\s*SYNTAGMA\b/ })).toHaveCount(8);
            await expect(stopLinks(page).filter({ hasText: '10341' })).toHaveCount(1);
            // Covering the stops nearby while it's there
            await expect(page.locator('#bus-view')).toBeHidden();
        }
        await search(page).fill('10341');
        await expect(stopLinks(page).first()).toContainText('10341');
        await expect(page.locator('#search-status')).toContainText(/Stops: \d+/);
        // Saying what a tap does
        await expect(results(page).locator('.search-hint')).toHaveText('Tap a stop to see when its next buses come.');
        // Nearest first, with how far: the location is known
        await search(page).fill('syntagma');
        await expect(stopLinks(page).first()).toContainText(/\d+ m/);
        expect((await asks()).length, 'requests to OASA while searching').toBe(before);

        await search(page).fill('');
        await expect(page.locator('#bus-view')).toBeVisible();
        await expect(results(page)).toBeHidden();
    });

    test('a line by its number, typed with Latin letters too', async ({ page }) => {
        await page.goto('/buses');
        await search(page).click();
        await search(page).fill('x95');
        const lines = results(page).locator('a[href*="?line="]');
        await expect(lines).toHaveCount(1);
        await expect(lines).toContainText('Χ95');
        await expect(lines).toContainText('SYNTAGMA - AEROL. ATHINON');
        await expect(page.locator('#search-status')).toHaveText(/Lines: 1/);
    });

    test('nothing found says so; Enter follows the first result', async ({ page }) => {
        await page.goto('/buses');
        await search(page).fill('zzzz');
        await expect(page.locator('#search-status')).toHaveText('No stop or line matches “zzzz”.');
        await search(page).fill('10341');
        await search(page).press('Enter');
        await expect(page).toHaveURL(/\/buses\?stop=10341$/);
        await expect(page.locator('.stop-item')).toHaveCount(1);
    });

    test('more stops than fit: a button shows the next ones and moves the keyboard to them', async ({ page }) => {
        await page.goto('/buses');
        await search(page).fill('α');
        await expect(stopLinks(page)).toHaveCount(20);
        await page.getByRole('button', { name: 'Show more stops' }).click();
        await expect(stopLinks(page)).toHaveCount(40);
        await expect(stopLinks(page).nth(20)).toBeFocused();
    });
});

test('a stop: opened, its live times asked for at once and every 30 s, and the way back', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses');
    await search(page).fill('10341');
    // 10341 is near where the test stands, so it was asked for already: count from here
    const from = await page.evaluate(() => Date.now());
    await stopLinks(page).first().click();
    await expect(page).toHaveURL(/\/buses\?stop=10341$/);
    const stop = page.locator('[data-stop="10341"]');
    await expect(stop.locator('.stop-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(stop.locator('.stop-toggle')).toBeFocused();
    await expect(stop.locator('.arrival-row').first()).toBeVisible();
    await expect(stop.locator('.stop-label')).toContainText('10341');
    // Its lines lead to their stops
    await expect(stop.getByRole('link', { name: '040' })).toHaveAttribute('href', '/buses?line=040');

    await run(95);
    const times = (await asks()).filter(a => a.code === '10341' && a.at >= from).map(a => a.at);
    const gaps = times.slice(1).map((t, i) => Math.round((t - times[i]) / 1000));
    expect(gaps.length, `gaps ${gaps}`).toBeGreaterThanOrEqual(2);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(30);
    // Only that stop: the nearby ones aren't on screen
    expect(new Set((await asks()).filter(a => a.at > times[0]).map(a => a.code))).toEqual(new Set(['10341']));

    await page.getByRole('link', { name: 'Stops near you' }).click();
    await expect(page).toHaveURL(/\/buses$/);
    await expect(page.locator('.stop-item').nth(1)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stops near you' })).toBeVisible();
});

test('a line: its stops in order, nearest marked, nothing asked until a stop is opened; the other direction', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses?line=040');
    await expect(page.getByRole('heading', { name: /040/ })).toBeVisible();
    const items = page.locator('.stop-item');
    // OASA's first way, to Syntagma: it ends at 10341, near where the test
    // stands; the stop nearest is marked and on screen
    await expect(items).toHaveCount(38);
    await expect(items.last()).toHaveAttribute('data-stop', '10341');
    const nearest = page.locator('.stop-nearest');
    await expect(nearest).toHaveCount(1);
    await expect(nearest).toContainText('Nearest to you');
    await expect(nearest).toBeInViewport();
    const metres = await items.locator('.stop-distance').evaluateAll(els => els.map(e => parseFloat(e.textContent.replace(/[^\d.]/g, '')) * (/km/.test(e.textContent) ? 1000 : 1)));
    expect(parseFloat((await nearest.locator('.stop-distance').textContent()).replace(/[^\d.]/g, ''))).toBe(Math.min(...metres));
    await run(40);
    expect(await asks(), 'requests before a stop is opened').toEqual([]);

    await items.nth(3).locator('.stop-toggle').click();
    await run(65);
    const code = await items.nth(3).getAttribute('data-stop');
    const asked = await asks();
    expect(new Set(asked.map(a => a.code))).toEqual(new Set([code]));
    expect(asked.length).toBeGreaterThanOrEqual(3);

    // The other way, named in the page's language
    const back = page.getByRole('button', { name: 'To PEIRAIAS', exact: true });
    await expect(page.getByRole('button', { name: 'To SYNTAGMA', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await back.click();
    await expect(page).toHaveURL(/\/buses\?line=040&dir=1$/);
    await expect(back).toHaveAttribute('aria-pressed', 'true');
    await expect(back).toBeFocused();
    await expect(items).toHaveCount(38);
    await expect(items.first()).toHaveAttribute('data-stop', '10341');
    // A line's stop opens its times
    await items.first().locator('.stop-toggle').click();
    await expect(items.first().locator('.arrival-row').first()).toBeVisible();
});

test('Back and Forward move between the views; a shared address opens the same view', async ({ page }) => {
    await page.goto('/el/buses');
    await page.getByLabel('Βρείτε στάση με όνομα ή κωδικό, ή γραμμή').fill('040');
    await results(page).locator('a[href*="?line=040"]').click();
    await expect(page).toHaveURL(/\/el\/buses\?line=040$/);
    await expect(page.locator('.line-heading')).toBeFocused();
    const entries = () => page.evaluate(() => history.length);
    const before = await entries();
    const first = page.locator('.stop-item').first();
    await first.locator('.stop-toggle').click();
    // Opened all the way (Bootstrap's "collapsing" while it slides)
    await expect(first.locator('.accordion-collapse')).toHaveClass(/(^| )show( |$)/);
    await first.getByRole('link', { name: '040' }).click();
    await expect.poll(entries, 'the stop\'s line link adds a page to the history').toBe(before + 1);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/el\/buses$/);
    await expect(page.locator('.line-heading')).toHaveCount(0);
    await expect(page.locator('.stop-item').nth(1)).toBeVisible();
    await page.goForward();
    await expect(page.locator('.line-heading')).toContainText('ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ');
    await page.reload();
    await expect(page.locator('.line-heading')).toContainText('ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ');
});

test.describe('no location', () => {
    test.use({ location: { permission: 'prompt', answer: 'never' } });

    test('a stop or a line opens without asking for the location, with no distances', async ({ page }) => {
        await page.goto('/buses?line=Χ95');
        await expect(page.locator('.stop-item')).toHaveCount(19);
        await expect(page.locator('.stop-nearest')).toHaveCount(0);
        await expect(page.locator('.stop-distance').first()).toBeEmpty();
        await page.goto('/buses?stop=10361');
        await expect(page.locator('.stop-item .arrival-row').first()).toBeVisible();
        expect(await page.evaluate(() => window.__geo), 'asked for the location').toBe(0);
        // The stops nearby still ask first
        await page.getByRole('link', { name: 'Stops near you' }).click();
        await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
    });

    test('searching works without one: by name, without distances', async ({ page }) => {
        await page.goto('/buses');
        await search(page).fill('syntagma');
        await expect(stopLinks(page).first()).toBeVisible();
        await expect(stopLinks(page).first()).not.toContainText(/\d m\b|km/);
    });
});

test('an unknown stop or line says so', async ({ page }) => {
    await page.goto('/buses?stop=99999999');
    await expect(page.locator('#bus-message')).toContainText("There's no stop with code 99999999.");
    await page.goto('/buses?line=nope');
    await expect(page.locator('#bus-message')).toContainText("There's no line nope.");
    await expect(page.getByRole('link', { name: 'Stops near you' })).toBeVisible();
});

test.describe('the lines can\'t be loaded', () => {
    test.use({ allowErrors: [/status of 503/] });

    test('a line says so; searching still finds stops', async ({ page }) => {
        await page.route('**/data/bus-lines.json', route => route.fulfill({ status: 503, body: '' }));
        await page.goto('/buses?line=040');
        await expect(page.locator('#bus-message')).toContainText("Couldn't load the lines.");
        await page.goto('/buses');
        await search(page).fill('syntagma');
        await expect(stopLinks(page).first()).toBeVisible();
    });
});

test('with the keyboard alone: search, a result, the stop, and back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'iphone', 'WebKit only tabs to links with Safari\'s setting on');
    await page.goto('/buses');
    await search(page).focus();
    await page.keyboard.type('10341');
    // The stops load in the background: Tab before they're shown would go past them
    await expect(stopLinks(page).first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(stopLinks(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-stop="10341"] .stop-toggle')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('link', { name: 'Stops near you' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/buses$/);
    await expect(page.locator('.stop-item .stop-toggle').first()).toBeFocused();
});

for (const lang of ['en', 'el']) {
    test(`${lang}: search results are accessible and work with the keyboard`, async ({ page }, testInfo) => {
        await page.goto(lang === 'el' ? '/el/buses' : '/buses');
        await page.locator('#bus-search-input').fill('συντ');
        await expect(stopLinks(page).first()).toBeVisible();
        expect(await axe(page), 'axe-core violations').toEqual([]);
        if (testInfo.project.name !== 'iphone') {
            const walk = await keyboardWalk(page);
            expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
        }
    });
}
