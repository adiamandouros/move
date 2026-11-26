// The bus page's stops near you on a phone (tools/buses/client/): the
// floating buttons, the search's example and the heading over the stops,
// and the pause after 10 untouched minutes. Which stops it asks for and when
// is tested in Node (bus-timing.test.js), and every request of a scripted
// visit in bus-trace.spec.js.
import { axe, expect, onlyOn, test } from './fixtures.js';

test.beforeEach(onlyOn('phone', 'iphone'));

// The floating buttons cover part of a stop scrolled under them: its walking
// directions still has room to tap (WCAG 2.5.8, axe's target-size), as it
// fills the stop's line (decision 79) rather than only its icon
test('the floating buttons are solid, and a stop\'s walking directions fill its line', async ({ page }) => {
    await page.goto('/buses');
    await expect(page.locator('.stop-item .time-badge').first()).toBeVisible();
    for (const background of await page.locator('#bus-actions .btn').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor))) {
        expect(background).not.toMatch(/transparent|rgba\(.*, 0\)/);
    }
    const sizes = await page.locator('.stop-item').evaluateAll(items => items.map(item => ({
        row: item.querySelector('.stop-actions').getBoundingClientRect().height,
        link: item.querySelector('.directions-btn').getBoundingClientRect().height,
    })));
    for (const { row, link } of sizes) {
        expect(link).toBeCloseTo(row, 0);
        expect(link).toBeGreaterThanOrEqual(40);
    }
});

// A stop's row (DESIGN.md, "List rows", decision 79): the stop's line on
// top, its star and walking directions at its end; the next bus under it
// across the row, its minutes level with its plate. Opened, the list starts
// with that bus, so it isn't shown twice; closed again, it's back
test('a stop\'s row: its line with its star, the next bus across the row under it, not twice once opened', async ({ page }) => {
    await page.goto('/buses');
    const stop = page.locator('#stops-accordion .stop-item[data-has-arrivals="true"]').first();
    await expect(stop.locator('.header-badge-wrap .time-badge')).toBeVisible();
    const boxes = () => Promise.all(['.stop-header', '.stop-name', '.stop-favourite .icon', '.directions-btn .icon', '.next-bus-line', '.next-bus-dest', '.header-badge-wrap .time-badge']
        .map(s => stop.locator(s).boundingBox()));
    const [row, name, star, walk, plate, dest, time] = await boxes();
    const middle = (/** @type {{ y: number, height: number }} */ b) => b.y + b.height / 2;
    for (const icon of [star, walk]) expect(Math.abs(middle(icon) - middle(name))).toBeLessThanOrEqual(4);
    expect(star.x + star.width).toBeLessThan(walk.x);
    expect(plate.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(Math.abs(middle(time) - middle(plate))).toBeLessThanOrEqual(2);
    expect(time.x + time.width).toBeLessThanOrEqual(row.x + row.width);
    // Where it goes has the row but for the plate and the minutes
    expect(time.x - (plate.x + plate.width)).toBeGreaterThan(row.width / 2);
    expect(dest.x).toBeGreaterThan(plate.x + plate.width);

    await stop.locator('.stop-toggle').tap();
    await expect(stop.locator('.accordion-collapse')).toHaveClass(/\bshow\b/);
    await expect(stop.locator('.arrival-row').first()).toBeVisible();
    await expect(stop.locator('.stop-next-bus')).toBeHidden();
    await expect(stop.locator('.header-badge-wrap')).toBeHidden();
    await expect(stop.locator('.stop-favourite')).toBeVisible();
    await stop.locator('.stop-toggle').tap();
    await expect(stop.locator('.accordion-collapse')).toBeHidden();
    await expect(stop.locator('.stop-next-bus')).toBeVisible();
    await expect(stop.locator('.header-badge-wrap .time-badge')).toBeVisible();
});

// Decision 79, with the shape of a real answer at Syntagma (10361, 26 Nov
// 2026): one line seven times is one row, its next bus at the right, the
// next two under where it goes; another line a row of its own; every plate
// as wide, so where each bus goes starts at one edge; no line between them;
// the stop's code inside, not on the stop's line
test('an opened stop: a row a line, "then in" its next buses, plates in one column, the code inside', async ({ page }) => {
    const x95 = { line: 'Χ95', to: { el: 'ΑΕΡ/ΝΑΣ ΑΘΗΝΩΝ - ΣΥΝΤΑΓΜΑ EXPRESS', en: 'AER/NAS ATHINON - SYNTAGMA [EXPRESS]' } };
    const arrivals = [3, 15, 31, 41, 51, 66, 76].map(minutes => ({ ...x95, minutes }));
    arrivals.splice(1, 0, { line: '2', to: { el: 'ΑΝΩ ΚΥΨΕΛΗ - ΠΑΓΚΡΑΤΙ', en: 'ANO KYPSELI - PAGKRATI' }, minutes: 11 });
    await page.route(/\/api\/arrivals\?stops=10361$/, route => route.fulfill({ json: { stops: { 10361: { arrivals } } } }));
    await page.goto('/buses');
    const stop = page.locator('#stops-accordion .stop-item[data-stop="10361"]');
    await expect(stop.locator('.header-badge-wrap .time-badge')).toBeVisible();
    // Seen: the text outside what only screen readers hear
    const seen = await stop.locator('.stop-label').evaluate(label => {
        const copy = /** @type {HTMLElement} */ (label.cloneNode(true));
        copy.querySelectorAll('.sr-only').forEach(e => e.remove());
        return copy.textContent;
    });
    expect(seen).not.toContain('10361');
    await expect(stop.locator('.stop-label')).toContainText('stop code 10361');
    await stop.locator('.stop-toggle').tap();
    await expect(stop.locator('.accordion-collapse')).toHaveClass(/\bshow\b/);
    const rows = stop.locator('.arrival-row');
    await expect(rows).toHaveCount(2);
    const then = rows.first().locator('.arrival-then');
    await expect(then).toContainText("then in 15'");
    await expect(then).toContainText("31'");
    await expect(then).not.toContainText("41'");
    await expect(rows.nth(1).locator('.arrival-then')).toHaveCount(0);
    await expect(stop.locator('.stop-code')).toHaveText('Stop 10361');
    // After the lines, smaller, at the right end of their last line, level
    // with its last plate
    const [foot, last, code] = await Promise.all([stop.locator('.stop-foot'), stop.locator('.stop-lines .bus-plate').last(), stop.locator('.stop-code')].map(l => l.boundingBox()));
    expect(code.x).toBeGreaterThan(last.x + last.width);
    const middle = code.y + code.height / 2;
    expect(middle).toBeGreaterThan(last.y);
    expect(middle).toBeLessThan(last.y + last.height);
    expect(foot.x + foot.width - (code.x + code.width)).toBeLessThanOrEqual(13);
    const [plates, dests, lines] = await Promise.all([
        rows.locator('.bus-plate').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => [r.left, r.width])),
        rows.locator('.arrival-dest').evaluateAll(els => els.map(e => e.getBoundingClientRect().left)),
        rows.evaluateAll(els => els.map(e => getComputedStyle(e).borderBottomStyle)),
    ]);
    expect(new Set(plates.map(([left, width]) => `${Math.round(left)} ${Math.round(width)}`)).size).toBe(1);
    expect(Math.abs(dests[0] - dests[1])).toBeLessThanOrEqual(1);
    expect(lines).toEqual(['none', 'none']);
    expect(await axe(page)).toEqual([]);
});

