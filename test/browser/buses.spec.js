// The bus page's stops near you on a phone (tools/buses/client/): the
// floating buttons, the search's example and the heading over the stops,
// and the pause after 10 untouched minutes. Which stops it asks for and when
// is tested in Node (bus-timing.test.js), and every request of a scripted
// visit in bus-trace.spec.js.
import { expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone', 'iphone'));

// The floating buttons cover part of a stop scrolled under them: its walking
// directions still has room to tap (WCAG 2.5.8, axe's target-size), as it
// fills the stop's row rather than only its icon
test('the floating buttons are solid, and a stop\'s walking directions fill its row', async ({ page }) => {
    await page.goto('/buses');
    await expect(page.locator('.stop-item .time-badge').first()).toBeVisible();
    for (const background of await page.locator('#bus-actions .btn').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor))) {
        expect(background).not.toMatch(/transparent|rgba\(.*, 0\)/);
    }
    const sizes = await page.locator('.stop-item').evaluateAll(items => items.map(item => ({
        row: item.querySelector('.stop-header').getBoundingClientRect().height,
        link: item.querySelector('.directions-btn').getBoundingClientRect().height,
    })));
    for (const { row, link } of sizes) expect(link).toBeCloseTo(row, 0);
});

// The search's example is its placeholder; the nearby stops have a heading
// saying they're near you, and a stop or a line doesn't (its way back does)
for (const [url, heading, example] of [
    ['/buses', 'Stops near you', 'e.g. Syntagma, 10341, 040, X95'],
    ['/el/buses', 'Στάσεις κοντά σας', 'π.χ. Σύνταγμα, 10341, 040, Χ95'],
]) {
    test(`${url}: the search's example in the box, a heading over the stops near you`, async ({ page }) => {
        await page.goto(url);
        await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', example);
        await expect(page.locator('.stop-item').first()).toBeVisible();
        const nearby = page.getByRole('heading', { name: heading });
        await expect(nearby).toBeVisible();
        const [bottom, first] = await Promise.all([
            nearby.evaluate(e => e.getBoundingClientRect().bottom),
            page.locator('.stop-item').first().evaluate(e => e.getBoundingClientRect().top),
        ]);
        expect(bottom).toBeLessThanOrEqual(first);

        for (const view of ['?line=040', '?stop=10341']) {
            await page.goto(url + view);
            await expect(page.locator('.stop-item').first()).toBeVisible();
            await expect(nearby).toBeHidden();
        }
    });
}

// After 10 minutes nobody touched the page, it stops asking for times and
// says so, between the search and the stops, as much space above as below;
// a tap brings the times back
for (const url of ['/el/buses', '/el/buses?line=040']) {
    test(`${url}: the pause notice, evenly spaced, and a tap to resume`, async ({ page }) => {
        await page.goto(url);
        await expect(page.locator('.stop-item').first()).toBeVisible();
        await page.clock.runFor(11 * 60_000);
        const notice = page.locator('#bus-status');
        await expect(notice).toContainText('Σε παύση για εξοικονόμηση δεδομένων.');
        const gaps = await page.evaluate(() => {
            // A line's bar is pinned: measured where it sits above the stops, not over them
            document.getElementById('app-content').scrollTo(0, 0);
            const status = document.getElementById('bus-status').getBoundingClientRect();
            const header = document.getElementById('view-header');
            const line = document.getElementById('line-bar');
            const above = (!line.hidden ? line.lastElementChild : header.hidden ? document.getElementById('nearby-heading') : header.lastElementChild).getBoundingClientRect();
            return { above: Math.round(status.top - above.bottom), below: Math.round(document.getElementById('stops-accordion').getBoundingClientRect().top - status.bottom) };
        });
        expect(gaps.above, `space above and below: ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(gaps.below - 1);
        expect(gaps.above).toBeLessThanOrEqual(gaps.below + 1);
        expect(gaps.below).toBeGreaterThanOrEqual(8);

        await notice.getByRole('button', { name: 'Πατήστε για ανανέωση' }).click();
        await expect(notice).toBeHidden();
    });
}

