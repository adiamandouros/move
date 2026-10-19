import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import { externalLink, format, formatDate, icon, raw } from '../../public/js/core/html.js';

// The server's views are Handlebars templates (.hbs): the layout
// (server/views/layout.hbs), the pages' views (server/views/, the tools'
// page.hbs, admin/) and the partials they share. {{value}} is escaped;
// {{{value}}} puts in HTML that's already built (the page's content, its
// meta tags); pieces built with html`` (/js/core/html.js) go in as {{piece}}.
// Helpers:
//   {{t "key"}}                     the page's string for key, escaped;
//                                   {{t "stations.toward" name=toward}} fills {name}
//   {{icon "geo-alt" "me-1"}}       an icon from the sprite (/js/core/html.js)
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
export const HELPERS = ['t', 'icon', 'json', 'ifLang', 'formatDate', 'external'];
const OPTIONS = {
    strict: true,
    knownHelpersOnly: true,
    knownHelpers: Object.fromEntries(HELPERS.map(name => [name, true])),
};

hb.registerHelper('t', (key, options) => {
    const text = options.data.strings?.[key];
    if (text === undefined) throw new Error(`There's no string "${key}" (${options.data.lang})`);
    return Object.keys(options.hash).length ? format(text, options.hash) : text;
});

// {{icon name}} or {{icon name classes}}: the last argument is Handlebars' options
hb.registerHelper('icon', (name, ...rest) => new hb.SafeString(String(icon(name, rest.length > 1 ? rest[0] : ''))));

hb.registerHelper('json', value => new hb.SafeString(JSON.stringify(value).replace(/</g, '\\u003c')));

hb.registerHelper('formatDate', date => formatDate(date));

hb.registerHelper('ifLang', function (code, options) {
    return options.data.lang === code ? options.fn(this) : options.inverse(this);
});

// Its content is the view's own output, so already escaped
hb.registerHelper('external', function (options) {
    const newTab = options.data.strings?.['shell.new-tab'];
    if (newTab === undefined) throw new Error(`There's no string "shell.new-tab" (${options.data.lang})`);
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
export function registerPartial(name, source) {
    hb.registerPartial(name, hb.compile(source, OPTIONS));
}

// ── The server's views ──────────────────────────────────────────────────────

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');

// A view in server/views/ by name ('home', 'pages/about.en', 'stations/station'), compiled once
const views = new Map();
/** @param {string} name @returns {View} */
export function view(name) {
    if (!views.has(name)) views.set(name, compileView(readFileSync(join(VIEWS_DIR, `${name}.hbs`), 'utf8'), `server/views/${name}.hbs`));
    return views.get(name);
}

// The partials they share: server/views/partials/<name>.hbs, as {{> name}}
const PARTIALS_DIR = join(VIEWS_DIR, 'partials');
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