// The search's example is its placeholder; the nearby stops have a heading
// saying they're near you, and a stop or a line doesn't (its way back does)
for (const [url, heading, example] of [
    ['/buses', 'Stops near you', 'e.g. Syntagma, 10341, 040, X95'],
    ['/el/buses', 'Στάσεις κοντά σας', 'π.χ. Σύνταγμα, 10341, 040, Χ95'],
]) {
    test(`${url}: the search's example in the box, a heading over the stops near you`, async ({ page }) => {
        await page.goto(url);
        await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', example);
        await expect(page.locator('.stop-item').first()).toBeVisible();
        const nearby = page.getByRole('heading', { name: heading });
        await expect(nearby).toBeVisible();
        const [bottom, first] = await Promise.all([
            nearby.evaluate(e => e.getBoundingClientRect().bottom),
            page.locator('.stop-item').first().evaluate(e => e.getBoundingClientRect().top),
        ]);
        expect(bottom).toBeLessThanOrEqual(first);

        for (const view of ['?line=040', '?stop=10341']) {
            await page.goto(url + view);
            await expect(page.locator('.stop-item').first()).toBeVisible();
            await expect(nearby).toBeHidden();
        }
    });
}

// The bus trip finder went with buses for everyone on the Trip page
// (decision 39): no "Where to?", and an old link to it shows the stops nearby
test('no trip finder: no "Where to?", and an old ?trip link shows the stops near you', async ({ page }) => {
    await page.goto('/buses');
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await expect(page.getByText('Where to?')).toHaveCount(0);
    await page.goto('/buses?trip&to=station:syntagma&from=10341');
    await expect(page.getByRole('heading', { name: 'Stops near you' })).toBeVisible();
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await expect(page.getByRole('searchbox')).toBeVisible();
});

// After 10 minutes nobody touched the page, it stops asking for times and
// says so, between the search and the stops, as much space above as below;
// a tap brings the times back
for (const url of ['/el/buses', '/el/buses?line=040']) {
    test(`${url}: the pause notice, evenly spaced, and a tap to resume`, async ({ page }) => {
        await page.goto(url);
        await expect(page.locator('.stop-item').first()).toBeVisible();
        await page.clock.runFor(11 * 60_000);
        const notice = page.locator('#bus-status');
        await expect(notice).toContainText('Σε παύση για εξοικονόμηση δεδομένων.');
        const gaps = await page.evaluate(() => {
            // A line's bar is pinned: measured where it sits above the stops, not over them
            document.getElementById('app-content').scrollTo(0, 0);
            const status = document.getElementById('bus-status').getBoundingClientRect();
            const header = document.getElementById('view-header');
            const line = document.getElementById('line-bar');
            const above = (!line.hidden ? line.lastElementChild : header.hidden ? document.getElementById('nearby-heading') : header.lastElementChild).getBoundingClientRect();
            return { above: Math.round(status.top - above.bottom), below: Math.round(document.getElementById('stops-accordion').getBoundingClientRect().top - status.bottom) };
        });
        expect(gaps.above, `space above and below: ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(gaps.below - 1);
        expect(gaps.above).toBeLessThanOrEqual(gaps.below + 1);
        expect(gaps.below).toBeGreaterThanOrEqual(8);

        await notice.getByRole('button', { name: 'Πατήστε για ανανέωση' }).click();
        await expect(notice).toBeHidden();
    });
}

