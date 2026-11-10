// Location: only Buses, Subway and Trip ask, the first time only after a
// tap, the position is shared between pages, and nothing waits for it.
import { axe, expect, OMONIA, test } from './fixtures.js';

const geoCalls = page => page.evaluate(() => window.__geo);

test.describe('a first visit, where the browser would ask', () => {
    test.use({ location: { permission: 'prompt', answer: 'position' } });

    test('pages that don\'t need it never ask', async ({ page }) => {
        for (const url of ['/', '/info', '/about', '/subway/stations/omonia', '/trip', '/subway']) {
            await page.goto(url);
            await page.waitForLoadState('networkidle');
            expect(await geoCalls(page), url).toBe(0);
        }
        // The subway page asks only from "Nearest"
        await expect(page.locator('#stop-search-from')).toHaveValue('');
        await expect(page.locator('#walk-btn')).toBeHidden();
        // and the trip page only from "My location", off until then
        await page.goto('/trip');
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('');
        await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'false');
    });

    test('the bus page asks after a tap, and the next pages have it at once', async ({ page }, { project }) => {
        await page.goto('/buses');
        await expect(page.locator('#bus-message')).toContainText('See the buses at the stops near you');
        expect(await geoCalls(page)).toBe(0);
        expect(await axe(page)).toEqual([]);

        if (project.name === 'iphone') await page.locator('.message-action').click();
        else { await page.locator('.message-action').focus(); await page.keyboard.press('Enter'); }
        await expect(page.locator('.stop-item').first()).toBeVisible();
        expect(await geoCalls(page)).toBeGreaterThan(0);
        // The keyboard lands on the first stop
        if (project.name !== 'iphone') await expect(page.locator('.stop-toggle').first()).toBeFocused();
        const saved = await page.evaluate(() => ({ position: JSON.parse(localStorage.getItem('location')), allowed: localStorage.getItem('location-allowed') }));
        expect(saved.allowed).toBe('1');
        // Rounded to about 10 m
        expect(String(saved.position.lat).length).toBeLessThanOrEqual(7);

        await page.goto('/subway');
        await expect(page.locator('#stop-search-from')).toHaveValue('Syntagma');
        await page.goto('/el/buses');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        expect(await axe(page)).toEqual([]);
    });
});

