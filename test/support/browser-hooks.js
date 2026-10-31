// Module resolution for loading the site's browser code in Node (see
// browser-modules.js): '/js/…' is public/js/… and '/tools/<id>/…' that tool's
// client/ folder, as the browser's import map has them, and a module loaded
// for one language (?lang=el) loads everything it imports in that language
// too, so each language gets its own copy of i18n.js and of the modules that
// use it.
const ROOT = new URL('../../', import.meta.url);

export async function resolve(specifier, context, next) {
    const parent = context.parentURL ? new URL(context.parentURL) : null;
    const lang = parent?.searchParams.get('lang');
    let url = null;
    if (specifier.startsWith('/js/')) url = new URL(`public${specifier}`, ROOT);
    else if (specifier.startsWith('/tools/')) url = new URL(specifier.slice(1).replace(/^(tools\/[^/]+)\//, '$1/client/'), ROOT);
    else if (lang && /^\.\.?\//.test(specifier)) url = new URL(specifier, parent);
    if (!url) return next(specifier, context);
    if (lang) url.search = `?lang=${lang}`;
    return { url: url.href, shortCircuit: true, format: 'module' };
}
