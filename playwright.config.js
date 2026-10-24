import { defineConfig, devices } from '@playwright/test';

// npm run test:browser: the site in real browsers (test/browser/README.md).
// It starts its own server with test data and a fake OASA, so nothing here
// reaches the network. Location and the clock are faked per test (fixtures.js).
const PORT = Number(process.env.BROWSER_TEST_PORT) || 3457;

export default defineConfig({
    testDir: 'test/browser',
    // A whole run should stay well under two minutes; slow tests say so with test.slow()
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    // On GitHub a failed test runs once more, for its trace; one that passes
    // only the second time still fails the run (flaky tests get fixed, not
    // retried away)
    retries: process.env.CI ? 1 : 0,
    failOnFlakyTests: Boolean(process.env.CI),
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        locale: 'en-GB',
        // The phone asks for dark unless a test says otherwise (theme.spec.js)
        colorScheme: 'dark',
        timezoneId: 'Europe/Athens',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // The offline cache has its own tests (offline.spec.js); elsewhere it
        // would only make pages come from the cache at random
        serviceWorkers: 'block',
    },
    projects: [
        { name: 'phone', use: { ...devices['Pixel 7'] } },
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
        // Safari's engine, as on an iPhone; needs WebKit's system libraries (README)
        { name: 'iphone', use: { ...devices['iPhone 15'] } },
    ],
    webServer: {
        command: 'node test/browser/server.js',
        url: `http://localhost:${PORT}/`,
        env: { BROWSER_TEST_PORT: String(PORT) },
        reuseExistingServer: !process.env.CI,
    },
});
