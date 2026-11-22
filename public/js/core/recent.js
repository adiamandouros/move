import { localStore } from './storage.js';

// What a person picked lately, kept on the device under `key` so a field can
// offer it first: the last `keep`, most recent first, each once. `valid`:
// whether something saved is one (anything else is left out); `same`: whether
// two are the same pick. The Subway page's stations (tools/subway/client/recent.js)
// and the Trip page's places (tools/trip/client/recent.js).

/**
 * @template T
 * @param {string} key
 * @param {{ valid: (item: unknown) => boolean, same?: (a: T, b: T) => boolean, keep?: number }} rules
 * @returns {{ list: () => T[], add: (item: T) => void }}
 */
export function recentList(key, { valid, same = (a, b) => a === b, keep = 3 }) {
    const list = () => {
        try {
            const items = JSON.parse(localStore.get(key) ?? 'null');
            return Array.isArray(items) ? items.filter(valid) : [];
        } catch {
            return [];
        }
    };
    /** @param {T} item */
    const add = item => localStore.set(key, JSON.stringify([item, ...list().filter(other => !same(other, item))].slice(0, keep)));
    return { list, add };
}
