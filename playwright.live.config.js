import { defineConfig, devices } from '@playwright/test';

// npm run test:live: a few checks against the live site, with its real data
// and real bus times (test/live/). Run nightly (.github/workflows/nightly.yml);
// gentle on OASA: one phone, one test at a time, the bus page opened once.
// LIVE_URL points it elsewhere.
export default defineConfig({
    testDir: 'test/live',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    workers: 1,
    // The network can hiccup; a real outage fails twice
    retries: 1,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]] : [['list']],
    outputDir: 'test-results-live',
    use: {
        baseURL: process.env.LIVE_URL || 'https://wayhop.gr',
        locale: 'en-GB',
        timezoneId: 'Europe/Athens',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        serviceWorkers: 'block',
    },
    projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
});
