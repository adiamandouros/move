import cron from 'node-cron';
import { buildSchedule, isScheduleStale } from './schedule-builder.js';

async function checkAndBuild() {
    try {
        if (await isScheduleStale()) {
            console.log('[scheduler] Schedule is stale or missing — rebuilding…');
            await buildSchedule();
        } else {
            console.log('[scheduler] Schedule is current, no rebuild needed.');
        }
    } catch (err) {
        console.error('[scheduler] Build failed:', err.message);
    }
}

export function startScheduler() {
    // Run immediately on startup (non-blocking)
    checkAndBuild();

    // Re-check every Monday at 03:00 AM
    cron.schedule('0 3 * * 1', () => {
        console.log('[scheduler] Weekly GTFS check triggered.');
        checkAndBuild();
    });

    console.log('[scheduler] Started (weekly check Mon 03:00).');
}
