import { readdirSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import { externalLink, formatDate, formatHtml, icon, raw } from '../../public/js/core/html.js';
import { busPlate, linePill } from '../../public/js/core/lines.js';
import { stringGetter } from './i18n.js';

// The server's views are Handlebars templates (.hbs): the layout
// (server/views/layout.hbs), the pages' views (server/views/, the tools'
// page.hbs, admin/) and the partials they share. {{value}} is escaped;
// {{{value}}} puts in HTML that's already built (the page's content, its
// meta tags); pieces built with html`` (/js/core/html.js) go in as {{piece}}.
// Helpers:
//   {{t "key"}}                     the page's string for key, escaped;
//                                   {{t "stations.toward" name=toward}} fills {name}
//   {{icon "walk" "me-1"}}          an icon from the sprite, by its meaning (/js/core/html.js)
//   {{pill "M3"}}, {{plate "X95"}}  a line's pill, a bus line's plate (/js/core/lines.js)
//   {{json value}}                  JSON that's safe inside a <script> element
//   {{formatDate "2026-10-14"}}     a date as people write it: 14/10/2026
//   {{#ifLang "en"}}…{{else}}…{{/ifLang}}  text written in both languages:
//                                   the first part on English pages, the rest on Greek ones
//   {{#external href="https://…"}}…{{/external}}  a link that opens in a new tab and
//                                   says so (externalLink in /js/core/html.js); other
//                                   attributes as given: class="…" lang="en" hidden=true
// Templates are compiled strictly: a value the template names but isn't
// given, a helper that doesn't exist or a string that's missing throws. Every
// page is rendered at startup, so such a mistake fails `npm test` (and the
// server's start), never a page.
//
// Not for scripts: the service workers are filled with fill() below, as
// Handlebars escapes for HTML.

const hb = Handlebars.create();

// (A value can't have a helper's name: {{lang}} is the page's language)
export const HELPERS = ['t', 'icon', 'json', 'ifLang', 'formatDate', 'external', 'pill', 'plate'];
const OPTIONS = {
    strict: true,
    knownHelpersOnly: true,
    knownHelpers: Object.fromEntries(HELPERS.map(name => [name, true])),
};

hb.registerHelper('t', (key, options) => {
    const text = stringGetter(options.data.strings ?? {}, options.data.lang)(key);
    // Filled: escaped here, as a value may be a piece built with html`` (a line's pill)
    return Object.keys(options.hash).length ? new hb.SafeString(String(formatHtml(text, options.hash))) : text;
});

// {{pill "M3"}} or {{pill "M3" "s"}}: a metro or tram line's pill, and
// {{plate "X95"}} a bus line's plate (/js/core/lines.js), in size m unless given
hb.registerHelper('pill', (id, ...rest) => linePill(id, id, rest.length > 1 ? rest[0] : 'm'));
hb.registerHelper('plate', (number, ...rest) => busPlate(number, rest.length > 1 ? rest[0] : 'm'));

// {{icon name}} or {{icon name classes}}: the last argument is Handlebars' options
// {{icon name filled=true}}: a tab's filled form
hb.registerHelper('icon', (name, ...rest) => new hb.SafeString(String(icon(name, rest.length > 1 ? rest[0] : '', { filled: rest.at(-1).hash.filled === true }))));

hb.registerHelper('json', value => new hb.SafeString(JSON.stringify(value).replace(/</g, '\\u003c')));

hb.registerHelper('formatDate', date => formatDate(date));

hb.registerHelper('ifLang', function (code, options) {
    return options.data.lang === code ? options.fn(this) : options.inverse(this);
});

// Its content is the view's own output, so already escaped. A helper, not a
// partial: a partial's hash joins the view's context, so a link's id= would
// hide the station's own id inside it.
hb.registerHelper('external', function (options) {
    const newTab = stringGetter(options.data.strings ?? {}, options.data.lang)('shell.new-tab');
    return new hb.SafeString(String(externalLink(options.hash, raw(options.fn(this)), newTab)));
});

/**
 * @typedef {{ lang: string, strings: Record<string, string> }} PageData the
 *   page's language and its strings ({{t}} and {{#ifLang}})
 * @typedef {(context: object, page: PageData) => string} View
 */

// A template → view(context, { lang, strings }). name says where it's from, for errors.
/** @param {string} source @param {string} name @returns {View} */
export function compileView(source, name) {
    const template = hb.compile(source, OPTIONS);
    return (context, { lang, strings }) => {
        try {
            return template(context, { data: { lang, strings } });
        } catch (err) {
            throw new Error(`${name}: ${err.message}`, { cause: err });
        }
    };
}

// A partial, for {{> name}} in any view
/** @param {string} name @param {string} source */
function registerPartial(name, source) {
    hb.registerPartial(name, hb.compile(source, OPTIONS));
}

// ── The views ───────────────────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A view by its file, from the repository's root ('server/views/home.hbs',
// 'tools/subway/page.hbs', 'admin/login.hbs') or as a full path; compiled once
const views = new Map();
/** @param {string} file @returns {View} */
export function view(file) {
    const path = resolve(ROOT, file);
    if (!views.has(path)) views.set(path, compileView(readFileSync(path, 'utf8'), relative(ROOT, path)));
    return views.get(path);
}

// The partials they share: server/views/partials/<name>.hbs, as {{> name}}
const PARTIALS_DIR = join(ROOT, 'server', 'views', 'partials');
for (const file of readdirSync(PARTIALS_DIR).filter(f => f.endsWith('.hbs'))) {
    registerPartial(file.slice(0, -'.hbs'.length), readFileSync(join(PARTIALS_DIR, file), 'utf8'));
}

// The parsed template, for checks on the templates themselves (test/templates.test.js)
/** @param {string} source */
export const parseTemplate = source => hb.parse(source);

// Fill a script's {{name}} slots with values as they are (the service workers'
// version and file lists, already JSON)
/** @param {string} template @param {Record<string, string>} values */
export function fill(template, values) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in values)) throw new Error(`No value for {{${key}}}`);
        return values[key];
    });
}
