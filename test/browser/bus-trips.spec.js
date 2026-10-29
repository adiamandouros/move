// The bus trip finder (tools/buses/client/views/trip.js): from the stops
// nearby to "Where to?", a stop or a metro station picked, and the direct
// buses with their live times; from a picked stop when the location is off;
// what it asks of OASA, second by second. Which options and buses come out
// is tested in Node (bus-trips.test.js), what's drawn in bus-trip-render.test.js.
import { watchRequests } from './bus-requests.js';
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';

const toField = page => page.getByLabel('To: a stop or a metro station');
const options = page => page.locator('.trip-option');

test.describe('finding a trip', () => {
    test.beforeEach(onlyOn('phone', 'desktop'));

    test('from the stops nearby to a metro station: the Χ95 to the airport, with when you\'re off it', async ({ page }) => {
        await page.goto('/buses');
        // A beta, and it says so: on the way in, and on the finder
        await expect(page.locator('#where-to .tag')).toHaveText('Beta');
        await page.getByRole('link', { name: /Where to\?/ }).click();
        await expect(page.locator('.trip-title .tag')).toHaveText('Beta');
        await expect(page.locator('.trip-beta')).toHaveText('This is a beta: it\'s still being built, so it may change.');
        await expect(page).toHaveURL(/\/buses\?trip$/);
        await expect(page.locator('#trip-view')).toContainText('Your location');
        // The stop search and the way in are out of the way
        await expect(page.locator('#bus-search')).toBeHidden();
        await expect(page.locator('#where-to')).toBeHidden();

        await toField(page).fill('airport');
        await expect(page.locator('#trip-to-status')).toHaveText('Stations: 1');
        const station = page.locator('#trip-to-results a').first();
        await expect(station).toContainText('Airport');
        await expect(station.locator('.line-pill')).toHaveText('M3');
        await station.click();

        await expect(page).toHaveURL(/\?trip=&to=station%3Aairport$/);
        await expect(page.locator('.trip-title')).toHaveText(/Buses to\s+M3\s+Airport/);
        await expect(page.locator('.trip-beta')).toBeVisible();
        await expect(options(page)).toHaveCount(1);
        const x95 = options(page).first();
        await expect(x95.locator('.bus-plate')).toHaveText('Line Χ95');
        await expect(x95).toContainText('walk to SYNTAGMA');
        await expect(x95).toContainText('Get off at AIR TERMINAL (ALL DEPARTURES)');
        // Live times only, each with when you're off it: the same bus at both stops (fake OASA)
        await expect(x95.locator('.trip-bus')).toHaveCount(2);
        await expect(x95.locator('.trip-bus').first()).toContainText(/Off at \d\d:\d\d · \d+ min ride/);

        // Back to the form, then to the stops nearby
        await page.goBack();
        await expect(toField(page)).toBeVisible();
        await page.goBack();
        await expect(page.locator('#where-to')).toBeVisible();
        await expect(page.locator('.stop-item').first()).toBeVisible();
    });

    test('to a stop: the 040 to Piraeus; Enter picks the first result', async ({ page }) => {
        await page.goto('/buses?trip');
        await toField(page).fill('10183');
        await expect(page.locator('#trip-to-results a').first()).toContainText('10183');
        await toField(page).press('Enter');
        await expect(page.locator('.trip-title')).toHaveText(/Buses to PEIRAIAS\s+, stop code\s+10183/);
        await expect(options(page).locator('.bus-plate')).toHaveText(['Line 040']);
        await expect(options(page).first()).toContainText('37 stops');
    });

    test('new positions while typing keep what\'s typed and found', async ({ page }) => {
        await page.goto('/buses?trip');
        await toField(page).fill('airport');
        await expect(page.locator('#trip-to-results a')).toHaveCount(1);
        // A phone sends a position every second or so
        for (let i = 0; i < 3; i++) await page.evaluate(() => window.__sendPosition());
        await expect(toField(page)).toHaveValue('airport');
        await expect(toField(page)).toBeFocused();
        await expect(page.locator('#trip-to-results a')).toHaveCount(1);
    });

    test('no direct bus: said so, with the Subway for a station', async ({ page }) => {
        await page.goto('/buses?trip&to=station:kifisia');
        await expect(page.locator('.trip-none')).toContainText('No direct bus');
        await expect(page.getByRole('link', { name: 'Plan it on the Subway' })).toHaveAttribute('href', '/subway?to=kifisia');
    });

    test('a place that isn\'t there says so', async ({ page }) => {
        await page.goto('/buses?trip&to=99999');
        await expect(page.locator('#trip-view')).toContainText('There\'s no stop or station “99999”.');
    });

    test('in Greek', async ({ page }) => {
        await page.goto('/el/buses?trip&to=station:airport');
        await expect(page.locator('.trip-title')).toHaveText(/Λεωφορεία προς\s+M3\s+Αεροδρόμιο/);
        await expect(page.locator('.trip-beta')).toContainText('Δοκιμαστική έκδοση');
        await expect(options(page).first()).toContainText('Αποβίβαση');
    });
});

