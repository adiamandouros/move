// Small GTFS feeds and helpers for the data build tests: a rail feed with
// its curated files, a bus feed, OASA's stop table, RAR archives like the
// ones OASA publishes, and a fake open-data portal.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32 } from 'zlib';

// A tiny feed: line M9 with stations a–b–c, valid Mon 3 – Sun 9 Aug 2026.
// X1 is a technical stop that stations.json tells the build to ignore.
// copies: trains listed twice, as the real feed sometimes has them (n1 again
// on weekdays, Saturday night's n7 again as Sunday's n8, 80 s off at b), and
// real trains close behind n1: n10 stops short, n11 is two minutes behind.
export function railFeed({ extraStop = '', copies = false, holiday = '' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'move-rail-'));
    const write = (name, rows) => writeFileSync(join(dir, name), rows.join('\n') + '\n');
    // With a holiday ('YYYYMMDD', in the second week), the feed runs two weeks and that date has Saturday's trains
    const end = holiday ? '20260816' : '20260809';
    write('routes.txt', ['route_id,route_short_name', '1,M9', '2,T1']);
    write('calendar.txt', [
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
        `wk,1,1,1,1,1,0,0,20260803,${end}`,
        `sat,0,0,0,0,0,1,0,20260803,${end}`,
        `sun,0,0,0,0,0,0,1,20260803,${end}`,
    ]);
    if (holiday) write('calendar_dates.txt', ['service_id,date,exception_type', `wk,${holiday},2`, `sat,${holiday},1`]);
    write('stops.txt', [
        'stop_id,stop_code,stop_lat,stop_lon',
        '1,A1,37.0,23.0', '2,A2,37.2,23.2', '3,B1,37.5,23.5', '4,B2,37.5,23.5',
        '5,C1,38.0,24.0', '6,C2,38.0,24.0', '7,X1,37.3,23.3', '8,Z1,0,0',
    ]);
    write('trips.txt', [
        'route_id,service_id,trip_id,direction_id',
        '1,wk,n1,0', '1,wk,n2,0', '1,wk,n3,0', '1,sat,n4,0', '1,sun,n5,0',
        '1,wk,s1,1', '1,sat,s2,1', '1,sun,s3,1',
        '2,wk,tram,0',
        ...(copies ? ['1,wk,n9,0', '1,wk,n10,0', '1,wk,n11,0', '1,sat,n7,0', '1,sun,n8,0'] : []),
    ]);
    const trip = (id, stops) => stops.map(([stop, time], i) => `${id},${time},${time},${stop},${i + 1}`);
    write('stop_times.txt', [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        ...trip('n1', [[1, '08:00:00'], [3, '08:02:00'], [5, '08:05:00']]),
        ...trip('n2', [[1, '08:10:00'], [3, '08:12:00'], [5, '08:15:00']]),
        ...trip('n3', [[1, '24:30:00'], [7, '24:31:00'], [3, '24:32:00']]),
        ...trip('n4', [[1, '09:00:00'], [3, '09:02:00'], [5, '09:05:00']]),
        ...trip('n5', [[1, '10:00:00'], [3, '10:02:00'], [5, '10:05:00']]),
        ...trip('s1', [[6, '08:00:00'], [4, '08:03:00'], [2, '08:05:00']]),
        ...trip('s2', [[6, '09:00:00'], [4, '09:03:00'], [2, '09:05:00']]),
        ...trip('s3', [[6, '10:00:00'], [4, '10:03:00'], [2, '10:05:00']]),
        ...trip('tram', [[8, '08:00:00'], [8, '08:01:00']]),
        ...(copies ? [
            ...trip('n9', [[1, '08:00:30'], [3, '08:02:00'], [5, '08:05:40']]),
            ...trip('n10', [[1, '08:00:20'], [3, '08:02:20']]),
            ...trip('n11', [[1, '08:02:00'], [3, '08:04:00'], [5, '08:07:00']]),
            ...trip('n7', [[1, '25:00:00'], [3, '25:02:00'], [5, '25:05:00']]),
            ...trip('n8', [[1, '01:00:20'], [3, '01:03:20'], [5, '01:05:00']]),
        ] : []),
        ...(extraStop ? trip('n6', [[1, '11:00:00'], [extraStop, '11:01:00']]).map(l => l.replace('n6', 'n1')) : []),
    ]);
    return dir;
}

