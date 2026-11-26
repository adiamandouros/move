// The subway planner and the home page in a real browser. What the planner
// works out and draws at each time of day is tested in Node
// (subway-network.test.js, subway-render.test.js); here, that the page puts
// it together, on one phone. The metro's trips, as worked out here from
// rail.json, so with the suburban railway hidden: a train of its can be
// quicker (suburban.spec.js has it).
import { readFileSync } from 'fs';
import { planTrip } from '../../tools/subway/client/network.js';
import { axe, expect, onlyOn, test, toggleKept } from './fixtures.js';

const rail = JSON.parse(readFileSync(new URL('data/rail.json', import.meta.url), 'utf8'));

test.beforeEach(onlyOn('phone'));
test.beforeEach(({ page }) => page.addInitScript(() => localStorage.setItem('suburban-hidden', '1')));

const content = page => page.locator('#app-content');

test.describe('23:55 on a Wednesday, after the airport branch has stopped', () => {
    test.use({ now: '2026-10-14T23:55:00+03:00' });

    test('tomorrow\'s first trains, as clock times', async ({ page }) => {
        await page.goto('/subway?from=syntagma&to=airport');
        await expect(content(page)).toContainText('No more service today. These are tomorrow\'s first departures.');
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
        // red on the badge, and in words under the times, with the clock time
        await expect(card.locator('.time-badge.time-last')).toHaveCount(1);
        await expect(card.locator('.last-train-last')).toHaveText('Last train 23:18');
        // on its own line under the header, which keeps the times beside the line
        const [header, times, words] = await Promise.all(['.result-header', '.schedule-section', '.last-trains'].map(sel => card.locator(sel).first().boundingBox()));
        expect(words.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
        expect(times.y + times.height).toBeLessThanOrEqual(header.y + header.height + 1);
        const title = await card.locator('.leg-title').first().boundingBox();
        expect(times.y, 'the times stay beside the line').toBeLessThan(title.y + title.height);
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

test.describe('noon on 2 November, after the OASA timetable ended (31 October)', () => {
    test.use({ now: '2026-11-02T12:00:00+02:00' });

    test('the warning is one closed line above the answer; opened, it stays open through the refresh; the next page starts closed', async ({ page }) => {
        await page.goto('/subway?from=kifisia&to=syntagma');
        const warning = page.locator('details.timetable-notice');
        const summary = warning.locator('summary');
        await expect(summary).toHaveText('The OASA timetable ended on 31/10/2026');
        await expect(warning).not.toHaveAttribute('open');
        await expect(warning.locator('.notice-body')).toBeHidden();
        // One line: no taller than the lines of words beside it
        const { height } = await summary.boundingBox();
        expect(height).toBeLessThan(40);
        expect(await axe(page)).toEqual([]);

        // With the keyboard
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(warning.locator('.notice-body')).toHaveText('Departure times come from it, so they may have changed since.');

        // The 30-second refresh draws it again: still open, still focused
        await warning.evaluate(el => el.setAttribute('data-before-refresh', ''));
        await page.clock.runFor(30_000);
        await expect(page.locator('[data-before-refresh]')).toHaveCount(0);
        await expect(warning).toHaveAttribute('open', '');
        await expect(summary).toBeFocused();

        // Another page: closed again
        await page.goto('/subway?from=kifisia&to=airport');
        await expect(warning).toHaveCount(1);
        await expect(warning).not.toHaveAttribute('open');
    });
});

test('a change of line, with the whole trip\'s arrival and length at the top', async ({ page }) => {
    await page.goto('/subway?from=kifisia&to=aigaleo');
    await expect(page.locator('.result-card').first()).toBeVisible();
    // (text for screen readers in between: "about", "47 minutes")
    const label = page.locator('h2.route-option-label').first();
    await expect(label).toContainText(/Via \w+/);
    await expect(label.locator('.route-total')).toContainText(/Arrive ~[^·]*\d\d:\d\d · \d+'/);
    // Where to change on the left, the arrival on the right
    const [line, via, arrival] = await Promise.all([label, label.locator('span:not(.sr-only)').first(), label.locator('.route-total')].map(l => l.boundingBox()));
    expect(Math.abs(via.x - line.x)).toBeLessThan(1);
    expect(Math.abs(arrival.x + arrival.width - (line.x + line.width))).toBeLessThan(1);
    expect(await axe(page)).toEqual([]);
});

test('one route: «No transfers» on the left, its arrival on the right', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const line = page.locator('p.route-option-label');
    const noTransfers = line.locator('span:not(.sr-only)').first();
    await expect(noTransfers).toHaveText('No transfers');
    await expect(line.locator('.route-total')).toContainText(/Arrive ~[^·]*\d\d:\d\d · \d+'/);
    const [box, left, arrival] = await Promise.all([line.boundingBox(), noTransfers.boundingBox(), line.locator('.route-total').boundingBox()]);
    expect(Math.abs(left.x - box.x)).toBeLessThan(1);
    expect(Math.abs(arrival.x + arrival.width - (box.x + box.width))).toBeLessThan(1);
});

test('each card ends with where to get off on the left, the stops (and with a change, minutes) on the right', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const [path, ride] of [['/subway?from=syntagma&to=airport', /^15 stops$/], ['/subway?from=kifisia&to=aigaleo', /^(\d+)'\1 minutes · \d+ stops$/], ['/el/subway?from=kifisia&to=aigaleo', /^(\d+)'\1 λεπτά · \d+ σταθμοί$/]]) {
        // ("12'" on screen, "12 minutes" for screen readers)
        await page.goto(path);
        const action = page.locator('.leg-action').first();
        await expect(action.locator('.leg-ride')).toHaveText(ride);
        // Under the train
        const [diagram, below] = await Promise.all([page.locator('.result-card').first().locator('.train-diagram'), action].map(l => l.boundingBox()));
        expect(below.y).toBeGreaterThanOrEqual(diagram.y + diagram.height);
        const [box, where, stops] = await Promise.all([action, action.locator('span').first(), action.locator('.leg-ride')].map(l => l.boundingBox()));
        expect(Math.abs(where.x - box.x)).toBeLessThan(1);
        expect(Math.abs(stops.x + stops.width - (box.x + box.width))).toBeLessThan(1);
    }
});

test('«Change to …» between the cards is centred on them', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/subway?from=kifisia&to=aigaleo');
    const connector = page.locator('.transfer-connector').first();
    await expect(connector).toContainText(/Change to M\d/);
    // The line to change to is its pill
    await expect(connector.locator('.line-pill')).toHaveText(/^M\d$/);
    const [card, icon, text] = await Promise.all([page.locator('.result-card').first(), connector.locator('.icon'), connector.locator('> span')].map(l => l.boundingBox()));
    // From the icon's left edge to the text's right edge
    expect(Math.abs((icon.x + text.x + text.width) / 2 - (card.x + card.width / 2))).toBeLessThan(1);
});

test('the train diagram is shaped like a train: a rounded tail on the left, a sloped nose on the right', async ({ page }) => {
    await page.goto('/subway?from=kifisia&to=aigaleo');
    const cars = page.locator('.train-diagram').first().locator('.train-car');
    await expect(cars).toHaveCount(5);
    const radii = await cars.evaluateAll(all => all.map(car => {
        const style = getComputedStyle(car);
        return { tail: parseFloat(style.borderTopLeftRadius), nose: parseFloat(style.borderTopRightRadius) };
    }));
    const middle = radii[2];
    expect(radii[0].tail).toBeGreaterThan(middle.tail);
    expect(radii[4].nose).toBeGreaterThan(middle.nose);
    expect(radii[0].nose).toBe(middle.nose);
    expect(radii[4].tail).toBe(middle.tail);
    // A highlighted end car keeps its highlight border
    const last = cars.last();
    await last.evaluate(car => car.classList.add('highlighted'));
    await expect(last).toHaveCSS('border-top-color', 'rgb(244, 245, 247)');
});

test('the car to ride in is the station sign\'s off-white, never yellow like the warnings', async ({ page }) => {
    await page.goto('/subway?from=kifisia&to=airport');
    const car = page.locator('.result-card .train-car.highlighted').first();
    await expect(car).toHaveCSS('background-color', 'rgb(244, 245, 247)');
    await expect(car).toHaveCSS('color', 'rgb(15, 19, 28)');
});

test('each name under the cars is centred under its car, in Greek too', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/el/subway?from=kifisia&to=airport');
    const diagram = page.locator('.result-card .train-diagram').first();
    await expect(diagram.locator('.position-labels')).toBeVisible();
    const centre = box => box.x + box.width / 2;
    const cars = await diagram.locator('.train-car').evaluateAll(all => all.map(el => el.getBoundingClientRect().toJSON()));
    const labels = await diagram.locator('.position-label').evaluateAll(all => all.map(el => el.getBoundingClientRect().toJSON()));
    expect(labels).toHaveLength(cars.length);
    cars.forEach((car, i) => expect(Math.abs(centre(labels[i]) - centre(car)), `label ${i}`).toBeLessThan(1.5));
});

test('a central platform\'s «Doors open on the left» sits on its own line, centred under where to get off', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/subway?from=syntagma&to=airport');
    const card = page.locator('.result-card').first();
    const badge = card.locator('.tag');
    await expect(badge).toHaveText('Doors open on the left');
    const [action, doors] = await Promise.all([card.locator('.leg-action'), badge].map(l => l.boundingBox()));
    expect(doors.y).toBeGreaterThanOrEqual(action.y + action.height);
    expect(Math.abs(doors.x + doors.width / 2 - (action.x + action.width / 2))).toBeLessThan(1);
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

test('an option\'s line too long for the phone: «Via …» ends in «…», the arrival stays whole', async ({ page }) => {
    // Narrower than any phone, so it can't fit whatever the font
    await page.setViewportSize({ width: 240, height: 640 });
    await page.goto('/subway?from=agios-eleftherios&to=syntagma');
    const label = page.locator('h2.route-option-label').filter({ hasText: 'Monastiraki' });
    await expect(label).toBeVisible();
    const measure = loc => loc.evaluate(e => ({ cut: e.scrollWidth > e.clientWidth, lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) }));
    expect(await measure(label)).toEqual({ cut: false, lines: 1 });
    expect(await measure(label.locator('.route-via'))).toMatchObject({ cut: true });
    expect(await label.locator('.route-via').evaluate(e => getComputedStyle(e).textOverflow)).toBe('ellipsis');
    expect(await measure(label.locator('.route-total'))).toMatchObject({ cut: false });
    // Screen readers still hear all of it
    await expect(label).toContainText('Via Monastiraki');
});

test('a slower option starts closed; opened, it stays open through the refresh, until the stations change', async ({ page }) => {
    // Noon: three options, the third 6 minutes after the first
    await page.goto('/subway?from=kifisia&to=syntagma');
    const slower = page.locator('details.route-details');
    const summary = slower.locator('summary');
    await expect(slower).toHaveCount(1);
    await expect(summary).toHaveAccessibleName('Show route · 6 minutes slower');
    await expect(slower.locator('.result-card').first()).toBeHidden();
    expect(await axe(page)).toEqual([]);

    // With the keyboard
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(slower.locator('.result-card').first()).toBeVisible();
    await expect(summary).toHaveAccessibleName('Hide route · 6 minutes slower');

    // The 30-second refresh draws it again: still open, still focused
    await slower.evaluate(el => el.setAttribute('data-before-refresh', ''));
    await page.clock.runFor(30_000);
    await expect(page.locator('[data-before-refresh]')).toHaveCount(0);
    await expect(slower).toHaveAttribute('open', '');
    await expect(summary).toBeFocused();

    // Other stations and back: closed again
    await page.locator('#swap-stations').click();
    await page.locator('#swap-stations').click();
    await expect(slower).not.toHaveAttribute('open');
    await expect(slower.locator('.result-card').first()).toBeHidden();
});

// Decision 61
test('a train\'s minutes count down by themselves; in its last minute 0\', and gone as it leaves', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const chip = content(page).locator('.schedule-chips .time-badge[data-at]').first();
    const at = Number(await chip.getAttribute('data-at'));
    const left = at - await page.evaluate(() => Date.now() / 1000);
    expect(left).toBeGreaterThan(60);
    const train = content(page).locator(`.time-badge[data-at="${at}"]`).first();
    await expect(train.locator('[aria-hidden="true"]')).toHaveText(`${Math.floor(left / 60)}'`);
    await page.clock.runFor(Math.ceil(left - 2) * 1000);
    await expect(train.locator('[aria-hidden="true"]')).toHaveText('0\'');
    await page.clock.runFor(3_000);
    await expect(content(page).locator(`.time-badge[data-at="${at}"]`)).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
});

test('a leg\'s stops open its stations on the way, by tap or keyboard; open through the refresh, until the stations change', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const toggle = content(page).locator('.leg-stops-toggle').first();
    const list = content(page).locator('ol.leg-stations').first();
    await expect(toggle).toHaveAccessibleName('15 stops');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();

    // A tap: Syntagma to the Airport, in order
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(list).toHaveAccessibleName('Stations on the way');
    const items = list.locator('li');
    await expect(items).toHaveCount(16);
    await expect(items.first()).toHaveText(/^Syntagma/);
    await expect(items.last()).toHaveText(/^Airport/);
    // The tap target: at least 24 px high (DESIGN.md)
    expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(24);
    expect(await axe(page)).toEqual([]);

    // The 30-second refresh draws it again: still open, still focused
    await toggle.focus();
    await list.evaluate(el => el.setAttribute('data-before-refresh', ''));
    await page.clock.runFor(30_000);
    await expect(page.locator('[data-before-refresh]')).toHaveCount(0);
    await expect(list).toBeVisible();
    await expect(toggle).toBeFocused();

    // With the keyboard: closed
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();
    await page.keyboard.press('Space');
    await expect(list).toBeVisible();

    // Other stations and back: closed again
    await page.locator('#swap-stations').click();
    await page.locator('#swap-stations').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();
});

