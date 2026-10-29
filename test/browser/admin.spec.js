// The admin pages (server/admin/): the diagnostics page, its checks as the
// server would send them (server/diagnostics.js), not run for real here
import { ADMIN_TEST_PASSWORD } from '../support/test-site.js';
import { axe, expect, keyboardWalk, onlyOn, test } from './fixtures.js';

test.use({ scenario: 'admin' });
test.beforeEach(onlyOn('phone', 'desktop'));

const STOPPED = {
    summary: { status: 'warn', text: 'Something needs a look.' },
    report: 'Wayhop diagnostics',
    checks: [
        { group: 'Data', title: 'Last data build', status: 'ok', detail: '2026-10-20 08:46 UTC (1 h ago)' },
        {
            group: 'Data', title: 'Bus network from OASA', status: 'warn',
            detail: 'The fetch at 2026-10-20 08:20 UTC stopped after 26 min, with 812 of 1203 routes\' stops: route 3923: HTTP 502 (4 tries).',
            hint: 'Restart the app to try again now, or wait for the 04:30 build.',
            progress: { done: 812, total: 1203, label: 'Routes\' stops fetched' },
        },
    ],
};

test('diagnostics: a bus network fetch that stopped shows how far it got, as a bar', async ({ page }) => {
    await page.route('**/admin/api/diagnostics', route => route.fulfill({ json: STOPPED }));
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.goto('/admin/diagnostics');

    const bar = page.getByRole('progressbar', { name: 'Routes\' stops fetched' });
    await expect(bar).toHaveAttribute('value', '812');
    await expect(bar).toHaveAttribute('max', '1203');
    await expect(page.locator('.diag-progress')).toContainText('812 / 1203');
    // Only the check that has a progress gets a bar
    await expect(page.getByRole('progressbar')).toHaveCount(1);
    expect(await axe(page)).toEqual([]);
});

test('the use of OASA: today\'s row, the lines\' predictions and the pages opened, from what the app counted; its tables scroll and take the keyboard', async ({ page }, testInfo) => {
    // Someone looks at a stop: an answer the app counts
    await page.request.get('/api/arrivals?stops=10157');
    // and opens a Greek page
    await page.goto('/el/info');
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.goto('/admin/diagnostics');
    await page.getByRole('link', { name: 'Use of OASA' }).click();
    await expect(page).toHaveURL(/\/admin\/usage$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use of OASA');

    const asked = page.getByRole('region', { name: 'What Wayhop asked for' });
    const today = asked.getByRole('row').nth(1);
    await expect(today.getByRole('rowheader')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    // Different stops: one
    await expect(today.getByRole('cell').nth(7)).toHaveText('1');
    await expect(page.getByRole('region', { name: 'How OASA answered, per route' })).toBeVisible();
    // The stop's lines, and the most minutes ahead their buses were predicted
    const horizon = page.getByRole('region', { name: 'How far ahead OASA predicts, per line' });
    await expect(horizon.getByRole('rowheader').first()).toBeVisible();
    await expect(horizon.getByRole('row').nth(1).getByRole('cell').first()).toHaveText(/^\d+$/);
    // Today's pages, at least that one in Greek (other tests open pages too)
    const opened = page.getByRole('region', { name: 'Pages opened, by browser language' }).getByRole('row').nth(1);
    await expect(opened.getByRole('cell').nth(2)).toHaveText(/^[1-9]\d*$/);
    expect(await axe(page)).toEqual([]);
    if (testInfo.project.name !== 'iphone') {
        const walk = await keyboardWalk(page);
        expect(walk.problems, walk.stops.join(' → ')).toEqual([]);
        expect(walk.stops.join(' → ')).toMatch(/div "What Wayhop asked of OASA.*→ div "How each route to OASA.*→ div "How far ahead OASA predicts.*→ div "Pages opened per day/);
    }
});

test('the station editor is accessible too', async ({ page }) => {
    await page.goto('/admin/login');
    expect(await axe(page)).toEqual([]);
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/admin\/stations$/);
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    // Export: the two files the editor edits, each ready to commit
    await page.getByText('Export', { exact: true }).click();
    await expect(page.getByRole('link', { name: 'positions.json' })).toHaveAttribute('href', '/admin/api/export/positions.json');
    await expect(page.getByRole('link', { name: 'street.json' })).toHaveAttribute('href', '/admin/api/export/street.json');
    expect(await axe(page)).toEqual([]);
});

test('the station editor records how each exit is reached: escalators up and stairs', async ({ page }) => {
    const saved = [];
    await page.route('**/admin/api/positions/**', route => {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { entry: route.request().postDataJSON().entry, edited: true } });
    });
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    // The first station is open; its back car is by an escalator, its front by stairs
    const escalators = page.getByRole('group', { name: 'Escalators up' });
    const stairs = page.getByRole('group', { name: 'Stairs' });
    await escalators.getByRole('button').first().click();
    await stairs.getByRole('button').last().click();
    await expect(escalators.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].entry).toMatchObject({ escalators: ['back'], stairs: ['front'] });
    expect(await axe(page)).toEqual([]);
});

