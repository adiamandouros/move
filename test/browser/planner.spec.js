// The subway planner and the home page in a real browser. What the planner
// works out and draws at each time of day is tested in Node
// (subway-network.test.js, subway-render.test.js); here, that the page puts
// it together, on one phone.
import { readFileSync } from 'fs';
import { planTrip } from '../../tools/subway/client/network.js';
import { axe, expect, onlyOn, test } from './fixtures.js';

const rail = JSON.parse(readFileSync(new URL('data/rail.json', import.meta.url), 'utf8'));

test.beforeEach(onlyOn('phone'));

const content = page => page.locator('#app-content');

test.describe('23:55 on a Wednesday, after the airport branch has stopped', () => {
    test.use({ now: '2026-10-14T23:55:00+03:00' });

    test('tomorrow\'s first trains, as clock times', async ({ page }) => {
        await page.goto('/subway?from=syntagma&to=airport');
        await expect(content(page)).toContainText('No more trains today. These are tomorrow\'s first trains.');
        await expect(content(page)).toContainText(/At\s*0[5-7]:\d\d/);
        expect(await axe(page)).toEqual([]);
    });

});

test.describe('22:50 on a Wednesday, before the last airport train', () => {
    test.use({ now: '2026-10-21T22:50:00+03:00' });

    test('STASY\'s late airport trains the GTFS doesn\'t have are offered, the last one marked', async ({ page }) => {
        await page.goto('/subway?from=syntagma&to=airport');
        // The 22:54 from Dimotiko Theatro reaches Syntagma at 23:18, in 28 minutes (the GTFS's last left at 22:06)
        const card = page.locator('.result-card').first();
        await expect(card).toContainText('28 minutes');
        await expect(card).toContainText('Last train');
        await expect(content(page)).not.toContainText('No more trains today');
    });
});

test.describe('00:05 on a Wednesday, after the last train from Dimotiko Theatro', () => {
    test.use({ now: '2026-10-21T00:05:00+03:00' });

    test('the timetable\'s later trains that STASY doesn\'t publish (depot runs) aren\'t offered', async ({ page }) => {
        await page.goto('/subway?from=dimotiko-theatro&to=syntagma');
        await expect(page.locator('.result-card').first()).toBeVisible();
        // The timetable had one at 00:14 (to the depot at Doukissis, in 9 minutes); the next train is the morning's
        await expect(content(page)).toContainText(/At\s*05:3\d/);
    });
});

test.describe('noon on Wednesday 28 October, a holiday', () => {
    // Winter time since 25 October
    test.use({ now: '2026-10-28T12:00:00+02:00' });

    test('the planner shows the holiday\'s trains, not a normal Wednesday\'s', async ({ page }) => {
        // The test data's feed gives M2 its own trains that day (fewer: about every 8 minutes)
        const toElliniko = rail.lines.M2.directions.elliniko.timetable;
        expect(toElliniko.dates?.['2026-10-28'], 'refreshed test data still needs 28 October as a holiday').toBeDefined();
        const next = date => planTrip(rail, 'syntagma', 'elliniko', { weekday: 3, seconds: 12 * 3600, date }).plans[0].legs[0].departures[0].departs;
        const minutes = Math.floor((next('2026-10-28') - 12 * 3600) / 60);
        expect(minutes).not.toBe(Math.floor((next('2026-10-21') - 12 * 3600) / 60));

        await page.goto('/subway?from=syntagma&to=elliniko');
        await expect(page.locator('.result-card').first()).toContainText(`${minutes} minutes`);
    });
});

test('a change of line, with the whole trip\'s arrival and length at the top', async ({ page }) => {
    await page.goto('/subway?from=kifisia&to=aigaleo');
    await expect(page.locator('.result-card').first()).toBeVisible();
    // (text for screen readers in between: "about", "47 minutes")
    await expect(page.locator('.route-option-label').first()).toContainText(/Via \w+ · Arrive ~[^·]*\d\d:\d\d · \d+'/);
    expect(await axe(page)).toEqual([]);
});

test('each option\'s line stays one line on a small phone, in Greek too (the longest)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    // Four options, one via Monastiraki (the longest name)
    for (const path of ['/subway', '/el/subway']) {
        await page.goto(`${path}?from=agios-eleftherios&to=syntagma`);
        const labels = page.locator('h2.route-option-label');
        await expect(labels.first()).toBeVisible();
        const sizes = await labels.evaluateAll(els => els.map(e => ({
            text: e.textContent, fits: e.scrollWidth <= e.clientWidth,
            lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)),
        })));
        expect(sizes.some(s => /Monastiraki|Μοναστηράκι/.test(s.text)), 'still a route via Monastiraki').toBe(true);
        for (const size of sizes) expect(size, size.text).toMatchObject({ fits: true, lines: 1 });
    }
});

test('the signpost walks you to the boarding station, and goes when there is none', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const walk = page.locator('#walk-btn');
    await expect(walk).toHaveAccessibleName('Walking directions to Syntagma (opens in a new tab)');
    await expect(walk).toHaveAttribute('href', /destination=37\.\d+,23\.\d+&travelmode=walking/);
    // The swap button sits right under it
    const centre = async locator => { const box = await locator.boundingBox(); return box.x + box.width / 2; };
    expect(Math.abs(await centre(walk) - await centre(page.locator('#swap-stations')))).toBeLessThan(1);
    const syntagma = await walk.getAttribute('href');
    await page.locator('#swap-stations').click();
    await expect(walk).toHaveAccessibleName(/Walking directions to Airport/);
    expect(await walk.getAttribute('href')).not.toBe(syntagma);
    await page.locator('#stop-search-from').fill('');
    await expect(walk).toBeHidden();
    expect(await axe(page)).toEqual([]);
});

test('names every object has in the address aren\'t stations: empty fields, no crash', async ({ page }) => {
    await page.goto('/subway?from=constructor&to=__proto__');
    await expect(page.locator('#stop-search-from')).toHaveValue('');
    await expect(page.locator('#stop-search-to')).toHaveValue('');
    await expect(page.locator('#walk-btn')).toBeHidden();
    await expect(page.locator('#subway-result')).toBeEmpty();
    await page.goto('/subway?from=toString&to=syntagma');
    await expect(page.locator('#stop-search-to')).toHaveValue('Syntagma');
    await expect(page.locator('#walk-btn')).toBeHidden();
});

test('home: intro and shortcuts, and no footer (the links are in the menu and the sidebar)', async ({ page }) => {
    await page.goto('/');
    await expect(content(page)).toContainText('Live bus arrivals at the stops around you');
    await expect(content(page)).toContainText('Metro stations');
    await expect(page.locator('footer')).toHaveCount(0);
    await page.goto('/el');
    await expect(content(page)).toContainText('Σταθμοί μετρό');
});

test('what is typed before the page\'s script has loaded is kept, and searched', async ({ page }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/data/rail.json', async route => { await held; await route.continue(); });
    await page.goto('/subway');
    await page.locator('#stop-search-from').fill('synta');
    await page.locator('#stop-search-to').fill('Airport');
    release();
    await expect(page.locator('#stop-search-from')).toHaveValue('synta');
    await expect(page.locator('#stop-suggestions-from')).toBeVisible();
    await expect(page.locator('#stop-suggestions-from .suggestion-item').first()).toContainText('Syntagma');
    // A full name counts as chosen, as when leaving the field
    await expect(page.locator('#stop-search-to')).toHaveValue('Airport');
    await expect(page).toHaveURL(/to=airport/);
    expect(await axe(page)).toEqual([]);
});
