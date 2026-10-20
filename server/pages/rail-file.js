import { readFileSync, statSync } from 'fs';
import { athensDate } from '../../tools/subway/client/network.js';

// rail.json for the pages drawn from it (the station pages, the Info page's
// last trains): read again when it changes, or when the day does (pages say
// whether its timetable has ended). `key` changes with it, so a page drawn
// from it can be kept until then. Before the first build: { key: null, rail: null }.
/** @param {string} file @returns {() => { key: string | null, rail: import('../../types/data.js').Rail | null }} */
export function railReader(file) {
    let loaded = { key: null, rail: null };
    return () => {
        try {
            const key = `${statSync(file).mtimeMs} ${athensDate()}`;
            if (key !== loaded.key) loaded = { key, rail: JSON.parse(readFileSync(file, 'utf8')) };
        } catch { /* keep what we had; nothing until the first build */ }
        return loaded;
    };
}
