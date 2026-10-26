// Every page with the text at 200% (WCAG 1.4.4), as for someone who has set a
// bigger default text size in their browser: nothing scrolls sideways and no
// text is cut off. Sizes in rem follow that setting (DESIGN.md), so this is
// what keeps them in rem. Cut off on purpose, with an ellipsis, is allowed.
import { expect, onlyOn, test } from './fixtures.js';
import { EVERY_PAGE, READY } from './site-pages.js';

// What doesn't fit at 200%: the window or the page scrolling sideways, text
// that spills out of its box (hidden or drawn over its neighbours), and
// words broken in the middle
function problems() {
    const found = [];
    const name = el => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? `.${el.classList[0]}` : ''}`;
    const path = el => [el.parentElement?.closest('[id], [class]'), el].filter(Boolean).map(name).join(' ');
    if (document.documentElement.scrollWidth > innerWidth) found.push('the window scrolls sideways');
    const content = document.getElementById('app-content');
    if (content && content.scrollWidth > content.clientWidth) found.push('the page scrolls sideways');
    const shown = el => el.checkVisibility() && !el.closest('.sr-only, svg');
    // Boxes whose text doesn't fit in them, innermost first, and only the
    // innermost one is named; the page's own scrolling box isn't one
    const spilled = [];
    for (const el of [...document.querySelectorAll('body *')].reverse()) {
        if (!shown(el) || el === content || !el.textContent.trim() || spilled.some(inner => el.contains(inner))) continue;
        const style = getComputedStyle(el);
        if (style.display === 'inline' || /auto|scroll/.test(style.overflowX + style.overflowY)) continue;
        const wide = style.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
        const tall = el.scrollHeight > el.clientHeight + 1;
        if (!wide && !tall) continue;
        spilled.push(el);
        found.push(`${path(el)}: text doesn't fit`);
    }
    // Words split over two lines although the unbroken run they're in
    // ("info@wayhop.gr") would have fit on a line of its own
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const lines = (start, end, node) => {
        range.setStart(node, start);
        range.setEnd(node, end);
        const rects = [...range.getClientRects()].filter(r => r.width);
        return { count: new Set(rects.map(r => Math.round(r.top))).size, width: rects.reduce((sum, r) => sum + r.width, 0) };
    };
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement || !shown(node.parentElement)) continue;
        let box = node.parentElement;
        while (getComputedStyle(box).display === 'inline' && box.parentElement) box = box.parentElement;
        const style = getComputedStyle(box);
        const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        for (const run of node.textContent.matchAll(/\S+/g)) {
            const broken = [...run[0].matchAll(/[\p{L}\p{N}]{2,}/gu)]
                .some(word => lines(run.index + word.index, run.index + word.index + word[0].length, node).count > 1);
            if (broken && lines(run.index, run.index + run[0].length, node).width <= room) found.push(`${path(node.parentElement)}: breaks words over two lines`);
        }
    }
    return [...new Set(found)];
}

// (A word wider than its box may break: .long)
test('the 200% check finds text that doesn\'t fit', async ({ page }) => {
    await page.setContent(`<main id="app-content" style="width: 200px; overflow: auto">
        <div class="short" style="height: 10px">Two<br>lines</div>
        <div class="narrow" style="width: 80px; word-break: break-all">Two Kallithea</div>
        <div class="long" style="width: 30px; overflow-wrap: anywhere">Kallithea</div>
        <div class="cut" style="width: 30px; overflow: hidden; white-space: nowrap">Kallithea</div>
        <div class="dots" style="width: 30px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis">Kallithea</div>
        <div style="width: 400px">wide</div>
    </main>`);
    expect(await page.evaluate(problems)).toEqual([
        'the page scrolls sideways',
        '#app-content div.cut: text doesn\'t fit',
        '#app-content div.short: text doesn\'t fit',
        '#app-content div.narrow: breaks words over two lines',
    ]);
});

for (const [path, , url] of EVERY_PAGE) {
    test(`${url} at 200% text`, async ({ page }) => {
        await page.goto(url);
        if (READY[path]) await expect(page.locator(READY[path]).first()).toBeAttached();
        // The browser's default text size, doubled
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        expect(await page.evaluate(problems)).toEqual([]);
    });
}

// What changes shape when it doesn't fit (style.css's container queries):
// on a phone's width, where it doesn't
test.describe('at large text', () => {
    test.beforeEach(onlyOn('phone', 'iphone'));
    const big = page => page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    test('the train diagram says where to ride in words instead of labels', async ({ page }) => {
        await page.goto('/subway?from=kifisia&to=airport');
        const diagram = page.locator('.train-diagram').first();
        await expect(diagram.locator('.position-labels')).toBeVisible();
        await expect(diagram.locator('.position-words')).toBeHidden();
        await big(page);
        await expect(diagram.locator('.position-labels')).toBeHidden();
        await expect(diagram.locator('.position-words')).toBeVisible();
        await expect(diagram.locator('.position-words .highlighted')).toHaveText(/^Ride in: \S/);
    });

    test('a bus stop\'s row puts the stop on a line of its own', async ({ page }) => {
        await page.goto('/buses');
        const header = page.locator('.stop-header').first();
        await expect(header.locator('.time-badge')).toBeVisible();
        const side = async () => {
            const [label, next] = await Promise.all(['.stop-label', '.stop-next-bus'].map(s => header.locator(s).boundingBox()));
            return next.x >= label.x + label.width - 1 ? 'beside' : next.y >= label.y + label.height - 1 ? 'under' : 'overlapping';
        };
        expect(await side()).toBe('beside');
        await big(page);
        await expect.poll(side).toBe('under');
        // the stop's band runs the row's whole width, and the time, the star and directions sit inside the row
        const [row, label, time, star, directions] = await Promise.all(['.stop-header', '.stop-label', '.time-badge', '.stop-favourite', '.directions-btn'].map(s => header.locator(s === '.stop-header' ? ':scope' : s).first().boundingBox()));
        expect(label.width).toBeGreaterThanOrEqual(row.width - 2);
        for (const box of [time, star, directions]) {
            expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width + 1);
            expect(box.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
        }
    });
});

// The favourites drawn on the bus page aren't on a fresh page: starred first
test('/buses with starred stops and lines, and a starred line\'s header, at 200% text', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('favourites', JSON.stringify({ stop: ['10361', '10341'], line: ['040/1', 'Χ95/0'] })));
    await page.goto('/buses');
    await expect(page.locator('#favourite-lines a')).toHaveCount(2);
    await expect(page.locator('#favourite-stops .time-badge').first()).toBeVisible();
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(problems)).toEqual([]);
    await page.goto('/buses?line=040&dir=1');
    await expect(page.locator('.line-favourite')).toHaveAttribute('aria-pressed', 'true');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(problems)).toEqual([]);
});
