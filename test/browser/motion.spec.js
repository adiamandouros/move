// Motion where it shows what changed (Design · A step 7): each motion plays
// only when the phone hasn't asked for less (reduced motion), and none
// loops. Playwright's pages ask for no preference unless a test says so.
import { expect, test } from './fixtures.js';

// Decision 82: moving between pages, a view transition the browser plays by
// itself between two of Wayhop's pages (CSS's @view-transition); the new
// page says whether one played (pagereveal's viewTransition)
test.describe('moving between pages', () => {
    test.beforeEach(({}, { project }) => test.skip(project.name === 'iphone', 'Playwright\'s WebKit plays no transitions between pages'));

    const played = page => page.evaluate(() => window.__transition);
    const watch = page => page.addInitScript(() => {
        window.__transition = null;
        addEventListener('pagereveal', e => { window.__transition = Boolean(e.viewTransition); });
    });

    test('a tab tapped: the page cross-fades, the current tab\'s highlight slides to the new one, the bars stay put', async ({ page }) => {
        await watch(page);
        await page.goto('/subway');
        await page.locator('nav:visible a[data-tool="buses"]').click();
        await expect(page).toHaveURL(/\/buses$/);
        await expect.poll(() => played(page)).toBe(true);
        // Named, so it moves rather than fading: one highlight, and the bar it's in
        const names = await page.evaluate(() => [...document.querySelectorAll('*')]
            .filter(el => el.checkVisibility() && getComputedStyle(el).viewTransitionName !== 'none')
            .map(el => getComputedStyle(el).viewTransitionName));
        expect(names.sort()).toEqual(expect.arrayContaining(['nav-current']));
        expect(names.filter(name => name === 'nav-current')).toHaveLength(1);
        expect(names.some(name => name === 'bottom-nav' || name === 'side-nav')).toBe(true);
    });

    test.describe('with reduced motion', () => {
        test.use({ reducedMotion: 'reduce' });

        test('pages just switch', async ({ page }) => {
            await watch(page);
            await page.goto('/subway');
            await page.locator('nav:visible a[data-tool="buses"]').click();
            await expect(page).toHaveURL(/\/buses$/);
            await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
            expect(await played(page)).toBe(false);
        });
    });
});

// Decision 82's times: a minute counted down rolls up (and grows once as it
// turns due, tested in Node, times.test.js); a bus time a fresh answer
// changed rings once, the others stay still
test.describe('times', () => {
    test.beforeEach(({}, { project }) => test.skip(project.name !== 'phone', 'one phone: the same CSS everywhere'));

    // OASA's answer for any stop: the X95 in `minutes`, the 040 in 15'
    const answer = minutes => route => {
        const code = new URL(route.request().url()).searchParams.get('stops');
        route.fulfill({ json: { stops: { [code]: { arrivals: [
            { line: 'Χ95', to: { el: 'ΑΕΡΟΔΡΟΜΙΟ', en: 'AIRPORT' }, minutes },
            { line: '040', to: { el: 'ΠΕΙΡΑΙΑΣ', en: 'PIRAEUS' }, minutes: 15 },
        ] } } } });
    };
    const animation = locator => locator.evaluate(el => getComputedStyle(el).animationName);

    test('a bus time OASA\'s next answer changed rings once; one it didn\'t change stays still', async ({ page }) => {
        let minutes = 8;
        await page.route('**/api/arrivals?*', route => answer(minutes)(route));
        await page.goto('/buses?stop=10361');
        const row = page.locator('.stop-item .arrival-row');
        await expect(row.first().locator('.time-badge').first()).toHaveText(/8/);
        minutes = 5;
        await page.clock.runFor(35_000);
        const changed = row.first().locator('.time-badge').first();
        await expect(changed).toHaveText(/5/);
        await expect(changed).toHaveClass(/time-fresh/);
        expect(await animation(changed)).toBe('time-ring');
        await expect(row.nth(1).locator('.time-badge').first()).not.toHaveClass(/time-fresh/);
    });

    test('a train\'s minute counted down rolls up', async ({ page }) => {
        await page.goto('/subway?from=syntagma&to=airport');
        await expect(page.locator('.result-card .time-badge').first()).toBeVisible();
        // A minute on (another, in case a train leaving drew the card anew then)
        const rolled = page.locator('.result-card .time-tick').first();
        await expect(async () => {
            await page.clock.runFor(61_000);
            await expect(rolled).toBeVisible({ timeout: 1_000 });
        }).toPass();
        expect(await animation(rolled.locator('[aria-hidden="true"]'))).toBe('time-roll');
    });

    test.describe('with reduced motion', () => {
        test.use({ reducedMotion: 'reduce' });

        test('the times change as before, nothing moving', async ({ page }) => {
            let minutes = 8;
            await page.route('**/api/arrivals?*', route => answer(minutes)(route));
            await page.goto('/buses?stop=10361');
            const badge = page.locator('.stop-item .arrival-row').first().locator('.time-badge').first();
            await expect(badge).toHaveText(/8/);
            minutes = 5;
            await page.clock.runFor(35_000);
            await expect(badge).toHaveText(/5/);
            expect(await animation(badge)).toBe('none');
            await page.goto('/subway?from=syntagma&to=airport');
            await expect(page.locator('.result-card .time-badge').first()).toBeVisible();
            await page.clock.runFor(61_000);
            const moving = await page.locator('.result-card').first().evaluate(card => [...card.querySelectorAll('*')].filter(el => getComputedStyle(el).animationName !== 'none').length);
            expect(moving).toBe(0);
        });
    });
});
