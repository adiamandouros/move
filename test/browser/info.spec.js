// The Info page: its sections (Bootstrap's accordion) with the keyboard, the
// metro and tram maps, and every section open passing axe and the keyboard walk.
import { axe, expect, keyboardWalk, test } from './fixtures.js';

for (const lang of ['', '/el']) {
    test(`${lang || '/'}info sections, maps and station lists`, async ({ page }, { project }) => {
        await page.goto(`${lang}/info`);
        // Every section starts closed, the announcements too
        await expect(page.locator('#toggle-announcements')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#sec-announcements')).toBeHidden();
        await expect(page.locator('#toggle-map')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#sec-map')).toBeHidden();

        // Enter opens the maps, then the metro's; Space its station list (a click on the iPhone)
        const press = async (selector, key) => {
            if (project.name === 'iphone') return page.locator(selector).click();
            await page.locator(selector).focus();
            await page.keyboard.press(key);
        };
        await press('#toggle-map', 'Enter');
        await expect(page.locator('#toggle-map')).toHaveAttribute('aria-expanded', 'true');
        // Both maps start closed, with a line between them
        await expect(page.locator('#toggle-metro')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#toggle-tram')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('h3:has(#toggle-tram)')).toHaveCSS('border-top-width', '1px');
        await expect(page.locator('h3:has(#toggle-metro)')).toHaveCSS('border-top-width', '0px');
        await press('#toggle-metro', 'Enter');
        await expect(page.locator('#metro-map > .map-svg .map-station').first()).toBeAttached();
        // Stubs to the tram, each ending in its line's badge
        await expect(page.locator('#metro-map .map-stub')).toHaveCount(6);
        await expect(page.locator('#metro-map .map-badge.line-t6')).toHaveCount(3);
        // The zoom buttons hold only their icons
        const button = page.locator('.map-btn').first();
        await expect(button).toHaveText('');
        expect((await button.locator('svg').boundingBox()).width).toBeLessThan(30);

        await press('#toggle-station-list', ' ');
        await expect(page.locator('#toggle-station-list')).toHaveAttribute('aria-expanded', 'true');
        expect(await page.locator('#station-list li').count()).toBeGreaterThan(50);
        await expect(page.locator('#toggle-map')).toHaveAttribute('aria-expanded', 'true');

        // The tram: its own map, with the loop's arrows and the metro's stubs, and its stops
        await press('#toggle-tram', 'Enter');
        const tram = page.locator('#tram-map');
        await expect(tram.locator('.map-station')).toHaveCount(60);
        await expect(tram.locator('.map-arrow')).toHaveCount(14);
        await expect(tram.locator('.map-stub')).toHaveCount(8);
        // Each stub ends in its line's badge (white text on the metro's colours), besides the tram lines' 4
        await expect(tram.locator('.map-badge')).toHaveCount(12);
        await expect(tram.locator('.map-badge.line-m2 text').first()).toHaveCSS('fill', 'rgb(255, 255, 255)');
        // The ends of the lines are bold, like the changes
        await expect(tram.locator('[data-station="asklipieio-voulas"] text')).toHaveCSS('font-weight', '700');
        await expect(tram.locator('[data-station="kolymvitirio"] text')).toHaveCSS('font-weight', '400');
        await expect(tram.locator('.map-svg')).toHaveAttribute('aria-label', lang ? 'Χάρτης τραμ' : 'Tram map');
        await press('#toggle-tram-stop-list', ' ');
        await expect(page.locator('#tram-stop-list h5')).toHaveCount(2);
        await expect(page.locator('#tram-stop-list a')).toHaveCount(0);
        await expect(page.locator('#tram-stop-list .station-way')).toContainText(lang ? 'Προς Ακτή Ποσειδώνος' : 'Toward Akti Posidonos');

        await page.locator('#toggle-announcements').click();
        await expect(page.locator('#sec-announcements')).toBeVisible();

        // Every section open
        const closed = page.locator('.accordion-button.collapsed');
        for (let n = await closed.count(); n > 0; n--) await closed.first().click();
        await expect(closed).toHaveCount(0);
        expect(await axe(page)).toEqual([]);
        if (project.name !== 'iphone') {
            const walk = await keyboardWalk(page);
            expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
        }
    });
}

test('the tram map zooms with the keyboard and its buttons', async ({ page }) => {
    await page.goto('/info');
    await page.locator('#toggle-map').click();
    await page.locator('#toggle-tram').click();
    const tram = page.locator('#tram-map');
    const svg = tram.locator('.map-svg');
    await expect(tram.locator('.map-station').first()).toBeAttached();
    const whole = await svg.getAttribute('viewBox');
    await svg.focus();
    await page.keyboard.press('+');
    await expect(tram).toHaveClass(/zoomed/);
    const zoomed = await svg.getAttribute('viewBox');
    await page.keyboard.press('ArrowDown');
    await expect(svg).not.toHaveAttribute('viewBox', zoomed);
    await page.keyboard.press('0');
    await expect(svg).toHaveAttribute('viewBox', whole);
    await expect(tram).not.toHaveClass(/zoomed/);
    await tram.locator('[data-zoom="in"]').click();
    await expect(tram).toHaveClass(/zoomed/);
    await tram.locator('[data-zoom="reset"]').click();
    await expect(tram).not.toHaveClass(/zoomed/);
    // The metro map is still closed, and undrawn
    await expect(page.locator('#metro-map .map-svg')).toHaveCount(0);
});

test('a bus stop opens', async ({ page }) => {
    await page.goto('/buses');
    const first = page.locator('.stop-toggle').first();
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
});
