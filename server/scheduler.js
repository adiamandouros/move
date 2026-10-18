import cron from 'node-cron';
import { runBuildInChild } from './data/index.js';

// Each build runs in its own process (see runBuildInChild), which logs its
// own progress and failures
const build = () => runBuildInChild();

export function startScheduler() {
    // Run immediately on startup (non-blocking), so a restart catches up on anything missed
    build();

    // Daily check: one portal request per dataset; files are only downloaded when they changed
    cron.schedule('30 4 * * *', build, { timezone: 'Europe/Athens' });

    console.log('[scheduler] Started (daily data check 04:30 Athens time).');
}
