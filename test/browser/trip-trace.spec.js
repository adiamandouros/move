// The trace of a ride (/trip?trace, decision 69): turned on by the address
// and kept on, every position written down with how exact it is, stations
// marked, the way followed and where the rider was placed, saved as a file,
// stopped and deleted. Off, there's no panel and nothing kept. What's kept
// and counted is tested in Node (test/trip-trace.test.js)
import { readFile } from 'node:fs/promises';
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';
import { list, MENELAOU_45, to } from './trip-page.js';

// A phone tool, the same everywhere: on the phone only
test.beforeEach(onlyOn('phone'));
test.use({ location: { at: MENELAOU_45 } });

const panel = page => page.locator('#trip-trace');
const counts = page => page.locator('#trip-trace-counts');
const send = (page, changes) => page.evaluate(changes => {
    window.__setLocation(changes);
    window.__sendPosition();
}, changes);
// The trace as saved: the file downloaded, read
async function saved(page) {
    const download = page.waitForEvent('download');
    await panel(page).getByRole('button', { name: 'Save the trace' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^wayhop-trace-\d{8}-\d{4}Z\.json$/);
    return JSON.parse(await readFile(await file.path(), 'utf8'));
}

test('off, the Trip page has no trace and keeps nothing', async ({ page }) => {
    await page.goto('/trip');
    await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'true');
    await send(page, { accuracy: 30 });
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => [localStorage.getItem('trip-trace'), localStorage.getItem('trip-trace-on')])).toEqual([null, null]);
});

test('on from /trip?trace: each position with its accuracy, stations marked, kept through a reload, saved, stopped and deleted', async ({ page }) => {
    await page.goto('/trip?trace');
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(/\/trip$/);
    await expect(page.getByRole('heading', { name: 'Trace' })).toBeVisible();

    // A rough position, as a phone underground gives, and an exact one
    await expect(counts(page)).toContainText('Last: ±20 m');
    await send(page, { accuracy: 850 });
    await expect(counts(page)).toContainText('(1 rougher than 200 m) · Last: ±850 m · Stations marked: 0');
    await send(page, { accuracy: 15 });
    await expect(counts(page)).toContainText('Last: ±15 m');

    await panel(page).getByRole('button', { name: 'At a station' }).click();
    await expect(page.locator('#sr-announcer')).toHaveText('Station 1 marked');
    await expect(counts(page)).toContainText('Stations marked: 1');
    expect(await axe(page)).toEqual([]);
    const walk = await keyboardWalk(page);
    expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);

    // Still on, with all of it, once the page is opened again without ?trace
    await page.goto('/trip');
    await expect(counts(page)).toContainText('Stations marked: 1');
    const file = await saved(page);
    expect(file).toMatchObject({ wayhop: 'trace', version: 1, roughMetres: 200 });
    expect(file.browser).toBeTruthy();
    const fixes = file.entries.filter(e => e.kind === 'fix');
    expect(fixes.map(f => f.accuracy)).toEqual(expect.arrayContaining([850, 15]));
    expect(fixes.every(f => f.lat === MENELAOU_45.lat && f.lng === MENELAOU_45.lng && f.got >= f.at)).toBe(true);
    expect(file.entries.filter(e => e.kind === 'station')).toEqual([{ kind: 'station', at: expect.any(Number), count: 1 }]);
    expect(file.entries.some(e => e.kind === 'hidden')).toBe(true);

    // Stopped: asked first, then the panel and everything kept gone, and off
    page.once('dialog', dialog => dialog.dismiss());
    await panel(page).getByRole('button', { name: 'Stop and delete' }).click();
    await expect(panel(page)).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await panel(page).getByRole('button', { name: 'Stop and delete' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('#sr-announcer')).toHaveText('Trace stopped and deleted');
    expect(await page.evaluate(() => [localStorage.getItem('trip-trace'), localStorage.getItem('trip-trace-on')])).toEqual([null, null]);
    await page.reload();
    await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page)).toHaveCount(0);
});

test('followed from My location: the way and where each position placed the rider on it', async ({ page }) => {
    await page.goto('/trip?trace');
    await to(page).fill('Άλσος');
    await list(page, 'to').first().click();
    await expect(page.locator('.trip-card').first()).toContainText('040');
    // 60 m east: left the start, on the walk to Pl. Dabaki
    const east = { lat: MENELAOU_45.lat, lng: MENELAOU_45.lng + 60 / (111_195 * Math.cos(MENELAOU_45.lat * Math.PI / 180)) };
    await send(page, { at: east });
    await expect(page.locator('#trip-from-status')).toHaveText('Following your ride');
    const { entries } = await saved(page);
    const way = entries.find(e => e.kind === 'way');
    expect(way.steps.map(s => s.kind)).toEqual(expect.arrayContaining(['walk', 'wait', 'ride', 'last']));
    expect(entries.filter(e => e.kind === 'way')).toHaveLength(1);
    const placed = entries.filter(e => e.kind === 'placed');
    expect(placed.at(-1)).toMatchObject({ left: true, step: 0, stop: 0, any: null, off: false });
    expect(entries.indexOf(way)).toBeLessThan(entries.indexOf(placed.at(-1)));
});
