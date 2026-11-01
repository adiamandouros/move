// The tram in the subway planner, in a real browser: finding its stops, a trip
// on it, and the switch that hides it. What's worked out and drawn for each
// trip is tested in Node (tram-planner.test.js, subway-render.test.js).
import { readFileSync } from 'fs';
import { axe, expect, onlyOn, test } from './fixtures.js';

const rail = JSON.parse(readFileSync(new URL('data/rail.json', import.meta.url), 'utf8'));

test.beforeEach(onlyOn('phone'));
test.use({ now: '2026-10-21T10:03:00+03:00' });

const showTram = page => page.getByRole('switch', { name: 'Tram' });
const suggestions = page => page.locator('#stop-suggestions-to .suggestion-name-en');
const field = page => page.locator('#stop-search-to');

test('a tram stop is found by typing, in a row of its own beside the metro station of the same name', async ({ page }) => {
    await page.goto('/subway');
    await field(page).fill('Syntag');
    await expect(suggestions(page)).toHaveText(['Syntagma', 'Syntagma (tram)', '34ou Syntagmatos']);
    await expect(page.locator('#stop-suggestions-to [role="option"]').nth(1).locator('.suggestion-lines')).toHaveText('T6');
    await page.locator('#stop-suggestions-to').getByText('Syntagma (tram)').tap();
    await expect(page).toHaveURL(/to=syntagma-tram/);
    await expect(field(page)).toHaveValue('Syntagma (tram)');
});

test('a full name typed is the metro station\'s when both have it', async ({ page }) => {
    await page.goto('/subway');
    await field(page).fill('Elliniko');
    await field(page).blur();
    await expect(page).toHaveURL(/to=elliniko(&|$)/);
});

test('with two changes the page shows every leg, and a train diagram on the metro\'s only', async ({ page }) => {
    await page.goto('/subway?from=kifisia&to=zappeio');
    const option = page.locator('.result-card');
    await expect(page.locator('.route-via').first()).toContainText(/^Via .+, .+$/);
    const tramCard = option.filter({ has: page.locator('.leg-title .line-t6') }).first();
    await expect(tramCard).toBeVisible();
    await expect(tramCard.locator('.train-diagram')).toHaveCount(0);
    await expect(option.filter({ has: page.locator('.leg-title .line-m1') }).first().locator('.train-diagram')).toBeVisible();
    await expect(tramCard).toContainText('Exit at Zappio');
    await expect(tramCard.locator('a')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
});

test('from a metro station to its tram stop\'s line: the walk first, then the tram', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=zappeio');
    await expect(page.locator('#subway-result')).toContainText('Walk to Syntagma (tram)');
    await expect(page.locator('.result-card').first()).toContainText('At Syntagma (tram):');
});

test('round T7\'s loop: a change at the end of the line, on the same line', async ({ page }) => {
    await page.goto('/subway?from=evangelistria&to=skylitsi');
    const cards = page.locator('.result-card');
    await expect(cards.nth(0)).toContainText('Transfer at Akti Posidonos');
    await expect(cards.nth(1).locator('.leg-title .line-t7')).toBeVisible();
});

test('every way is on the page: the tied one open, the much slower one closed behind its row', async ({ page }) => {
    // 10:03, when the M2 way catches the same tram as staying on T6
    await page.goto('/subway?from=korydallos&to=agia-paraskevi-tram');
    await expect(page.locator('.route-via')).toHaveText(['Via Syntagma', /Via Syntagma, /, /Via Syntagma, /]);
    await expect(page.locator('details.route-details')).toHaveCount(0);

    await page.goto('/subway?from=kifisia&to=piraeus');
    await expect(page.locator('.route-via').first()).toHaveText('No transfers');
    const slower = page.locator('details.route-details').first();
    await expect(slower.locator('summary')).toContainText('slower');
    await expect(slower.locator('.result-card').first()).toBeHidden();
    await slower.locator('summary').tap();
    await expect(slower.locator('.result-card .line-t7').first()).toBeVisible();
});