test('the station editor records whether a platform is step-free, and "not known yet" saves nothing', async ({ page }) => {
    const saved = await fakeSaves(page);
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    const field = page.getByLabel('Step-free from the street (this platform)');
    // (synced once the form says it's an edit again)
    const synced = page.locator('#entry-state[data-state="edited"]');
    await field.selectOption('ramp');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(1);
    await expect(synced).toBeVisible();
    expect(saved[0].entry.stepFree).toBe('ramp');

    await field.selectOption('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(2);
    await expect(synced).toBeVisible();
    expect(saved[1].entry).not.toHaveProperty('stepFree');
});

// Saves and reverts answered as the server would, without writing its
// files: each is recorded, { kind: 'positions' or 'street', ref, entry }
// (null: reverted), and the station data the editor fetches after it has
// the edits. While `online()` is false, they fail as with no connection.
async function fakeSaves(page, online = () => true) {
    const saved = [];
    const edits = new Map();
    const answer = route => {
        if (!online()) return route.abort('internetdisconnected');
        const request = route.request();
        // /admin/api/<kind>/<ref…>
        const [kind, ...ref] = new URL(request.url()).pathname.split('/').slice(3).map(decodeURIComponent);
        const entry = request.method() === 'PUT' ? request.postDataJSON().entry : null;
        saved.push({ kind, ref, entry });
        if (entry) edits.set(JSON.stringify([kind, ...ref]), entry);
        else edits.delete(JSON.stringify([kind, ...ref]));
        return route.fulfill({ json: { entry, edited: Boolean(entry) } });
    };
    await page.route('**/admin/api/positions/**', answer);
    await page.route('**/admin/api/street/**', answer);
    await page.route('**/admin/api/state', async route => {
        let state;
        // (a test that has seen what it waited for may end during the fetch)
        try { state = await (await route.fetch()).json(); } catch { return; }
        for (const [key, entry] of edits) {
            const [kind, line, dir, station] = JSON.parse(key);
            if (kind === 'street') state.street.overlay[line] = entry;
            else ((state.overlay[line] ??= {})[dir] ??= {})[station] = entry;
        }
        return route.fulfill({ json: state });
    });
    return saved;
}

// What the station list marks missing for the open station
const marks = async page => {
    const text = await page.getByLabel('Station', { exact: true }).locator('option:checked').textContent();
    return text.includes('⚠') ? text.split('⚠ ')[1].split(', ') : [];
};

// Logged in, on the first station (M1 → Kifisia: Piraeus), with STASY's
// lift page read once, so its lift names come with the station data
async function openEditor(page) {
    await page.request.get('/api/lifts');
    await page.goto('/admin/login');
    await page.getByLabel('Password').fill(ADMIN_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByLabel('Station', { exact: true })).toBeVisible();
}

test.describe('saved underground', () => {
    // The saves the test makes fail, as with no connection; the phone is at
    // one of Piraeus's exits
    test.use({ allowErrors: [/ERR_INTERNET_DISCONNECTED/], location: { at: { lat: 37.9483, lng: 23.6431 } } });

    test('the station editor records each elevator by STASY\'s name and where it is, saved offline and sent once back', async ({ page }) => {
        let online = false;
        const saved = await fakeSaves(page, () => online);
        await openEditor(page);
        // Whether Piraeus has elevators isn't known yet
        expect(await marks(page)).toContain('elevators');
        await expect(page.getByText('Missing: elevators.')).toBeVisible();

        await page.getByRole('radio', { name: 'Elevators', exact: true }).check();
        const first = page.getByRole('group', { name: 'Elevator 1' });
        const name = first.getByLabel('Name', { exact: true });
        await name.fill('Προς Χ');
        await expect(first.getByText('Not one of STASY\'s names for this station.')).toBeVisible();
        // STASY's names for the station's lifts are offered
        await expect(page.locator('#stasy-lifts option')).toHaveText(['Προς Α', 'Προς Β']);
        await name.fill('Προς Α');
        await expect(first.getByText('Not one of STASY\'s names for this station.')).toBeHidden();
        await first.getByLabel('Where').selectOption('front');

        // A second, removed again: the keyboard goes on from the button that adds one
        await page.getByRole('button', { name: 'Add elevator' }).click();
        await expect(page.getByRole('group', { name: 'Elevator 2' }).getByLabel('Name', { exact: true })).toBeFocused();
        await page.getByRole('button', { name: 'Remove elevator 2' }).click();
        await expect(page.getByRole('group', { name: 'Elevator 2' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Add elevator' })).toBeFocused();

        // Underground: kept on the phone
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('status').filter({ hasText: '1 edit waiting to sync' })).toContainText('Offline.');
        await expect(page.getByText('Missing: elevators.')).toBeHidden();
        expect(await axe(page)).toEqual([]);

        online = true;
        await page.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.locator('#entry-state')).toHaveAttribute('data-state', 'edited');
        expect(saved.map(s => s.entry.elevators)).toEqual([[{ at: 'front', name: 'Προς Α' }]]);
        expect(await marks(page)).not.toContain('elevators');
    });

    test('a station\'s exit on the street, placed with "Here", saved offline with an edit of the platform, both sent once back', async ({ page }) => {
        let online = false;
        const saved = await fakeSaves(page, () => online);
        await openEditor(page);
        await expect(page.locator('#street-missing')).toHaveText(/^Missing: street exits/);

        await page.getByRole('button', { name: 'Add exit' }).click();
        const exit = page.getByRole('group', { name: 'Exit 1' });
        const name = exit.getByLabel('Name, as signed');
        await expect(name).toBeFocused();
        await name.fill('Ακτή Καλλιμασιώτη');
        await exit.getByRole('button', { name: 'Here: where I am now' }).click();
        await expect(exit.getByLabel('Where it is (latitude, longitude)')).toHaveValue('37.94830, 23.64310');
        // Said as it is: yellow is for warnings only
        await expect(exit.getByText(/^±20 m · \d+ m from the station$/)).not.toHaveClass(/list-hint-warn/);
        await exit.getByRole('checkbox', { name: 'Stairs' }).check();
        await exit.getByRole('checkbox', { name: 'Escalator up' }).check();
        expect(await axe(page)).toEqual([]);
        // and the platform's note: two edits in one Save
        await page.getByLabel('Note').fill('Two exits');

        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('status').filter({ hasText: '2 edits waiting to sync' })).toContainText('Offline.');
        online = true;
        await page.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.locator('#street-state')).toHaveAttribute('data-state', 'edited');
        await expect(page.locator('#entry-state')).toHaveAttribute('data-state', 'edited');
        expect(saved.find(s => s.kind === 'street')).toEqual({
            kind: 'street', ref: ['piraeus'],
            entry: { exits: [{ name: { el: 'Ακτή Καλλιμασιώτη', en: '' }, coords: [37.9483, 23.6431], way: ['stairs', 'escalator-up'] }], lifts: [] },
        });
        expect(saved.find(s => s.kind === 'positions').entry.note).toBe('Two exits');
        expect(await marks(page)).not.toContain('street exits');
    });

    test('a sync in the background leaves what\'s being typed alone', async ({ page }) => {
        let online = false;
        await fakeSaves(page, () => online);
        await openEditor(page);
        await page.getByLabel('Note').fill('Saved');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('status').filter({ hasText: '1 edit waiting to sync' })).toBeVisible();
        // Typing the next thing when the connection comes back
        await page.getByRole('button', { name: 'Add exit' }).click();
        await page.getByLabel('Name, as signed').fill('Ακτή');
        online = true;
        await page.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.locator('#entry-state')).toHaveAttribute('data-state', 'edited');
        await expect(page.getByLabel('Name, as signed')).toHaveValue('Ακτή');
    });
});