export function railCurated(overrides = {}) {
    return {
        stations: {
            stations: {
                a: { name: { el: 'Α', en: 'A' }, gtfs: ['A1', 'A2'] },
                b: { name: { el: 'Β', en: 'B' }, gtfs: ['B1', 'B2'] },
                c: { name: { el: 'Γ', en: 'C' }, gtfs: ['C1', 'C2'] },
            },
            ignoreGtfs: ['X1'],
        },
        lines: {
            M9: {
                name: 'M9', color: '#000',
                directions: {
                    north: { gtfsDirection: '0', toward: { el: 'Γ', en: 'C' } },
                    south: { gtfsDirection: '1', toward: { el: 'Α', en: 'A' } },
                },
            },
        },
        positions: {
            M9: {
                north: { a: { exits: [] }, b: { exits: ['front'], note: 'Hi' }, c: { exits: ['back'] } },
                south: { c: { exits: ['back'] }, b: { exits: ['center'] }, a: { exits: ['front'] } },
            },
        },
        ...overrides,
    };
}

// A bus feed with `stops` stops (the build needs at least 1000), one line
// through all of them, valid Mon 3 – Sun 9 Aug 2026. `extraStops` adds rows
// to stops.txt as they are, e.g. a stop with a bad code.
export function busFeed({ stops = 1000, extraStops = [], dir = mkdtempSync(join(tmpdir(), 'wayhop-bus-')) } = {}) {
    const write = (name, rows) => writeFileSync(join(dir, name), rows.join('\n') + '\n');
    const codes = Array.from({ length: stops }, (_, i) => String(10000 + i));
    write('routes.txt', ['route_id,route_short_name', 'r1,040', 'r2,Χ95']);
    write('trips.txt', ['route_id,service_id,trip_id', 'r1,wk,t1', 'r2,wk,t2']);
    write('calendar.txt', [
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
        'wk,1,1,1,1,1,1,1,20260803,20260809',
    ]);
    write('stops.txt', [
        'stop_id,stop_name,stop_lat,stop_lon',
        ...codes.map((code, i) => `${code},ΣΤΑΣΗ  ${i},${(37.9 + i * 1e-4).toFixed(5)},23.7`),
        // Served by no trip: left out
        '99999,ΑΧΡΗΣΙΜΟΠΟΙΗΤΗ,37.95,23.75',
        ...extraStops,
    ]);
    write('stop_times.txt', [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        ...codes.map((code, i) => `t1,08:00:00,08:00:00,${code},${i + 1}`),
        ...extraStops.map((row, i) => `t1,10:00:00,10:00:00,${row.split(',')[0]},${stops + i + 1}`),
        `t2,09:00:00,09:00:00,${codes[0]},1`,
    ]);
    return dir;
}

// OASA's stop table, with English names for the first `named` stops
export function stopTable({ named = 10, dir = mkdtempSync(join(tmpdir(), 'wayhop-stoptable-')) } = {}) {
    const path = join(dir, 'stops_all.csv');
    writeFileSync(path, ['stop_code,stop_desr_matrix', ...Array.from({ length: named }, (_, i) => `${10000 + i},STOP ${i}`)].join('\n') + '\n');
    return path;
}

// The curated files of railCurated(), written as data/curated/ has them
export function curatedDir(curated = railCurated()) {
    const dir = mkdtempSync(join(tmpdir(), 'wayhop-curated-'));
    for (const name of ['stations', 'lines', 'positions']) writeFileSync(join(dir, `${name}.json`), JSON.stringify(curated[name]));
    return dir;
}

