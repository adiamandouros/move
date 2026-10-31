// A tiny OpenStreetMap: two towns side by side, Καλλιθέα to the west of
// lng 23.72 and Νέα Σμύρνη to the east, as Overpass answers, and two stations.

const square = (name, en, west, east) => ({
    type: 'relation',
    tags: { name: `Δήμος ${name}`, 'name:en': `Municipality of ${en}` },
    members: [{
        type: 'way',
        geometry: [[37.95, west], [37.96, west], [37.96, east], [37.95, east], [37.95, west]].map(([lat, lon]) => ({ lat, lon })),
    }],
});

const road = (name, points, tags = {}) => ({
    type: 'way',
    tags: { highway: 'residential', name, ...tags },
    geometry: points.map(([lat, lon]) => ({ lat, lon })),
});

const number = (street, housenumber, lat, lon, tags = {}) => ({
    type: 'node', lat, lon, tags: { 'addr:street': street, 'addr:housenumber': housenumber, ...tags },
});

export const raw = {
    municipalities: [square('Καλλιθέας', 'Kallithea', 23.70, 23.72), square('Νέας Σμύρνης', 'Nea Smyrni', 23.72, 23.74)],
    streets: [
        road('Μενελάου', [[37.955, 23.705], [37.955, 23.715]], { alt_name: 'Menelaou;Old Menelaou' }),
        road('Πάροδος Μενελάου', [[37.955, 23.715], [37.957, 23.715]]),
        road('Ομήρου', [[37.958, 23.725], [37.958, 23.735]]),
        // Crosses from one town into the other
        road('Θησέως', [[37.952, 23.71], [37.952, 23.73]]),
        // One road, two names
        road('Ανδρέα Συγγρού', [[37.951, 23.701], [37.951, 23.705]]),
        road('Συγγρού', [[37.951, 23.705], [37.951, 23.709]]),
        // The same name, far apart: two streets
        road('Κύπρου', [[37.9505, 23.701], [37.9505, 23.702]]),
        road('Κύπρου', [[37.9595, 23.718], [37.9595, 23.719]]),
        road('Σταύρου', [[37.9535, 23.725], [37.9535, 23.726]]),
        // Not a street, and not in Attica's towns
        road('Στάση', [[37.953, 23.703], [37.953, 23.704]], { highway: 'bus_stop' }),
        road('Μακριά', [[38.5, 23.5], [38.5, 23.6]]),
    ],
    addresses: [
        number('Μενελάου', '45', 37.955, 23.707, { 'addr:city': 'Καλλιθέα' }),
        number('Μενελάου', '65', 37.955, 23.709),
        number('Μενελάου', '85', 37.955, 23.711),
        { type: 'way', center: { lat: 37.955, lon: 23.713 }, tags: { 'addr:street': 'Μενελάου', 'addr:housenumber': '105' } },
        // The ends of a range
        number('Ομήρου', '2', 37.958, 23.726),
        number('Ομήρου', '10', 37.958, 23.73),
        {
            type: 'way', tags: { 'addr:interpolation': 'even' },
            geometry: [{ lat: 37.958, lon: 23.726 }, { lat: 37.958, lon: 23.73 }],
        },
        // A span, and two numbers
        number('Θησέως', '12-16', 37.952, 23.712),
        number('Θησέως', '20,22', 37.952, 23.713),
        // Only part of the street's name
        number('Συγγρού', '3', 37.951, 23.703),
        number('Ανδρ. Συγγρού', '5', 37.951, 23.704),
        // A letter off, on a corner, and on a street that isn't mapped
        number('Σταύρυ', '1', 37.9535, 23.7255),
        number('Κύπρου & Κάπου', '7', 37.9505, 23.7045),
        number('Άγνωστη', '9', 37.956, 23.703),
        // Left out
        number('Μενελάου', 'Α', 37.955, 23.71),
        number('Έξω', '1', 38.5, 23.5),
        { type: 'node', lat: 37.955, lon: 23.71, tags: { 'addr:housenumber': '1' } },
    ],
    places: [
        { type: 'node', lat: 37.9565, lon: 23.7125, tags: { place: 'neighbourhood', name: 'Τζιτζιφιές' } },
        { type: 'way', center: { lat: 37.9545, lon: 23.7305 }, tags: { leisure: 'park', name: 'Άλσος' } },
        // The same place twice, and a place with no name
        { type: 'node', lat: 37.9546, lon: 23.7306, tags: { leisure: 'park', name: 'Άλσος' } },
        { type: 'node', lat: 37.9546, lon: 23.7306, tags: { place: 'locality' } },
    ],
    airports: [
        { type: 'way', center: { lat: 37.9565, lon: 23.7345 }, tags: { aeroway: 'aerodrome', iata: 'ATH', name: 'Διεθνής Αερολιμένας' } },
        { type: 'node', lat: 37.9585, lon: 23.7345, tags: { aeroway: 'aerodrome', name: 'Τατόι' } },
    ],
};

export const rail = {
    stations: { sygrou: { name: { el: 'Συγγρού-Φιξ', en: 'Sygrou-Fix' }, coords: [37.9525, 23.735], lines: ['M2'] } },
    tram: { stations: { kasomouli: { name: { el: 'Κασομούλη', en: 'Kasomouli' }, coords: [37.9535, 23.736], lines: ['T6'] } } },
};
