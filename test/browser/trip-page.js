// The Trip page's fields, for the specs that plan a trip on it (trip.spec.js,
// offline.spec.js, text-size.spec.js). The addresses are test/fixtures/places.js.

export const from = page => page.getByRole('combobox', { name: 'From' });
export const to = page => page.getByRole('combobox', { name: 'To' });
export const list = (page, name) => page.locator(`#trip-${name}-list [role="option"]`);

// From an address in Kallithea to Syggrou-Fix, on `url`
export async function pickBoth(page, url = '/trip') {
    await page.goto(url);
    await from(page).fill('Μενελάου 45');
    await list(page, 'from').first().click();
    await to(page).fill('Συγγρού-Φιξ');
    await list(page, 'to').first().click();
}

// From Μενελάου 45 to the park, Άλσος: at noon the way shown in full walks
// to Pl. Dabaki for the 040, a bus ride of its own (not any of several)
export async function pickPark(page) {
    await page.goto('/trip');
    await from(page).fill('Μενελάου 45');
    await list(page, 'from').first().click();
    await to(page).fill('Άλσος');
    await list(page, 'to').first().click();
}

// From Σταύρου 1 to Μενελάου 45, on `url`, with its fields' names: at noon
// the directions stay on the T6 for a bus; with the trip-quicker scenario
// the quicker way gets off sooner, at Agia Foteini, for one there, the only
// stop with buses coming (decision 36)
export async function pickDecision(page, url = '/trip', [fromName, toName] = ['From', 'To']) {
    await page.goto(url);
    await page.getByRole('combobox', { name: fromName }).fill('Σταύρου 1');
    await list(page, 'from').first().click();
    await page.getByRole('combobox', { name: toName }).fill('Μενελάου 45');
    await list(page, 'to').first().click();
}

// Σταύρου 1 (test/fixtures/places.js), as test.use({ location: { at: STAVROU_1 } }),
// for a rider followed from there by "My location" on the decision's T6 (T14)
export const STAVROU_1 = { lat: 37.9535, lng: 23.7255 };

// Menelaou 45 and 85, 350 m apart on the same street (test/fixtures/places.js),
// for a rider followed by "My location" (decision 45)
export const MENELAOU_45 = { lat: 37.955, lng: 23.707 };
export const MENELAOU_85 = { lat: 37.955, lng: 23.711 };

// Where the Trip page's searches plan from, each new place once, with the
// page's (fake) time it was first asked: [{ lat, lng, at }]
export async function watchPlans(page) {
    await page.addInitScript(() => {
        window.__plans = [];
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (data, ...rest) {
            const last = window.__plans.at(-1);
            if (data?.from && (data.from.lat !== last?.lat || data.from.lng !== last?.lng)) {
                window.__plans.push({ lat: data.from.lat, lng: data.from.lng, at: Date.now() });
            }
            return post.call(this, data, ...rest);
        };
    });
    return () => page.evaluate(() => window.__plans);
}

// The rider somewhere else, and the phone saying so at once
export const moveTo = (page, at) => page.evaluate(at => {
    window.__setLocation({ at });
    window.__sendPosition();
}, at);

// The way the Trip page shows in full, as the worker last timed it (the
// `live` answers main.js gets): its rides, each with where its stops are
// (`along`, [lat, lng] each), for a spec that moves the rider along it
// (decision 50). Returns a function that gives the latest, or null
export async function watchLive(page) {
    await page.addInitScript(() => {
        window.__live = null;
        const listen = Worker.prototype.addEventListener;
        Worker.prototype.addEventListener = function (type, fn, ...rest) {
            const heard = type !== 'message' ? fn : event => {
                if (event.data?.live?.way) window.__live = event.data.live.way.option;
                return fn.call(this, event);
            };
            return listen.call(this, type, heard, ...rest);
        };
    });
    return () => page.evaluate(() => window.__live);
}

// The park, Άλσος (test/fixtures/places.js): from Menelaou 45 at noon, the
// walk to Pl. Dabaki, the 040, the walk to the park (pickPark)
export const PARK = { lat: 37.9545, lng: 23.7305 };

// Megara's station, as test.use({ location: { at: MEGARA } }), and from
// there by "My location" to Syntagma: the A4 at 12:08 (train 1313), Athens
// at 12:51, the walk to Larissa Station and the M2 at 13:01
export const MEGARA = { lat: 37.99095, lng: 23.36107 };
export async function hereToSyntagma(page) {
    await page.goto('/trip');
    await page.getByRole('button', { name: 'My location' }).click();
    await to(page).fill('Syntagma');
    await list(page, 'to').first().click();
}
