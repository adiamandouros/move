// What the bus page asks of /api/arrivals, for the bus page's specs
// (buses.spec.js, bus-search.spec.js)

// Every /api/arrivals request, stamped with the page's (fake) time when it was
// sent; recorded in the page, so nothing in flight is missed
export async function watchRequests(page) {
    await page.addInitScript(() => {
        window.__asks = [];
        window.__pending = 0;
        // When the page's once-a-second check started (main.js, TICK_MS)
        const every = window.setInterval;
        window.setInterval = (fn, ms, ...rest) => {
            if (ms === 1000) window.__tickFrom ??= Date.now();
            return every(fn, ms, ...rest);
        };
        const real = window.fetch;
        window.fetch = (url, ...rest) => {
            const match = String(url).match(/\/api\/arrivals\?stops=([\d,]+)/);
            if (!match) return real(url, ...rest);
            for (const code of match[1].split(',')) window.__asks.push({ code, at: Date.now() });
            window.__pending++;
            return real(url, ...rest).finally(() => window.__pending--);
        };
    });
    // Stops the clock, then moves it on a second at a time, letting each
    // second's requests finish, so time passes only as the test says. The
    // page's checks then come halfway through each second, so a request
    // made on one falls in the same second every run.
    let paused = false;
    const run = async seconds => {
        if (!paused) {
            await page.clock.pauseAt(await page.evaluate(() => {
                const soon = Date.now() + 1000;
                const from = window.__tickFrom;
                return from === undefined ? soon : soon + ((from - soon + 500) % 1000 + 1000) % 1000;
            }));
            paused = true;
        }
        for (let i = 0; i < seconds; i++) {
            await page.clock.runFor(1000);
            await page.waitForFunction(() => window.__pending === 0);
        }
    };
    const asks = () => page.evaluate(() => window.__asks);
    return { asks, run };
}

export const onScreen = page => page.locator('.stop-item').evaluateAll(items => items
    .filter(e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })
    .map(e => e.dataset.stop));
