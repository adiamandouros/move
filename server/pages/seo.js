import { escapeHtml } from '../../public/js/core/html.js';
import { LANGS, localPath } from './i18n.js';

// What search engines and link previews see: meta tags, structured data,
// robots.txt and the sitemap.

// The public origin (e.g. https://wayhop.gr), for canonical URLs, the sitemap
// and link previews. Without SITE_URL the pages leave out what needs it.
export const siteUrl = () => (process.env.SITE_URL ?? '').replace(/\/+$/, '');

const LOCALES = { en: 'en_US', el: 'el_GR' };

// Search and link-preview tags. Pages that aren't indexed (the 404, /offline,
// the admin pages) are kept out of search results. path is the English one.
export function metaTags({ path, index, lang, title, description }) {
    if (!path || !index) return '    <meta name="robots" content="noindex">';
    const origin = siteUrl();
    const url = origin && origin + localPath(path, lang);
    // The same page in each language; English is the default for everyone else
    const alternates = origin ? [
        ...LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${origin}${localPath(path, l)}">`),
        `<link rel="alternate" hreflang="x-default" href="${origin}${path}">`,
    ] : [];
    return [
        `<meta name="description" content="${escapeHtml(description)}">`,
        url && `<link rel="canonical" href="${url}">`,
        ...alternates,
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Wayhop">',
        `<meta property="og:locale" content="${LOCALES[lang]}">`,
        ...LANGS.filter(l => l !== lang).map(l => `<meta property="og:locale:alternate" content="${LOCALES[l]}">`),
        `<meta property="og:title" content="${escapeHtml(title)}">`,
        `<meta property="og:description" content="${escapeHtml(description)}">`,
        url && `<meta property="og:url" content="${url}">`,
        origin && `<meta property="og:image" content="${origin}/icon/og-image.png">`,
        origin && '<meta property="og:image:width" content="1200">',
        origin && '<meta property="og:image:height" content="630">',
        origin && '<meta property="og:image:alt" content="Wayhop: live buses and metro in Athens">',
        '<meta name="twitter:card" content="summary_large_image">',
    ].filter(Boolean).map(tag => `    ${tag}`).join('\n');
}

// Structured data (schema.org), for the page's <head>
export const structuredData = data => `    <script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

// For the home page, so search results can show Wayhop as a free web app
export function appData(description, lang) {
    return structuredData({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Wayhop',
        description,
        ...(siteUrl() && { url: siteUrl() + localPath('/', lang) }),
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Any',
        inLanguage: ['en', 'el'],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    });
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
