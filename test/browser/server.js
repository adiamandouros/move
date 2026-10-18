// The site as the browser tests see it (test/support/test-site.js), with
// each scenario a copy of it that a "scenario" cookie picks. Playwright
// starts it (playwright.config.js); to look around by hand:
// node test/browser/server.js, then localhost:3457 (BROWSER_TEST_PORT
// changes the port).
import express from 'express';
import { scenarios } from '../support/test-site.js';

const PORT = Number(process.env.BROWSER_TEST_PORT) || 3457;
const SCENARIOS = scenarios();

const app = express();
app.use((req, res, next) => {
    const scenario = req.headers.cookie?.match(/(?:^|;\s*)scenario=([\w-]+)/)?.[1] ?? 'normal';
    (SCENARIOS[scenario] ?? SCENARIOS.normal)(req, res, next);
});
app.listen(PORT, () => console.log(`Wayhop (browser tests) at http://localhost:${PORT}`));
