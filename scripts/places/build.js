// Turns OpenStreetMap's answers (fetch.js) and Wayhop's own stations into the
// index that address search reads (server/places/search.js). It takes about
// 550 MB, too much for the host, so it runs on GitHub (decision 22).

import { keyOf, wordsOf, meters, editOne } from '../../server/places/search.js';

const E5 = n => Math.round(n * 1e5);
const LNG = Math.cos(37.97 * Math.PI / 180);

// Roads tagged as these aren't streets anyone has an address on
const SKIP_HIGHWAY = /^(bus_stop|platform|proposed|construction|corridor|elevator|raceway|abandoned|razed)$/;
// Words that make a side street of a name: 'Πάροδος Αγίου Νικολάου' isn't Αγίου Νικολάου
const SIDE = new Set(['parodos', 'stenopos', 'adiekodo', 'platia', 'plateia', 'a', 'v', 'g', 'd', 'e']);
const AIRPORT_NAMES = {
    ATH: ['Αεροδρόμιο', 'Αεροδρόμιο Αθηνών', 'Αεροδρόμιο Αθήνας', 'Αεροδρόμιο Ελευθέριος Βενιζέλος', 'Ελευθέριος Βενιζέλος', 'Eleftherios Venizelos', 'Αεροδρόμιο Σπάτων', 'Airport', 'Athens Airport', 'ATH'],
    KIT: ['Αεροδρόμιο Κυθήρων', 'Kythira Airport', 'KIT'],
};

const altNames = tags => ['alt_name', 'old_name', 'official_name', 'short_name', 'loc_name', 'name:en', 'name:el', 'int_name']
    .flatMap(k => (tags[k] ?? '').split(';')).map(s => s.trim()).filter(Boolean);

// A grid of about 130 m, to find what's close by
const cellOf = p => `${Math.round(p.lat * 800)},${Math.round(p.lng * 800)}`;
function near(p) {
    const a = Math.round(p.lat * 800), b = Math.round(p.lng * 800), cells = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.push(`${a + i},${b + j}`);
    return cells;
}

// The municipalities. A point is inside one when a line from it crosses the
// border an odd number of times.
function municipalities(elements) {
    const towns = elements.map(relation => {
        const segments = [];
        let s = 90, w = 90, n = -90, e = -90;
        for (const member of relation.members ?? []) {
            if (member.type !== 'way' || !member.geometry) continue;
            const g = member.geometry;
            for (let i = 0; i < g.length; i++) {
                s = Math.min(s, g[i].lat); n = Math.max(n, g[i].lat); w = Math.min(w, g[i].lon); e = Math.max(e, g[i].lon);
                if (i) segments.push([g[i - 1].lat, g[i - 1].lon, g[i].lat, g[i].lon]);
            }
        }
        const tags = relation.tags;
        return {
            name: (tags['name:el'] ?? tags.name).replace(/^Δήμος\s+/, ''),
            en: (tags['name:en'] ?? '').replace(/^Municipality of\s+/i, ''),
            segments, s, w, n, e, cities: new Map(),
        };
    });
    const townAt = (lat, lng) => {
        for (let i = 0; i < towns.length; i++) {
            const t = towns[i];
            if (lat < t.s || lat > t.n || lng < t.w || lng > t.e) continue;
            let odd = false;
            for (const [a, b, c, d] of t.segments) {
                if ((a > lat) !== (c > lat) && lng < (d - b) * (lat - a) / (c - a) + b) odd = !odd;
            }
            if (odd) return i;
        }
        return -1;
    };
    return { towns, townAt };
}