test('the signpost walks you to the boarding station, and goes when there is none', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const walk = page.locator('#walk-btn');
    await expect(walk).toHaveAccessibleName('Walking directions to Syntagma (opens in a new tab)');
    await expect(walk).toHaveAttribute('href', /destination=37\.\d+,23\.\d+&travelmode=walking/);
    // On the boarding row, just before Nearest
    const [walkBox, nearest, field] = await Promise.all([walk, page.locator('#locate-btn'), page.locator('#stop-search-from')].map(l => l.boundingBox()));
    expect(walkBox.x).toBeGreaterThanOrEqual(field.x + field.width);
    expect(walkBox.x + walkBox.width).toBeLessThanOrEqual(nearest.x);
    expect(Math.abs(walkBox.y - nearest.y)).toBeLessThan(1);
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
    // Nothing but what the page is for
    await expect(page.locator('#subway-result .result-card')).toHaveCount(0);
    await expect(page.locator('.subway-intro')).toBeVisible();
    await page.goto('/subway?from=toString&to=syntagma');
    await expect(page.locator('#stop-search-to')).toHaveValue('Syntagma');
    await expect(page.locator('#walk-btn')).toBeHidden();
});

// Decision 81: Home is what's near, the metro stations in the menu
test('home: where to and what\'s near you, no footer; the metro stations in the menu', async ({ page }) => {
    await page.goto('/');
    await expect(content(page)).toContainText('Where to?');
    await expect(content(page)).toContainText('Near you');
    await expect(page.locator('footer')).toHaveCount(0);
    await page.locator('.menu-btn').click();
    await page.locator('#site-menu').getByRole('link', { name: 'Metro stations' }).click();
    await expect(page).toHaveURL(/\/subway\/stations$/);
    await page.goto('/el');
    await expect(content(page)).toContainText('Πού πάτε;');
});

