import { LANGS, localPath } from './i18n.js';

// What search engines and link previews see: meta tags, structured data,
// robots.txt and the sitemap.

const LOCALES = { en: 'en_US', el: 'el_GR' };

// What search engines and link previews are told about a page, as data for
// the layout's <head> (server/views/partials/meta.hbs). Pages that aren't
// indexed (the 404, /offline, the admin pages) are kept out of search
// results. path is the English one; origin is the public address
// (SITE_URL), without which the tags that need it are left out.
export function pageMeta({ path, index, lang, title, description, origin = '' }) {
    if (!path || !index) return { index: false };
    const url = origin && origin + localPath(path, lang);
    return {
        index: true,
        title,
        description,
        url,
        // The same page in each language; English is the default for everyone else
        alternates: url ? [
            ...LANGS.map(l => ({ lang: l, href: origin + localPath(path, l) })),
            { lang: 'x-default', href: origin + path },
        ] : [],
        locale: LOCALES[lang],
        otherLocales: LANGS.filter(l => l !== lang).map(l => LOCALES[l]),
        image: origin && `${origin}/icon/og-image.png`,
    };
}

// Structured data (schema.org) for the home page, so search results can show
// Wayhop as a free web app; the layout writes it into <head>
export function appData(description, lang, origin = '') {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Wayhop',
        description,
        ...(origin && { url: origin + localPath('/', lang) }),
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Any',
        inLanguage: ['en', 'el'],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    };
}

export function robotsTxt(origin) {
    return `User-agent: *\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
}

// Every indexed page in each language, each listing all its languages
export function sitemapXml(origin, paths) {
    const alternates = path => [...LANGS.map(lang => [lang, localPath(path, lang)]), ['x-default', path]]
        .map(([lang, p]) => `        <xhtml:link rel="alternate" hreflang="${lang}" href="${origin}${p}"/>`).join('\n');
    const urls = paths.flatMap(path => LANGS.map(lang =>
        `    <url>\n        <loc>${origin}${localPath(path, lang)}</loc>\n${alternates(path)}\n    </url>`)).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}
