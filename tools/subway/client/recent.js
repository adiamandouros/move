import { recentList } from '/js/core/recent.js';

// The stations a person picked lately, kept on the device so the station
// lists can offer them first. Ids only, most recent first.

const stations = recentList('recent-stations', { valid: id => typeof id === 'string' });

/** @type {() => string[]} */
export const recentStations = stations.list;

/** @type {(id: string) => void} */
export const addRecentStation = stations.add;
