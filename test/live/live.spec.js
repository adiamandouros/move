// The live site with its real data (npm run test:live, nightly): the pages
// load without errors, the planner finds a route in the real timetable, the
// announcements come in, and the bus page gets live times from OASA. Only
// what breaks is checked, not what changes: at 3 a.m. there may be no buses,
// but there must be an answer.
import { axe, expect, test } from '../browser/fixtures.js';

// The real time, not the browser tests' fixed one; the location stays Syntagma
test.use({ now: null });

test('home, in both languages', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await axe(page)).toEqual([]);
    await page.goto('/el');
    await expect(page.locator('html')).toHaveAttribute('lang', 'el');
});

test('the planner finds a route in the real timetable', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    await expect(page.locator('.result-card').first()).toBeVisible();
    await page.goto('/subway/stations/syntagma');
    await expect(page.locator('h1')).toContainText('Syntagma');
});

test('the announcements come in', async ({ page }) => {
    await page.goto('/info');
    const list = page.locator('#announcements');
    await expect(list).not.toContainText('Loading announcements');
    await expect(list).not.toContainText('Couldn\'t load the announcements');
});

test('the bus page gets live times from OASA', async ({ page }) => {
    // Every answer the page gets for its stops
    const answers = [];
    page.on('response', async res => {
        if (!res.url().includes('/api/arrivals?')) return;
        answers.push({ status: res.status(), body: await res.json().catch(() => null) });
    });
    await page.goto('/buses');
    await expect(page.locator('.stop-item').first()).toBeVisible();
    const stops = await page.locator('.stop-item').count();
    // The stops on screen have been asked for (the page asks one request per stop)
    await expect.poll(() => answers.filter(a => a.body).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(Math.min(stops, 3));

    expect(answers.map(a => a.status), 'HTTP statuses').toEqual(answers.map(() => 200));
    const unavailable = answers.flatMap(a => Object.entries(a.body?.stops ?? {}).filter(([, s]) => s.unavailable).map(([code]) => code));
    expect(unavailable, 'stops OASA gave no answer for').toEqual([]);
    await expect(page.locator('#bus-status')).not.toContainText('Live times are unavailable');
});
