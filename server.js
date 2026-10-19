import 'dotenv/config';
import { loadConfig } from './server/config.js';
import { startScheduler } from './server/scheduler.js';
import { createApp } from './server/app.js';

// The settings come from .env (and the environment), read once here
const config = loadConfig();
for (const problem of config.problems) console.warn(`[config] ${problem.title}: ${problem.text}. ${problem.hint}`);

const app = createApp({ config });

app.listen(config.port, () => {
    console.log(`Wayhop running at http://localhost:${config.port}`);
    for (const r of config.relays) console.log(`[oasa] Fallback ${r.name}: ${new URL(r.url).host}`);
    startScheduler();
});
