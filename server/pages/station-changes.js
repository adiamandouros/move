import { formatHtml, html, localName } from '../../public/js/core/html.js';
import { linePill, pillList } from '../../public/js/core/lines.js';
import { STATION_PAGES } from '../../public/js/core/metro.js';
import { minutesMark } from '../../public/js/core/times.js';

/** @typedef {import('../../types/data.js').Rail} Rail */
/** @typedef {import('../../types/data.js').Trains} Trains */
/** @typedef {'metro' | 'tram' | 'suburban'} Network */

// The walks between stations that the planner knows (a tram stop's to a metro
// station or another stop, data/curated/tram.json; the suburban railway's,
// suburban.json), as every station page lists them under "Changes": each
// page is one network's (decision 55), so the walks are what joins Syntagma
// the metro station to Syntagma the tram stop. A station is "<network>:<id>",
// by its id in its own network's data.

// Each walk once: [from, to, minutes, note?]
/** @param {Rail} rail @param {Trains | null} trains @returns {[string, string, number, import('../../types/data.js').Names?][]} */
export function stationWalks(rail, trains) {
    const walks = [];
    for (const [id, stop] of Object.entries(rail.tram?.stations ?? {})) {
        for (const { metro, stop: other, minutes } of stop.walks ?? []) {
            walks.push([`tram:${id}`, metro ? `metro:${metro}` : `tram:${other}`, minutes]);
        }
    }
    // trains.json names the planner's stops: 'train:<id>' a suburban station,
    // 'rail:<id>' a metro station, or a tram stop ("-tram" where it shares a metro station's id)
    const station = stop => {
        if (stop.startsWith('train:')) return `suburban:${stop.slice(6)}`;
        const id = stop.slice(5);
        if (Object.hasOwn(rail.stations, id)) return `metro:${id}`;
        return `tram:${id.replace(/-tram$/, '')}`;
    };
    for (const [from, to, seconds, note] of trains?.walks ?? []) {
        walks.push([station(from), station(to), Math.round(seconds / 60), ...(note ? [note] : [])]);
    }
    return walks;
}

// A station's name, lines and page, or null when the data has no such station
/** @param {Rail} rail @param {Trains | null} trains @param {string} key @param {'en' | 'el'} lang */
function described(rail, trains, key, lang) {
    const [network, id] = /** @type {[Network, string]} */ (key.split(/:(.*)/));
    const path = `${STATION_PAGES[network]}/${id}`;
    if (network === 'metro' && rail.stations[id]) {
        return { name: localName(rail.stations[id].name, lang), lines: rail.stations[id].lines.map(l => linePill(l, rail.lines[l].name, 's')), path };
    }
    const tram = rail.tram;
    const stop = tram?.stations[id];
    if (network === 'tram' && tram && stop) {
        return { name: localName(stop.name, lang), lines: stop.lines.map(l => linePill(l, tram.lines[l].name, 's')), path };
    }
    const row = trains?.stations[id];
    if (network === 'suburban' && row) {
        const lines = [...new Set(Object.values(trains.dates).flat().filter(route => route.stops.includes(id)).map(route => route.line))].sort();
        return { name: lang === 'el' ? row[2] : row[3] || row[2], lines: lines.map(l => linePill(l, trains.lines?.[l]?.name ?? l, 's')), path };
    }
    return null;
}

// The station `key`'s changes, as data for the views: [{ text, note }],
// text "[M2][M3] Syntagma · ~4' on foot" with the station linked to
// its page, both ways of each walk, nearest first
/**
 * @param {Rail} rail @param {Trains | null} trains @param {string} key
 * @param {'en' | 'el'} lang @param {(key: string) => string} s
 */
export function stationChanges(rail, trains, key, lang, s) {
    return stationWalks(rail, trains)
        .flatMap(([a, b, minutes, note]) => a === key ? [{ other: b, minutes, note }] : b === key ? [{ other: a, minutes, note }] : [])
        .sort((x, y) => x.minutes - y.minutes)
        .flatMap(({ other, minutes, note }) => {
            const station = described(rail, trains, other, lang);
            if (!station) return [];
            return [{
                text: formatHtml(s('stations.change-walk'), { lines: pillList(station.lines), station: html`<a href="${station.path}">${station.name}</a>`, minutes: minutesMark(minutes, s, { about: true }) }),
                note: note ? localName(note, lang) : null,
            }];
        });
}
