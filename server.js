import 'dotenv/config';
import { startScheduler } from './server/scheduler.js';
import { createApp } from './server/app.js';
import { relaysFromEnv } from './server/oasa/client.js';
import { adsenseProblems } from './server/ads.js';

const PORT = process.env.PORT || 3000;
for (const problem of adsenseProblems()) console.warn(`[ads] ${problem} — ads are off until it's fixed`);

const relays = relaysFromEnv(process.env);
const app = createApp({ relays });

app.listen(PORT, () => {
    console.log(`Wayhop running at http://localhost:${PORT}`);
    for (const r of relays) console.log(`[oasa] Fallback ${r.name}: ${new URL(r.url).host}`);
    startScheduler();
});