test('the station editor: an elevator needs to say where it is; "no elevator", or a platform reached by a ramp, isn\'t marked missing', async ({ page }) => {
    const saved = await fakeSaves(page);
    await openEditor(page);

    // An elevator not yet placed stops the save, with the browser saying why
    await page.getByRole('radio', { name: 'Elevators', exact: true }).check();
    const where = page.getByRole('group', { name: 'Elevator 1' }).getByLabel('Where');
    // Its warnings can be read in light too (the tests' phone asks for dark)
    await page.getByRole('group', { name: 'Elevator 1' }).getByLabel('Name', { exact: true }).fill('Προς Χ');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
    await expect(page.getByText('Missing: elevators.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Save' }).click();
    expect(await where.evaluate(select => select.validity.valueMissing)).toBe(true);

    // Left half filled, it doesn't count once there's no elevator
    await page.getByRole('radio', { name: 'No elevator' }).check();
    await expect(page.getByRole('group', { name: 'Elevator 1' })).toBeHidden();
    // (saved once the form says it's an edit, and the editor's data has it)
    const synced = page.locator('#entry-state[data-state="edited"]');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(synced).toBeVisible();
    expect(saved.map(s => s.entry.elevators)).toEqual(['none']);
    expect(await marks(page)).not.toContain('elevators');

    // Not known, but reached by a ramp: a surface station's needs no elevator
    await page.getByRole('radio', { name: 'Not known yet' }).check();
    await page.getByLabel('Step-free from the street (this platform)').selectOption('ramp');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved.length).toBe(2);
    await expect(synced).toBeVisible();
    expect(saved[1].entry).not.toHaveProperty('elevators');
    expect(await marks(page)).not.toContain('elevators');
});

