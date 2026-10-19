// The pages: the tools (tools/<id>/) and the list in server/pages/registry.js.
// Only for checking (npm run typecheck) and editor hints.

import type { Names } from './data.js';
import type { Html } from '../public/js/core/html.js';

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
    /** page.hbs: the page's view (server/pages/templates.js) */
    page: string;
    /** strings.json */
    strings: Strings;
    /** data.json: the values its page.hbs gets ({} without one) */
    data: Record<string, any>;
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
    /** The HTML inside <main>, from its view; strings: the page's, for {{t}} */
    content: (lang: Lang, strings: Record<string, string>) => string;
    strings?: Strings;
    scripts?: string[];
    /** Its schema.org data, for <head> (seo.js) */
    structuredData?: (lang: Lang, s: StringGetter) => object;
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
    /** The HTML inside <main>: a string, or built with html`` */
    content: string | Html;
    strings?: Strings;
    scripts?: string[];
    /** schema.org data for <head> (seo.js) */
    structuredData?: object | null;
    /** More stylesheets (the admin pages') */
    styles?: string[];
    active?: string | null;
    ad?: string | null;
}
