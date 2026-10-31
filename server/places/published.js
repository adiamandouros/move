// The published index, as the build writes it and the site reads it. Node's
// own modules only: the build runs on GitHub without npm install.

import { gunzipSync } from 'zlib';

export const PUBLISHED = 'https://github.com/adiamandouros/move/releases/download/places-index/places-index.json.gz';
// Editing removes a little; this much in a week means a broken fetch
const MOST_LOST = 0.1;

export const unpack = file => JSON.parse(gunzipSync(file).toString());

export function countsOf(index) {
    return {
        towns: index.towns.length,
        streets: index.streets.length,
        numbers: index.streets.reduce((sum, street) => sum + street[3].length / 3, 0),
        places: index.places.length,
    };
}

// What has shrunk too far since last time, in words
export function lostSince(counts, previous) {
    return Object.keys(counts)
        .filter(what => previous?.[what] && counts[what] < previous[what] * (1 - MOST_LOST))
        .map(what => `${what}: ${counts[what]}, down from ${previous[what]}`);
}
