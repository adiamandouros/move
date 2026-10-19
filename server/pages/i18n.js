import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Languages: every page exists in English at its plain path and in Greek
// under /el, and is rendered on the server in its language (browsers get it
// ready to show and never translate anything). Views write their text with
// {{t "key"}} and {{#lang}} (server/pages/templates.js).

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');
// server/views/strings.json: the navigation's, the home page's, the menu's…
const SHELL_STRINGS = JSON.parse(readFileSync(join(VIEWS_DIR, 'strings.json'), 'utf8'));

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
    const shell = SHELL_STRINGS;
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