test('tapping a suggestion picks it and leaves the field, so the phone\'s keyboard closes', async ({ page }) => {
    await page.goto('/subway?from=syntagma');
    const to = page.locator('#stop-search-to');
    await to.fill('Airp');
    await page.locator('#stop-suggestions-to .suggestion-item').first().tap();
    await expect(to).toHaveValue('Airport');
    await expect(page).toHaveURL(/to=airport/);
    await expect(to).not.toBeFocused();
    await expect(page.locator('#stop-suggestions-to')).toBeHidden();
});

test('tapping an empty field lists stations to start from: the interchanges, then the ends of the lines', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tram-hidden', '1'));
    await page.goto('/subway?from=syntagma');
    const list = page.locator('#stop-suggestions-to');
    await page.locator('#stop-search-to').tap();
    await expect(list.locator('.suggestion-name-en')).toHaveText([
        'Attiki', 'Monastiraki', 'Omonia', 'Piraeus', 'Syntagma',
        'Airport', 'Anthoupoli', 'Dimotiko Theatro', 'Elliniko', 'Kifisia',
    ]);
    await expect(page.locator('#stop-search-to')).toHaveAttribute('aria-expanded', 'true');
    expect(await axe(page)).toEqual([]);
    await list.getByText('Airport').tap();
    await expect(page).toHaveURL(/to=airport/);
    await expect(list).toBeHidden();
});

