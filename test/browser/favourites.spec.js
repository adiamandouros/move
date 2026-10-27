// Favourites in a real browser: the star on the pages, kept on the device
// (/js/core/favourites.js), and what's starred first where the tools offer
// it: stations in the planner's lists, stops and lines on the bus page.
// What's kept and in what order is tested in Node (favourites.test.js,
// station-search.test.js, bus-render.test.js).
import { onScreen, watchRequests } from './bus-requests.js';
import { axe, expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone'));

const star = page => page.locator('.station-title [data-favourite="station"]');

test('a station starred on its page comes first in the subway planner\'s lists, marked, and stays starred', async ({ page }) => {
    await page.goto('/subway/stations/kerameikos');
    await expect(star(page)).toBeVisible();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(star(page)).toHaveAccessibleName('Favourite');
    await star(page).tap();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(star(page).locator('use')).toHaveAttribute('href', /#favourite-filled$/);
    expect(await axe(page)).toEqual([]);
    await page.reload();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/subway');
    await page.locator('#stop-search-to').tap();
    const first = page.locator('#stop-suggestions-to .suggestion-item').first();
    await expect(first.locator('.suggestion-name-en')).toHaveText('Kerameikos');
    await expect(first.locator('.suggestion-favourite')).toBeVisible();
    await expect(first).toContainText(', favourite');
    // The interchanges follow, as before
    await expect(page.locator('#stop-suggestions-to .suggestion-name-en').nth(1)).toHaveText('Attiki');
    expect(await axe(page)).toEqual([]);
});

test('a starred station comes before the ones picked lately, and isn\'t offered twice', async ({ page }) => {
    await page.goto('/subway?from=syntagma');
    await page.locator('#stop-search-to').fill('Kerame');
    await page.locator('#stop-suggestions-to .suggestion-item').first().tap();
    await page.goto('/subway/stations/airport');
    await star(page).tap();
    await page.goto('/subway/stations/kerameikos');
    await star(page).tap();
    await page.goto('/subway');
    await page.locator('#stop-search-from').tap();
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en').first()).toHaveText('Kerameikos');
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en').nth(1)).toHaveText('Airport');
    await expect(page.locator('#stop-suggestions-from .suggestion-favourite')).toHaveCount(2);
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en', { hasText: 'Kerameikos' })).toHaveCount(1);
});

test('with the keyboard alone: the star is reached with Tab and pressed with Space or Enter, and unstarring takes it off the list', async ({ page }) => {
    await page.goto('/el/subway/stations/kerameikos');
    await expect(star(page)).toHaveAccessibleName('Αγαπημένο');
    for (let i = 0; i < 40 && !(await star(page).evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(star(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/el/subway');
    await page.locator('#stop-search-from').tap();
    await expect(page.locator('#stop-suggestions-from .suggestion-favourite')).toHaveCount(0);
});

test('the planner\'s lists: every station has a star; tapping it stars the station without picking it, and the row stays put until the list opens again', async ({ page }) => {
    await page.goto('/subway');
    await page.locator('#stop-search-to').tap();
    const rows = page.locator('#stop-suggestions-to .suggestion-item');
    await expect(rows.first().locator('.suggestion-name-en')).toHaveText('Attiki');
    const count = await rows.count();
    await expect(page.locator('#stop-suggestions-to .suggestion-not-favourite')).toHaveCount(count);
    await expect(page.locator('#stop-suggestions-to .suggestion-favourite')).toHaveCount(0);

    const piraeus = rows.filter({ hasText: 'Piraeus' });
    const before = await piraeus.boundingBox();
    await piraeus.locator('.suggestion-star').tap();
    await expect(piraeus.locator('.suggestion-favourite')).toBeVisible();
    await expect(piraeus).toContainText(', favourite');
    await expect(page.locator('#sr-announcer')).toHaveText('Piraeus: added to favourites');
    // Not picked (the From field has the nearest station), still open, in the same place
    await expect(page.locator('#stop-search-to')).toHaveValue('');
    await expect(page.locator('#stop-suggestions-to')).toBeVisible();
    expect(await piraeus.boundingBox()).toEqual(before);
    expect(await axe(page)).toEqual([]);

    // Opened again, it's first; tapped again, it's off
    await page.locator('#stop-search-from').tap();
    const first = page.locator('#stop-suggestions-from .suggestion-item').first();
    await expect(first.locator('.suggestion-name-en')).toHaveText('Piraeus');
    await first.locator('.suggestion-star').tap();
    await expect(first.locator('.suggestion-not-favourite')).toBeVisible();
    await expect(first).not.toContainText(', favourite');
    await expect(page.locator('#sr-announcer')).toHaveText('Piraeus: removed from favourites');

    // A tap beside the star still picks the station
    await first.locator('.suggestion-names').tap();
    await expect(page.locator('#stop-search-from')).toHaveValue('Piraeus');
    await page.goto('/subway/stations/piraeus');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the planner\'s lists with the keyboard: F stars the station on the row, as the row\'s hint says, and Enter still picks it', async ({ page }) => {
    await page.goto('/el/subway');
    const input = page.locator('#stop-search-to');
    await input.focus();
    // Pressed again until the page's script lists the stations
    await expect(async () => {
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#stop-suggestions-to')).toBeVisible({ timeout: 500 });
    }).toPass();
    await page.keyboard.press('ArrowDown');
    const row = page.locator('#stop-suggestions-to .suggestion-item').first();
    await expect(row).toBeFocused();
    await expect(row).toHaveAccessibleDescription('Πατήστε F για προσθήκη ή αφαίρεση από τα αγαπημένα');
    await page.keyboard.press('f');
    await expect(row.locator('.suggestion-favourite')).toBeVisible();
    await expect(row).toBeFocused();
    await expect(page.locator('#sr-announcer')).toHaveText('Αττική: προστέθηκε στα αγαπημένα');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Αττική');
    await page.goto('/el/subway/stations/attiki');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
});

// ── Spacing ─────────────────────────────────────────────────────────────────

test('the stars sit evenly: in the planner\'s lists midway between the list\'s edge and the name, on an opened bus stop as far from the walking directions as from the time', async ({ page }) => {
    await page.goto('/subway');
    await page.locator('#stop-search-to').tap();
    const row = page.locator('#stop-suggestions-to .suggestion-item').first();
    const [edge, star, name] = await Promise.all([row, row.locator('.suggestion-star .icon'), row.locator('.suggestion-names')].map(l => l.boundingBox()));
    expect(Math.abs((star.x - edge.x) - (name.x - star.x - star.width))).toBeLessThanOrEqual(1);

    await page.goto('/buses');
    const stop = page.locator('#stops-accordion .stop-item').first();
    await expect(stop.locator('.header-badge-wrap .time-badge')).toBeVisible();
    await stop.locator('.stop-toggle').tap();
    await expect(stop.locator('.stop-favourite')).toBeVisible();
    const [time, starIcon, walk] = await Promise.all(['.header-badge-wrap .time-badge', '.stop-favourite .icon', '.directions-btn .icon'].map(s => stop.locator(s).boundingBox()));
    const before = starIcon.x - time.x - time.width;
    const after = walk.x - starIcon.x - starIcon.width;
    expect(before).toBeGreaterThan(4);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

// ── Bus stops and lines ─────────────────────────────────────────────────────

const favourites = page => page.locator('#favourites');
// Starred before the page first opens (not again on a reload)
const seed = (page, saved) => page.addInitScript(value => { if (!localStorage.getItem('favourites')) localStorage.setItem('favourites', value); }, JSON.stringify(saved));

test('a stop starred among those nearby is listed above them with its live times, asked for once', async ({ page }) => {
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses');
    await expect(favourites(page)).toBeHidden();
    const first = page.locator('#stops-accordion .stop-item').first();
    await expect(first.locator('.header-badge-wrap .time-badge')).toBeVisible();
    const code = await first.getAttribute('data-stop');
    // The star shows once the stop is opened, and goes when it's closed
    await expect(first.locator('.stop-favourite')).toBeHidden();
    await first.locator('.stop-toggle').tap();
    await expect(first.locator('.stop-favourite')).toBeVisible();
    await expect(first.locator('.stop-favourite')).toHaveAccessibleName(new RegExp(`^Favourite: .+ ${code}$`));
    // (a tap while it's still opening is ignored)
    await expect(first.locator('.accordion-collapse')).toHaveClass(/\bshow\b/);
    await first.locator('.stop-toggle').tap();
    await expect(first.locator('.stop-favourite')).toBeHidden();
    await expect(first.locator('.accordion-collapse')).toBeHidden();
    await first.locator('.stop-toggle').tap();
    await first.locator('.stop-favourite').tap();
    await expect(first.locator('.stop-favourite')).toHaveAttribute('aria-pressed', 'true');

    await expect(favourites(page)).toBeVisible();
    await expect(favourites(page).getByRole('heading', { name: 'Favourites' })).toBeVisible();
    const starred = favourites(page).locator('.stop-item');
    await expect(starred).toHaveCount(1);
    await expect(starred).toHaveAttribute('data-stop', code);
    await expect(starred.locator('.header-badge-wrap .time-badge')).toBeVisible();
    await expect(starred.locator('.stop-favourite')).toBeHidden();
    await starred.locator('.stop-toggle').tap();
    await expect(starred.locator('.stop-favourite')).toHaveAttribute('aria-pressed', 'true');
    expect(await axe(page)).toEqual([]);
    await page.reload();
    await expect(favourites(page).locator('.stop-item')).toHaveAttribute('data-stop', code);

    // Listed twice, asked for once each time it's due, no more often than before
    await expect(favourites(page).locator('.header-badge-wrap .time-badge')).toBeVisible();
    await run(40);
    const times = (await asks()).filter(a => a.code === code).map(a => a.at);
    expect(times.length).toBeGreaterThan(1);
    expect(times.every((at, i) => !i || at - times[i - 1] >= 30_000), `asked at ${times}`).toBe(true);
});

test('starred stops are asked for only while on screen, like the stops nearby', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await seed(page, { stop: ['10705', '440014', '440104', '440102', '440042', '390005', '390004', '390006', '390011', '700021'] });
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses');
    await expect(favourites(page).locator('.stop-item')).toHaveCount(10);
    await expect(favourites(page).locator('.header-badge-wrap .time-badge').first()).toBeVisible();
    await run(4);
    const shown = await onScreen(page);
    const asked = new Set((await asks()).map(a => a.code));
    expect(shown.length, 'some starred stops on screen').toBeGreaterThan(0);
    expect(shown.filter(code => !asked.has(code)), 'on screen, not asked for').toEqual([]);
    // Rows grow once their times are in, so one just under the screen may have been on it at first
    const farBelow = await page.locator('.stop-item').evaluateAll(items => items
        .filter(e => e.getBoundingClientRect().top > innerHeight * 1.5).map(e => e.dataset.stop));
    expect(farBelow.length, 'starred and nearby stops far below the screen').toBeGreaterThan(5);
    expect(farBelow.filter(code => asked.has(code)), 'far below the screen, asked for').toEqual([]);
});

test('starred stops show, with their times, even without the location', async ({ page }) => {
    await seed(page, { stop: ['10361'] });
    await page.context().clearPermissions();
    await page.goto('/buses');
    await expect(favourites(page).locator('.stop-item[data-stop="10361"] .header-badge-wrap .time-badge')).toBeVisible();
});

test('a line starred in one direction is listed by where it goes, and opens that way', async ({ page }) => {
    await page.goto('/buses?line=040&dir=1');
    const lineStar = page.locator('.line-favourite');
    await expect(lineStar).toHaveAccessibleName('Favourite: Line 040, To PEIRAIAS');
    await lineStar.tap();
    await expect(lineStar).toHaveAttribute('aria-pressed', 'true');
    // The other direction is a favourite of its own
    await page.locator('[data-direction="0"]').tap();
    await expect(page.locator('.line-favourite')).toHaveAttribute('aria-pressed', 'false');

    await page.goto('/buses');
    const link = favourites(page).locator('#favourite-lines a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAccessibleName(/^Line 040 ?, To PEIRAIAS$/);
    await link.tap();
    await expect(page).toHaveURL(/line=040&dir=1/);
    await expect(page.locator('[data-direction="1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(favourites(page)).toBeHidden();
});

// Open a stop's row in the favourites with the keyboard, Tab to its star, unstar it
async function unstarWithKeys(page, code) {
    await favourites(page).locator(`.stop-item[data-stop="${code}"] .stop-toggle`).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(favourites(page).locator(`.stop-item[data-stop="${code}"] .stop-favourite`)).toBeFocused();
    await page.keyboard.press('Space');
}
const toggleOf = (page, code) => favourites(page).locator(`.stop-item[data-stop="${code}"] .stop-toggle`);

test('with the keyboard alone: a stop unstarred among the favourites leaves them at once, and the keyboard moves to the next stop, else the one before, else the stops nearby', async ({ page }, { project }) => {
    test.skip(project.name === 'iphone', 'WebKit only Tabs to links with Safari\'s setting on');
    await seed(page, { stop: ['10361', '10341', '60718'] });
    await page.goto('/buses');
    await expect(favourites(page).locator('.stop-item')).toHaveCount(3);

    await unstarWithKeys(page, '10341');
    await expect(favourites(page).locator('.stop-item')).toHaveCount(2);
    await expect(toggleOf(page, '60718')).toBeFocused();
    await expect(page.locator('#sr-announcer')).toHaveText(/^SYNTAGMA: removed from favourites$/);

    await unstarWithKeys(page, '60718');
    await expect(favourites(page).locator('.stop-item')).toHaveCount(1);
    await expect(toggleOf(page, '10361')).toBeFocused();

    await unstarWithKeys(page, '10361');
    await expect(favourites(page)).toBeHidden();
    await expect(page.locator('#nearby-heading')).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await page.reload();
    await expect(favourites(page)).toBeHidden();
});

test('a stop unstarred anywhere leaves the favourites at once; the ones opened there stay open, and the last stop hands the keyboard to a starred line', async ({ page }) => {
    await seed(page, { stop: ['10361', '10341'], line: ['040/1'] });
    await page.goto('/buses');
    await expect(favourites(page).locator('#favourite-lines a')).toHaveCount(1);
    await toggleOf(page, '10341').tap();
    await expect(favourites(page).locator('.stop-item[data-stop="10341"] .accordion-collapse')).toHaveClass(/\bshow\b/);

    // Unstarred among the stops nearby
    const nearby = page.locator('#stops-accordion .stop-item[data-stop="10361"]');
    await nearby.locator('.stop-toggle').tap();
    await nearby.locator('.stop-favourite').tap();
    await expect(nearby.locator('.stop-favourite')).toHaveAttribute('aria-pressed', 'false');
    await expect(favourites(page).locator('.stop-item')).toHaveCount(1);
    await expect(favourites(page).locator('.stop-item[data-stop="10341"] .accordion-collapse')).toBeVisible();

    // Unstarred among the favourites: the last stop, so the line is next
    await favourites(page).locator('.stop-favourite').tap();
    await expect(favourites(page).locator('.stop-item')).toHaveCount(0);
    await expect(favourites(page).locator('#favourite-lines a')).toBeFocused();
    await expect(favourites(page)).toBeVisible();
});

test('a station\'s star sits at the far right of its sign\'s line; without room, alone, then under it with its word', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const box = locator => locator.boundingBox();
    const word = page.locator('.station-title .favourite-btn > span');

    // Room for both: centred on the sign, at the right edge
    await page.goto('/subway/stations/omonia');
    await expect(star(page)).toBeVisible();
    await expect(word).toBeVisible();
    const [title, sign, button] = await Promise.all([page.locator('.station-title'), page.locator('.station-title h1'), star(page)].map(box));
    expect(Math.abs(button.y + button.height / 2 - (sign.y + sign.height / 2))).toBeLessThan(1);
    expect(Math.abs(button.x + button.width - (title.x + title.width))).toBeLessThan(1);

    // A longer name: the star alone, its word still there for screen readers
    await page.goto('/subway/stations/agios-eleftherios');
    await expect(page.locator('.station-title')).toHaveClass(/\bstar-alone\b/);
    await expect(star(page)).toHaveAccessibleName('Favourite');
    expect((await box(word)).width).toBeLessThanOrEqual(1);
    const [sign2, button2] = await Promise.all([page.locator('.station-title h1'), star(page)].map(box));
    expect(Math.abs(button2.y + button2.height / 2 - (sign2.y + sign2.height / 2))).toBeLessThan(1);
    expect(await axe(page)).toEqual([]);

    // Longer still: under the sign, centred, with its word
    await page.goto('/subway/stations/doukissis-plakentias');
    await expect(page.locator('.station-title')).toHaveClass(/\bstar-below\b/);
    await expect(word).toBeVisible();
    const [title3, sign3, button3] = await Promise.all([page.locator('.station-title'), page.locator('.station-title h1'), star(page)].map(box));
    expect(button3.y).toBeGreaterThanOrEqual(sign3.y + sign3.height);
    expect(Math.abs(button3.x + button3.width / 2 - (title3.x + title3.width / 2))).toBeLessThan(1);

    // Wider, it goes back beside the sign
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.locator('.station-title')).not.toHaveClass(/star-(alone|below)/);
    await expect(word).toBeVisible();
});
