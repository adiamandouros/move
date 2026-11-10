// Lifts out of service, as STASY's lift page says (public/js/core/lifts.js):
// a notice on the subway and trip pages for the stations a trip boards,
// changes or gets off at, words in the station search, and a notice on a
// station's page; an error there when the lift status is unavailable; and
// how each platform is reached without steps, on the station's page. In the
// 'lifts-out' scenario Kerameikos can't be reached step-free and one of
// Omonia's lifts is out (test/support/test-site.js). What the notices say is
// tested in Node (subway-render.test.js, trip-render.test.js, lifts.test.js).
import { axe, expect, onlyOn, test, toggleKept } from './fixtures.js';
import { from, list, to } from './trip-page.js';

test.beforeEach(onlyOn('phone'));

const notice = page => page.locator('#subway-result .lift-notice');
const lifts = page => page.waitForResponse(res => new URL(res.url()).pathname === '/api/lifts');
const UNAVAILABLE = 'Lift status unavailable right now, so lifts out of service aren\'t shown.';

// On the trip page, from an address in Kallithea to Kerameikos: by M1 and
// then M3 from Monastiraki
async function tripToKerameikos(page) {
    await page.goto('/trip');
    await from(page).fill('Μενελάου 45');
    await list(page, 'from').first().click();
    await to(page).fill('Kerameikos');
    await list(page, 'to').first().click();
    await expect(page.locator('#trip-result .trip-card').first()).toBeVisible();
}

