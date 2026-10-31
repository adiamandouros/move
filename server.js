import 'dotenv/config';
import { loadConfig } from './server/config.js';
import { startScheduler } from './server/scheduler.js';
import { createApp } from './server/app.js';
import { createProcessGuard } from './server/processes.js';

// The settings come from .env (and the environment), read once here
const config = loadConfig();
for (const problem of config.problems) console.warn(`[config] ${problem.title}: ${problem.text}. ${problem.hint}`);

// Stops this app's copies left over from before a restart (server/processes.js)
const processGuard = createProcessGuard();
const app = createApp({ config, processGuard });

app.listen(config.port, () => {
    console.log(`Wayhop running at http://localhost:${config.port}`);
    for (const r of config.relays) console.log(`[oasa] Fallback ${r.name}: ${new URL(r.url).host}`);
    startScheduler({ refreshPlaces: app.locals.places.refreshIfDue });
    processGuard.start();
});
