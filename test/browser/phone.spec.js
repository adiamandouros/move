// The phone layout: Home and the menu in the bottom bar, the language link in the menu,
// the one-time suggestion of the other language, and the install card.
import { axe, expect, test } from './fixtures.js';

test.beforeEach(({}, { project }) => test.skip(project.name === 'desktop', 'phones only'));

const visible = locator => locator.evaluate(el => el.offsetParent !== null && !el.hidden).catch(() => false);

test.describe('a phone set to Greek', () => {
    test.use({ locale: 'el-GR' });

    test('on an English page: the suggestion, once', async ({ page }, { project }) => {
        await page.goto('/subway?from=omonia&to=airport');
        await expect(page.locator('#bottom-nav a')).toHaveText(['Home', 'Subway', 'Buses', 'Info']);
        await expect(page.locator('#bottom-nav button')).toHaveText('');
        await expect(page.locator('#bottom-nav button')).toHaveAccessibleName('Menu');
        await expect(page.locator('.lang-suggest')).toBeVisible();
        await expect(page.locator('.lang-suggest a')).toHaveText('Διαβάστε το Wayhop στα ελληνικά');
        await expect(page.locator('#site-menu .menu-language')).toBeAttached();
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
        await page.locator('.menu-btn').click();
        await page.locator('#site-menu .menu-language').click();
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

test('the bottom bar: Home lines up with the other icons, and the labels with each other', async ({ page }) => {
    await page.goto('/subway');
    const items = page.locator('#bottom-nav > a');
    await expect(items).toHaveCount(4);
    const icons = await items.evaluateAll(els => els.map(el => el.firstElementChild).map(el => Math.round(el.getBoundingClientRect().top)));
    const labels = await page.locator('#bottom-nav .nav-label').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    expect(labels).toHaveLength(4);
    for (const t of icons) expect(t).toBe(icons[1]);
    for (const t of labels) expect(t).toBe(labels[1]);
});

test('the bottom bar: the menu icon fills its button, in the middle', async ({ page }) => {
    await page.goto('/subway');
    const { button, icon } = await page.locator('#bottom-nav .menu-btn').evaluate(el => {
        const style = getComputedStyle(el);
        const px = name => parseFloat(style[name]);
        const b = el.getBoundingClientRect();
        // Inside the button's border and padding
        const button = {
            left: b.left + px('borderLeftWidth') + px('paddingLeft'), right: b.right - px('borderRightWidth') - px('paddingRight'),
            top: b.top + px('borderTopWidth') + px('paddingTop'), bottom: b.bottom - px('borderBottomWidth') - px('paddingBottom'),
        };
        const i = el.querySelector('svg').getBoundingClientRect();
        return { button, icon: { left: i.left, right: i.right, top: i.top, bottom: i.bottom } };
    });
    for (const side of ['left', 'right', 'top', 'bottom']) expect(Math.abs(icon[side] - button[side])).toBeLessThan(0.5);
    // The SVG keeps the icon's shape and centres it (its default preserveAspectRatio)
    expect(await page.locator('#bottom-nav .menu-btn svg').getAttribute('preserveAspectRatio')).toBeNull();
});

test('the bottom bar: the buttons sit in the middle of it, all the same height', async ({ page }) => {
    await page.goto('/subway');
    const { above, below, heights } = await page.locator('#bottom-nav').evaluate(bar => {
        // Inside the bar's top border
        const top = bar.getBoundingClientRect().top + bar.clientTop;
        const bottom = top + bar.clientHeight;
        const boxes = [...bar.children].map(el => el.getBoundingClientRect());
        return { above: boxes[0].top - top, below: bottom - boxes[0].bottom, heights: boxes.map(b => Math.round(b.height * 10) / 10) };
    });
    expect(Math.abs(above - below)).toBeLessThan(1);
    expect(above).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBe(heights[0]);
});

test.describe('the menu', () => {
    const menu = page => page.locator('#site-menu');

    test('starts closed, opens above the bar by the right thumb, and closes with a tap outside', async ({ page }) => {
        await page.goto('/subway');
        const button = page.locator('#bottom-nav .menu-btn');
        await expect(button).toBeVisible();
        await expect(menu(page)).toBeHidden();
        // The three lines are in the logo's yellow
        expect(await button.locator('svg use').getAttribute('href')).toMatch(/#menu$/);
        expect(await button.locator('svg').evaluate(svg => getComputedStyle(svg).color)).toBe('rgb(255, 193, 7)');

        await button.click();
        await expect(menu(page)).toBeVisible();
        await expect(menu(page).locator('a')).toHaveText(['Ελληνικά', 'About', 'Privacy', 'Terms of use', 'Contact']);
        expect(await axe(page)).toEqual([]);
        const [box, bar, view] = [await menu(page).boundingBox(), await page.locator('#bottom-nav').boundingBox(), page.viewportSize()];
        expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
        expect(view.width - (box.x + box.width)).toBeLessThan(16);

        await page.mouse.click(view.width / 2, 10);
        await expect(menu(page)).toBeHidden();
    });

    test('its links go to the pages, in the page\'s language', async ({ page }) => {
        await page.goto('/el/info');
        await page.locator('.menu-btn').click();
        await expect(menu(page).locator('a')).toHaveText(['English', 'Σχετικά', 'Απόρρητο', 'Όροι χρήσης', 'Επικοινωνία']);
        await menu(page).getByText('Όροι χρήσης').click();
        await expect(page).toHaveURL(/:\d+\/el\/terms$/);
        await expect(menu(page)).toBeHidden();
    });

    test('with the keyboard: Enter opens it, Tab goes in, Esc closes it and goes back to the button', async ({ page }, { project }) => {
        test.skip(project.name === 'iphone', 'WebKit only tabs to links with Safari\'s setting on');
        await page.goto('/subway');
        const button = page.locator('.menu-btn');
        await button.focus();
        await page.keyboard.press('Enter');
        await expect(menu(page)).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(menu(page).locator('.menu-language')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu(page)).toBeHidden();
        await expect(button).toBeFocused();
    });
});
