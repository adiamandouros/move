// The scheduled health check (.github/workflows/health.yml): asks the live
// site what a visitor would, then reads its health page (server/health.js).
// A problem is checked again RECHECK_MS later before it counts, so a blip
// doesn't raise an alarm. Prints a report (Markdown) and exits 1 on problems.
//
//   node scripts/health-check.js [https://wayhop.gr]
//
// Each run asks for one stop's live arrivals, so OASA gets at most one
// request (none if the stop is cached), two when a problem is rechecked.

import { appendFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Syntagma: busy at most hours, as in the diagnostics
const TEST_STOP = '10361';
const RECHECK_MS = 2 * 60_000;
const TIMEOUT_MS = 30_000;

export async function runChecks(site, fetch = globalThis.fetch) {
    const problems = [];
    const get = async path => {
        try {
            return await fetch(site + path, { headers: { 'User-Agent': 'Wayhop health check' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (err) {
            return { ok: false, status: 0, statusText: err.message, json: async () => null };
        }
    };
    const failed = res => `HTTP ${res.status || res.statusText}`;

    for (const path of ['/', '/el']) {
        const res = await get(path);
        if (res.status !== 200) problems.push(`Page ${path}: ${failed(res)}`);
    }

    // What the bus page asks for
    const arrivals = await get(`/api/arrivals?stops=${TEST_STOP}`);
    if (arrivals.status !== 200) {
        problems.push(`Live arrivals: ${failed(arrivals)}`);
    } else {
        const stop = (await arrivals.json().catch(() => null))?.stops?.[TEST_STOP];
        if (!stop || stop.unavailable) problems.push('Live arrivals: unavailable (OASA could not be reached)');
        else if (stop.stale) problems.push('Live arrivals: only older arrivals (OASA could not be reached just now)');
    }

    // Lets the announcements refresh if they're due, so the health page has their current state
    await get('/api/announcements');

    const res = await get('/api/health');
    const health = await res.json().catch(() => null);
    if (!health?.problems) problems.push(`Health page: ${failed(res)}`);
    else problems.push(...health.problems);
    return { problems, health };
}

export function report(site, { problems, health }, at = new Date()) {
    const lines = [
        problems.length ? `## ${site}: ${problems.length} problem${problems.length === 1 ? '' : 's'}` : `## ${site}: healthy`,
        '',
        ...problems.map(p => `- ${p}`),
        '',
        `Checked ${at.toISOString()}. Details: ${site}/admin/diagnostics`,
    ];
    if (health) lines.push('', '<details><summary>Health page</summary>', '', '```json', JSON.stringify(health, null, 2), '```', '', '</details>');
    return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const site = (process.argv[2] ?? 'https://wayhop.gr').replace(/\/+$/, '');
    let result = await runChecks(site);
    if (result.problems.length) {
        console.error(`${result.problems.length} problem(s); checking again in ${RECHECK_MS / 60_000} minutes`);
        await new Promise(r => setTimeout(r, RECHECK_MS));
        result = await runChecks(site);
    }
    const text = report(site, result);
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
    process.exitCode = result.problems.length ? 1 : 0;
}
