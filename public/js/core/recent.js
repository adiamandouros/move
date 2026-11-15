// What a person picked lately, kept on the device under `key` so a field can
// offer it first: the last `keep`, most recent first, each once. `valid`:
// whether something saved is one (anything else is left out); `same`: whether
// two are the same pick. The Subway page's stations (tools/subway/client/recent.js)
// and the Trip page's places (tools/trip/client/recent.js).

// localStorage can be missing or blocked (private windows, some settings)
const storage = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } },
};

/**
 * @template T
 * @param {string} key
 * @param {{ valid: (item: unknown) => boolean, same?: (a: T, b: T) => boolean, keep?: number }} rules
 * @returns {{ list: () => T[], add: (item: T) => void }}
 */
export function recentList(key, { valid, same = (a, b) => a === b, keep = 3 }) {
    const list = () => {
        try {
            const items = JSON.parse(storage.get(key));
            return Array.isArray(items) ? items.filter(valid) : [];
        } catch {
            return [];
        }
    };
    const add = item => storage.set(key, JSON.stringify([item, ...list().filter(other => !same(other, item))].slice(0, keep)));
    return { list, add };
}
