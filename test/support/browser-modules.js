// Load the site's browser modules (public/js/, tools/*/client/) in Node, in
// English or Greek, with the strings the pages would give them:
//   const { matchStations } = await browserModule('tools/subway/client/search.js', 'el');
// Modules that only build HTML or work things out run as they are; there's
// no page, so ones that touch the page at import time can't be loaded.
import { register } from 'node:module';
import { readFileSync } from 'fs';
import { loadTools } from '../../server/pages/registry.js';

register('./browser-hooks.js', import.meta.url);

const ROOT = new URL('../../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));

// Every string in one language, as the pages' <script id="strings"> has them
export function strings(lang) {
    const tools = loadTools();
    return Object.assign({}, ...[read('server/views/strings.json'), read('server/views/stations.json'), ...tools.map(t => t.strings)].map(table => table[lang]));
}

// The module at `path` (from the repository's root), in `lang`. `fresh: true`
// loads a new copy, with its own state. A test that set up its own
// `document` (with the page events a module listens to) keeps it.
let copies = 0;
export async function browserModule(path, lang = 'en', { fresh = false } = {}) {
    const own = !globalThis.document;
    // What i18n.js reads when it's first loaded in this language
    if (own) {
        globalThis.document = {
            documentElement: { lang, dataset: { icons: '/icons.svg' } },
            getElementById: id => id === 'strings' ? { textContent: JSON.stringify(strings(lang)) } : null,
        };
    }
    try {
        return await import(`${new URL(path, ROOT).href}?lang=${lang}${fresh ? `&copy=${++copies}` : ''}`);
    } finally {
        if (own) delete globalThis.document;
    }
}
