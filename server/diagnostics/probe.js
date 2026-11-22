// Asking a service for a page and saying, in words, why it failed; and the
// shape of every check: a group, a title, a status, what was found, and what
// to do about it.

import { messageOf } from '../errors.js';

const TIMEOUT_MS = 8_000;

/**
 * The fetch the checks ask with: the server's own, saying who we are
 * (runDiagnostics), or a test's
 * @typedef {(url: string, init?: { headers?: Record<string, string>, signal?: AbortSignal }) => Promise<Response>} Fetch
 */
/**
 * What a failed request or lookup throws: an Error, with the system's code
 * (ENOTFOUND…) in it, or for fetch in its cause
 * @typedef {{ name?: string, code?: string, cause?: { code?: string } }} RequestError
 */

// Why a request failed, in a word: dns | refused | timeout | reset | tls | network
/** @param {unknown} err @returns {keyof typeof WHY} */
export function classifyError(err) {
    const e = /** @type {RequestError | null | undefined} */ (err);
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
    const code = e?.cause?.code ?? e?.code ?? '';
    if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME'].includes(code)) return 'dns';
    if (code === 'ECONNREFUSED') return 'refused';
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code)) return 'timeout';
    if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return 'reset';
    if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return 'tls';
    return 'network';
}

const WHY = {
    dns: 'the server could not look up the address (DNS)',
    refused: 'the connection was refused',
    timeout: `no answer within ${TIMEOUT_MS / 1000} s, often a firewall silently dropping traffic, or the service being down`,
    reset: 'the connection was cut off, often a sign of blocking',
    tls: 'the secure (HTTPS) connection failed: a certificate problem, something intercepting traffic, or a wrong server clock',
    network: 'a network error',
};

/** @param {number} status */
export function describeHttp(status) {
    if (status === 401) return 'HTTP 401 (not authorised)';
    if (status === 403) return 'HTTP 403 (forbidden), typical when an IP address is blocked';
    if (status === 404) return 'HTTP 404 (not found), wrong address';
    if (status === 429) return 'HTTP 429 (too many requests), rate-limited';
    if (status >= 500) return `HTTP ${status}, the service itself has a problem`;
    return `HTTP ${status}`;
}

/**
 * What a request got (probe): an answer, its body as text and read as JSON
 * (undefined when it isn't JSON); or none (`status` null), with why in a
 * word (`kind`) and in words (`reason`). `ms`: how long it took
 * @typedef {{ ok: boolean, status: number, ms: number, text: string, json: unknown, kind?: undefined, reason?: undefined }
 *   | { ok: false, status: null, ms: number, text?: undefined, json?: undefined, kind: keyof typeof WHY, reason: string }} Probe
 */

/** @param {Fetch} fetch @param {string} url @param {Record<string, string>} [headers] @returns {Promise<Probe>} */
export async function probe(fetch, url, headers = {}, timeoutMs = TIMEOUT_MS) {
    const started = Date.now();
    try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        const text = await res.text();
        /** @type {unknown} */
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        return { ok: res.ok, status: res.status, ms: Date.now() - started, text, json };
    } catch (err) {
        const kind = classifyError(err);
        const code = /** @type {RequestError | null} */ (err)?.cause?.code;
        return { ok: false, status: null, ms: Date.now() - started, kind, reason: `${WHY[kind]} (${code ?? messageOf(err)})` };
    }
}

/** @param {Probe} p */
export const isApiAnswer = p => p.ok && (Array.isArray(p.json) || p.json === null);
/** @param {Probe} p */
export const failureText = p => p.status === null ? p.reason
    : p.ok ? `answered, but not with API data. Got: ${p.text.slice(0, 80).replace(/\s+/g, ' ')}… (maybe a block or maintenance page)`
    : describeHttp(p.status);

// A field of an answer read as JSON, when it's an object
/** @param {unknown} json @param {string} key @returns {unknown} */
export const fieldOf = (json, key) => typeof json === 'object' && json !== null ? /** @type {Record<string, unknown>} */ (json)[key] : undefined;

/**
 * A check: its group and title, how it went, what was found, what to do
 * about it, and for a long job how far it got, shown as a bar under the detail
 * @typedef {'ok' | 'warn' | 'fail' | 'info'} Status
 * @typedef {{ done: number, total: number, label: string }} Progress
 * @typedef {{ group: string, title: string, status: Status, detail: string, hint?: string, progress?: Progress }} Check
 */
/** @param {string} group @param {string} title @param {Status} status @param {string} detail @param {string} [hint] @param {Progress} [progress] @returns {Check} */
export const check = (group, title, status, detail, hint, progress) => ({ group, title, status, detail, ...(hint ? { hint } : {}), ...(progress ? { progress } : {}) });

/** @param {string} text */
export const capital = text => text[0].toUpperCase() + text.slice(1);
