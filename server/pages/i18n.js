import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Languages: every page exists in English at its plain path and in Greek
// under /el, and is rendered on the server in its language (browsers get it
// ready to show and never translate anything). Views write their text with
// {{t "key"}} and {{#lang}} (server/pages/templates.js).

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');
// server/views/strings.json: the navigation's, the home page's, the menu's…
export const SHELL_STRINGS = JSON.parse(readFileSync(join(VIEWS_DIR, 'strings.json'), 'utf8'));

/** @type {import('../../types/pages.js').Lang[]} */
export const LANGS = ['en', 'el'];
/** @param {string} path @returns {import('../../types/pages.js').Lang} */
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
    const names = toolNames(tools);
    const table = (lang, own) => ({ ...SHELL_STRINGS[lang], ...own[lang], ...names[lang] });
    return (lang, own = {}) => {
        const translated = Object.entries(table(lang, own)).filter(([, text]) => text !== undefined);
        return { ...table('en', own), ...Object.fromEntries(translated) };
    };
}

// Every tool's name, short name and description, as strings ({ en, el }):
// tool.<id>.title, tool.<id>.short, tool.<id>.description
/** @param {import('../../types/pages.js').Tool[]} tools @returns {import('../../types/pages.js').Strings} */
export function toolNames(tools) {
    return Object.fromEntries(LANGS.map(lang => [lang, Object.fromEntries(tools.flatMap(tool => [
        [`tool.${tool.id}.title`, tool.title[lang]],
        [`tool.${tool.id}.short`, (tool.shortTitle ?? tool.title)[lang]],
        ...(tool.description ? [[`tool.${tool.id}.description`, tool.description[lang]]] : []),
    ]))]));
}

// Tables of strings ({ en, el }) as one, the later ones winning
/** @param {...import('../../types/pages.js').Strings} tables @returns {import('../../types/pages.js').Strings} */
export const mergeStrings = (...tables) => Object.fromEntries(LANGS.map(lang => [lang, Object.assign({}, ...tables.map(t => t[lang]))]));

// s(key): a string of the page's (strings, in lang); a missing one fails, as {{t}} does in views
/** @param {Record<string, string>} strings @param {string} lang @returns {(key: string) => string} */
export function stringGetter(strings, lang) {
    return key => {
        const text = strings[key];
        if (text === undefined) throw new Error(`There's no string "${key}" (${lang})`);
        return text;
    };
}

// ── Links in the page's language ────────────────────────────────────────────

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

// Views link to the English pages (<a href="/subway">); on a Greek page those
// links point at the Greek ones, except links that name their language with
// hreflang, like the language link
/** @param {string} html @param {string} lang @param {string[]} pagePaths */
export function localiseLinks(html, lang, pagePaths) {
    if (lang === 'en') return html;
    return html.replace(/<a\b[^>]*>/g, tag => /\shreflang="/.test(tag) ? tag
        : tag.replace(/(\shref=")(\/[^"]*)"/, (_, open, href) => `${open}${localHref(href, lang, pagePaths)}"`));
}
