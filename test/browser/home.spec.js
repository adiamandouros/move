// Home (decision 81, public/js/core/home.js): where to, the starred
// stations as trips to them, and "Near you": the nearest station's next
// trains and the nearest bus stop's next buses. What's worked out is tested
// in Node (near.test.js), the disruption line in disruptions.spec.js.
import { watchRequests } from './bus-requests.js';
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';
import { from, to } from './trip-page.js';

test.beforeEach(onlyOn('phone', 'iphone'));

const station = page => page.locator('#near-you .near-card').first();
const stop = page => page.locator('#near-you .near-card').nth(1);

test('near you, where the location is allowed: Syntagma\'s trains each way, then the nearest stop\'s buses and the way to all of them', async ({ page }, { project }) => {
    await page.goto('/');
    await expect(station(page).locator('.station-sign')).toHaveText('Syntagma');
    await expect(station(page).locator('.near-row')).toHaveCount(4);
    await expect(station(page).locator('.near-row').first().locator('.line-pill')).toHaveText('M2');
    await expect(station(page).locator('.near-row').first().locator('.time-badge')).toHaveCount(2);
    await expect(stop(page).locator('.arrival-row').first()).toBeVisible();
    expect(await stop(page).locator('.arrival-row').count()).toBeLessThanOrEqual(4);
    await expect(stop(page).locator('.stop-code')).toHaveText(/^Stop \d+$/);
    await expect(stop(page).getByRole('link', { name: 'All stops near you' })).toHaveAttribute('href', '/buses');
    expect(await axe(page)).toEqual([]);
    if (project.name !== 'iphone') expect((await keyboardWalk(page)).problems).toEqual([]);
    // The stop's name opens it on the Buses page
    const code = (await stop(page).locator('.stop-code').textContent()).replace('Stop ', '');
    await stop(page).locator('.near-stop-link').click();
    await expect(page).toHaveURL(new RegExp(`/buses\\?stop=${code}$`));
});

test('in Greek, by the stations\' Greek names', async ({ page }) => {
    await page.goto('/el');
    await expect(page.locator('#near-title')).toHaveText('Κοντά σας');
    await expect(station(page).locator('.station-sign')).toHaveText('Σύνταγμα');
});

test.describe('the location not yet allowed', () => {
    test.use({ location: { permission: 'prompt' } });

    test('nothing asks for it until the button is pressed; then what\'s near', async ({ page }) => {
        await page.goto('/');
        const button = page.getByRole('button', { name: 'Use my location' });
        await expect(button).toBeVisible();
        await expect(page.locator('#near-you')).toContainText('See the next trains and buses near you.');
        expect(await page.evaluate(() => window.__geo.calls ?? window.__geo)).toBeFalsy();
        expect(await axe(page)).toEqual([]);
        await button.click();
        await expect(station(page).locator('.station-sign')).toHaveText('Syntagma');
    });
});

test.describe('the location blocked', () => {
    test.use({ location: { permission: 'denied' } });

    test('says so, and how to allow it', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#near-you')).toContainText('Location is blocked for this site');
        await expect(page.locator('#near-you .near-card')).toHaveCount(0);
    });
});

test('walked across town: near you picked again from there', async ({ page }) => {
    await page.goto('/');
    await expect(station(page).locator('.station-sign')).toHaveText('Syntagma');
    // Kallithea
    await page.evaluate(() => { window.__setLocation({ at: { lat: 37.9603, lng: 23.6972 } }); window.__sendPosition(); });
    await expect(station(page).locator('.station-sign')).toHaveText('Kallithea');
});

test('the starred stations, each a trip to it from where you are, a suburban one too', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('favourites', JSON.stringify({ station: ['piraeus-suburban', 'syntagma', 'gone'], stop: [], line: [] })));
    await page.goto('/');
    const chips = page.locator('#home-stars .star-chip');
    await expect(chips).toHaveText([/ Piraeus$/, / Syntagma$/]);
    await expect(chips.nth(1)).toHaveAccessibleName('Plan a trip to Syntagma');
    expect(await axe(page)).toEqual([]);
    await chips.nth(1).click();
    await expect(to(page)).toHaveValue('Syntagma');
    await expect(from(page)).toHaveValue('My location');
});

test('no stars: no row of them', async ({ page }) => {
    await page.goto('/');
    await expect(station(page)).toBeVisible();
    await expect(page.locator('#home-stars')).toBeHidden();
});

test('"Where to?" opens the Trip page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Where to?' }).click();
    await expect(page).toHaveURL(/\/trip$/);
});

// The numbers agreed for decision 81: the nearest stop only, on the Buses
// page's tiers, said &for=home; nothing while Home is out of sight or after
// 10 minutes untouched. Without motion (decision 82): a time's roll plays in
// real time while this passes 15 minutes in moments, so each minute's slowed
// the steps (WebKit past its 30 s); what's asked doesn't depend on it
test('OASA asked for the nearest stop only, on the Buses page\'s tiers, and not once Home is left untouched for 10 minutes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { asks, run } = await watchRequests(page);
    await page.goto('/');
    await expect(stop(page).locator('.arrival-row').first()).toBeVisible();
    const first = await asks();
    expect(first).toHaveLength(1);
    expect(first[0].for).toBe('home');
    // Its next bus within 10 minutes: asked again every 32 s
    await run(65);
    const minute = await asks();
    expect(minute.map(a => a.code)).toEqual([first[0].code, first[0].code, first[0].code]);
    expect(minute[1].at - minute[0].at).toBeGreaterThanOrEqual(32_000);
    expect(minute[1].at - minute[0].at).toBeLessThan(33_000);
    // Untouched: nothing after 10 minutes. Minutes at a time (a second at a
    // time is too slow on WebKit), each request let finish
    const skip = async ms => {
        await page.clock.runFor(ms);
        await page.waitForFunction(() => window.__pending === 0);
    };
    await skip(11 * 60_000);
    const idle = (await asks()).length;
    await skip(120_000);
    expect((await asks()).length).toBe(idle);
    // A touch: asked again at once
    await page.mouse.click(5, 5);
    await run(2);
    expect((await asks()).length).toBe(idle + 1);
});
