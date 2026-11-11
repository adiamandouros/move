// The trip page (tools/trip/): an address typed and picked, the trip, the hard
// cases, and search being down. What's worked out and drawn is tested in Node
// (trip-plan.test.js, trip-render.test.js); here, that the page puts it
// together. The addresses are test/fixtures/places.js.
import { watchRequests } from './bus-requests.js';
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';
import { from, hereToSyntagma, list, MEGARA, MENELAOU_45, MENELAOU_85, moveTo, pickBoth, pickDecision, pickPark, to, watchPlans } from './trip-page.js';

test.describe('the trip page', () => {
    test.beforeEach(onlyOn('phone'));

    test('from an address to a station: the trip, then back to the fields', async ({ page }) => {
        await pickBoth(page);
        await expect(page.locator('.trip-card').first()).toBeVisible();
        await expect(page.locator('.trip-total [aria-hidden="true"]').first()).toHaveText(/^~?\d+(–\d+)?'$/);
        await expect(page.locator('#trip-form')).toBeHidden();
        await expect(page.locator('.trip-places')).toContainText('Μενελάου 45');
        await page.getByRole('button', { name: 'Change' }).click();
        await expect(from(page)).toBeFocused();
        await expect(page.locator('.trip-card').first()).toBeVisible();
    });

    test('axe-core is clean with the list open and with a trip', async ({ page }) => {
        await page.goto('/trip');
        await from(page).fill('Μενελάου');
        await expect(list(page, 'from').first()).toBeVisible();
        expect(await axe(page), 'axe-core violations').toEqual([]);
        await pickBothFrom(page);
        await expect(page.locator('.trip-card').first()).toBeVisible();
        expect(await axe(page), 'axe-core violations').toEqual([]);
    });

    test('a page that reaches the server only by POST, with nothing in the address', async ({ page }) => {
        const asked = [];
        page.on('request', request => { if (request.url().includes('/api/places')) asked.push(request); });
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45');
        await expect(list(page, 'from').first()).toBeVisible();
        expect(asked.length).toBeGreaterThan(0);
        for (const request of asked) {
            expect(request.method()).toBe('POST');
            expect(request.url()).not.toContain('?');
        }
        expect(page.url()).not.toContain('Μενελάου');
    });

    test('the keyboard alone: down to a place, Enter picks it, Escape closes', async ({ page }) => {
        await page.goto('/trip');
        await from(page).focus();
        await page.keyboard.type('Μενελάου 45');
        await expect(list(page, 'from').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(list(page, 'from').first()).toBeHidden();
        await expect(from(page), 'Escape closes the list, and leaves what\'s typed').toHaveValue('Μενελάου 45');
        await page.keyboard.type(' ');
        await expect(list(page, 'from').first()).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await expect(list(page, 'from').first()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(from(page)).toHaveValue('Μενελάου 45');
        await expect(from(page)).toBeFocused();
        const walk = await keyboardWalk(page);
        expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
    });

    test('a street that isn\'t in that town says so and lists where it is', async ({ page }) => {
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45, Νέα Σμύρνη');
        await expect(page.locator('#trip-from-status')).toContainText('isn\'t in that town');
        await expect(list(page, 'from').first()).toContainText('Καλλιθέας');
    });

    test('my location is on when the page opens: the trip starts from here', async ({ page }) => {
        await page.goto('/trip');
        await expect(from(page)).toHaveValue('My location');
        await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'true');
        await to(page).fill('Συγγρού-Φιξ');
        await list(page, 'to').first().click();
        await expect(page.locator('.trip-card').first()).toBeVisible();
        await expect(page.locator('.trip-places')).toContainText('My location');
    });

    test('what is typed before the train times have loaded is kept, and searched', async ({ page }) => {
        let release;
        const held = new Promise(resolve => { release = resolve; });
        await page.route('**/data/rail.json', async route => { await held; await route.continue(); });
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45');
        await to(page).fill('Συγγρού-Φιξ');
        release();
        await expect(from(page)).toHaveValue('Μενελάου 45');
        await expect(list(page, 'from').first()).toContainText('Μενελάου 45');
        await expect(list(page, 'to').first()).toContainText('Συγγρού Φιξ');
        await expect(page.locator('.trip-intro')).toBeVisible();
        expect(await axe(page), 'axe-core violations').toEqual([]);
        // Enter, as a tap on one list closes the other
        await to(page).press('Enter');
        await list(page, 'from').first().click();
        await expect(page.locator('.trip-card').first()).toBeVisible();
    });

    test('swap turns the trip around', async ({ page }) => {
        await page.goto('/trip');
        await from(page).fill('Μενελάου 45');
        await list(page, 'from').first().click();
        await page.locator('#trip-swap').click();
        await expect(to(page)).toHaveValue('Μενελάου 45');
        await expect(from(page)).toHaveValue('');
    });

    test('the tram, unless it\'s hidden on the Subway page: then the metro alone', async ({ page }) => {
        const trip = async () => {
            await page.goto('/trip');
            await from(page).fill('Σταύρου 1');
            await list(page, 'from').first().click();
            await to(page).fill('Άλσος');
            await list(page, 'to').first().click();
            await expect(page.locator('.trip-card').first()).toBeVisible();
        };
        await trip();
        await expect(page.locator('#trip-result .line-t6').first()).toBeVisible();
        await page.evaluate(() => localStorage.setItem('tram-hidden', '1'));
        await trip();
        await expect(page.locator('#trip-result .line-m2').first()).toBeVisible();
        await expect(page.locator('#trip-result .line-t6')).toHaveCount(0);
    });

    test('buses for everyone, with no Beta tag: the page asks for their times, and an old /trip?buses link is the same page', async ({ page }) => {
        const asked = [];
        page.on('request', request => { if (request.url().includes('/data/buses.json')) asked.push(request.url()); });
        await pickBoth(page);
        await expect(page.locator('#trip-result .bus-plate').first()).toBeVisible();
        expect(asked.length).toBeGreaterThan(0);
        await expect(page.locator('.trip-heading .tag')).toHaveCount(0);
        await expect(page.getByText('Beta')).toHaveCount(0);
        await pickBoth(page, '/trip?buses');
        await expect(page.locator('#trip-result .bus-plate').first()).toBeVisible();
    });

    test('the next half hour takes the answer\'s place: its range, the stops and their buses, and nothing under it', async ({ page }) => {
        await pickBoth(page);
        // One clear way at noon: any of the buses from the stops near the door
        const best = page.locator('.trip-card').first();
        // "16–19'" on screen, "16 to 19 minutes" for screen readers
        await expect(best.locator('.trip-total [aria-hidden="true"]')).toHaveText(/^\d+–\d+'$/);
        await expect(best.locator('.trip-total')).toHaveAccessibleName(/^\d+ to \d+ minutes$/);
        await expect(best).toContainText('Best on most departures');
        await expect(best).toContainText('Any of these buses, whichever comes first:');
        await expect(best.locator('.bus-plate').first()).toBeVisible();
        await expect(page.locator('#trip-checking')).toHaveCount(0);
        const more = best.locator('.trip-more');
        await expect(more.locator('summary')).toHaveText(/^\d+ more stops$/);
        await expect(more.locator('.trip-step').first()).toBeHidden();
        await more.locator('summary').click();
        await expect(more.locator('.trip-step').first()).toBeVisible();
        await expect(page.locator('#trip-result > :last-child'), 'nothing under the answer').toHaveClass(/trip-card/);
        await expect(page.locator('#trip-timing')).toHaveCount(0);
        expect(await axe(page), 'axe-core violations').toEqual([]);
        const walk = await keyboardWalk(page);
        expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
    });

    // DESIGN.md, "The Trip page": the guide's picture of a way
    test('a bus ride: when it leaves, strong, its badge and the next one\'s at the right end of its heading; a walk\'s directions at the far right of its row', async ({ page }) => {
        await pickPark(page);
        const best = page.locator('.trip-card').first();
        const ride = best.locator('li.trip-step', { has: page.locator('.trip-step-badges') });
        await expect(ride).toHaveCount(1);
        // The next half hour's answer in the place of the answer for leaving now
        await expect(page.locator('#trip-checking')).toHaveCount(0);
        // By the timetable until OASA has it: "~12:09", bold
        await expect(ride.locator('.trip-step-when [aria-hidden="true"]')).toHaveText(/^~\d\d:\d\d$/);
        expect(await ride.locator('.trip-step-when').evaluate(el => getComputedStyle(el).fontWeight)).toBe('700');
        await expect(ride.locator('.trip-step-head .bus-plate.pill-m')).toHaveText('040');
        const badges = ride.locator('.trip-step-badges');
        await expect(badges).not.toHaveClass(/trip-live/);
        await expect(badges.locator('.time-badge [aria-hidden="true"]').first()).toHaveText(/^\d+'$/);
        expect(Math.abs(await ride.evaluate(step => step.querySelector('.trip-step-head').getBoundingClientRect().right - step.querySelector('.trip-step-badges').getBoundingClientRect().right))).toBeLessThan(1);
        // The walk to its stop: plain words, and the walking figure as tall as the row, at its far right
        const walk = best.locator('li.trip-step', { hasText: 'Walk to' }).first();
        await expect(walk.getByRole('link')).toHaveCount(1);
        await expect(walk.getByRole('link', { name: /^Walking directions to .+ \(opens in a new tab\)$/ })).toBeVisible();
        const edges = await walk.evaluate(step => {
            const [row, button] = [step, step.querySelector('a')].map(el => el.getBoundingClientRect());
            return { right: row.right - button.right, height: row.height - button.height };
        });
        expect(Math.abs(edges.right)).toBeLessThan(1);
        expect(Math.abs(edges.height)).toBeLessThan(1);
        expect(await axe(page), 'axe-core violations').toEqual([]);
    });

    test('in Greek too', async ({ page }) => {
        await page.goto('/el/trip');
        await page.getByRole('combobox', { name: 'Από' }).fill('Μενελάου 45');
        await list(page, 'from').first().click();
        await page.getByRole('combobox', { name: 'Προς' }).fill('Συγγρού-Φιξ');
        await list(page, 'to').first().click();
        const best = page.locator('.trip-card').first();
        await expect(best.locator('.trip-total [aria-hidden="true"]')).toHaveText(/^\d+–\d+'$/);
        await expect(best.locator('.trip-total')).toHaveAccessibleName(/^\d+ έως \d+ λεπτά$/);
        await expect(best).toContainText('Ο καλύτερος στις περισσότερες αναχωρήσεις');
        await expect(best.locator('.bus-plate').first()).toBeVisible();
        await expect(page.locator('#trip-result > :last-child'), 'nothing under the answer').toHaveClass(/trip-card/);
    });

    test('?timing: how long the buses took here, then the next half hour, worked out after the answer', async ({ page }) => {
        await pickBoth(page, '/trip?timing');
        const box = page.locator('#trip-timing');
        await expect(box).toContainText(/Buses ready in \d+ ms · This answer in \d+ ms/);
        await expect(box.getByRole('status')).toHaveText(/^The next half hour, a departure every 2'.*: \d+ ms, one clear way$/);
        expect(await axe(page), 'axe-core violations').toEqual([]);
    });

    test('?timing: a trip changed while its half hour is worked out gets its own answer and half hour', async ({ page }) => {
        await pickBoth(page, '/trip?timing');
        await page.getByRole('button', { name: 'Change' }).click();
        await to(page).fill('Άλσος');
        await list(page, 'to').first().click();
        await expect(page.locator('.trip-places')).toContainText('Άλσος');
        await expect(page.locator('.trip-card').first()).toBeVisible();
        await expect(page.locator('#trip-half')).toHaveText(/\d+ ms, (one clear way|a decision on the way|it depends|no way found)$/);
    });

    test.describe('with OASA\'s live times', () => {
        test.use({ scenario: 'trip-live' });

        // The minutes of the first bus at each stop of the way shown with one, in the order shown
        const firstBuses = page => page.locator('.trip-card').first().locator('li.trip-step').evaluateAll(steps => steps
            .map(step => step.querySelector('.trip-live .time-badge [aria-hidden="true"]')?.textContent)
            .filter(Boolean)
            .map(minutes => parseInt(minutes, 10)));
        // The page out of sight, or back, as when the phone locks or the app is switched
        const timeTravel = (page, hidden) => page.evaluate(hidden => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
            document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);

        test('the way shown has its buses\' minutes, the stops by when their bus comes, asked as the Trip page\'s, 10 stops at most', async ({ page }) => {
            const { asks } = await watchRequests(page);
            await pickBoth(page);
            const best = page.locator('.trip-card').first();
            await expect(best).toContainText('Any of these buses, whichever comes first:');
            await expect(best.locator('.trip-live .time-badge').first()).toBeVisible();
            await expect.poll(() => firstBuses(page)).not.toEqual([]);
            const minutes = await firstBuses(page);
            expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
            // One request a stop, the first saying it starts a search
            await page.waitForFunction(() => window.__pending === 0);
            const asked = await asks();
            expect(asked[0].for).toBe('plan-start');
            expect(asked.slice(1).map(a => a.for)).toEqual(asked.slice(1).map(() => 'plan'));
            expect(new Set(asked.map(a => a.code)).size).toBe(asked.length);
            expect(asked.length).toBe(10);
            await expect(page.locator('#trip-live-status')).toBeHidden();
            expect(await axe(page), 'axe-core violations').toEqual([]);
            const walk = await keyboardWalk(page);
            expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
        });

        test('asked again as their buses near, nothing while out of sight, paused after 10 minutes untouched until a tap', async ({ page }) => {
            const { asks, run } = await watchRequests(page);
            await pickBoth(page);
            await expect(page.locator('.trip-card').first().locator('.trip-live .time-badge').first()).toBeVisible();
            await expect.poll(async () => (await asks()).length).toBe(10);
            await page.waitForFunction(() => window.__pending === 0);
            // A bus due within 10 minutes: its stop again after 30 s; none later than that
            await run(35);
            const again = (await asks()).length;
            expect(again).toBeGreaterThan(10);
            expect(again).toBeLessThan(20);
            // Out of sight: nothing, however long; back: the stops due, at once.
            // (Minutes at a time from here: a second at a time is for counting requests)
            const skip = async seconds => {
                await page.clock.runFor(seconds * 1000);
                await page.waitForFunction(() => window.__pending === 0);
            };
            await timeTravel(page, true);
            await skip(150);
            expect((await asks()).length).toBe(again);
            await timeTravel(page, false);
            await expect.poll(async () => (await asks()).length).toBeGreaterThan(again);
            // Untouched for 10 minutes: paused, and said
            await skip(610);
            await expect(page.locator('#trip-live-status')).toContainText('Live times paused to save data.');
            const paused = (await asks()).length;
            await skip(150);
            expect((await asks()).length).toBe(paused);
            // The clock runs again, for axe-core's own timers
            await page.clock.resume();
            expect(await axe(page), 'axe-core violations').toEqual([]);
            await page.getByRole('button', { name: 'Tap to refresh' }).click();
            await expect(page.locator('#trip-live-status')).toBeHidden();
            await expect.poll(async () => (await asks()).length).toBeGreaterThan(paused);
        });

        test('in Greek too', async ({ page }) => {
            await page.goto('/el/trip');
            await page.getByRole('combobox', { name: 'Από' }).fill('Μενελάου 45');
            await list(page, 'from').first().click();
            await page.getByRole('combobox', { name: 'Προς' }).fill('Συγγρού-Φιξ');
            await list(page, 'to').first().click();
            await expect(page.locator('.trip-card').first().locator('.trip-live .time-badge').first()).toBeVisible();
        });

        test('a bus ride OASA has coming: its time without "~", its badges marked as OASA\'s', async ({ page }) => {
            await pickPark(page);
            const ride = page.locator('.trip-card').first().locator('li.trip-step', { has: page.locator('.trip-step-badges') });
            await expect(ride.locator('.trip-step-badges.trip-live .time-badge').first()).toBeVisible();
            await expect(ride.locator('.trip-step-when')).toHaveText(/^\d\d:\d\d$/);
        });

        test.describe('followed by My location (decision 45)', () => {
            test.use({ location: { at: MENELAOU_45 } });

            // From where the location is, Menelaou 45, to Syggrou-Fix, with
            // its stops asked and the clock stopped
            const hereToFix = async (page, run, asks) => {
                await page.goto('/trip');
                await expect(page.getByRole('button', { name: 'My location' })).toHaveAttribute('aria-pressed', 'true');
                await to(page).fill('Συγγρού-Φιξ');
                await list(page, 'to').first().click();
                await expect(page.locator('.trip-card').first().locator('.trip-live .time-badge').first()).toBeVisible();
                await expect.poll(async () => (await asks()).length).toBe(10);
                await run(1);
            };

            test('planned again 2 minutes on once 200 m away, the answer kept meanwhile, only stops new to its way asked at once', async ({ page }) => {
                const { asks, run } = await watchRequests(page);
                const plans = await watchPlans(page);
                await hereToFix(page, run, asks);
                expect((await plans()).map(({ lat, lng }) => ({ lat, lng }))).toEqual([MENELAOU_45]);
                // The answer is never taken away to be worked out again, nor
                // swapped for the one for leaving now while its half hour is
                await page.evaluate(() => new MutationObserver(() => {
                    window.__blank ||= Boolean(document.querySelector('#trip-result .trip-intro, #trip-checking'));
                }).observe(document.getElementById('trip-result'), { childList: true, subtree: true }));

                // 350 m on at once, as on a bus: not before 2 minutes. The
                // clock stops as it's planned again, so its stops are asked
                // while those it kept were asked a moment ago
                await moveTo(page, MENELAOU_85);
                await run(100);
                expect(await plans()).toHaveLength(1);
                for (let i = 0; i < 30 && (await plans()).length < 2; i++) await run(1);
                const [first, again] = await plans();
                expect({ lat: again.lat, lng: again.lng }).toEqual(MENELAOU_85);
                expect(again.at - first.at).toBeGreaterThanOrEqual(120_000);
                expect(again.at - first.at).toBeLessThan(122_000);
                await expect.poll(async () => (await asks()).some(a => a.for === 'plan-moved')).toBe(true);
                await page.waitForFunction(() => window.__pending === 0);
                await expect(page.locator('.trip-card').first().locator('.trip-live .time-badge').first()).toBeVisible();
                expect(await page.evaluate(() => window.__blank), 'the answer stays').toBe(false);

                // Asked at once: only the stops the first way didn't have, the
                // first saying it was planned again, and no new search
                const all = await asks();
                const before = new Set(all.filter(a => a.at < again.at).map(a => a.code));
                const after = all.filter(a => a.at >= again.at);
                expect(after.length).toBeGreaterThan(0);
                expect(after.filter(a => before.has(a.code)), 'stops kept, asked on their tiers').toEqual([]);
                expect(after.map(a => a.for)).toEqual(['plan-moved', ...after.slice(1).map(() => 'plan')]);
                // Kept: asked again on their tiers from here
                await run(35);
                expect((await asks()).slice(all.length).some(a => before.has(a.code))).toBe(true);
            });

            test('not planned again out of sight, but at once back in sight; while paused, planned again with nothing asked', async ({ page }) => {
                const { asks, run } = await watchRequests(page);
                const plans = await watchPlans(page);
                await hereToFix(page, run, asks);
                const skip = async seconds => {
                    await page.clock.runFor(seconds * 1000);
                    await page.waitForFunction(() => window.__pending === 0);
                };
                await timeTravel(page, true);
                await moveTo(page, MENELAOU_85);
                await skip(150);
                expect(await plans()).toHaveLength(1);
                await timeTravel(page, false);
                await expect.poll(async () => (await plans()).length).toBe(2);
                await expect(page.locator('.trip-card').first().locator('.trip-live .time-badge').first()).toBeVisible();

                // Untouched for 10 minutes: paused. Moving on plans it again,
                // which isn't a touch: the new way asks nothing, and says it's paused
                await skip(610);
                const status = page.locator('#trip-live-status');
                await expect(status).toContainText('Live times paused to save data.');
                const paused = (await asks()).length;
                await moveTo(page, MENELAOU_45);
                await skip(2);
                await expect.poll(async () => (await plans()).length).toBe(3);
                await expect(status).toContainText('Live times paused to save data.');
                await page.waitForFunction(() => window.__pending === 0);
                expect((await asks()).length).toBe(paused);
                await page.clock.resume();
                await page.getByRole('button', { name: 'Tap to refresh' }).click();
                await expect.poll(async () => (await asks()).length).toBeGreaterThan(paused);
            });
        });
    });

    test.describe('on a decision, with the quicker way\'s bus coming', () => {
        test.use({ scenario: 'trip-quicker' });

        // From Σταύρου 1 to Μενελάου 45 at noon (pickDecision)
        const offer = page => page.locator('#trip-quicker');

        test('offered under the directions; taken, in their place with the way back; kept, gone for the trip', async ({ page }) => {
            const { asks } = await watchRequests(page);
            await pickDecision(page);
            await expect(offer(page)).toContainText('A quicker way: about');
            await expect(offer(page)).toContainText('Get off the');
            await expect(offer(page).locator('.line-t6')).toBeVisible();
            await expect(offer(page).locator('.bus-plate').first()).toBeVisible();
            // The quicker way's stop first, the trip's first request
            await page.waitForFunction(() => window.__pending === 0);
            expect((await asks())[0]).toMatchObject({ code: '340016', for: 'plan-start' });
            expect(await axe(page), 'axe-core violations').toEqual([]);

            await page.getByRole('button', { name: 'Take the quicker way' }).click();
            const best = page.locator('.trip-card').first();
            await expect(best).toContainText('The quicker way');
            await expect(offer(page)).toHaveCount(0);
            await expect(best.locator('.trip-live .time-badge').first()).toBeVisible();
            expect(await axe(page), 'axe-core violations').toEqual([]);

            await page.getByRole('button', { name: 'Back to my route' }).click();
            await expect(offer(page)).toBeVisible();
            await expect(best).not.toContainText('The quicker way');
            await page.getByRole('button', { name: 'Keep my route' }).click();
            await expect(offer(page)).toHaveCount(0);
            // For the rest of the trip: its live times asked again, and still nothing offered
            const before = (await asks()).length;
            await page.clock.runFor(130_000);
            await expect.poll(async () => (await asks()).length).toBeGreaterThan(before);
            await page.waitForFunction(() => window.__pending === 0);
            await expect(offer(page)).toHaveCount(0);
        });

        test('from the keyboard alone: taking it and going back leave the keyboard on the choice', async ({ page }) => {
            await pickDecision(page);
            const take = page.getByRole('button', { name: 'Take the quicker way' });
            await take.focus();
            await page.keyboard.press('Enter');
            const back = page.getByRole('button', { name: 'Back to my route' });
            await expect(back).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(take).toBeFocused();
            const walk = await keyboardWalk(page);
            expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
        });

        test('in Greek too', async ({ page }) => {
            await pickDecision(page, '/el/trip', ['Από', 'Προς']);
            await expect(offer(page)).toContainText('Γρηγορότερος δρόμος: περίπου');
            await expect(offer(page)).toContainText('στη στάση');
            await page.getByRole('button', { name: 'Πάρε τον γρηγορότερο' }).click();
            await expect(page.locator('.trip-card').first()).toContainText('Ο γρηγορότερος δρόμος');
            await expect(page.getByRole('button', { name: 'Πίσω στη διαδρομή μου' })).toBeVisible();
        });
    });

    test.describe('with OASA down', () => {
        test.use({ scenario: 'oasa-down' });

        test('the timetable\'s times stay, and an error says the live times are unavailable', async ({ page }) => {
            await pickBoth(page);
            await expect(page.locator('#trip-live-status .notice-danger')).toContainText('Live bus times are unavailable right now.');
            await expect(page.locator('.trip-card').first().locator('.bus-plate').first()).toBeVisible();
            await expect(page.locator('#trip-result .time-badge')).toHaveCount(0);
            expect(await axe(page), 'axe-core violations').toEqual([]);
        });
    });

    test.describe('with the buses\' times not loading', () => {
        test.use({ allowErrors: [/status of 503/] });

        test('it says so, and plans by metro and tram', async ({ page }) => {
            await page.route('**/data/buses.json', route => route.fulfill({ status: 503, body: '' }));
            await pickBoth(page);
            await expect(page.locator('.trip-card').first()).toBeVisible();
            await expect(page.getByText('The bus times couldn\'t be loaded, so these ways are by metro and tram only.')).toBeVisible();
            await expect(page.locator('#trip-result .bus-plate')).toHaveCount(0);
        });
    });

    test.describe('the suburban railway (decision 41)', () => {
        // From Athens station, where the location is, to Megara, which only the
        // railway reaches. The address index of the tests has no such place, so
        // the place search's answer is the test's own
        test.use({ location: { at: { lat: 37.9930, lng: 23.7203 } } });
        const megara = { name: 'Μέγαρα', town: 'Μεγαρέων', type: 'place', placeKind: 'town', lineNames: [], n: null, lat: 37.9906, lng: 23.3609 };
        const toMegara = async (page, path, { here, there }) => {
            await page.route('**/api/places', route => route.fulfill({ json: { results: [megara], notInTown: null, noSuchTown: false } }));
            await page.goto(path);
            await page.getByRole('button', { name: here }).click();
            await page.getByRole('combobox', { name: there }).fill('Μέγαρα');
            await list(page, 'to').first().click();
        };

        // A way's train ride: the Subway page's card (decision 47)
        const trainCard = page => page.locator('.trip-card').first().locator('li.trip-leg', { has: page.locator('.line-pill.line-a4') });
        const trainBadge = page => trainCard(page).locator('.schedule-chips .time-badge [aria-hidden="true"]').first();

        test('a way by train: the Subway page\'s card, where its train goes, the ticket it needs, and nothing under it of where its times are from', async ({ page }) => {
            await toMegara(page, '/trip', { here: 'My location', there: 'To' });
            const best = page.locator('.trip-card').first();
            await expect(best.locator('.trip-total [aria-hidden="true"]')).toHaveText(/^\d+–\d+'$/);
            await expect(best.locator('.line-pill.line-a4').first()).toHaveText('A4');
            const card = trainCard(page);
            await expect(card.locator('.leg-boarding')).toHaveText('At Athens:');
            await expect(card.locator('h3.leg-title')).toHaveAccessibleName('A4 toward Kiato');
            // 12:35, from 12:00
            await expect(trainBadge(page)).toHaveText(/^3[45]'$/);
            await expect(card.locator('.train-diagram'), 'no train diagram').toHaveCount(0);
            await expect(card.locator('.trip-step-when'), 'nothing on its left').toHaveCount(0);
            await expect(card.locator('.leg-boarding a'), 'no station pages').toHaveCount(0);
            await expect(card).toContainText('Needs a Hellenic Train ticket, as OASA\'s ticket doesn\'t cover Megara.');
            await expect(card.locator('.leg-action')).toContainText('Exit at Megara');
            await expect(page.locator('#trip-result')).not.toContainText('railway.gov.gr');
            await expect(page.locator('#trip-result .notice-danger')).toHaveCount(0);
            await expect(page.locator('#trip-result > :last-child'), 'nothing under the answer').toHaveClass(/trip-card/);
            expect(await axe(page), 'axe-core violations').toEqual([]);
            const walk = await keyboardWalk(page);
            expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
        });

        test('hidden on the Subway page, it\'s left out here too, and not said to be missing', async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem('suburban-hidden', '1'));
            let asked = false;
            page.on('request', request => { asked ||= /\/data\/trains\.json|\/api\/trains/.test(request.url()); });
            await toMegara(page, '/trip', { here: 'My location', there: 'To' });
            await expect(page.locator('.trip-card').first()).toBeVisible();
            await expect(page.locator('#trip-result .line-a4')).toHaveCount(0);
            await expect(page.locator('#trip-result')).not.toContainText('left out');
            expect(asked).toBe(false);
        });

        test('in Greek too', async ({ page }) => {
            await toMegara(page, '/el/trip', { here: 'Η θέση μου', there: 'Προς' });
            const best = page.locator('.trip-card').first();
            await expect(best.locator('.line-pill.line-a4').first()).toHaveText('A4');
            await expect(best).toContainText('Μέγαρα');
            await expect(trainCard(page).locator('.leg-boarding')).toHaveText('Σε Αθήνα:');
            await expect(best).toContainText('δεν καλύπτει τον σταθμό Μέγαρα');
            await expect(page.locator('#trip-result')).not.toContainText('railway.gov.gr');
        });

        // How late the trains run (decision 42), as Wayhop's server answers it;
        // `answer.now` can change. Each request's time is kept
        const lateness = async (page, answer) => {
            const asked = [];
            await page.route('**/api/trains', route => {
                asked.push(Date.now());
                return route.fulfill({ json: answer.now });
            });
            return asked;
        };

        test.describe('from Megara, where the location is, to Syntagma', () => {
            // The A4 at 12:08 (train 1313), Athens at 12:51, the walk to Larissa Station and the M2 at 13:01
            test.use({ location: { at: MEGARA } });
            // The way shown's M2: its card (decision 46), and when its first train leaves,
            // past an hour by the clock
            const metroCard = page => page.locator('.trip-card').first().locator('li.trip-leg', { has: page.locator('.line-pill.line-m2') });
            const metroTime = async page => (await metroCard(page).locator('.schedule-chips .time-badge').first().textContent()).match(/\d\d:\d\d/)[0];
            const minutesOf = hhmm => hhmm.replace('~', '').split(':').reduce((h, m) => h * 60 + Number(m), 0);

            test('its metro ride is the Subway page\'s card: where to board, the line to its sign, the train, where to get off, its stations kept open; the legend under the way', async ({ page }) => {
                await lateness(page, { now: { at: '2026-10-21T09:00:00Z', trains: {} } });
                await hereToSyntagma(page);
                const card = metroCard(page);
                await expect(card).toBeVisible();
                await expect(card.locator('.leg-boarding')).toHaveText('At Larissa Station:');
                await expect(card.locator('h3.leg-title')).toHaveAccessibleName('M2 toward Elliniko');
                await expect(card.locator('.schedule-label')).toHaveText('At', { useInnerText: true });
                expect(await metroTime(page)).toBe('13:01');
                await expect(card.locator('.train-diagram')).toBeVisible();
                await expect(card.locator('.leg-action')).toContainText('Exit at Syntagma');
                await expect(card.locator('.trip-step-when'), 'nothing on its left').toHaveCount(0);
                await expect(page.getByRole('link', { name: 'Where to stand on the train' })).toHaveCount(0);
                // What the train shows, right under the way's card. Found by
                // where it is, so a redraw meanwhile (the trains' lateness
                // coming in) is waited out rather than read half-way
                await expect(page.locator('#trip-result > .trip-card + details.diagram-legend')).toHaveAttribute('open', '');
                // Its stations, opened, stay open when the page is drawn again a minute on
                const toggle = card.locator('.leg-stops-toggle');
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                await expect(card.locator('.leg-stations')).toBeVisible();
                await card.evaluate(el => { el.dataset.before = '1'; });
                await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement).blur());
                await page.clock.runFor(61_000);
                await expect(page.locator('li.trip-leg[data-before]'), 'drawn again').toHaveCount(0);
                await expect(metroCard(page).locator('.leg-stations')).toBeVisible();
                await page.clock.resume();
                expect(await axe(page), 'axe-core violations').toEqual([]);
                const walk = await keyboardWalk(page);
                expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
                // In Greek, with the Subway page's words
                await page.goto('/el/trip');
                await page.getByRole('button', { name: 'Η θέση μου' }).click();
                await page.getByRole('combobox', { name: 'Προς' }).fill('Σύνταγμα');
                await list(page, 'to').first().click();
                await expect(metroCard(page).locator('.leg-boarding')).toHaveText('Σε Σταθμός Λαρίσσης:');
                await expect(metroCard(page).locator('.leg-stops-toggle')).toContainText(/^\d+ σταθμοί/);
            });

            test('how late its train runs: its badge when it actually leaves, the M2 after it later, asked again on the tiers while in sight', async ({ page }) => {
                const answer = { now: { at: '2026-10-21T09:00:00Z', trains: {} } };
                const asked = await lateness(page, answer);
                await hereToSyntagma(page);
                const best = page.locator('.trip-card').first();
                await expect(trainCard(page)).toBeVisible();
                await expect.poll(() => asked.length).toBe(1);
                // 12:08, from 12:00
                await expect(trainBadge(page)).toHaveText(/^[78]'$/);
                const onTime = minutesOf(await metroTime(page));

                // 8 minutes late, as measured: its badge 8 minutes later, and the
                // M2 at 13:01 missed; asked again after 32 seconds, as the train
                // leaves in under 10 minutes
                answer.now = { at: '2026-10-21T09:01:00Z', trains: { 1313: { late: 480, exact: true } } };
                await page.clock.runFor(31_000);
                expect(asked.length).toBe(1);
                await page.clock.runFor(3_000);
                await expect(trainBadge(page)).toHaveText(/^1[56]'$/);
                expect(asked.length).toBe(2);
                await expect(best, 'no line saying how late').not.toContainText('Running about');
                await expect(trainCard(page), 'nor its timetable time').not.toContainText('12:08');
                expect(minutesOf(await metroTime(page))).toBeGreaterThan(onTime);
                await expect(page.locator('#trip-live-status')).toBeHidden();
                // Out of sight: not asked, however long
                await page.evaluate(() => {
                    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                    document.dispatchEvent(new Event('visibilitychange'));
                });
                await page.clock.runFor(300_000);
                expect(asked.length).toBe(2);
                await page.clock.resume();
                expect(await axe(page), 'axe-core violations').toEqual([]);
                const walk = await keyboardWalk(page);
                expect(walk.problems, `keyboard walk: ${walk.stops.join(' → ')}`).toEqual([]);
            });
        });

        test('with no lateness to be had, an error above the answer says so; the times the timetable\'s', async ({ page }) => {
            await lateness(page, { now: { unavailable: true } });
            await toMegara(page, '/trip', { here: 'My location', there: 'To' });
            await expect(page.locator('#trip-live-status .notice-danger')).toContainText('How late the suburban trains run is unavailable right now, so their times are the timetable\'s.');
            await expect(page.locator('.trip-card').first()).not.toContainText('late');
        });

        test('in Greek, its badge as late as its train runs, at least', async ({ page }) => {
            await lateness(page, { now: { at: '2026-10-21T09:00:00Z', trains: { 1314: { late: 240, exact: false } } } });
            await toMegara(page, '/el/trip', { here: 'Η θέση μου', there: 'Προς' });
            // 12:35 and at least 4 minutes late, from 12:00
            await expect(trainBadge(page)).toHaveText(/^3[89]'$/);
            await expect(page.locator('.trip-card').first()).not.toContainText('Καθυστερεί');
        });
    });

    test.describe('with the suburban railway\'s times not loading', () => {
        test.use({ allowErrors: [/status of 404/] });

        test('it\'s left out, and an error above the answer says so', async ({ page }) => {
            await page.route('**/data/trains.json', route => route.fulfill({ status: 404, body: '' }));
            await pickBoth(page);
            await expect(page.locator('.trip-card').first()).toBeVisible();
            // Right under where it's from and to, above the ways
            await expect(page.locator('#trip-result > .trip-places + .notice-danger')).toContainText('The suburban railway is left out: its times for today couldn\'t be loaded.');
            // Its own space under it, as the cards have
            const gap = await page.locator('#trip-result .notice-danger').evaluate(box => box.nextElementSibling.getBoundingClientRect().top - box.getBoundingClientRect().bottom);
            expect(gap).toBeGreaterThanOrEqual(12);
            await expect(page.locator('#trip-result .bus-plate').first()).toBeVisible();
        });
    });

    test.describe('with search down', () => {
        test.use({ allowErrors: [/status of 503/] });

        test('it\'s said, and the page goes on', async ({ page }) => {
            await page.route('**/api/places', route => route.fulfill({ status: 503, json: { error: 'Address search is unavailable' } }));
            await page.goto('/trip');
            await from(page).fill('Μενελάου 45');
            await expect(page.locator('#trip-from-status')).toContainText('isn\'t available');
            await expect(page.locator('.trip-intro')).toBeVisible();
        });
    });

    test('in Greek, with the credit to OpenStreetMap', async ({ page }) => {
        await page.goto('/el/trip');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Σχεδιασμός διαδρομής');
        await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
    });
});

async function pickBothFrom(page) {
    await list(page, 'from').first().click();
    await to(page).fill('Συγγρού-Φιξ');
    await list(page, 'to').first().click();
}