// A RAR 4 archive holding `files` ({ name: text }) uncompressed, as OASA
// publishes some of its feed files; node-unrar-js reads it like a real one
export function rar(files) {
    const header = (type, flags, body) => {
        const h = Buffer.alloc(7 + body.length);
        h.writeUInt8(type, 2);
        h.writeUInt16LE(flags, 3);
        h.writeUInt16LE(h.length, 5);
        body.copy(h, 7);
        h.writeUInt16LE(crc32(h.subarray(2)) & 0xffff, 0);
        return h;
    };
    const parts = [Buffer.from('Rar!\x1a\x07\x00', 'latin1'), header(0x73, 0, Buffer.alloc(6))];
    for (const [name, text] of Object.entries(files)) {
        const data = Buffer.from(text);
        const fileName = Buffer.from(name);
        const body = Buffer.alloc(25 + fileName.length);
        body.writeUInt32LE(data.length, 0);       // packed size
        body.writeUInt32LE(data.length, 4);       // unpacked size
        body.writeUInt32LE(crc32(data) >>> 0, 9);
        body.writeUInt32LE(0x5b210000, 13);       // a DOS date in 2025
        body.writeUInt8(20, 17);                  // version needed
        body.writeUInt8(0x30, 18);                // stored, not compressed
        body.writeUInt16LE(fileName.length, 19);
        body.writeUInt32LE(0x20, 21);             // attributes
        fileName.copy(body, 25);
        parts.push(header(0x74, 0x8000, body), data);
    }
    parts.push(header(0x7b, 0x4000, Buffer.alloc(0)));
    return Buffer.concat(parts);
}

// A fake of OASA's open-data portal (CKAN) and its downloads.
//   publish(dataset, dir, { version, rarFor: ['stops.txt'] }): offer every file in dir
//   publishFile(dataset, name, body, version, urlName): offer one file (at a URL ending in urlName)
//   remove(dataset, name), down(true|false)
// `calls` lists every URL asked for; `downloads` only the file downloads.
export function fakePortal() {
    const datasets = {};
    const files = new Map();
    const calls = [];
    let isDown = false;
    const publishFile = (dataset, name, body, version = '2026-08-01T00:00:00', urlName = name) => {
        const url = `https://portal.example/${dataset}/${version}/${urlName}`;
        files.set(url, body);
        datasets[dataset] = (datasets[dataset] ?? []).filter(r => r.name !== name).concat({ name, url, last_modified: version });
    };
    const portal = {
        calls,
        get downloads() { return calls.filter(u => u.startsWith('https://portal.example/')); },
        publishFile,
        publish(dataset, dir, { version, rarFor = [] } = {}) {
            for (const name of readdirSync(dir)) {
                const text = readFileSync(join(dir, name), 'utf8');
                if (rarFor.includes(name)) publishFile(dataset, name.replace(/\.txt$/, '.rar'), rar({ [name]: text }), version);
                else publishFile(dataset, name, text, version);
            }
        },
        remove(dataset, name) { datasets[dataset] = datasets[dataset].filter(r => r.name !== name); },
        down(value = true) { isDown = value; },
        async fetch(input) {
            const url = String(input);
            calls.push(url);
            if (isDown) throw new TypeError('fetch failed');
            const dataset = url.match(/package_show\?id=(.+)$/)?.[1];
            if (dataset) {
                return datasets[dataset]
                    ? Response.json({ success: true, result: { resources: datasets[dataset] } })
                    : new Response('not found', { status: 404 });
            }
            return files.has(url) ? new Response(files.get(url)) : new Response('gone', { status: 404 });
        },
    };
    return portal;
}

// An empty folder for a test's raw downloads or whole data folder
export const tempDir = (prefix = 'wayhop-data-') => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(dir, { recursive: true });
    return dir;
};
