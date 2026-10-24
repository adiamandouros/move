// Every page with the text at 200% (WCAG 1.4.4), as for someone who has set a
// bigger default text size in their browser: nothing scrolls sideways and no
// text is cut off. Sizes in rem follow that setting (DESIGN.md), so this is
// what keeps them in rem. Cut off on purpose, with an ellipsis, is allowed.
import { expect, test } from './fixtures.js';
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
    // Words split over two lines, once per element
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement || !shown(node.parentElement)) continue;
        for (const word of node.textContent.matchAll(/[\p{L}\p{N}]{2,}/gu)) {
            range.setStart(node, word.index);
            range.setEnd(node, word.index + word[0].length);
            const tops = new Set([...range.getClientRects()].filter(r => r.width).map(r => Math.round(r.top)));
            if (tops.size > 1) found.push(`${path(node.parentElement)}: breaks words over two lines`);
        }
    }
    return [...new Set(found)];
}

// What doesn't fit yet, while sizes are still in px (DESIGN.md, step 1 of the
// visual overhaul). A problem not listed here fails the test; the list only
// gets shorter, and goes once everything is in rem.
const KNOWN = new Set([
    // The navigation: fixed heights and widths around text in rem
    '#bottom-nav: text doesn\'t fit',
    '#bottom-nav a.nav-btn: text doesn\'t fit',
    'div.d-flex a.nav-btn: text doesn\'t fit',
    'div.mt-auto a.lang-toggle-btn: text doesn\'t fit',
    'a.brand-link span: text doesn\'t fit',
    // Home tiles
    'a.card span.tool-tile-title: breaks words over two lines',
    'a.card span.tool-tile-desc: breaks words over two lines',
    // Buses: the narrow stop column
    'span.stop-label span.stop-name: breaks words over two lines',
    // Subway: the search row, the trip cards and the train diagram
    'div.subway-search-wrap div.d-flex: text doesn\'t fit',
    'div.result-header div.schedule-section: text doesn\'t fit',
    'div.card-body div.train-diagram: text doesn\'t fit',
    'div.card div.card-body: text doesn\'t fit',
    'span.d-flex span.line-pill: text doesn\'t fit',
    'h2.line-heading span.line-pill: text doesn\'t fit',
    // Station pages: the train diagram and the timetable
    'the page scrolls sideways',
]);

test('the 200% check finds text that doesn\'t fit', async ({ page }) => {
    await page.setContent(`<main id="app-content" style="width: 200px; overflow: auto">
        <div class="short" style="height: 10px">Two<br>lines</div>
        <div class="narrow" style="width: 30px; overflow-wrap: anywhere">Kallithea</div>
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
        expect((await page.evaluate(problems)).filter(problem => !KNOWN.has(problem))).toEqual([]);
    });
}