test('the stations picked lately come first, in either field, and are still there later', async ({ page }) => {
    await page.goto('/subway?from=syntagma');
    await page.locator('#stop-search-to').fill('Kerame');
    await page.locator('#stop-suggestions-to .suggestion-item').first().tap();
    await page.reload();
    await page.locator('#stop-search-from').tap();
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en').first()).toHaveText('Kerameikos');
    // A station from the address wasn't picked here, so it isn't offered
    await expect(page.locator('#stop-suggestions-from .suggestion-name-en').nth(1)).toHaveText('Attiki');
});

test('tapping into a field with a station selects its name, so typing replaces it, and lists the stations; a second tap places the cursor', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const to = page.locator('#stop-search-to');
    const selected = () => to.evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd));
    await to.tap();
    await expect(page.locator('#stop-suggestions-to')).toBeVisible();
    expect(await selected()).toBe('Airport');
    // Tapped again, the name can be edited (selecting on every tap left Android no way to)
    await to.tap({ position: { x: 4, y: 10 } });
    expect(await selected()).toBe('');
    // Left and tapped into again, it's selected again
    await to.blur();
    await to.tap();
    expect(await selected()).toBe('Airport');
    await page.keyboard.type('Omon');
    await expect(to).toHaveValue('Omon');
    await expect(page.locator('#stop-suggestions-to .suggestion-name-en')).toHaveText(['Omonia']);
});