test.describe('lifts out of service', () => {
    test.use({ scenario: 'lifts-out' });

    test('a trip from a station without step-free access starts with a warning', async ({ page }) => {
        await page.goto('/subway?from=kerameikos&to=syntagma');
        await expect(notice(page)).toHaveClass(/notice-warn/);
        await expect(notice(page)).toContainText('Kerameikos: no step-free access right now. Out of service: «Εξωτερικός Τεχνόπολις Γκάζι».');
        // Nothing under it says where that comes from (decision 43)
        await expect(notice(page).getByRole('link')).toHaveCount(0);
        // Above the trains, which are still shown
        await expect(page.locator('#subway-result .result-card').first()).toBeVisible();
        expect(await axe(page)).toEqual([]);
    });

    test('closed, the warning keeps its first line, in yellow; it stays closed through the refresh, a reload and on the station pages, until opened again', async ({ page }) => {
        await page.goto('/subway?from=kerameikos&to=syntagma');
        const summary = notice(page).locator('summary');
        await expect(summary).toHaveText('Step-free access: Kerameikos');
        await expect(notice(page)).toHaveAttribute('open', '');

        // With the keyboard
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(notice(page)).not.toHaveAttribute('open', '');
        await expect(notice(page)).toHaveClass(/notice-warn/);
        await expect(notice(page).locator('.notice-body')).toBeHidden();
        expect(await axe(page)).toEqual([]);

        // The 30-second refresh draws it again: still closed, still focused
        await notice(page).evaluate(el => el.setAttribute('data-before-refresh', ''));
        await page.clock.runFor(30_000);
        await expect(page.locator('[data-before-refresh]')).toHaveCount(0);
        await expect(notice(page)).not.toHaveAttribute('open', '');
        await expect(summary).toBeFocused();

        // A reload, and a station's page
        await page.reload();
        await expect(summary).toBeVisible();
        await expect(notice(page)).not.toHaveAttribute('open', '');
        await page.goto('/subway/stations/kerameikos');
        const status = page.locator('#lift-status .lift-notice');
        await expect(status.locator('summary')).toHaveText('Step-free access: Kerameikos');
        await expect(status).not.toHaveAttribute('open', '');

        // Opened there: open everywhere again
        await toggleKept(status);
        await expect(status).toHaveAttribute('open', '');
        await page.goto('/subway?from=kerameikos&to=syntagma');
        await expect(notice(page)).toHaveAttribute('open', '');
        // The train legend is kept apart: still open
        await expect(page.locator('.diagram-legend')).toHaveAttribute('open', '');
    });

    test('a change of line at a station with a lift out: for information, in Greek', async ({ page }) => {
        await page.goto('/el/subway?from=victoria&to=panepistimio');
        await expect(notice(page)).toHaveClass(/notice-info/);
        await expect(notice(page)).toContainText('Ομόνοια: δεν λειτουργούν όλοι οι ανελκυστήρες');
        await expect(notice(page).getByRole('link')).toHaveCount(0);
        expect(await axe(page)).toEqual([]);
    });

    test('one station picked: its lifts, before the second is', async ({ page }) => {
        await page.goto('/subway?from=kerameikos');
        await expect(notice(page)).toContainText('Kerameikos: no step-free access right now.');
        await expect(page.locator('#subway-result .subway-intro')).toBeVisible();
    });

    test('the station search says so in words, and a trip passing through says nothing', async ({ page }) => {
        const loaded = lifts(page);
        await page.goto('/subway?from=metaxourghio&to=syntagma');
        await loaded;
        // Through Omonia without changing: not one of the trip's stations
        await expect(page.locator('#subway-result .result-card').first()).toBeVisible();
        await expect(notice(page)).toHaveCount(0);

        await page.locator('#stop-search-to').fill('Kera');
        const option = page.getByRole('option', { name: /Kerameikos/ });
        await expect(option).toContainText('No step-free access right now');
        await expect(option.locator('.suggestion-lifts')).toHaveClass(/suggestion-lifts-closed/);
        await page.locator('#stop-search-to').fill('Omon');
        await expect(page.getByRole('option', { name: /Omonia/ })).toContainText('An elevator is out of service');
        expect(await axe(page)).toEqual([]);
    });

    test('the trip page warns above the answer, for the stations its ways use, and keeps it closed as the subway page does', async ({ page }) => {
        await tripToKerameikos(page);
        const warning = page.locator('#trip-result .lift-notice');
        await expect(warning).toHaveClass(/notice-warn/);
        await expect(warning).toContainText('Kerameikos: no step-free access right now. Out of service: «Εξωτερικός Τεχνόπολις Γκάζι».');
        // Above the answer
        expect(await warning.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('#trip-result .trip-card')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
        expect(await axe(page)).toEqual([]);
        // Closed here, closed on the subway page
        await toggleKept(warning);
        await expect(warning).not.toHaveAttribute('open', '');
        await page.goto('/subway?from=kerameikos&to=syntagma');
        await expect(notice(page)).not.toHaveAttribute('open', '');
    });

    test('a station\'s page says so under its lines; one whose lifts work says nothing', async ({ page }) => {
        await page.goto('/subway/stations/kerameikos');
        const status = page.locator('#lift-status');
        await expect(status.locator('.notice-warn')).toContainText('Kerameikos: no step-free access right now.');
        await expect(status).toHaveAttribute('aria-live', 'polite');
        expect(await axe(page)).toEqual([]);

        const loaded = lifts(page);
        await page.goto('/el/subway/stations/syntagma');
        await loaded;
        await expect(page.locator('#lift-status')).toBeEmpty();
    });
});

test.describe('every lift working', () => {
    test('a station\'s page says how each platform is reached without steps', async ({ page }) => {
        // Thiseio: an elevator toward Kifisia, a ramp toward Piraeus (positions.json)
        await page.goto('/subway/stations/thiseio');
        const cards = page.locator('.station-direction');
        await expect(cards.filter({ hasText: 'Kifisia' }).locator('.station-step-free')).toHaveText('Step-free from the street: by elevator');
        await expect(cards.filter({ hasText: 'Piraeus' }).locator('.station-step-free')).toHaveText('Step-free from the street: by ramp');
        // Petralona waits for a field trip
        await page.goto('/el/subway/stations/petralona');
        await expect(page.locator('.station-step-free').first()).toHaveText('Πρόσβαση χωρίς σκαλοπάτια: δεν είναι γνωστή ακόμη');
        expect(await axe(page)).toEqual([]);
    });

    test('no notice anywhere', async ({ page }) => {
        const loaded = lifts(page);
        await page.goto('/subway?from=kerameikos&to=syntagma');
        await loaded;
        await expect(page.locator('#subway-result .result-card').first()).toBeVisible();
        await expect(notice(page)).toHaveCount(0);
    });
});

test.describe('STASY\'s lift page can\'t be read', () => {
    // /api/lifts answers 503
    test.use({ scenario: 'lifts-down', allowErrors: [/status of 503/] });

    test('the subway page, the trip page and the station page say the lift status is unavailable, an error above the trains', async ({ page }) => {
        let loaded = lifts(page);
        await page.goto('/subway?from=kerameikos&to=syntagma');
        expect((await loaded).status()).toBe(503);
        const error = page.locator('#subway-result .lift-error');
        await expect(error).toHaveClass(/notice-danger/);
        await expect(error).toHaveText(UNAVAILABLE);
        await expect(page.locator('#subway-result .result-card').first()).toBeVisible();
        await expect(notice(page)).toHaveCount(0);
        expect(await axe(page)).toEqual([]);

        await tripToKerameikos(page);
        await expect(page.locator('#trip-result .lift-error')).toHaveText(UNAVAILABLE);

        loaded = lifts(page);
        await page.goto('/subway/stations/kerameikos');
        await loaded;
        await expect(page.locator('#lift-status .notice-danger')).toHaveText(UNAVAILABLE);
        expect(await axe(page)).toEqual([]);
    });
});