test.describe('no signal: the location never comes', () => {
    test.use({ location: { permission: 'granted', answer: 'never' } });

    test('a position from a few minutes ago is used', async ({ page }) => {
        await page.goto('/about');
        await page.evaluate(({ lat, lng }) => {
            localStorage.setItem('location', JSON.stringify({ lat, lng, at: Date.now() - 3 * 60_000 }));
            localStorage.setItem('location-allowed', '1');
        }, OMONIA);
        await page.goto('/subway?to=airport');
        await expect(page.locator('#stop-search-from')).toHaveValue('Omonia');
        await expect(page.locator('#walk-btn')).toHaveAccessibleName(/Walking directions to Omonia/);
        await expect(page.locator('.result-card').first()).toBeVisible();
        await page.goto('/buses');
        await expect(page.locator('.stop-item').first()).toBeVisible();
        // The trip page starts from it, and follows the location from there
        await page.goto('/trip');
        await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('My location');
        await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('without one, the bus page says so after 20 s instead of spinning', async ({ page }) => {
        await page.goto('/buses');
        await expect(page.locator('#bus-message')).toContainText('Getting your location');
        await page.clock.fastForward(21_000);
        await expect(page.locator('#bus-message')).toContainText(/Still looking|Couldn.t get your location/);
        await expect(page.locator('.message-action')).toBeVisible();
        await expect(page.locator('#nearby-heading')).toBeHidden();
        expect(await axe(page)).toEqual([]);
    });
});

test.describe('location blocked', () => {
    test.use({ location: { permission: 'denied', answer: 'deny' } });

    test('both pages say it\'s blocked', async ({ page }) => {
        await page.goto('/buses');
        await expect(page.locator('#bus-message')).toContainText('Location is blocked');
        await expect(page.locator('#nearby-heading')).toBeHidden();
        await page.goto('/el/subway');
        await page.locator('#locate-btn').click();
        await expect(page.locator('#locate-status')).toContainText('αποκλεισμένη');
        // It can't follow the location, so it isn't on
        await expect(page.locator('#locate-btn')).toHaveAttribute('aria-pressed', 'false');
        expect(await axe(page)).toEqual([]);
        // Nor the trip page's, which says so when pressed
        await page.goto('/trip');
        const here = page.getByRole('button', { name: 'My location' });
        await expect(here).toHaveAttribute('aria-pressed', 'false');
        await here.click();
        await expect(page.locator('#trip-from-status')).toContainText('Location is off.');
        await expect(here).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('');
        expect(await axe(page)).toEqual([]);
    });
});

test.describe('"Nearest": on while the boarding station follows the location', () => {
    const colour = locator => locator.evaluate(el => getComputedStyle(el).color);

    test('on at first, off once a station is picked, on again with a tap', async ({ page }) => {
        await page.goto('/subway?to=airport');
        const nearest = page.locator('#locate-btn');
        const from = page.locator('#stop-search-from');
        await expect(from).toHaveValue('Syntagma');
        await expect(nearest).toHaveAccessibleName('Nearest');
        await expect(nearest).toHaveAttribute('aria-pressed', 'true');
        // Blue (the primary colour), its icon filled
        const blue = await page.evaluate(() => { const el = document.createElement('i'); el.className = 'text-primary'; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; });
        await expect.poll(() => colour(nearest)).toBe(blue);
        await expect(nearest.locator('use')).toHaveAttribute('href', /#nearest-filled$/);
        expect(await axe(page)).toEqual([]);

        // Another station typed in: off, the colour of the buttons around it
        await from.fill('Omonia');
        await expect(nearest).toHaveAttribute('aria-pressed', 'false');
        await page.locator('#stop-suggestions-from .suggestion-item').first().click();
        await expect(page).toHaveURL(/from=omonia/);
        await expect(nearest).toHaveAttribute('aria-pressed', 'false');
        // (after its fade)
        await expect.poll(() => colour(nearest)).toBe(await colour(page.locator('#swap-stations')));
        await expect(nearest.locator('use')).toHaveAttribute('href', /#nearest$/);
        expect(await axe(page)).toEqual([]);

        // On again: the nearest station again
        await nearest.click();
        await expect(nearest).toHaveAttribute('aria-pressed', 'true');
        await expect(from).toHaveValue('Syntagma');
        await expect(page).toHaveURL(/from=syntagma/);
    });

    test('off when the address names the station, or the stations are swapped', async ({ page }) => {
        await page.goto('/subway?from=omonia&to=airport');
        const nearest = page.locator('#locate-btn');
        await expect(page.locator('.result-card').first()).toBeVisible();
        await expect(nearest).toHaveAttribute('aria-pressed', 'false');

        await page.goto('/subway?to=airport');
        await expect(nearest).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#swap-stations').click();
        await expect(nearest).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#stop-search-from')).toHaveValue('Airport');
    });

    test('in Greek: «Κοντινότερος»', async ({ page }) => {
        await page.goto('/el/subway');
        await expect(page.locator('#locate-btn')).toHaveAccessibleName('Κοντινότερος');
    });
});

test.describe('"My location" on the trip page: on while From follows the location, as "Nearest" does', () => {
    const colour = locator => locator.evaluate(el => getComputedStyle(el).color);

    test('on at first, off once a start is typed or picked or the places are swapped, on again with a tap', async ({ page }) => {
        await page.goto('/trip');
        const here = page.getByRole('button', { name: 'My location' });
        const from = page.getByRole('combobox', { name: 'From' });
        const to = page.getByRole('combobox', { name: 'To' });
        await expect(from).toHaveValue('My location');
        await expect(here).toHaveAttribute('aria-pressed', 'true');
        // Blue (the primary colour), its icon filled
        const blue = await page.evaluate(() => { const el = document.createElement('i'); el.className = 'text-primary'; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; });
        await expect.poll(() => colour(here)).toBe(blue);
        await expect(here.locator('use')).toHaveAttribute('href', /#nearest-filled$/);
        expect(await axe(page)).toEqual([]);

        // Another start typed in: off, the colour of the buttons around it,
        // its icon an outline; and picked, still off
        await from.fill('Μενελάου 45');
        await expect(here).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => colour(here)).toBe(await colour(page.locator('#trip-swap')));
        await expect(here.locator('use')).toHaveAttribute('href', /#nearest$/);
        await page.locator('#trip-from-list [role="option"]').first().click();
        await expect(here).toHaveAttribute('aria-pressed', 'false');
        // A new position doesn't move a start someone chose
        await page.evaluate(() => window.__sendPosition());
        await expect(from).toHaveValue('Μενελάου 45');
        expect(await axe(page)).toEqual([]);

        // On again: from here again
        await here.click();
        await expect(here).toHaveAttribute('aria-pressed', 'true');
        await expect(from).toHaveValue('My location');

        // Swapped: off, the trip now going to where the rider was
        await page.locator('#trip-swap').click();
        await expect(here).toHaveAttribute('aria-pressed', 'false');
        await expect(to).toHaveValue('My location');
        await expect(from).toHaveValue('');
    });

    test('in Greek: «Η θέση μου»', async ({ page }) => {
        await page.goto('/el/trip');
        await expect(page.getByRole('button', { name: 'Η θέση μου' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('combobox', { name: 'Από' })).toHaveValue('Η θέση μου');
    });
});