test('with the keyboard: ArrowDown opens the list, Enter picks, and the list stays closed after', async ({ page }) => {
    await page.goto('/subway?from=syntagma');
    const to = page.locator('#stop-search-to');
    const list = page.locator('#stop-suggestions-to');
    await to.focus();
    await expect(list).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(to).toHaveValue('Attiki');
    await expect(to).toBeFocused();
    await expect(list).toBeHidden();
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

test('under the trip, what the train shows: open, in words, and closes with the keyboard', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const legend = page.locator('.diagram-legend');
    await expect(legend).toHaveAttribute('open', '');
    await expect(legend.getByRole('listitem')).toContainText(['Ride in this part of the train', 'An escalator up', 'An elevator']);
    expect(await axe(page)).toEqual([]);
    await legend.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(legend).not.toHaveAttribute('open', '');
    await expect(legend.getByRole('listitem').first()).toBeHidden();
    // Through the 30-second refresh it stays closed, and keeps the focus
    await page.clock.runFor(31_000);
    await expect(legend).not.toHaveAttribute('open', '');
    await expect(legend.locator('summary')).toBeFocused();
});

test('entering the planner: what it does, and what the train shows, open', async ({ page }) => {
    // The nearest station fills in where to get on; where to get off is still to pick
    await page.goto('/subway');
    await expect(page.locator('.subway-intro')).toContainText('Pick where you get on and where you get off');
    await expect(page.locator('.diagram-legend')).toHaveAttribute('open', '');
    expect(await axe(page)).toEqual([]);
});

test('a legend closed stays closed after a reload and on the station pages, until opened again', async ({ page }) => {
    await page.goto('/subway?from=syntagma&to=airport');
    const legend = page.locator('.diagram-legend');
    await toggleKept(legend);
    await expect(legend).not.toHaveAttribute('open', '');
    await page.reload();
    await expect(page.locator('.result-card').first()).toBeVisible();
    await expect(legend).not.toHaveAttribute('open', '');
    // Another trip, and the page before stations are picked
    await page.goto('/subway?from=kifisia&to=aigaleo');
    await expect(page.locator('.result-card').first()).toBeVisible();
    await expect(legend).not.toHaveAttribute('open', '');
    await page.goto('/subway/stations/airport');
    await expect(legend).not.toHaveAttribute('open', '');
    // Opened there: open everywhere again
    await toggleKept(legend);
    await expect(legend).toHaveAttribute('open', '');
    await page.goto('/subway?from=syntagma&to=airport');
    await expect(page.locator('.result-card').first()).toBeVisible();
    await expect(legend).toHaveAttribute('open', '');
});
