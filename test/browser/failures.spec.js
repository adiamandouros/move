// When things go wrong: OASA down, slow to recover or limiting us, the
// announcement sources down, the data not built yet, the phone losing its
// connection. Each page must say what's going on, stay usable and
// accessible, keep trying at the approved pace, and recover by itself.
// The scenarios are copies of the site in server.js; the bus page's timing
// rules are in tools/buses/client/timing.js.
import { axe, expect, keyboardWalk, setScenario, test } from './fixtures.js';

// The same in every browser: one phone is enough
test.beforeEach(({}, { project }) => test.skip(project.name !== 'phone', 'the same everywhere: runs on phone only'));

// Every /api/arrivals request the page makes
function arrivalRequests(page) {
    const asked = [];
    page.on('request', r => { if (r.url().includes('/api/arrivals?')) asked.push(r.url()); });
    return asked;
}
const status = page => page.locator('#bus-status');

test.describe('OASA down', () => {
    test.use({ scenario: 'oasa-down' });

    test('the bus page says live times are unavailable, keeps trying every 32 s, and recovers', async ({ page }) => {
        const asked = arrivalRequests(page);
        await page.goto('/buses');
        await expect(status(page)).toHaveText('Live times are unavailable right now.');
        await expect(page.locator('.stop-item').first()).toContainText('Live times are unavailable right now.');
        await expect(page.locator('.stop-item .arrival-badge')).toHaveCount(0);
        expect(await axe(page)).toEqual([]);

        // Not before its time…
        const first = asked.length;
        await page.clock.fastForward(20_000);
        expect(asked.length, 'no retries within 30 s').toBe(first);
        // …then again, and OASA is back
        await setScenario(page, 'normal');
        await page.clock.fastForward(13_000);
        await expect(page.locator('.stop-item .arrival-badge').first()).toBeVisible();
        await expect(status(page)).toBeHidden();
    });

    test('in Greek too', async ({ page }) => {
        await page.goto('/el/buses');
        await expect(status(page)).toHaveText('Οι ώρες σε πραγματικό χρόνο δεν είναι διαθέσιμες αυτή τη στιγμή.');
    });
});

test.describe('OASA answering late', () => {
    test.use({ scenario: 'oasa-stale' });

    test('the last answers are shown, with a note that they may be old', async ({ page }) => {
        await page.goto('/buses');
        await expect(page.locator('.stop-item .arrival-badge').first()).toBeVisible();
        await expect(status(page)).toHaveText('Live times may be a few minutes old.');
        expect(await axe(page)).toEqual([]);
    });
});

test.describe('over the per-visitor limit', () => {
    test.use({ scenario: 'oasa-limited', allowErrors: [/status of 429/] });

    test('stops say unavailable, nothing is asked again for 32 s, then it recovers', async ({ page }) => {
        const asked = arrivalRequests(page);
        await page.goto('/buses');
        await expect(status(page)).toHaveText('Live times are unavailable right now.');
        const first = asked.length;
        await page.clock.fastForward(20_000);
        expect(asked.length, 'no retries within 30 s').toBe(first);
        await setScenario(page, 'normal');
        await page.clock.fastForward(13_000);
        await expect(page.locator('.stop-item .arrival-badge').first()).toBeVisible();
    });
});

test.describe('the announcement sources down', () => {
    test.use({ scenario: 'announcements-down', allowErrors: [/status of 503/] });

    test('Info says the announcements couldn\'t load; the rest of the page works', async ({ page }) => {
        await page.goto('/info');
        await expect(page.locator('#announcements')).toHaveText('Couldn\'t load the announcements. Check your connection and try again later.');
        await page.locator('#toggle-map').click();
        await expect(page.locator('#metro-map .map-station').first()).toBeAttached();
        expect(await axe(page)).toEqual([]);
    });

    test('home shows no disruption banner and nothing broken', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('#disruptions')).toBeEmpty();
        expect(await axe(page)).toEqual([]);
    });
});

test.describe('before the first data build', () => {
    test.use({ scenario: 'no-data', allowErrors: [/status of 404/] });

    test('the subway page says the data couldn\'t load', async ({ page }) => {
        await page.goto('/subway?from=syntagma&to=airport');
        await expect(page.locator('#app-content')).toContainText('Couldn\'t load the subway data.');
        expect(await axe(page)).toEqual([]);
    });

    test('the bus page says the stop list couldn\'t load', async ({ page }) => {
        await page.goto('/buses');
        await expect(page.locator('#bus-message')).toContainText('Couldn\'t load the bus stop list.');
        expect(await axe(page)).toEqual([]);
    });

    test('the Info map says it couldn\'t load; announcements still come', async ({ page }) => {
        await page.goto('/info');
        await page.locator('#toggle-map').click();
        await expect(page.locator('#metro-map')).toContainText('Couldn\'t load the map.');
        await expect(page.locator('#announcements li').first()).toBeAttached();
        expect(await axe(page)).toEqual([]);
    });

    test('station pages answer "not found" until there\'s a timetable', async ({ page }) => {
        const response = await page.goto('/subway/stations/syntagma');
        expect(response.status()).toBe(404);
        await expect(page.locator('h1')).toHaveText('Page not found');
    });
});

test.describe('losing the connection on the bus page', () => {
    test.use({ allowErrors: [/ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/] });

    test('the last times stay, count down and are marked as possibly old; refreshing resumes on reconnecting', async ({ page, context }) => {
        const asked = arrivalRequests(page);
        await page.goto('/buses');
        const badge = page.locator('.stop-item .header-badge-wrap').first();
        await expect(badge).not.toBeEmpty();
        const before = parseInt(await badge.textContent());

        await context.setOffline(true);
        await page.clock.fastForward(61_000);
        await expect(page.locator('.stop-item .arrival-badge').first()).toBeVisible();
        // Counting down from when the answer came, not from the failed refresh
        await expect(badge).toHaveText(new RegExp(`^${before - 1}\\b`));
        await expect(status(page)).toHaveText('Live times may be a few minutes old.');
        expect(await axe(page)).toEqual([]);

        await context.setOffline(false);
        const offline = asked.length;
        await page.clock.fastForward(33_000);
        await expect.poll(() => asked.length).toBeGreaterThan(offline);
        await expect(status(page)).toBeHidden();
    });
});

test.describe('a page that can\'t be drawn', () => {
    // Omonia's data is broken in this copy of the site, so its page fails (500)
    test.use({ scenario: 'broken-data', allowErrors: [/status of 500/] });

    test('the error page, in the page\'s language, without the error, and a way home', async ({ page }) => {
        for (const [path, title, home] of [['/subway/stations/omonia', 'Something went wrong', 'Go to the home page'], ['/el/subway/stations/omonia', 'Κάτι πήγε στραβά', 'Μετάβαση στην αρχική σελίδα']]) {
            const res = await page.goto(path);
            expect(res.status()).toBe(500);
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
            await expect(page.locator('main')).not.toContainText('TypeError');
            expect(await axe(page)).toEqual([]);
            const walk = await keyboardWalk(page);
            expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
            await page.getByRole('link', { name: home }).click();
            await expect(page).toHaveURL(path.startsWith('/el') ? /\/el$/ : /\/$/);
        }
    });
});
