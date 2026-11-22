// What a page keeps in the browser: localStore on the device (localStorage),
// sessionStore for this tab or app session (sessionStorage). Either can be
// missing or blocked (private windows, some settings) or full: then a read
// gives null and a write keeps nothing, and the page goes on without it.
// The browser's storage is looked up on each call, as a test swaps it.

/**
 * @typedef {{ get: (key: string) => string | null, set: (key: string, value: string) => void, remove: (key: string) => void }} Store
 */

/** @param {() => Storage} storage @returns {Store} */
const safe = storage => ({
    get: key => { try { return storage().getItem(key); } catch { return null; } },
    set: (key, value) => { try { storage().setItem(key, value); } catch { /* not kept */ } },
    remove: key => { try { storage().removeItem(key); } catch { /* nothing kept */ } },
});

export const localStore = safe(() => localStorage);
export const sessionStore = safe(() => sessionStorage);
