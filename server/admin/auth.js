import { createHash, createHmac, timingSafeEqual } from 'crypto';

const SESSION_MS = 30 * 86_400_000;

// Whether two secrets match, in the same time whatever they are
/** @param {unknown} value */
const digest = value => createHash('sha256').update(String(value)).digest();
/** @param {unknown} a @param {unknown} b */
export const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b));

// Stateless sessions: the cookie holds an expiry time and an HMAC of it, keyed
// by the admin password. Sessions survive server restarts (handy when edits
// are queued offline) and changing ADMIN_PASSWORD logs every device out.
/** @param {string} password */
export function createAuth(password, { now = Date.now } = {}) {
    const key = createHash('sha256').update(`move-admin:${password}`).digest();
    /** @param {string} value */
    const sign = value => createHmac('sha256', key).update(value).digest('base64url');

    return {
        sessionMs: SESSION_MS,

        /** @param {unknown} attempt */
        checkPassword: attempt => sameSecret(attempt, password),

        issue() {
            const expires = String(now() + SESSION_MS);
            return `${expires}.${sign(expires)}`;
        },

        /** @param {string | null | undefined} token */
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
// A client is its address (req.ip: undefined when Express can't tell it).
export function createLimiter({ max = 5, windowMs = 15 * 60_000, now = Date.now } = {}) {
    /** @type {Map<string | undefined, number[]>} */
    const failures = new Map();
    /** @param {string | undefined} key */
    const recent = key => (failures.get(key) ?? []).filter(t => now() - t < windowMs);

    return {
        /** @param {string | undefined} key */
        blocked: key => recent(key).length >= max,
        /** @param {string | undefined} key */
        fail(key) {
            failures.set(key, [...recent(key), now()]);
            // Forget old clients so the map can't grow without bound
            if (failures.size > 1000) for (const k of failures.keys()) if (!recent(k).length) failures.delete(k);
        },
        /** @param {string | undefined} key */
        reset: key => failures.delete(key),
    };
}

/** @param {import('http').IncomingMessage} req @param {string} name */
export function readCookie(req, name) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
}
