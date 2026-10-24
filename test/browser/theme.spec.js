// The colour mode: Auto follows the phone (dark unless it asks for light),
// Light and Dark are chosen in the menu (the sidebar on wide screens) and
// remembered on the device. The logic: test/theme.test.js; the colours:
// test/accessibility.test.js.
import { axe, expect, test } from './fixtures.js';

const DARK_PAGE = 'rgb(15, 17, 23)';
const LIGHT_PAGE = 'rgb(244, 246, 250)';

const mode = page => page.locator('html').getAttribute('data-bs-theme');
const background = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const barColour = page => page.locator('meta[name=theme-color]').getAttribute('content');

// The switch where this screen has it: the menu on phones, the sidebar beside it
async function switchFor(page) {
    const menuButton = page.locator('button[popovertarget=site-menu]');
    if (await menuButton.isVisible()) {
        await menuButton.click();
        return page.locator('#site-menu .theme-switch');
    }
    return page.locator('#side-nav .theme-switch');
}
async function choose(page, name) {
    const group = await switchFor(page);
    await group.getByRole('button', { name, exact: true }).click();
}

test.describe('Auto follows the phone', () => {
    test.use({ colorScheme: 'light' });
    test('a phone that asks for light gets light, all the way down', async ({ page }) => {
        await page.goto('/subway');
        expect(await mode(page)).toBe('light');
        expect(await background(page)).toBe(LIGHT_PAGE);
        expect(await barColour(page)).toBe('#ffffff');
        await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    });
});

// (A browser with no preference says "light" too, so only one that can't say at all is unsure)
test('a browser that can\'t say what the phone prefers gets dark', async ({ page }) => {
    await page.addInitScript(() => { window.matchMedia = () => /** @type {any} */ ({ matches: false, addEventListener() {} }); });
    await page.goto('/subway');
    expect(await mode(page)).toBe('dark');
    expect(await background(page)).toBe(DARK_PAGE);
    expect(await barColour(page)).toBe('#161b27');
});

test('a dark phone gets dark, and the logo of a dark page', async ({ page }) => {
    await page.goto('/subway');
    expect(await mode(page)).toBe('dark');
    expect(await background(page)).toBe(DARK_PAGE);
    const logos = page.locator('img[src^="/icon/logo"]:visible');
    await expect(logos).toHaveCount(1);
    await expect(logos).toHaveAttribute('src', /logo\.svg/);
});

test('Light on a dark phone: the page, the bar and the logo change, and stay chosen after a reload', async ({ page }) => {
    await page.goto('/subway');
    await choose(page, 'Light');
    expect(await mode(page)).toBe('light');
    expect(await background(page)).toBe(LIGHT_PAGE);
    expect(await barColour(page)).toBe('#ffffff');
    const logos = page.locator('img[src^="/icon/logo"]:visible');
    await expect(logos).toHaveCount(1);
    await expect(logos).toHaveAttribute('src', /logo-light\.svg/);

    await page.reload();
    expect(await mode(page)).toBe('light');
    expect(await background(page)).toBe(LIGHT_PAGE);
    // …and on the other pages, in the other language
    await page.goto('/el/buses');
    expect(await mode(page)).toBe('light');
});

test('the switch says which is chosen, and Auto goes back to the phone', async ({ page }) => {
    await page.goto('/subway');
    let group = await switchFor(page);
    await expect(group.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(group.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'false');

    await group.getByRole('button', { name: 'Auto', exact: true }).click();
    expect(await mode(page)).toBe('dark');
    await page.reload();
    group = await switchFor(page);
    await expect(group.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await mode(page)).toBe('dark');
});

test('Dark on a light phone stays dark; Auto follows the phone while the page is open', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/subway');
    expect(await mode(page)).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => mode(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => mode(page)).toBe('light');

    await choose(page, 'Dark');
    expect(await mode(page)).toBe('dark');
    await page.reload();
    expect(await mode(page)).toBe('dark');
});

test('in Greek the switch and its group are named in Greek', async ({ page }) => {
    await page.goto('/el/subway');
    const group = await switchFor(page);
    await expect(group).toHaveAttribute('aria-label', 'Χρώματα');
    await expect(group.getByRole('button')).toHaveText(['Αυτόματα', 'Φωτεινά', 'Σκούρα']);
    await group.getByRole('button', { name: 'Φωτεινά' }).click();
    expect(await mode(page)).toBe('light');
});

test('with storage blocked, the choice still applies to the page it was made on', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    await page.goto('/subway');
    expect(await mode(page)).toBe('dark');
    await choose(page, 'Light');
    expect(await mode(page)).toBe('light');
});

// The switch is a control like the others: the keyboard alone
test('the switch works with the keyboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'iphone', 'WebKit only tabs to links when Safari\'s setting is on');
    await page.goto('/subway');
    const group = await switchFor(page);
    const light = group.getByRole('button', { name: 'Light', exact: true });
    await light.focus();
    await page.keyboard.press('Enter');
    expect(await mode(page)).toBe('light');
    await expect(light).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    expect(await mode(page)).toBe('dark');
});

// ── The light mode in use ───────────────────────────────────────────────────

test.describe('light', () => {
    test.use({ colorScheme: 'light' });

    test('a route, with its train and times, has no axe-core violations', async ({ page }) => {
        await page.goto('/subway?from=kifisia&to=airport');
        await expect(page.locator('.result-card').first()).toBeAttached();
        expect(await axe(page), 'axe-core violations').toEqual([]);
        // The train to ride in is the amber one, and still stands out from the others
        const [ride, other] = await page.locator('.train-car').evaluateAll(cars => cars.map(c => getComputedStyle(c).backgroundColor));
        expect(ride).not.toBe(other);
    });

    test('a bus stop with its times has no axe-core violations', async ({ page }) => {
        await page.goto('/buses?stop=10341');
        await expect(page.locator('.stop-item .arrival-row').first()).toBeAttached();
        expect(await axe(page), 'axe-core violations').toEqual([]);
    });

    test('the menu and the switch have no axe-core violations', async ({ page }) => {
        await page.goto('/subway');
        await switchFor(page);
        expect(await axe(page), 'axe-core violations').toEqual([]);
    });

    test('the maps stay black', async ({ page }) => {
        await page.goto('/info');
        const map = page.locator('.metro-map').first();
        await expect(map).toBeAttached();
        await expect(map).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    });
});

// ── Forced colours (high contrast) ──────────────────────────────────────────

test.describe('forced colours', () => {
    test('the car to ride in is outlined, and the maps and line pills keep their colours', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'iphone', 'WebKit can\'t emulate forced colours');
        await page.emulateMedia({ forcedColors: 'active' });
        await page.goto('/subway?from=kifisia&to=airport');
        await expect(page.locator('.result-card').first()).toBeAttached();
        const outline = await page.locator('.train-car.highlighted').first().evaluate(car => getComputedStyle(car).outlineStyle);
        expect(outline).toBe('solid');
        await expect(page.locator('.line-pill').first()).toHaveCSS('forced-color-adjust', 'none');
    });
});