test.describe('without the location', () => {
    test.beforeEach(onlyOn('phone', 'desktop'));
    test.use({ location: { permission: 'denied', answer: 'deny' } });

    test('the start is a stop picked, then the trip goes from there', async ({ page }) => {
        await page.goto('/buses?trip');
        await expect(page.locator('#trip-view')).toContainText('Location is off, so pick the stop you start from.');
        await page.getByLabel('From: a stop').fill('10361');
        await page.locator('#trip-from-results a').first().click();
        await expect(page).toHaveURL(/\?trip=&from=10361$/);
        await expect(page.locator('#trip-view')).toContainText('SYNTAGMA');
        await toField(page).fill('airport');
        await page.locator('#trip-to-results a').first().click();
        await expect(page.locator('.trip-from')).toContainText('From SYNTAGMA');
        await expect(options(page).first()).toContainText('Board at SYNTAGMA');
    });

    test('straight to the buses, it asks where you start from', async ({ page }) => {
        await page.goto('/buses?trip&to=station:airport');
        await expect(page.locator('#trip-view')).toContainText('Where are you starting from?');
        await page.getByRole('link', { name: 'Pick a stop' }).click();
        await expect(page.getByLabel('From: a stop')).toBeVisible();
        // Where to stays chosen meanwhile
        await expect(page.locator('.trip-chosen')).toContainText('Airport');
    });
});

test('what it asks of OASA: both stops at once, the first as a new search; then the boarding stop by its line\'s next bus, the other once a minute', async ({ page }) => {
    test.skip(test.info().project.name !== 'phone', 'one device: the requests don\'t depend on the screen');
    const { asks, run } = await watchRequests(page);
    await page.goto('/buses?trip&to=station:airport');
    await expect(page.locator('.trip-bus').first()).toBeVisible();
    await run(1);
    const t0 = (await asks())[0].at;
    await run(125);
    // The Χ95's next bus is 4 minutes away: every 30 s (+2); the terminal every 60 s (+2)
    expect((await asks()).map(a => [Math.floor((a.at - t0) / 1000), a.code, a.for])).toEqual([
        [0, '10361', 'trip-start'], [0, '10705', 'trip'],
        [32, '10361', 'trip'],
        [62, '10705', 'trip'], [64, '10361', 'trip'],
        [96, '10361', 'trip'],
        [124, '10705', 'trip'],
    ]);
});

test('accessible, and usable with the keyboard alone', async ({ page }, testInfo) => {
    for (const url of ['/buses?trip', '/buses?trip&to=station:airport', '/el/buses?trip&to=10183']) {
        await page.goto(url);
        await expect(page.locator('.trip-title')).toBeVisible();
        if (url.includes('to=')) await expect(page.locator('.trip-bus').first()).toBeVisible();
        expect(await axe(page), url).toEqual([]);
        // (Safari moves with Tab only between fields, unless told otherwise)
        if (testInfo.project.name !== 'iphone') {
            const walk = await keyboardWalk(page);
            expect(walk.problems, `${url}: ${walk.stops.join(' → ')}`).toEqual([]);
        }
    }
    await page.goto('/buses?trip');
    await toField(page).fill('air');
    await expect(page.locator('#trip-to-results a').first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
});
