import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml } from '../../public/js/core/html.js';

// Languages: every page exists in English at its plain path and in Greek
// under /el, and is rendered on the server in its language (browsers get it
// ready to show and never translate anything).

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');

export const LANGS = ['en', 'el'];
export const langOf = path => /^\/el(\/|$)/.test(path) ? 'el' : 'en';
export const otherLang = lang => lang === 'el' ? 'en' : 'el';
export const basePath = path => path.replace(/^\/el(?=\/|$)/, '') || '/';
export const localPath = (path, lang) => lang === 'el' ? (path === '/' ? '/el' : `/el${path}`) : path;

// ── Strings ─────────────────────────────────────────────────────────────────

// → (lang, own) => the strings of a page in one language: the shell's
// (server/views/strings.json), every tool's name (for the navigation) and the
// page's own ({ en: {…}, el: {…} }), with English for any that aren't translated
/**
 * @param {import('../../types/pages.js').Tool[]} tools
 * @returns {(lang: string, own?: import('../../types/pages.js').Strings) => Record<string, string>}
 */
export function pageStrings(tools) {
    const shell = JSON.parse(readFileSync(join(VIEWS_DIR, 'strings.json'), 'utf8'));
    const table = (lang, own) => {
        const out = { ...shell[lang], ...own[lang] };
        for (const tool of tools) {
            out[`tool.${tool.id}.title`] = tool.title[lang];
            out[`tool.${tool.id}.short`] = (tool.shortTitle ?? tool.title)[lang];
            if (tool.description) out[`tool.${tool.id}.description`] = tool.description[lang];
        }
        return out;
    };
    return (lang, own = {}) => {
        const translated = Object.entries(table(lang, own)).filter(([, text]) => text !== undefined);
        return { ...table('en', own), ...Object.fromEntries(translated) };
    };
}

// ── Translating a page ──────────────────────────────────────────────────────

// Whether a path is one of the pages; "/a/*" in the list stands for every path under /a/
export const isPage = (path, pagePaths) =>
    pagePaths.some(p => p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) : p === path);

// Links to one of the pages (with any ?query or #hash) point at that page in
// the given language
function localHref(href, lang, pagePaths) {
    const [, path, rest] = href.match(/^(\/[^?#]*)(.*)$/) ?? [];
    if (!path || !isPage(basePath(path), pagePaths)) return href;
    return localPath(basePath(path), lang) + rest;
}

// The page in its language. Every page is written in English and put into
// its language here:
//   - an element with data-i18n="key" gets that string as its text, and
//     data-i18n-<attribute>="key" sets that attribute
//   - text written in both languages, as data-lang="en" and data-lang="el"
//     elements, keeps only the page's language
//   - in Greek, links to the pages point at the Greek ones (except links
//     that name their language with hreflang, like the language link)
/** @param {string} html @param {string} lang @param {(key: string) => string | undefined} get @param {string[]} pagePaths */
export function translate(html, lang, get, pagePaths) {
    html = keepLanguage(html, lang)
        .replace(/(<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g, (match, open, _tag, key, text, close) => {
            if (!get(key)) return match;
            // Keep the spaces around the text, e.g. before "(opens in a new tab)"
            const [, before, after] = text.match(/^(\s*)[\s\S]*?(\s*)$/);
            return open + before + escapeHtml(get(key)) + after + close;
        })
        .replace(/<[a-z][^>]*>/g, tag => {
            for (const [, name, key] of tag.matchAll(/\sdata-i18n-([a-z-]+)="([^"]+)"/g)) {
                if (get(key)) tag = tag.replace(new RegExp(`(\\s${name}=")[^"]*"`), `$1${escapeHtml(get(key))}"`);
            }
            return tag;
        });
    if (lang === 'en') return html;
    return html.replace(/<a\b[^>]*>/g, tag => /\shreflang="/.test(tag) ? tag
        : tag.replace(/(\shref=")(\/[^"]*)"/, (_, open, href) => `${open}${localHref(href, lang, pagePaths)}"`));
}

// Remove each data-lang element of the other language, with everything in it,
// and the data-lang attribute of the ones that stay
function keepLanguage(html, lang) {
    const opening = /<(\w+)\b[^>]*\sdata-lang="(\w+)"[^>]*>/g;
    let out = '';
    let from = 0;
    for (let m; (m = opening.exec(html));) {
        const [tag, name, only] = m;
        out += html.slice(from, m.index);
        if (only === lang) {
            out += tag.replace(/\sdata-lang="\w+"/, '');
            from = m.index + tag.length;
        } else {
            from = elementEnd(html, name, m.index + tag.length);
            opening.lastIndex = from;
            // An element on a line of its own takes the line with it
            if (/\n[ \t]*$/.test(out) && html[from] === '\n') {
                out = out.replace(/[ \t]*$/, '');
                from++;
            }
        }
    }
    return out + html.slice(from);
}

// Where the <name> element whose content starts at `start` ends (after its closing tag)
function elementEnd(html, name, start) {
    const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g');
    tags.lastIndex = start;
    let depth = 1;
    for (let m; (m = tags.exec(html));) {
        depth += m[1] ? -1 : 1;
        if (!depth) return m.index + m[0].length;
    }
    throw new Error(`<${name} data-lang> is never closed`);
}
