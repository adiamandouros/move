import { lookup } from 'dns/promises';
import { loadConfig } from '../config.js';
import { CKAN_API } from '../data/sources.js';
import { OASA_API } from '../oasa/client.js';
import { dataChecks } from './data.js';
import { configChecks, dnsCheck, expectBlockedRelays, internetCheck, oasaCheck, portalCheck, probeOasa, relayChecks, verdict } from './reaching.js';
import { appChecks, usageChecks } from './running.js';
import { accountChecks, cspChecks, factsChecks } from './site.js';
import { announcementChecks, liftChecks } from './stasy-oasa.js';

// Health checks for when something goes wrong on the server: can it reach the
// internet, OASA, the relay and the open-data portal, is the timetable data
// fresh, and what does the running app see. Every failure comes with what it
// most likely means and what to do. Used by /admin/diagnostics and
// `npm run diagnose` (scripts/diagnose.js). Each group of checks is a file of
// its own in this folder.

/**
 * @param {{
 *   config?: import('../../types/config.js').Config, dataDir?: string, appStatus?: any, announcements?: any, lifts?: any,
 *   fetch?: typeof globalThis.fetch, dnsLookup?: typeof lookup, now?: () => number, nodeVersion?: string,
 *   csp?: { mode: string, kinds?: any[], dropped?: number } | null,
 *   facts?: { what: string, date: string }[],
 *   account?: ReturnType<typeof import('../processes.js').accountStatus> | null,
 * }} [options]
 */
export async function runDiagnostics({
    config = loadConfig({}),
    dataDir,
    appStatus = null,
    announcements = null,
    lifts = null,
    fetch = globalThis.fetch,
    dnsLookup = lookup,
    now = Date.now,
    nodeVersion = process.version,
    csp = null,
    facts = [],
    account = null,
} = {}) {
    // Every request says who we are, as the app's do
    const send = (url, init = {}) => fetch(url, { ...init, headers: { 'User-Agent': config.userAgent, ...init.headers } });
    const hosts = [new URL(OASA_API).hostname, new URL(CKAN_API).hostname];
    const relaySettings = config.relays;
    for (const r of relaySettings) hosts.push(new URL(r.url).hostname);

    const [internet, dns, oasaProbe, relays, portal] = await Promise.all([
        internetCheck(send),
        Promise.all(hosts.map(h => dnsCheck(dnsLookup, h))),
        probeOasa(send),
        Promise.all(relaySettings.map(r => relayChecks(send, r))),
        portalCheck(send),
    ]);
    const oasa = oasaCheck(oasaProbe, internet.loc);
    expectBlockedRelays(relays);

    const checks = [
        ...configChecks(config, nodeVersion),
        internet.result,
        ...dns,
        oasa.result,
        ...relays.flatMap(r => r.results),
        portal,
        ...dataChecks(dataDir, now),
        ...appChecks(appStatus, now),
        ...usageChecks(appStatus?.usage),
        ...announcementChecks(announcements, now),
        ...liftChecks(lifts, now),
        ...cspChecks(csp, now),
        ...factsChecks(facts, now),
        ...accountChecks(account),
    ];
    const summary = verdict({
        internet: internet.result,
        ip: internet.ip,
        loc: internet.loc,
        dns,
        oasa,
        relays,
        appStatus,
    });
    return { ranAt: new Date(now()).toISOString(), summary, checks };
}

// Plain-text report, for the terminal and for copying from the admin page
export function formatReport({ ranAt, summary, checks }) {
    const mark = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[INFO]' };
    const lines = [`Wayhop diagnostics, ${ranAt}`, '', `${mark[summary.status]} ${summary.text}`];
    let group = '';
    for (const c of checks) {
        if (c.group !== group) { group = c.group; lines.push('', `${group}:`); }
        lines.push(`  ${mark[c.status]} ${c.title}: ${c.detail}`);
        if (c.hint) lines.push(`         → ${c.hint}`);
    }
    return lines.join('\n');
}
