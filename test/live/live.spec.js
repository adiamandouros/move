// The live site with its real data (npm run test:live, nightly): the pages
// load without errors, the planner finds a route in the real timetable, the
// announcements come in, the Info page's facts aren't too old, the bus
// page gets live times from OASA and has the lines. Only
// what breaks is checked, not what changes: at 3 a.m. there may be no buses,
// but there must be an answer.
import { axe, expect, test } from '../browser/fixtures.js';
import { hashOf, inlineScripts } from '../../server/csp.js';
import { FACTS_MAX_AGE_DAYS } from '../../server/diagnostics.js';

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

// Closing times, prices and night buses are written by hand: a reminder to
// check them again, as visitors see them (the dates come from tools/info/data.json)
test(`the facts on the Info page were checked in the last ${FACTS_MAX_AGE_DAYS} days`, async ({ page }) => {
    await page.goto('/info');
    const notes = await page.locator('.info-source').allTextContents();
    const dates = notes.flatMap(text => [...text.matchAll(/Checked on (\d\d)\/(\d\d)\/(\d{4})/g)]).map(([, d, m, y]) => `${y}-${m}-${d}`);
    expect(dates.length, 'the "Checked on" notes').toBeGreaterThanOrEqual(4);
    const old = dates.filter(date => (Date.now() - Date.parse(date)) / 86_400_000 > FACTS_MAX_AGE_DAYS);
    expect(old, 'checked too long ago: check them against the linked sources, then update the page and tools/info/data.json').toEqual([]);
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

// From last night's data build; no stop is opened, so OASA isn't asked
test('the bus page has the lines, with their stops in order', async ({ page }) => {
    await page.goto('/buses?line=040');
    await expect(page.locator('.line-heading')).toContainText('040');
    await expect.poll(() => page.locator('.stop-item').count()).toBeGreaterThan(10);
    await page.getByLabel('Find a stop by name or code, or a line').fill('x95');
    await expect(page.locator('#search-results a[href*="?line="]').first()).toContainText('Χ95');
});

test('the Content-Security-Policy is sent and allows the page\'s own inline scripts', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response.headers();
    const policy = headers['content-security-policy'] ?? headers['content-security-policy-report-only'];
    expect(policy, 'a policy, enforced or report-only').toBeTruthy();
    for (const script of inlineScripts(await response.text())) expect(policy).toContain(hashOf(script));
});

