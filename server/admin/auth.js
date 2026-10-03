import { createHash, createHmac, timingSafeEqual } from 'crypto';

const SESSION_MS = 30 * 86_400_000;

// Stateless sessions: the cookie holds an expiry time and an HMAC of it, keyed
// by the admin password. Sessions survive server restarts (handy when edits
// are queued offline) and changing ADMIN_PASSWORD logs every device out.
export function createAuth(password, { now = Date.now } = {}) {
    const key = createHash('sha256').update(`move-admin:${password}`).digest();
    const sign = value => createHmac('sha256', key).update(value).digest('base64url');
    const digest = value => createHash('sha256').update(String(value)).digest();

    return {
        sessionMs: SESSION_MS,

        checkPassword: attempt => timingSafeEqual(digest(attempt), digest(password)),

        issue() {
            const expires = String(now() + SESSION_MS);
            return `${expires}.${sign(expires)}`;
        },

        verify(token) {
            const [expires, signature] = String(token ?? '').split('.');
            if (!expires || !signature) return false;
            const expected = sign(expires);
            if (signature.length !== expected.length) return false;
            return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) && Number(expires) > now();
        },
    };
}

// Count failed logins per client and block after `max` within `windowMs`.
export function createLimiter({ max = 5, windowMs = 15 * 60_000, now = Date.now } = {}) {
    const failures = new Map();
    const recent = key => (failures.get(key) ?? []).filter(t => now() - t < windowMs);

    return {
        blocked: key => recent(key).length >= max,
        fail(key) {
            failures.set(key, [...recent(key), now()]);
            // Forget old clients so the map can't grow without bound
            if (failures.size > 1000) for (const k of failures.keys()) if (!recent(k).length) failures.delete(k);
        },
        reset: key => failures.delete(key),
    };
}

export function readCookie(req, name) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
}
