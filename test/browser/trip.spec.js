// The trip page (tools/trip/): an address typed and picked, the trip, the hard
// cases, and search being down. What's worked out and drawn is tested in Node
// (trip-plan.test.js, trip-render.test.js); here, that the page puts it
// together. The addresses are test/fixtures/places.js.
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';

const from = page => page.getByRole('combobox', { name: 'From' });
const to = page => page.getByRole('combobox', { name: 'To' });
const list = (page, name) => page.locator(`#trip-${name}-list [role="option"]`);

async function pickBoth(page, url = '/trip') {
    await page.goto(url);
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

    test('what is typed before the train times have loaded is kept, and searched', async ({ page }) => {
        let release;
        const held = new Promise(resolve => { release = resolve; });
        await page.route('**/data/rail.json', async route => { await held; await route.continue(); });
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45');
        await to(page).fill('Συγγρού-Φιξ');
        release();
        await expect(from(page)).toHaveValue('Μενελάου 45');
        await expect(list(page, 'from').first()).toContainText('Μενελάου 45');
        await expect(list(page, 'to').first()).toContainText('Συγγρού Φιξ');
        await expect(page.locator('.trip-intro')).toBeVisible();
        expect(await axe(page), 'axe-core violations').toEqual([]);
        // Enter, as a tap on one list closes the other
        await to(page).press('Enter');
        await list(page, 'from').first().click();
        await expect(page.locator('.trip-card').first()).toBeVisible();
    });

    test('swap turns the trip around', async ({ page }) => {
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45');
        await list(page, 'from').first().click();
        await page.locator('#trip-swap').click();
        await expect(to(page)).toHaveValue('Μενελάου 45');
        await expect(from(page)).toHaveValue('');
    });

    test('the tram, unless it\'s hidden on the Subway page: then the metro alone', async ({ page }) => {
        const trip = async () => {
            await page.goto('/trip');
            await from(page).fill('Σταύρου 1');
            await list(page, 'from').first().click();
            await to(page).fill('Άλσος');
            await list(page, 'to').first().click();
            await expect(page.locator('.trip-card').first()).toBeVisible();
        };
        await trip();
        await expect(page.locator('#trip-result .line-t6').first()).toBeVisible();
        await page.evaluate(() => localStorage.setItem('tram-hidden', '1'));
        await trip();
        await expect(page.locator('#trip-result .line-m2').first()).toBeVisible();
        await expect(page.locator('#trip-result .line-t6')).toHaveCount(0);
    });

    test('buses only with the switch: without it the page doesn\'t ask for their times', async ({ page }) => {
        const asked = [];
        page.on('request', request => { if (request.url().includes('/data/buses.json')) asked.push(request.url()); });
        await pickBoth(page);
        await expect(page.locator('.trip-card').first()).toBeVisible();
        await expect(page.locator('#trip-result .bus-plate')).toHaveCount(0);
        expect(asked).toEqual([]);
    });

    test('with the switch, the next half hour takes the answer\'s place: its range, the stops and their buses, and why they\'re estimates', async ({ page }) => {
        await pickBoth(page, '/trip?buses');
        // One clear way at noon: any of the buses from the stops near the door
        const best = page.locator('.trip-card').first();
        await expect(best.locator('.trip-total')).toHaveText(/^\d+–\d+ min$/);
        await expect(best).toContainText('Best on most departures');
        await expect(best).toContainText('Any of these buses, whichever comes first:');
        await expect(best.locator('.bus-plate').first()).toBeVisible();
        await expect(page.locator('#trip-checking')).toHaveCount(0);
        const more = best.locator('.trip-more');
        await expect(more.locator('summary')).toHaveText(/^\d+ more stops$/);
        await expect(more.locator('.trip-step').first()).toBeHidden();
        await more.locator('summary').click();
        await expect(more.locator('.trip-step').first()).toBeVisible();
        await expect(page.locator('.trip-estimates')).toContainText('Bus times are estimates from OASA\'s timetable of August 2026');
        await expect(page.locator('.trip-estimates')).toContainText('A range covers the next half hour\'s departures');
        await expect(page.locator('#trip-timing')).toHaveCount(0);
        expect(await axe(page), 'axe-core violations').toEqual([]);
        const walk = await keyboardWalk(page);
        expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
    });

    test('in Greek too', async ({ page }) => {
        await page.goto('/el/trip?buses');
        await page.getByRole('combobox', { name: 'Από' }).fill('Μενελάου 45');
        await list(page, 'from').first().click();
        await page.getByRole('combobox', { name: 'Προς' }).fill('Συγγρού-Φιξ');
        await list(page, 'to').first().click();
        const best = page.locator('.trip-card').first();
        await expect(best.locator('.trip-total')).toHaveText(/^\d+–\d+ λεπτά$/);
        await expect(best).toContainText('Ο καλύτερος στις περισσότερες αναχωρήσεις');
        await expect(best.locator('.bus-plate').first()).toBeVisible();
        await expect(page.locator('.trip-estimates')).toContainText('Οι ώρες των λεωφορείων είναι εκτιμήσεις');
    });

    test('?timing: how long the buses took here, then the next half hour, worked out after the answer', async ({ page }) => {
        await pickBoth(page, '/trip?timing');
        const box = page.locator('#trip-timing');
        await expect(box).toContainText(/Buses ready in \d+ ms · This answer in \d+ ms/);
        await expect(box.getByRole('status')).toHaveText(/^The next half hour, a departure every 2 minutes: \d+ ms, one clear way$/);
        expect(await axe(page), 'axe-core violations').toEqual([]);
    });

    test('?timing: a trip changed while its half hour is worked out gets its own answer and half hour', async ({ page }) => {
        await pickBoth(page, '/trip?timing');
        await page.getByRole('button', { name: 'Change' }).click();
        await to(page).fill('Άλσος');
        await list(page, 'to').first().click();
        await expect(page.locator('.trip-places')).toContainText('Άλσος');
        await expect(page.locator('.trip-card').first()).toBeVisible();
        await expect(page.locator('#trip-half')).toHaveText(/\d+ ms, (one clear way|a decision on the way|it depends|no way found)$/);
    });

    test.describe('with the buses\' times not loading', () => {
        test.use({ allowErrors: [/status of 503/] });

        test('it says so, and plans by metro and tram', async ({ page }) => {
            await page.route('**/data/buses.json', route => route.fulfill({ status: 503, body: '' }));
            await pickBoth(page, '/trip?buses');
            await expect(page.locator('.trip-card').first()).toBeVisible();
            await expect(page.getByText('The bus times couldn\'t be loaded, so these ways are by metro and tram only.')).toBeVisible();
            await expect(page.locator('#trip-result .bus-plate')).toHaveCount(0);
        });
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
