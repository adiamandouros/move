// Accessibility checks on HTML as text: whole pages as the server sends them
// (accessibility.test.js) and the pieces the pages' scripts draw (route
// results, bus stops). Each returns a list of problems, empty when fine.
// Our markup is simple enough for regular expressions: no element nests
// inside another of the same name where it matters here.

export const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// Text a screen reader would read: tags removed, aria-hidden and hidden parts dropped.
// Each check takes HTML as a string or built with html``.
export function spoken(fragment) {
    return String(fragment)
        .replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<(\w+)\b[^>]*\shidden(?=[\s>])[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name])
        .replace(/&\w+;/g, ' ')
        .trim();
}

// [{ open, inner }] for each <name …>…</name> (not nested in itself)
export const elements = (html, name) => [...html.matchAll(new RegExp(`(<${name}\\b[^>]*>)([\\s\\S]*?)</${name}>`, 'g'))]
    .map(([, open, inner]) => ({ open, inner }));

export function headingProblems(html) {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map(m => Number(m[1]));
    return levels.flatMap((level, i) => i > 0 && level > levels[i - 1] + 1 ? [`<h${level}> follows <h${levels[i - 1]}>`] : []);
}

export function nameProblems(html) {
    return ['button', 'a'].flatMap(name => elements(html, name)
        .filter(({ open, inner }) => !(attr(open, 'aria-label') || attr(open, 'title') || spoken(inner)))
        .map(({ open }) => `${open} has no text or aria-label`));
}

export function iconProblems(html) {
    return [
        ...(html.match(/<(?:i|svg) class="icon\b[^"]*"[^>]*>/g) ?? []).filter(tag => !/aria-hidden="true"/.test(tag)).map(tag => `${tag} needs aria-hidden="true"`),
        ...(html.match(/<img\b[^>]*>/g) ?? []).filter(img => !/\salt="/.test(img)).map(img => `${img} needs alt`),
    ];
}

export function newTabProblems(html) {
    return elements(html, 'a').filter(a => /target="_blank"/.test(a.open))
        .filter(({ open, inner }) => !/new tab|νέα καρτέλα/i.test(`${attr(open, 'aria-label') ?? ''} ${spoken(inner)}`))
        .map(({ open }) => `${open} opens a new tab without saying so`);
}

export function idProblems(html) {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    return [
        ...ids.filter((id, i) => ids.indexOf(id) !== i).map(id => `duplicate id "${id}"`),
        ...[...html.matchAll(/\s(?:for|aria-controls|aria-describedby|aria-labelledby)="([^"]+)"/g)]
            .flatMap(([, ref]) => ref.split(' ')).filter(id => !ids.includes(id)).map(id => `nothing has id="${id}"`),
    ];
}

export function formProblems(html) {
    return [
        ...(html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [])
            .filter(input => !/type="(hidden|submit|button)"/.test(input))
            .filter(input => !(attr(input, 'aria-label') || (attr(input, 'id') && html.includes(`for="${attr(input, 'id')}"`))))
            .map(input => `${input} has no label`),
        ...(/tabindex="[1-9]/.test(html) ? ['a positive tabindex'] : []),
    ];
}

// A string key shown as it is ("buses.minutes"): what t() returns for a
// string that's missing. `keys`: every known key, to know their prefixes.
export function untranslatedProblems(html, keys) {
    if (!keys.length) return [];
    const prefixes = [...new Set(keys.map(k => k.split('.')[0]))].join('|');
    const shown = `${spoken(html)} ${[...html.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map(m => m[1]).join(' ')}`;
    return [...shown.matchAll(new RegExp(`\\b(?:${prefixes})\\.[a-z][\\w-]*`, 'g'))].map(([key]) => `"${key}" shown instead of its text`);
}

// A line named in words where people see it, not by its pill or plate
// (/js/core/lines.js, DESIGN.md): "M3", "T7", "X95" (a capital and a number;
// Greek capitals too, as "Τ7" looks the same). Text only for screen readers
// is fine, as are bus numbers that are only digits, which can't be told from
// other numbers. Scripts are data, not text.
export function bareLineProblems(html) {
    const shown = String(html)
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<(\w+) class="sr-only">[^<]*<\/\1>/g, '')
        .replace(/<span class="(?:line-pill|bus-plate)\b[^"]*">[^<]*<\/span>/g, '')
        .replace(/<[^>]+>/g, ' ');
    return [...shown.matchAll(/(?<![\p{L}\p{N}])\p{Lu}\d{1,3}(?![\p{L}\p{N}])/gu)].map(([name]) => `"${name}" shown without its pill`);
}

// Everything above, for a piece of a page (ids it points at must be in it too)
export function markupProblems(view, { keys = [] } = {}) {
    const html = String(view);
    return [
        ...headingProblems(html), ...nameProblems(html), ...iconProblems(html), ...newTabProblems(html),
        ...idProblems(html), ...formProblems(html), ...untranslatedProblems(html, keys), ...bareLineProblems(html),
    ];
}
