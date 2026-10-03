import { existsSync } from 'fs';
import { join } from 'path';
import { readCsv, readCsvAll } from './csv.js';
import { isoDate, serviceDates } from './calendar.js';

// Build bus-stops.json — a compact index of every bus/trolley stop, so the
// browser can find nearby stops without calling OASA:
//
// {
//   schema, generated,
//   feed:   { validFrom, validTo },
//   fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'],
//   stops:  [['10361', 37.97491, 23.73488, 'ΣΥΝΤΑΓΜΑ', 'SYNTAGMA', ['024', '035', …]], …]
// }
//
// `code` is the GTFS stop_id, which is the stop code the telematics API uses.
// `en` comes from OASA's separate stop table and may be empty.

export const BUS_SCHEMA = 1;

const MIN_STOPS = 1000;

export async function buildBus({ dir, stopTablePath, today }) {
    const file = name => join(dir, name);
    const warnings = [];

    const routeName = new Map();
    for (const r of await readCsvAll(file('routes.txt'), { required: ['route_id', 'route_short_name'] })) {
        routeName.set(r.route_id, r.route_short_name);
    }

    const tripRoute = new Map();
    for await (const t of readCsv(file('trips.txt'), { required: ['route_id', 'trip_id'] })) {
        const name = routeName.get(t.route_id);
        if (name) tripRoute.set(t.trip_id, name);
    }

    const stopLines = new Map();
    for await (const st of readCsv(file('stop_times.txt'), { required: ['trip_id', 'stop_id'] })) {
        const line = tripRoute.get(st.trip_id);
        if (!line) continue;
        if (!stopLines.has(st.stop_id)) stopLines.set(st.stop_id, new Set());
        stopLines.get(st.stop_id).add(line);
    }

    const latinName = new Map();
    if (stopTablePath) {
        for (const s of await readCsvAll(stopTablePath, { required: ['stop_code', 'stop_desr_matrix'] })) {
            if (s.stop_desr_matrix) latinName.set(s.stop_code, s.stop_desr_matrix);
        }
    } else {
        warnings.push('No OASA stop table; English stop names will be empty');
    }

    const byNumber = (a, b) => a.localeCompare(b, 'el', { numeric: true });
    const stops = [];
    let unserved = 0;
    for (const s of await readCsvAll(file('stops.txt'), { required: ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'] })) {
        const lines = [...(stopLines.get(s.stop_id) ?? [])].sort(byNumber);
        if (!lines.length) { unserved++; continue; }
        stops.push([s.stop_id, round(+s.stop_lat, 5), round(+s.stop_lon, 5), s.stop_name.replace(/\s+/g, ' '), latinName.get(s.stop_id) ?? '', lines]);
    }
    if (stops.length < MIN_STOPS) throw new Error(`Bus feed has only ${stops.length} served stops (expected at least ${MIN_STOPS})`);
    if (unserved) warnings.push(`${unserved} bus stops have no trips and were left out`);

    const optional = async name => existsSync(file(name)) ? readCsvAll(file(name)) : [];
    const dates = [...serviceDates(await optional('calendar.txt'), await optional('calendar_dates.txt')).keys()].sort();
    if (!dates.length) throw new Error('Bus feed has no service dates');
    if (dates.at(-1) < today) warnings.push(`Bus feed expired on ${isoDate(dates.at(-1))}`);

    return {
        data: {
            schema: BUS_SCHEMA,
            generated: new Date().toISOString(),
            feed: { validFrom: isoDate(dates[0]), validTo: isoDate(dates.at(-1)) },
            fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'],
            stops,
        },
        warnings,
    };
}

function round(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
