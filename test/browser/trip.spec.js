// The trip page (tools/trip/): an address typed and picked, the trip, the hard
// cases, and search being down. What's worked out and drawn is tested in Node
// (trip-plan.test.js, trip-render.test.js); here, that the page puts it
// together. The addresses are test/fixtures/places.js.
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';

const from = page => page.getByRole('combobox', { name: 'From' });
const to = page => page.getByRole('combobox', { name: 'To' });
const list = (page, name) => page.locator(`#trip-${name}-list [role="option"]`);

async function pickBoth(page) {
    await page.goto('/trip');
    await from(page).fill('Μενελάου 45');
    await list(page, 'from').first().click();
    await to(page).fill('Συγγρού-Φιξ');
    await list(page, 'to').first().click();
}

test.describe('the trip page', () => {
    test.beforeEach(onlyOn('phone'));

    test('from an address to a station: the trip, then back to the fields', async ({ page }) => {
        await pickBoth(page);
        await expect(page.locator('.trip-card').first()).toBeVisible();
        await expect(page.locator('.trip-total').first()).toContainText('min');
        await expect(page.locator('#trip-form')).toBeHidden();
        await expect(page.locator('.trip-places')).toContainText('Μενελάου 45');
        await page.getByRole('button', { name: 'Change' }).click();
        await expect(from(page)).toBeFocused();
        await expect(page.locator('.trip-card').first()).toBeVisible();
    });

    test('axe-core is clean with the list open and with a trip', async ({ page }) => {
        await page.goto('/trip');
        await from(page).fill('Μενελάου');
        await expect(list(page, 'from').first()).toBeVisible();
        expect(await axe(page), 'axe-core violations').toEqual([]);
        await pickBothFrom(page);
        await expect(page.locator('.trip-card').first()).toBeVisible();
        expect(await axe(page), 'axe-core violations').toEqual([]);
    });

    test('a page that reaches the server only by POST, with nothing in the address', async ({ page }) => {
        const asked = [];
        page.on('request', request => { if (request.url().includes('/api/places')) asked.push(request); });
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45');
        await expect(list(page, 'from').first()).toBeVisible();
        expect(asked.length).toBeGreaterThan(0);
        for (const request of asked) {
            expect(request.method()).toBe('POST');
            expect(request.url()).not.toContain('?');
        }
        expect(page.url()).not.toContain('Μενελάου');
    });

    test('the keyboard alone: down to a place, Enter picks it, Escape closes', async ({ page }) => {
        await page.goto('/trip');
        await from(page).focus();
        await page.keyboard.type('Μενελάου 45');
        await expect(list(page, 'from').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(list(page, 'from').first()).toBeHidden();
        await expect(from(page), 'Escape closes the list, and leaves what\'s typed').toHaveValue('Μενελάου 45');
        await page.keyboard.type(' ');
        await expect(list(page, 'from').first()).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await expect(list(page, 'from').first()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(from(page)).toHaveValue('Μενελάου 45');
        await expect(from(page)).toBeFocused();
        const walk = await keyboardWalk(page);
        expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
    });

    test('a street that isn\'t in that town says so and lists where it is', async ({ page }) => {
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45, Νέα Σμύρνη');
        await expect(page.locator('#trip-from-status')).toContainText('isn\'t in that town');
        await expect(list(page, 'from').first()).toContainText('Καλλιθέας');
    });

    test('my location starts the trip from here', async ({ page }) => {
        await page.goto('/trip');
        await page.getByRole('button', { name: 'My location' }).click();
        await expect(from(page)).toHaveValue('My location');
        await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('swap turns the trip around', async ({ page }) => {
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45');
        await list(page, 'from').first().click();
        await page.locator('#trip-swap').click();
        await expect(to(page)).toHaveValue('Μενελάου 45');
        await expect(from(page)).toHaveValue('');
    });

    test.describe('with search down', () => {
        test.use({ allowErrors: [/status of 503/] });

        test('it\'s said, and the page goes on', async ({ page }) => {
            await page.route('**/api/places', route => route.fulfill({ status: 503, json: { error: 'Address search is unavailable' } }));
            await page.goto('/trip');
            await from(page).fill('Μενελάου 45');
            await expect(page.locator('#trip-from-status')).toContainText('isn\'t available');
            await expect(page.locator('.trip-intro')).toBeVisible();
        });
    });

    test('in Greek, with the credit to OpenStreetMap', async ({ page }) => {
        await page.goto('/el/trip');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Σχεδιασμός διαδρομής');
        await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
    });
});

async function pickBothFrom(page) {
    await list(page, 'from').first().click();
    await to(page).fill('Συγγρού-Φιξ');
    await list(page, 'to').first().click();
}
