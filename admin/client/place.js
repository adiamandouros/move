// Places on the street, a station's exits and lifts there: written as
// "latitude, longitude", or taken from where the phone is, and checked
// against where the station is, to catch a wrong one. No map, so nothing
// needs a connection (the GPS doesn't either).
import { distanceMeters } from '/js/core/geo.js';
import { announce } from '/js/core/html.js';
import { field } from './lists.js';

// Further than this from its station, a place is probably a wrong one
const FAR_M = 500;

// "37.97552, 23.73481", as maps copy it (or with a space for the comma):
// [lat, lng]; nothing written: null; anything else: undefined
export function parseCoords(text) {
    const value = text.trim();
    if (!value) return null;
    const match = value.match(/^(-?\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(-?\d+(?:\.\d+)?)$/);
    return match ? [Number(match[1]), Number(match[2])] : undefined;
}

export const formatCoords = ([lat, lng]) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

// What's wrong with a place as written, '' when nothing is. `bounds`: where
// a place can be, { lat: [min, max], lng: [min, max] }, as the server checks
export function coordsProblem(text, bounds) {
    const coords = parseCoords(text);
    if (coords === null) return '';
    if (!coords) return 'Write it as latitude, longitude, like 37.97552, 23.73481.';
    const inside = (n, [min, max]) => n >= min && n <= max;
    if (!inside(coords[0], bounds.lat) || !inside(coords[1], bounds.lng)) return 'That isn\'t around Athens: are latitude and longitude the right way round?';
    return '';
}

// Where a place is from its station, [lat, lng] each, in words; far off,
// a warning ({ warn })
export function fromStation(place, station) {
    const meters = distanceMeters(place[0], place[1], station[0], station[1]);
    return meters > FAR_M ? { warn: `${meters} m from the station: is that right?` } : `${meters} m from the station`;
}

// Where the phone is now, as precisely as it can say: { lat, lng, accuracy } (metres)
export function here() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('No location on this device'));
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: Math.round(coords.accuracy) }),
            reject,
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
        );
    });
}

// A place's field in a row (lists.js): the text, a Here button filling it in
// from the phone, and under it how far it is from `station` ([lat, lng]) and
// how precise the phone was. → a function reading it: [lat, lng] or undefined
export function placeField(parent, coords, { station, bounds }) {
    // What the Here button last found: its precision, or what went wrong ({ warn })
    let found = '';
    const input = field(parent, 'Where it is (latitude, longitude)', coords ? formatCoords(coords) : '', {
        wide: true,
        error: value => coordsProblem(value, bounds),
        check: value => {
            const at = parseCoords(value);
            const said = [found, at && fromStation(at, station)].filter(Boolean);
            const text = said.map(s => typeof s === 'string' ? s : s.warn).join(' · ');
            return said.some(s => typeof s !== 'string') ? { warn: text } : text;
        },
    });
    // Written by hand: the phone's precision isn't this place's
    input.addEventListener('beforeinput', () => { found = ''; });
    const update = () => input.dispatchEvent(new Event('input'));

    let busy = false;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline-primary';
    button.textContent = 'Here';
    button.setAttribute('aria-label', 'Here: where I am now');
    button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        found = 'Finding where you are…';
        update();
        try {
            const fix = await here();
            found = `±${fix.accuracy} m`;
            input.value = formatCoords([fix.lat, fix.lng]);
            announce(`Set to where you are, ±${fix.accuracy} m.`);
        } catch {
            found = { warn: 'Your location is unavailable: allow it for this site, or write the place in.' };
            announce(found.warn);
        } finally {
            busy = false;
            update();
        }
    });

    const group = document.createElement('div');
    group.className = 'input-group';
    input.replaceWith(group);
    group.append(input, button);
    return () => parseCoords(input.value) ?? undefined;
}
