// The stations a person picked lately, kept on the device so the station
// lists can offer them first. Ids only, most recent first.

const KEY = 'recent-stations';
const KEEP = 3;

// localStorage can be missing or blocked (private windows, some settings)
const storage = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } },
};

/** @returns {string[]} */
export function recentStations() {
    try {
        const ids = JSON.parse(storage.get(KEY));
        return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

export function addRecentStation(id) {
    storage.set(KEY, JSON.stringify([id, ...recentStations().filter(other => other !== id)].slice(0, KEEP)));
}