test('a stop\'s stations open on a strip in the tram\'s colour', async ({ page }) => {
    await page.goto('/subway?from=fix&to=zappeio');
    await page.locator('.leg-stops-toggle').first().tap();
    await expect(page.locator('.leg-stations.strip-t6').first()).toBeVisible();
    await expect(page.locator('.leg-stations li').first()).toContainText('Fix');
});

test('two stops a short walk apart: a word about the walk, no route', async ({ page }) => {
    await page.goto('/subway?from=piraeus&to=akti-poseidonos');
    await expect(page.locator('#subway-result')).toContainText('short walk apart: about 8 minutes');
    await expect(page.locator('.result-card')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
});

test('hiding the tram takes its stops and its routes away, and stays after a reload', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=zappeio');
    await expect(showTram(page)).toBeChecked();
    await expect(page.locator('.result-card').first()).toBeVisible();

    await showTram(page).uncheck();
    // The stop picked goes with it, the metro station stays
    await expect(page.locator('#stop-search-from')).toHaveValue('Syntagma');
    await expect(field(page)).toHaveValue('');
    await expect(page).toHaveURL(/\?from=syntagma$/);
    await field(page).fill('Syntag');
    await expect(suggestions(page)).toHaveText(['Syntagma']);
    expect(await axe(page)).toEqual([]);

    await page.goto('/subway?from=fix');
    await expect(showTram(page)).toBeChecked();

    await page.goto('/subway?from=kifisia&to=syntagma');
    await expect(showTram(page)).not.toBeChecked();
    await expect(page.locator('.line-t6, .line-t7')).toHaveCount(0);
    await expect(page.locator('.result-card').first()).toBeVisible();
    await field(page).fill('Zappio');
    await expect(suggestions(page)).toHaveCount(0);

    await showTram(page).check();
    await field(page).fill('Zappio');
    await expect(suggestions(page)).toHaveText(['Zappio']);
    await page.reload();
    await expect(showTram(page)).toBeChecked();
});

test('a tram stop in the address shows the tram for that visit, and leaves the choice as it was', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tram-hidden', '1'));
    await page.goto('/subway?to=zappeio');
    await expect(showTram(page)).toBeChecked();
    await expect(field(page)).toHaveValue('Zappio');
    expect(await page.evaluate(() => localStorage.getItem('tram-hidden'))).toBe('1');
    await page.goto('/subway');
    await expect(showTram(page)).not.toBeChecked();
});

test('the boarding station that follows the location moves off a tram stop when the tram is hidden', async ({ page }) => {
    const [lat, lng] = rail.tram.stations['paralia-glyfadas'].coords;
    const boarding = page.locator('#stop-search-from');
    await page.goto('/subway');
    await expect(boarding).toHaveValue('Syntagma');
    await page.evaluate(at => {
        window.__setLocation({ at });
        window.__sendPosition();
    }, { lat, lng });
    await expect(boarding).toHaveValue('Paralia Glyfadas');
    await showTram(page).uncheck();
    await expect(boarding).toHaveValue('Elliniko');
});

test('the switch works from the keyboard, and with the device\'s storage blocked', async ({ page }) => {
    await page.goto('/subway');
    await showTram(page).focus();
    await page.keyboard.press('Space');
    await expect(showTram(page)).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(showTram(page)).toBeChecked();

    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }));
    await page.goto('/subway');
    await expect(showTram(page)).toBeChecked();
    await showTram(page).uncheck();
    await expect(showTram(page)).not.toBeChecked();
});

test('with no tram in the data there\'s no switch, and the planner is the metro\'s', async ({ page }) => {
    await page.route('**/data/rail.json*', async route => {
        const response = await route.fetch();
        const metro = await response.json();
        delete metro.tram;
        await route.fulfill({ response, json: metro });
    });
    await page.goto('/subway?from=kifisia&to=syntagma');
    await expect(page.locator('.result-card').first()).toBeVisible();
    await expect(page.locator('#tram-switch')).toBeHidden();
});