// A line with the points it can do without, to within 8 m (Douglas-Peucker)
function simplify(line, tolerance = 8) {
    if (line.length < 3) return line;
    const keep = new Uint8Array(line.length);
    keep[0] = keep[line.length - 1] = 1;
    const stack = [[0, line.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const ax = line[a].lng * LNG, ay = line[a].lat;
        const dx = line[b].lng * LNG - ax, dy = line[b].lat - ay, length = Math.hypot(dx, dy) || 1e-12;
        let far = 0, at = -1;
        for (let i = a + 1; i < b; i++) {
            const d = Math.abs((line[i].lng * LNG - ax) * dy - (line[i].lat - ay) * dx) / length * 111320;
            if (d > far) { far = d; at = i; }
        }
        if (far > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    return line.filter((_, i) => keep[i]);
}

// The point a share of the way along a line, by length: a simplified straight
// road has only its two ends, so its middle point would be one of them
function pointAt(line, share) {
    if (line.length < 2) return line[0];
    const walked = [0];
    for (let i = 1; i < line.length; i++) walked.push(walked[i - 1] + meters(line[i - 1], line[i]));
    const want = walked.at(-1) * share;
    let i = 1;
    while (i < line.length - 1 && walked[i] < want) i++;
    const t = (want - walked[i - 1]) / ((walked[i] - walked[i - 1]) || 1);
    return { lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * t, lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * t };
}

// Every town a road really runs through, not one it only touches at its end
function townsOf(line, townAt) {
    const at = p => townAt(p.lat, p.lng);
    const quick = new Set([0, 0.5, 1].map(share => at(pointAt(line, share))));
    if (quick.size === 1) return [...quick].filter(t => t >= 0);
    const hits = new Map();
    for (let share = 0.05; share < 1; share += 0.1) {
        const t = at(pointAt(line, share));
        if (t >= 0) hits.set(t, (hits.get(t) ?? 0) + 1);
    }
    if (!hits.size) return [];
    const most = Math.max(...hits.values());
    return [...hits].filter(([, n]) => n >= 2 || n === most).map(([t]) => t);
}

// One street per town, name and stretch of connected road
function streetsFrom(elements, townAt, count) {
    const groups = new Map();
    for (const way of elements) {
        if (SKIP_HIGHWAY.test(way.tags.highway) || !way.geometry) continue;
        const line = simplify(way.geometry.map(p => ({ lat: p.lat, lng: p.lon })));
        const inTowns = townsOf(line, townAt);
        if (!inTowns.length) count('street ways outside any municipality');
        if (inTowns.length > 1) count('street ways on a border, kept in each town');
        for (const town of inTowns) {
            const id = `${town}|${keyOf(way.tags.name)}`;
            if (!groups.has(id)) groups.set(id, []);
            groups.get(id).push({ name: way.tags.name, aliases: altNames(way.tags), line, town });
        }
    }
    const streets = [];
    for (const ways of groups.values()) {
        const parent = ways.map((_, i) => i);
        const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
        const cells = new Map();
        ways.forEach((way, i) => {
            for (const p of way.line) {
                for (const cell of near(p)) {
                    if (cells.has(cell)) parent[find(i)] = find(cells.get(cell));
                    else cells.set(cell, i);
                }
            }
        });
        const parts = new Map();
        ways.forEach((way, i) => {
            const root = find(i);
            if (!parts.has(root)) parts.set(root, []);
            parts.get(root).push(way);
        });
        for (const part of parts.values()) {
            const names = new Map();
            for (const way of part) names.set(way.name, (names.get(way.name) ?? 0) + way.line.length);
            const main = [...names].sort((a, b) => b[1] - a[1])[0][0];
            streets.push({
                main, names: new Set([main, ...part.flatMap(way => [way.name, ...way.aliases])]), town: part[0].town,
                lines: part.map(way => way.line), key: keyOf(main), points: new Map(),
            });
        }
    }
    return streets;
}

function sameRoadName(a, b) {
    const x = wordsOf(a), y = wordsOf(b), [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return short.every(w => long.includes(w)) && !long.some(w => !short.includes(w) && SIDE.has(w));
}

// One road with two names in OpenStreetMap, 'Συγγρού' running into 'Ανδρέα
// Συγγρού', is one street here, so its numbers stay together
function joinRoads(streets, count) {
    const ends = new Map();
    streets.forEach((street, i) => {
        for (const line of street.lines) {
            for (const p of [line[0], line.at(-1)]) {
                for (const cell of near(p)) {
                    if (!ends.has(cell)) ends.set(cell, new Set());
                    ends.get(cell).add(i);
                }
            }
        }
    });
    const up = streets.map((_, i) => i);
    const top = i => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
    streets.forEach((street, i) => {
        for (const line of street.lines) {
            for (const p of [line[0], line.at(-1)]) {
                for (const j of ends.get(cellOf(p)) ?? []) {
                    const other = streets[j];
                    if (j === i || other.town !== street.town || other.key === street.key || top(i) === top(j)) continue;
                    if (!sameRoadName(street.main, other.main)) continue;
                    if (other.lines.some(l => [l[0], l.at(-1)].some(q => meters(p, q) <= 40))) {
                        up[top(i)] = top(j);
                        count('streets joined: one road, two names');
                    }
                }
            }
        }
    });
    const joined = new Map();
    streets.forEach((street, i) => {
        const root = top(i), was = joined.get(root);
        if (!was) { joined.set(root, street); return; }
        const big = was.lines.flat().length >= street.lines.flat().length ? was : street;
        const small = big === was ? street : was;
        big.lines.push(...small.lines);
        for (const name of small.names) big.names.add(name);
        joined.set(root, big);
    });
    return [...joined.values()];
}

function toSegment(p, a, b) {
    const dx = (b.lng - a.lng) * LNG, dy = b.lat - a.lat, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.lng - a.lng) * LNG * dx + (p.lat - a.lat) * dy) / length)) : 0;
    return meters(p, { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
}

function distanceTo(street, p) {
    let distance = Infinity;
    for (const line of street.lines) {
        for (let i = 0; i < line.length; i++) distance = Math.min(distance, toSegment(p, line[Math.max(0, i - 1)], line[i]));
    }
    return distance;
}

function nearest(list, p, limit) {
    let best = null, distance = limit;
    for (const street of list) {
        const d = distanceTo(street, p);
        if (d < distance) { distance = d; best = street; }
    }
    return best;
}

// Finds the street a number belongs to, by the name on it and where it is
function streetFinder(streets, count) {
    const byKey = new Map();
    const addKey = (key, street) => {
        if (!byKey.has(key)) byKey.set(key, new Set());
        byKey.get(key).add(street);
    };
    const grid = new Map();
    for (const street of streets) {
        for (const name of street.names) addKey(keyOf(name), street);
        for (const l of street.lines) {
            for (let i = 0; i < l.length; i++) {
                const steps = i ? Math.ceil(meters(l[i - 1], l[i]) / 100) : 0;
                for (let k = 0; k <= steps; k++) {
                    const t = steps ? k / steps : 1, a = l[Math.max(0, i - 1)], b = l[i];
                    const cell = cellOf({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
                    if (!grid.has(cell)) grid.set(cell, new Set());
                    grid.get(cell).add(street);
                }
            }
        }
    }
    const lookup = (name, p, town) => {
        const key = keyOf(name);
        const list = [...(byKey.get(key) ?? [])];
        const inTown = list.filter(s => s.town === town);
        // A street's own name first: a side road can carry the avenue's as another name
        let street = nearest(inTown.filter(s => s.key === key), p, 500) ?? nearest(inTown, p, 500);
        if (street) return ['same name, same town', street];
        street = nearest(list, p, 300);
        if (street) return ['same name, town next door', street];
        const around = [...new Set(near(p).flatMap(cell => [...(grid.get(cell) ?? [])]))];
        street = nearest(around.filter(s => [...s.names].some(n => sameRoadName(name, n))), p, 200);
        if (street) return ['part of the name, close by', street];
        street = key.length >= 5 && nearest(around.filter(s => [...s.names].some(n => editOne(keyOf(n), key))), p, 200);
        return street ? ['misspelt by a letter, close by', street] : null;
    };
    // Numbers whose street isn't mapped: the name is still worth finding
    const orphans = new Map();
    const streetFor = (name, p, town) => {
        let found = lookup(name, p, town);
        // 'Μεσολογγίου & Φραγκούλη', a corner: the number is on one of them
        if (!found) {
            for (const part of name.split(/\s*[&,/]\s*|\s+και\s+/).slice(0, 3)) {
                if (part === name || !part.trim()) continue;
                found = lookup(part, p, town);
                if (found) { found = ['a corner, one of its streets', found[1]]; break; }
            }
        }
        if (found) { count(`numbers: ${found[0]}`); return found[1]; }
        count('numbers: no street found');
        const id = `${town}|${keyOf(name)}`;
        if (!orphans.has(id)) {
            const orphan = { main: name, names: new Set([name]), town, lines: [], key: keyOf(name), points: new Map() };
            orphans.set(id, orphan);
            addKey(keyOf(name), orphan);
        }
        return orphans.get(id);
    };
    return { streetFor, orphans };
}

function numbersIn(text) {
    const found = String(text).match(/\d+/g);
    if (!found) return [];
    const numbers = found.map(Number).filter(n => n > 0 && n < 5000);
    // '12-16' is the two ends of a building; '12,16' or '12Α' only what they say
    const isSpan = /^\s*\d+\s*-\s*\d+[^\d]*$/.test(text) && numbers.length === 2 && numbers[1] > numbers[0] && numbers[1] - numbers[0] <= 40;
    return isSpan ? numbers : [...new Set(numbers)];
}

// Keeps one point for a number: a mapped one beats one worked out from a
// range, and several of the same sort are averaged
function putNumber(street, n, p, range = false) {
    const was = street.points.get(n);
    if (!was || (was.range && !range)) street.points.set(n, { lat: p.lat, lng: p.lng, range, seen: 1 });
    else if (was.range === range) {
        was.lat = (was.lat * was.seen + p.lat) / (was.seen + 1);
        was.lng = (was.lng * was.seen + p.lng) / (was.seen + 1);
        was.seen++;
    }
}

function addNumbers(addresses, towns, townAt, streetFor, count) {
    const atPoint = new Map();
    for (const element of addresses) {
        const tags = element.tags;
        if (tags['addr:interpolation'] && element.type === 'way') continue;
        const lat = element.lat ?? element.center?.lat, lng = element.lon ?? element.center?.lon;
        if (lat === undefined) continue;
        const p = { lat, lng };
        const numbers = numbersIn(tags['addr:housenumber']);
        if (!tags['addr:street']) { count('numbers without a street name: left out'); continue; }
        if (!numbers.length) { count('numbers that are not numbers: left out'); continue; }
        const town = townAt(lat, lng);
        if (town < 0) { count('numbers outside any municipality'); continue; }
        const street = streetFor(tags['addr:street'], p, town);
        for (const n of numbers) putNumber(street, n, p);
        atPoint.set(pointKey(p), { street, n: numbers[0] });
        const city = (tags['addr:city'] ?? '').trim();
        if (city) towns[town].cities.set(city, (towns[town].cities.get(city) ?? 0) + 1);
    }
    return atPoint;
}

const pointKey = p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

// Address ranges: the numbers between both ends, spread along the line
function addRanges(addresses, atPoint, count) {
    for (const element of addresses) {
        const kind = element.tags?.['addr:interpolation'];
        if (!kind || element.type !== 'way' || !element.geometry) continue;
        const line = element.geometry.map(p => ({ lat: p.lat, lng: p.lon }));
        const from = atPoint.get(pointKey(line[0])), to = atPoint.get(pointKey(line.at(-1)));
        if (!from || !to || from.street !== to.street) { count('ranges without two numbered ends'); continue; }
        const low = Math.min(from.n, to.n), high = Math.max(from.n, to.n), step = kind === 'all' ? 1 : 2;
        if (high === low || (high - low) % step || high - low > 400) { count('ranges that make no sense'); continue; }
        const upwards = from.n < to.n ? line : [...line].reverse();
        for (let n = low + step; n < high; n += step) {
            putNumber(from.street, n, pointAt(upwards, (n - low) / (high - low)), true);
            count('numbers filled in from ranges');
        }
        count('ranges used');
    }
}

// Named places, then Wayhop's metro stations and tram stops, then the two
// airports people fly from (Attica's others are air bases)
function placesFrom({ places, airports }, rail, townAt) {
    const seen = [];
    const out = [];
    for (const element of places) {
        const tags = element.tags ?? {}, lat = element.lat ?? element.center?.lat, lng = element.lon ?? element.center?.lon;
        if (lat === undefined || !tags.name) continue;
        const key = keyOf(tags.name);
        if (seen.some(o => o.key === key && meters(o, { lat, lng }) < 300)) continue;
        seen.push({ key, lat, lng });
        const kind = tags.place ?? tags.amenity ?? tags.tourism ?? tags.leisure ?? tags.shop;
        out.push([[...new Set([tags.name, ...altNames(tags)])], townAt(lat, lng), kind, E5(lat), E5(lng)]);
    }
    const addStop = (stop, kind) => out.push([[stop.name.el, stop.name.en], townAt(...stop.coords), kind, E5(stop.coords[0]), E5(stop.coords[1]), stop.lines]);
    for (const stop of Object.values(rail.stations)) addStop(stop, 'metro');
    for (const stop of Object.values(rail.tram.stations)) addStop(stop, 'tram');
    for (const element of airports) {
        const tags = element.tags ?? {}, names = AIRPORT_NAMES[tags.iata];
        if (!names) continue;
        const lat = element.lat ?? element.center.lat, lng = element.lon ?? element.center.lon;
        out.push([[...new Set([tags.name, ...names, ...altNames(tags)])], townAt(lat, lng), 'airport', E5(lat), E5(lng)]);
    }
    return out;
}

// Each town's names: its own, then the ones people write on their addresses,
// each going to the municipality that uses it most
function townNames(towns) {
    const users = new Map();
    towns.forEach((town, i) => {
        for (const [city, n] of town.cities) {
            const key = keyOf(city), counts = users.get(key) ?? new Map();
            counts.set(i, (counts.get(i) ?? 0) + n);
            users.set(key, counts);
        }
    });
    const ownerOf = key => [...users.get(key)].sort((a, b) => b[1] - a[1])[0][0];
    return towns.map((town, i) => {
        const known = new Set([keyOf(town.name), keyOf(town.en)]);
        const cities = [...town.cities]
            .filter(([city, n]) => n >= 5 && !/\d/.test(city) && ownerOf(keyOf(city)) === i)
            .sort((a, b) => b[1] - a[1]).map(([city]) => city)
            .filter(city => !known.has(keyOf(city)) && known.add(keyOf(city)));
        return [town.name, ...(town.en ? [town.en] : []), ...cities.slice(0, 6)];
    });
}

// Written out as whole numbers, each point as a step from the one before
function encodeLine(line) {
    const out = [];
    let lat = 0, lng = 0;
    for (const p of line) { const x = E5(p.lat), y = E5(p.lng); out.push(x - lat, y - lng); lat = x; lng = y; }
    return out;
}
function encodePoints(points) {
    const out = [];
    let lat = 0, lng = 0;
    for (const [n, p] of [...points].sort((a, b) => a[0] - b[0])) {
        const x = E5(p.lat), y = E5(p.lng);
        out.push(p.range ? -n : n, x - lat, y - lng);
        lat = x; lng = y;
    }
    return out;
}

// raw: fetch.js's answers by name; rail: Wayhop's rail.json.
// Gives the index, and a count of what happened to the data along the way.
export function buildIndex(raw, rail, built = new Date().toISOString().slice(0, 10)) {
    const stats = {};
    const count = key => { stats[key] = (stats[key] ?? 0) + 1; };
    const { towns, townAt } = municipalities(raw.municipalities);
    const streets = joinRoads(streetsFrom(raw.streets, townAt, count), count);
    const { streetFor, orphans } = streetFinder(streets, count);
    const atPoint = addNumbers(raw.addresses, towns, townAt, streetFor, count);
    addRanges(raw.addresses, atPoint, count);
    const all = [...streets, ...orphans.values()];
    const index = {
        built,
        licence: '© OpenStreetMap contributors, ODbL 1.0',
        towns: townNames(towns),
        streets: all.map(s => [[...s.names], s.town, s.lines.map(encodeLine), encodePoints(s.points)]),
        places: placesFrom(raw, rail, townAt),
    };
    return { index, stats };
}
