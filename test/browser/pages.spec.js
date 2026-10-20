// Every page, in both languages, once its scripts have drawn it: in the right
// language, no axe-core violations (WCAG 2.2 AA), and usable with the keyboard
// alone, with only the page scrolling. New pages in the registry are picked up by themselves.
import { loadTools, sitePages } from '../../server/pages/registry.js';
import { axe, expect, keyboardWalk, test } from './fixtures.js';

// What to wait for before checking a page whose content comes from its scripts
const READY = {
    '/buses': '.stop-item .arrival-badge',
    '/info': '#sec-announcements li',
    '/subway?from=kifisia&to=airport': '.result-card',
    '/buses?stop=10341': '.stop-item .arrival-row',
    '/buses?line=040': '.stop-item .stop-toggle',
};
const PAGES = [
    ...sitePages(loadTools()).map(p => p.path),
    '/subway?from=kifisia&to=airport',
    '/buses?stop=10341',
    '/buses?line=040',
    '/subway/stations',
    '/subway/stations/omonia',
    '/nope',
];
const greek = path => path === '/' ? '/el' : `/el${path}`;

for (const path of PAGES) {
    for (const [lang, url] of [['en', path], ['el', greek(path)]]) {
        test(`${url}`, async ({ page }, testInfo) => {
            await page.goto(url);
            if (READY[path]) await expect(page.locator(READY[path]).first()).toBeAttached();
            await expect(page.locator('html')).toHaveAttribute('lang', lang);

            expect(await axe(page), 'axe-core violations').toEqual([]);

            // Only the page scrolls, never the window with the navigation in it
            const window = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, height: innerHeight }));
            expect(window.scroll, 'the window scrolls').toBeLessThanOrEqual(window.height);

            // Phones have no keyboard, except that some people use one with them;
            // WebKit only tabs to links when Safari's setting is on, so it's skipped there
            if (testInfo.project.name !== 'iphone') {
                const walk = await keyboardWalk(page);
                expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
            }
        });
    }
}
