// The phone layout: Home in the bottom bar, the language link in the footer,
// the one-time suggestion of the other language, and the install card.
import { axe, expect, test } from './fixtures.js';

test.beforeEach(({}, { project }) => test.skip(project.name === 'desktop', 'phones only'));

const visible = locator => locator.evaluate(el => el.offsetParent !== null && !el.hidden).catch(() => false);

test.describe('a phone set to Greek', () => {
    test.use({ locale: 'el-GR' });

    test('on an English page: the suggestion, once', async ({ page }, { project }) => {
        await page.goto('/subway?from=omonia&to=airport');
        await expect(page.locator('#bottom-nav a')).toHaveText(['Home', 'Subway', 'Buses', 'Info']);
        await expect(page.locator('.lang-suggest')).toBeVisible();
        await expect(page.locator('.lang-suggest a')).toHaveText('Διαβάστε το Wayhop στα ελληνικά');
        await expect(page.locator('.footer-language')).toBeAttached();
        expect(await visible(page.locator('.lang-toggle-btn').first())).toBe(false);
        expect(await axe(page)).toEqual([]);

        // Closing it moves the keyboard to the page, and it doesn't come back
        if (project.name === 'iphone') await page.locator('.lang-suggest-close').click();
        else { await page.locator('.lang-suggest-close').focus(); await page.keyboard.press('Enter'); }
        await expect(page.locator('.lang-suggest')).toBeHidden();
        if (project.name !== 'iphone') await expect(page.locator('#app-content')).toBeFocused();
        await page.goto('/info');
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('.lang-suggest')).toBeHidden();
    });

    test('the footer link switches, and Home goes home', async ({ page }) => {
        await page.goto('/subway?from=omonia&to=airport');
        await page.locator('.footer-language').click();
        await expect(page).toHaveURL(/:\d+\/el\/subway\?from=omonia&to=airport$/);
        const home = page.locator('#bottom-nav a').first();
        await expect(home).toHaveAttribute('href', '/el');
        await home.click();
        await expect(page).toHaveURL(/:\d+\/el$/);
        await expect(page.locator('#bottom-nav a').first()).toHaveAttribute('aria-current', 'page');
    });

    test('on a Greek page: no suggestion', async ({ page }) => {
        await page.goto('/el/info');
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('.lang-suggest')).toBeHidden();
    });
});

test('an English phone on an English page: no suggestion', async ({ page }) => {
    await page.goto('/subway');
    await expect(page.locator('#stop-search-from')).toBeVisible();
    await expect(page.locator('.lang-suggest')).toBeHidden();
});

test.describe('the install card', () => {
    test('where the browser offers installing: a button', async ({ page }, { project }) => {
        test.skip(project.name === 'iphone', 'iPhones get the steps instead');
        await page.goto('/');
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('#install')).toBeHidden();
        // Chrome's offer, simulated so the test controls it
        await page.evaluate(() => {
            const offer = new Event('beforeinstallprompt', { cancelable: true });
            offer.prompt = () => { window.prompted = true; };
            offer.userChoice = Promise.resolve({ outcome: 'accepted' });
            window.dispatchEvent(offer);
        });
        await expect(page.locator('#install-btn')).toBeVisible();
        await expect(page.locator('#install-ios')).toBeHidden();
        expect(await axe(page)).toEqual([]);
        await page.locator('#install-btn').click();
        expect(await page.evaluate(() => window.prompted)).toBe(true);
        await expect(page.locator('#install')).toBeHidden();
    });

    test('on an iPhone: the Share steps, and "Not now" for good', async ({ page }, { project }) => {
        test.skip(project.name !== 'iphone', 'the iPhone\'s steps');
        await page.goto('/el');
        await expect(page.locator('#install-ios')).toBeVisible();
        await expect(page.locator('#install-btn')).toBeHidden();
        await expect(page.locator('#install-ios')).toContainText('Προσθήκη στην οθόνη Αφετηρίας');
        expect(await axe(page)).toEqual([]);
        await page.locator('#install-close').click();
        await expect(page.locator('#install')).toBeHidden();
        await page.reload();
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('#install')).toBeHidden();
        await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/el/manifest.webmanifest');
    });
});

test('the bottom bar: Home lines up with the other icons and labels', async ({ page }) => {
    await page.goto('/subway');
    const links = page.locator('#bottom-nav a');
    await expect(links).toHaveCount(4);
    const tops = await links.evaluateAll(as => as.map(a => ({
        icon: Math.round(a.firstElementChild.getBoundingClientRect().top),
        label: Math.round(a.querySelector('.nav-label').getBoundingClientRect().top),
    })));
    for (const top of tops) expect(top).toEqual(tops[1]);
});
