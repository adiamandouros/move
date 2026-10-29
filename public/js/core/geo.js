// Distances on the map, for the pages that measure them (the bus stops near
// someone, the station editor's places on the street). No DOM access.

/** @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2 */
export function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6_371_000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
