// The suburban railway in the subway planner (decision 41), in a real
// browser: finding its stations, trips on it, its switch, and trains.json
// coming late or not at all. What's worked out and drawn for each trip is
// tested in Node (suburban-planner.test.js, subway-render.test.js).
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone'));

const showSuburban = page => page.getByRole('switch', { name: 'Suburban railway' });
const suggestions = page => page.locator('#stop-suggestions-to .suggestion-name-en');
const boarding = page => page.locator('#stop-search-from');
const field = page => page.locator('#stop-search-to');

test('a suburban station is found by typing, in a row of its own beside the metro station of the same name', async ({ page }) => {
    await page.goto('/subway');
    await field(page).fill('Piraeus');
    await expect(suggestions(page)).toHaveText(['Piraeus', 'Piraeus (suburban)']);
    await expect(page.locator('#stop-suggestions-to [role="option"]').nth(1).locator('.suggestion-lines')).toHaveText('A1A4');
    await page.locator('#stop-suggestions-to').getByText('Piraeus (suburban)').tap();
    await expect(page).toHaveURL(/to=piraeus-suburban/);
    await expect(field(page)).toHaveValue('Piraeus (suburban)');
});

test('Megara to Syntagma: the A4 toward where it ends, with no train diagram and the ticket it needs, the walk, then the M2', async ({ page }) => {
    await page.goto('/subway?from=megara&to=syntagma');
    const first = page.locator('.result-card').first();
    await expect(first.locator('.leg-title .line-a4')).toHaveText('A4');
    await expect(first.locator('.station-sign')).toHaveText('Piraeus');
    await expect(first.locator('.train-diagram')).toHaveCount(0);
    await expect(first).toContainText('Needs a Hellenic Train ticket, as OASA\'s ticket doesn\'t cover Megara.');
    await expect(first.locator('a')).toHaveCount(0);
    await expect(page.locator('#subway-result')).toContainText('Walk to Larissa Station');
    await expect(page.locator('.result-card').nth(1).locator('.train-diagram')).toBeVisible();
    await expect(page.locator('#subway-result')).not.toContainText('railway.gov.gr');
    expect(await axe(page)).toEqual([]);
    const walk = await keyboardWalk(page);
    expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
});

test('from Piraeus\'s suburban station, the walk to the metro says the way isn\'t signed', async ({ page }) => {
    await page.goto('/subway?from=piraeus-suburban&to=monastiraki');
    await expect(page.locator('.walk-note').first()).toHaveText('The suburban railway’s station isn’t in the metro’s building: about 2 minutes on foot, across a busy road, with no signs.');
});

test('in Greek: the switch, the footbridge at SKA and the ticket', async ({ page }) => {
    await page.goto('/el/subway?from=ano-liosia&to=chalkida');
    await expect(page.getByRole('switch', { name: 'Προαστιακός' })).toBeChecked();
    await expect(page.locator('#subway-result')).toContainText('Περπάτημα ως Σιδηροδρομικό Κέντρο Αχαρνών');
    await expect(page.locator('.walk-note').first()).toContainText('στενή πεζογέφυρα');
    await expect(page.locator('#subway-result')).toContainText('δεν καλύπτει τον σταθμό Χαλκίδα');
    expect(await axe(page)).toEqual([]);
});

test('hiding the railway takes its stations and its routes away, and stays after a reload', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=megara');
    await expect(showSuburban(page)).toBeChecked();
    await expect(page.locator('.result-card').first()).toBeVisible();

    await showSuburban(page).uncheck();
    // The station picked goes with it, the metro station stays
    await expect(boarding(page)).toHaveValue('Syntagma');
    await expect(field(page)).toHaveValue('');
    await expect(page).toHaveURL(/\?from=syntagma$/);
    await field(page).fill('Piraeus');
    await expect(suggestions(page)).toHaveText(['Piraeus']);
    expect(await axe(page)).toEqual([]);

    // The metro and the tram stay as they were
    await page.goto('/subway?from=piraeus&to=airport');
    await expect(showSuburban(page)).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Tram' })).toBeChecked();
    await expect(page.locator('.result-card').first()).toBeVisible();
    await expect(page.locator('.line-a1, .line-a2, .line-a3, .line-a4')).toHaveCount(0);

    await showSuburban(page).check();
    await field(page).fill('Megara');
    await expect(suggestions(page)).toHaveText(['Megara']);
    await page.reload();
    await expect(showSuburban(page)).toBeChecked();
});

test('a suburban station in the address shows the railway for that visit, and leaves the choice as it was', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('suburban-hidden', '1'));
    await page.goto('/subway?from=megara');
    await expect(showSuburban(page)).toBeChecked();
    await expect(boarding(page)).toHaveValue('Megara');
    expect(await page.evaluate(() => localStorage.getItem('suburban-hidden'))).toBe('1');
    await page.goto('/subway');
    await expect(showSuburban(page)).not.toBeChecked();
});

test('the switch works from the keyboard', async ({ page }) => {
    await page.goto('/subway');
    await showSuburban(page).focus();
    await page.keyboard.press('Space');
    await expect(showSuburban(page)).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(showSuburban(page)).toBeChecked();
});

test('the page doesn\'t wait for trains.json: the metro plans at once, and the railway joins when it comes', async ({ page }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/data/trains.json*', async route => {
        await held;
        await route.continue();
    });
    await page.goto('/subway?from=megara&to=syntagma');
    await expect(field(page)).toHaveValue('Syntagma');
    await expect(boarding(page)).toHaveValue('');
    await expect(page.locator('#suburban-switch')).toBeHidden();
    release();
    await expect(boarding(page)).toHaveValue('Megara');
    await expect(showSuburban(page)).toBeChecked();
    await expect(page.locator('.result-card').first().locator('.line-a4')).toBeVisible();
    await expect(page).toHaveURL(/from=megara&to=syntagma/);
});

test('trains.json coming while a station is typed: the list stays open, with the railway\'s stations', async ({ page }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/data/trains.json*', async route => {
        await held;
        await route.continue();
    });
    await page.goto('/subway');
    // The page's script has started: the tram's switch is shown
    await expect(page.getByRole('switch', { name: 'Tram' })).toBeVisible();
    await field(page).fill('Pirae');
    await expect(suggestions(page)).toHaveText(['Piraeus']);
    release();
    await expect(suggestions(page)).toHaveText(['Piraeus', 'Piraeus (suburban)']);
    await expect(field(page)).toBeFocused();
});

test('tapping an empty field lists the metro\'s and the tram\'s stations to start from, not the railway\'s', async ({ page }) => {
    await page.goto('/subway');
    await expect(page.locator('#suburban-switch')).toBeVisible();
    await field(page).tap();
    await expect(suggestions(page).first()).toBeVisible();
    expect((await suggestions(page).allTextContents()).filter(name => /suburban|Megara|Kiato|Chalkida/.test(name))).toEqual([]);
});

test.describe('without trains.json', () => {
    test.use({ allowErrors: [/status of 404/] });

    test('there\'s no switch for the railway, and the planner is the metro\'s and the tram\'s', async ({ page }) => {
        await page.route('**/data/trains.json*', route => route.fulfill({ status: 404, body: '' }));
        await page.goto('/subway?from=kifisia&to=megara');
        await expect(boarding(page)).toHaveValue('Kifisia');
        await expect(page.getByRole('switch', { name: 'Tram' })).toBeVisible();
        await expect(page.locator('#suburban-switch')).toBeHidden();
        await expect(field(page)).toHaveValue('');
        await field(page).fill('Megara');
        await expect(suggestions(page)).toHaveCount(0);
    });
});