test('the station editor: a place that can\'t be read stops the save, one far off is questioned, and the station goes back to the committed data', async ({ page }) => {
    const saved = await fakeSaves(page);
    await openEditor(page);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Nothing has changed.')).toBeVisible();

    await page.getByRole('button', { name: 'Add street elevator' }).click();
    const lift = page.getByRole('group', { name: 'Street elevator 1' });
    await lift.getByLabel('Name', { exact: true }).fill('Προς Α');
    const where = lift.getByLabel('Where it is (latitude, longitude)');
    await where.fill('37.948');
    await expect(lift.getByText('Write it as latitude, longitude, like 37.97552, 23.73481.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    expect(await where.evaluate(input => input.validity.customError)).toBe(true);

    // The phone is at Syntagma, not Piraeus
    await lift.getByRole('button', { name: 'Here: where I am now' }).click();
    await expect(lift.getByText(/^±20 m · \d+ m from the station: is that right\?$/)).toHaveClass(/list-hint-warn/);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#street-state')).toHaveAttribute('data-state', 'edited');
    expect(saved).toEqual([{ kind: 'street', ref: ['piraeus'], entry: { exits: [], lifts: [{ name: 'Προς Α', coords: [37.9755, 23.7348] }] } }]);

    await page.getByRole('button', { name: 'Revert station' }).click();
    await expect(page.locator('#street-state')).toHaveAttribute('data-state', 'committed');
    expect(saved[1]).toEqual({ kind: 'street', ref: ['piraeus'], entry: null });
    await expect(page.getByRole('group', { name: 'Street elevator 1' })).toHaveCount(0);
});
