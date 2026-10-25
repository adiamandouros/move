// Exports nothing else uses: an export is a promise that another file needs
// the name, so one that no other file (code or test) names is noise, or
// code that's no longer used. sources: { path: text } of every file, code
// and tests; code: the paths whose exports are checked. Modules imported
// whole (`import * as layout from './map-layout.js'`) are used by whatever
// names they have, so they're left out.
// → ['path: name', …], empty when every export is used elsewhere

const DECLARED = /^export (?:async )?(?:function\*?|const|let|class) ([A-Za-z_$][\w$]*)/gm;
const LISTED = /^export \{([^}]*)\}/gm;
const WHOLE = /import \* as \w+ from '([^']+)'/g;

/** @param {Record<string, string>} sources @param {string[]} code */
export function unusedExports(sources, code) {
    const basename = path => path.split('/').pop();
    const whole = new Set(Object.values(sources).flatMap(text => [...text.matchAll(WHOLE)].map(m => basename(m[1]))));
    const problems = [];
    for (const path of code) {
        if (whole.has(basename(path))) continue;
        const text = sources[path];
        const names = [
            ...[...text.matchAll(DECLARED)].map(m => m[1]),
            ...[...text.matchAll(LISTED)].flatMap(m => m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()).filter(Boolean)),
        ];
        for (const name of names) {
            const named = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
            if (!Object.entries(sources).some(([other, otherText]) => other !== path && named.test(otherText))) problems.push(`${path}: ${name}`);
        }
    }
    return problems;
}
