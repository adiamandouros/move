// Nearby-stop search over bus-stops.json (see server/data/build-bus.js for the
// format). No DOM access, so it can be unit-tested in Node.

// Turn the compact rows into objects
export function decodeStops({ fields, stops }) {
    const at = Object.fromEntries(fields.map((f, i) => [f, i]));
    return stops.map(row => ({
        code: row[at.code],
        lat: row[at.lat],
        lng: row[at.lng],
        name: { el: row[at.el], en: row[at.en] || row[at.el] },
        lines: row[at.lines],
    }));
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6_371_000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// The closest stops within `radius` metres, at most `limit` of them. If fewer
// than `min` are that close (e.g. in the suburbs), the `min` nearest are
// returned whatever the distance.
export function nearestStops(stops, lat, lng, { limit = 6, radius = 500, min = 3 } = {}) {
    const sorted = stops
        .map(s => ({ ...s, meters: distanceMeters(lat, lng, s.lat, s.lng) }))
        .sort((a, b) => a.meters - b.meters);
    const close = sorted.filter(s => s.meters <= radius).slice(0, limit);
    return close.length >= min ? close : sorted.slice(0, Math.min(min, limit));
}
