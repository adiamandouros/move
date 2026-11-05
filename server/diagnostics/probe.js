// Asking a service for a page and saying, in words, why it failed; and the
// shape of every check: a group, a title, a status, what was found, and what
// to do about it.

const TIMEOUT_MS = 8_000;

// Why a request failed, in a word: dns | refused | timeout | reset | tls | network
export function classifyError(err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
    const code = err?.cause?.code ?? err?.code ?? '';
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

export function describeHttp(status) {
    if (status === 401) return 'HTTP 401 (not authorised)';
    if (status === 403) return 'HTTP 403 (forbidden), typical when an IP address is blocked';
    if (status === 404) return 'HTTP 404 (not found), wrong address';
    if (status === 429) return 'HTTP 429 (too many requests), rate-limited';
    if (status >= 500) return `HTTP ${status}, the service itself has a problem`;
    return `HTTP ${status}`;
}

// → { ok, status, ms, text, json, kind, reason }
export async function probe(fetch, url, headers = {}, timeoutMs = TIMEOUT_MS) {
    const started = Date.now();
    try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        return { ok: res.ok, status: res.status, ms: Date.now() - started, text, json };
    } catch (err) {
        const kind = classifyError(err);
        return { ok: false, status: null, ms: Date.now() - started, kind, reason: `${WHY[kind]} (${err.cause?.code ?? err.message})` };
    }
}

export const isApiAnswer = p => p.ok && (Array.isArray(p.json) || p.json === null);
export const failureText = p => p.status === null ? p.reason
    : p.ok ? `answered, but not with API data. Got: ${p.text.slice(0, 80).replace(/\s+/g, ' ')}… (maybe a block or maintenance page)`
    : describeHttp(p.status);

// progress: { done, total, label }, shown as a bar under the detail
export const check = (group, title, status, detail, hint, progress) => ({ group, title, status, detail, ...(hint ? { hint } : {}), ...(progress ? { progress } : {}) });

export const capital = text => text[0].toUpperCase() + text.slice(1);
