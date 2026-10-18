// The pages: the tools (tools/<id>/) and the list in server/pages/registry.js.
// Only for checking (npm run typecheck) and editor hints.

import type { Names } from './data.js';

export type Lang = 'en' | 'el';

/** Strings by language: { en: { key: text }, el: { … } } */
export interface Strings {
    en?: Record<string, string>;
    el?: Record<string, string>;
}

/** Gives the page's string for a key, in its language */
export type StringGetter = (key: string) => string;

/** A tools/<id>/ folder, as loadTools reads it (see tools/README.md) */
export interface Tool {
    id: string;
    path: string;
    order: number;
    icon: string;
    title: Names;
    shortTitle?: Names;
    description?: Names;
    offline: boolean;
    scripts: string[];
    precache: string[];
    ad?: string;
    /** page.html */
    page: string;
    /** strings.json */
    strings: Strings;
    /** Full path of client/ */
    clientDir: string;
}

/** An entry in sitePages (registry.js) */
export interface Page {
    /** The English address; pages without one (the 404) get it when rendered */
    path?: string;
    /** Strings key of the title */
    title: string;
    /** Strings key of the description in search results */
    description?: string;
    /** false keeps it out of search results and the sitemap */
    index?: boolean;
    content: (lang: Lang, s: StringGetter) => string;
    strings?: Strings;
    scripts?: string[];
    head?: (lang: Lang, s: StringGetter) => string;
    /** The tool whose navigation entry is highlighted */
    active?: string;
    /** Where it has an ad slot (server/ads.js) */
    ad?: string;
}

/** What render() (server/pages/layout.js) takes */
export interface RenderOptions {
    lang?: Lang;
    path?: string | null;
    index?: boolean;
    title: string;
    description?: string;
    content: string;
    strings?: Strings;
    scripts?: string[];
    head?: string;
    active?: string | null;
    ad?: string | null;
}
