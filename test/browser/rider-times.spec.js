// Times measured by riders (decision 84), as a rider meets them: asked once,
// the first time the Trip page follows a metro or tram ride; "No thanks"
// sends nothing, ever; "Yes" sends the ride's times a while after it, in one
// request; the answer changed on the Trip page and the privacy page. What
// the phone measures, and the server's side: test/trip-measure.test.js and
// test/rider-times.test.js
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';
import { list, MENELAOU_45, moveTo, STAVROU_1, to, watchLive } from './trip-page.js';

// Following a ride is a phone's
test.beforeEach(onlyOn('phone'));
test.use({ location: { at: STAVROU_1 } });

const question = page => page.locator('#trip-ask');
const toggle = page => page.getByRole('switch', { name: 'Send my metro and tram times' });

// The requests that send riders' times, answered as counted
async function watchSent(page) {
    const sent = [];
    await page.route('**/api/rider-times', route => {
        sent.push(route.request().postDataJSON());
        return route.fulfill({ status: 204 });
    });
    return sent;
}

// From Σταύρου 1, where the location is, to Μενελάου 45: the way shown in
// full takes the T6 (trip-page.js); the rider walks to its stop. Its stops
async function atTheTram(page) {
    const liveWay = await watchLive(page);
    await page.goto('/trip');
    await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'true');
    await to(page).fill('Μενελάου 45');
    await list(page, 'to').first().click();
    await expect.poll(async () => (await liveWay())?.rides[0].line).toBe('T6');
    const tram = (await liveWay()).rides[0].along.map(([lat, lng]) => ({ lat, lng }));
    await moveTo(page, tram[0]);
    return tram;
}

test('asked once, at the tram\'s stop, without taking the keyboard; "No thanks": nothing sent, the answer kept and shown as a switch', async ({ page }) => {
    const sent = await watchSent(page);
    const tram = await atTheTram(page);
    await expect(question(page).getByRole('heading', { name: 'Help make metro and tram times better?' })).toBeVisible();
    await expect(question(page)).toContainText('with no name or number attached and no place but the stops');
    await expect(question(page).getByRole('link', { name: 'What\'s sent, on the privacy page' })).toHaveAttribute('href', '/privacy#rider-times');
    await expect(page.locator('#sr-announcer')).toHaveText('Help make metro and tram times better?');
    await expect(page.getByRole('combobox', { name: 'To' })).not.toBeFocused();
    await expect(toggle(page)).toBeHidden();
    expect(await axe(page)).toEqual([]);
    const walk = await keyboardWalk(page);
    expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);

    await question(page).getByRole('button', { name: 'No thanks' }).click();
    await expect(question(page)).toBeHidden();
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).not.toBeChecked();
    await expect(toggle(page)).toBeFocused();
    await expect(page.locator('#sr-announcer')).toHaveText('Nothing will be sent. You can change this at the end of the page.');
    expect(await page.evaluate(() => localStorage.getItem('rider-times'))).toBe('no');

    // The whole ride, and long after: nothing sent, nor asked again
    for (const stop of tram.slice(1)) await moveTo(page, stop);
    await page.clock.fastForward('20:00');
    await page.reload();
    await moveTo(page, tram[0]);
    await expect(toggle(page)).toBeVisible();
    await expect(question(page)).toBeHidden();
    expect(sent).toEqual([]);
});

test('"Yes": the ride\'s times sent in one request within 15 minutes of it, then nothing more; the switch turns it off', async ({ page }) => {
    const sent = await watchSent(page);
    const tram = await atTheTram(page);
    await question(page).getByRole('button', { name: 'Yes' }).click();
    await expect(toggle(page)).toBeChecked();
    await expect(page.locator('#sr-announcer')).toHaveText('Your metro and tram times will be sent. You can change this at the end of the page.');
    // By GPS from here: on the platform 40 s, the tram leaving, its stops
    // passed without a stand (however many the way followed rides), the door
    const gps = (at, speed) => page.evaluate(({ at, speed }) => {
        window.__setLocation({ at, accuracy: 5, speed });
        window.__sendPosition();
    }, { at, speed });
    await gps(tram[0], 0);
    await page.clock.fastForward(40_000);
    await gps(tram[0], 10);
    for (const stop of tram.slice(1)) {
        await page.clock.fastForward(20_000);
        await gps(stop, 10);
    }
    await page.clock.fastForward(60_000);
    await gps(MENELAOU_45, 1.4);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rider-times-waiting') ?? '[]').length)).toBe(1);
    expect(sent).toEqual([]);
    await page.clock.fastForward('16:00');
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ line: 'T6', day: 'weekday', hour: 12, stretches: [], stops: [] });
    // From the first fix on the platform after "Yes" to the tram leaving
    expect(sent[0].wait).toMatchObject({ s: 40, by: 'gps' });
    expect(Object.keys(sent[0]).sort()).toEqual(['day', 'dir', 'hour', 'line', 'stops', 'stretches', 'wait']);
    expect(await page.evaluate(() => localStorage.getItem('rider-times-waiting'))).toBeNull();
    await page.clock.fastForward('20:00');
    expect(sent.length).toBe(1);

    await toggle(page).uncheck();
    expect(await page.evaluate(() => localStorage.getItem('rider-times'))).toBe('no');
});

test('the privacy page: the switch says the answer and changes it, as the Trip page reads it', async ({ page }) => {
    await page.goto('/privacy');
    const choice = page.getByRole('switch', { name: 'Send my metro and tram times' });
    await expect(choice).toBeVisible();
    await expect(choice).not.toBeChecked();
    await choice.check();
    expect(await page.evaluate(() => localStorage.getItem('rider-times'))).toBe('yes');
    await page.reload();
    await expect(choice).toBeChecked();
    await page.goto('/el/privacy');
    const greek = page.getByRole('switch', { name: 'Αποστολή των χρόνων μου στο μετρό και στο τραμ' });
    await expect(greek).toBeChecked();
    await greek.uncheck();
    expect(await page.evaluate(() => localStorage.getItem('rider-times'))).toBe('no');
    // The Trip page shows the answer given here, and asks nothing
    await page.goto('/trip');
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).not.toBeChecked();
});
