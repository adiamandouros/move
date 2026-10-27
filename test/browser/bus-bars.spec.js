// The bus page's bars (tools/buses/client/main.js, style.css): the buttons
// docked at the bottom of the screen (above the bottom nav on phones) however
// few stops show, and a line's number, name and directions pinned at the top
// while its stops scroll. What the keyboard moves to stays clear of both.
import { expect, onlyOn, test } from './fixtures.js';

// Where the screen ends for the page: the bottom nav's top on phones, the window's bottom on desktop
const screenEnd = page => page.evaluate(() => {
    const nav = document.getElementById('bottom-nav');
    return nav.getClientRects().length ? nav.getBoundingClientRect().top : innerHeight;
});
const bottomOf = locator => locator.evaluate(e => e.getBoundingClientRect().bottom);

test('the stops nearby: "More" and "Hide empty" sit at the bottom of the screen under a short list too', async ({ page }) => {
    // Tall enough that the first six stops leave room under them
    await page.setViewportSize({ width: page.viewportSize().width, height: 1000 });
    await page.goto('/buses');
    await expect(page.locator('.stop-item').first()).toBeVisible();
    const more = page.getByRole('button', { name: 'More', exact: true });
    const hide = page.locator('#toggle-empty-btn');
    await expect(more).toBeVisible();
    await expect(hide).toHaveText('Hide empty');
    // Six stops don't fill the screen: the buttons are still at its bottom, not under the last stop
    const last = await bottomOf(page.locator('.stop-item').last());
    const end = await screenEnd(page);
    expect(last).toBeLessThan(end - 100);
    expect(Math.abs(await bottomOf(page.locator('#bus-actions')) - end)).toBeLessThanOrEqual(1);

    await hide.click();
    await expect(hide).toHaveText('Show all');
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await hide.click();
    await expect(hide).toHaveText('Hide empty');
});

test('in Greek: «Περισσότερες» and «Απόκρυψη άδειων», pressed «Εμφάνιση όλων»', async ({ page }) => {
    await page.goto('/el/buses');
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await expect(page.locator('#show-more-btn')).toHaveText('Περισσότερες');
    const hide = page.locator('#toggle-empty-btn');
    await expect(hide).toHaveText('Απόκρυψη άδειων');
    await hide.click();
    await expect(hide).toHaveText('Εμφάνιση όλων');
});

test('search results: "More" is docked at the bottom of the screen too', async ({ page }) => {
    await page.goto('/buses');
    await page.getByLabel('Find a stop by name or code, or a line').fill('α');
    const more = page.locator('#search-results').getByRole('button', { name: 'More', exact: true });
    await expect(more).toBeVisible();
    const bar = page.locator('#search-results .filter-bar');
    const content = page.locator('#app-content');
    for (const to of [0, 'end']) {
        await content.evaluate((m, y) => m.scrollTo(0, y === 'end' ? m.scrollHeight : y), to);
        expect(Math.abs(await bottomOf(bar) - await screenEnd(page))).toBeLessThanOrEqual(1);
    }
});

test.describe('a line', () => {
    test('its number, name and directions stay at the top while its stops scroll; the way back doesn\'t', async ({ page }) => {
        await page.goto('/buses?line=040');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        const content = page.locator('#app-content');
        await content.evaluate(m => m.scrollTo(0, m.scrollHeight));
        const top = await content.evaluate(m => m.getBoundingClientRect().top);
        const bar = page.locator('#line-bar');
        await expect.poll(() => bar.evaluate(e => e.getBoundingClientRect().top)).toBe(top);
        await expect(bar.locator('.line-heading')).toBeInViewport();
        await expect(page.locator('.back-link')).not.toBeInViewport();
        // Stops pass under it: it's drawn over them
        const under = await bar.evaluate(e => {
            const r = e.getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.bottom - 2)?.closest('#line-bar') !== null;
        });
        expect(under).toBe(true);

        await bar.getByRole('button', { name: 'To PEIRAIAS' }).click();
        await expect(page).toHaveURL(/dir=1/);
        await expect(page.locator('#line-bar [data-direction="1"]')).toHaveAttribute('aria-pressed', 'true');
    });


    // A stop half under the bar is too small a target to tap (WCAG 2.5.8, axe-core's target-size)
    const cutStops = page => page.evaluate(() => {
        const pinned = document.getElementById('line-bar').getBoundingClientRect().bottom;
        return [...document.querySelectorAll('#stops-accordion > .stop-item')].filter(row => {
            const r = row.getBoundingClientRect();
            return r.top < pinned - 1 && r.bottom > pinned + 1;
        }).map(row => row.dataset.stop);
    });

    test('opened, it scrolls to the nearest stop with no stop left half under its bar', async ({ page }) => {
        await page.goto('/buses?line=040');
        await expect(page.locator('.stop-nearest')).toBeInViewport();
        await expect.poll(() => cutStops(page)).toEqual([]);
    });
});

// WebKit only Tabs to links with Safari's setting on (README)
test.describe('a line, with the keyboard', () => {
    test.beforeEach(onlyOn('phone', 'desktop'));

    test('the keyboard never ends up under its bar, or under the bottom nav', async ({ page }) => {
        await page.goto('/buses?line=040');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        await page.locator('#app-content').evaluate(m => m.scrollTo(0, 0));
        await page.locator('.line-heading').focus();
        const end = await screenEnd(page);
        let seen = 0;
        for (let i = 0; i < 40; i++) {
            await page.keyboard.press('Tab');
            const at = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el?.closest('#stops-accordion')) return null;
                const r = el.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom, pinned: document.getElementById('line-bar').getBoundingClientRect().bottom };
            });
            if (!at) continue;
            seen++;
            expect(at.top, `focus ${i} under the line's bar`).toBeGreaterThanOrEqual(at.pinned - 1);
            expect(at.bottom, `focus ${i} under the bottom nav`).toBeLessThanOrEqual(end + 1);
        }
        expect(seen).toBeGreaterThan(10);
    });

    test('the bars\' own buttons take the keyboard without the page jumping', async ({ page }) => {
        await page.goto('/buses?line=040');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        const content = page.locator('#app-content');
        await content.evaluate(m => m.scrollTo(0, m.scrollHeight / 2));
        const at = await content.evaluate(m => m.scrollTop);
        await page.locator('#line-bar [data-direction="1"]').focus();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('#line-bar [data-direction="0"]')).toBeFocused();
        expect(await content.evaluate(m => m.scrollTop)).toBe(at);

        await page.goto('/buses');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        await page.locator('#show-more-btn').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.stop-item')).toHaveCount(12);
        expect(await content.evaluate(m => m.scrollTop)).toBe(0);
    });

});

test.describe('a line, at large text', () => {
    test.beforeEach(onlyOn('phone', 'iphone'));

    test('at 200% text on a small phone, its bar takes at most a third of the screen, or isn\'t pinned', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.goto('/buses?line=040');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        const bar = page.locator('#line-bar');
        await expect.poll(() => bar.evaluate(e => {
            const height = document.getElementById('app-content').clientHeight;
            return e.classList.contains('line-bar-unpinned') || e.offsetHeight <= height / 3;
        })).toBe(true);
        // Whichever it is, the page knows: nothing reserved at the top when it isn't pinned
        const { unpinned, pad } = await bar.evaluate(e => ({ unpinned: e.classList.contains('line-bar-unpinned'), pad: getComputedStyle(e.ownerDocument.querySelector('.stop-toggle')).scrollMarginTop }));
        if (unpinned) expect(pad).toBe('0px');
        else expect(pad).not.toBe('0px');
    });
});
