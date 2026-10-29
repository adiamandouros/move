// Pretty-print JSON the way the curated files are written: nested objects get
// one key per line down to `inlineDepth`, anything deeper stays on one line,
// and so does every array, but for a list of objects above `inlineDepth`,
// which gets one of them per line. positions.json uses depth 3, so each
// station is one line; street.json too, so each exit is.
export function formatJson(value, inlineDepth, depth = 0, indent = '  ') {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const isArray = Array.isArray(value);
    const entries = isArray ? value.map(v => [null, v]) : Object.entries(value);
    const pad = indent.repeat(depth + 1);
    if (isArray && depth < inlineDepth && value.length && value.every(v => v !== null && typeof v === 'object' && !Array.isArray(v))) {
        return `[\n${value.map(v => pad + formatJson(v, inlineDepth, inlineDepth, indent)).join(',\n')}\n${indent.repeat(depth)}]`;
    }
    if (isArray || depth >= inlineDepth) {
        const inner = entries
            .map(([k, v]) => (k === null ? '' : `${JSON.stringify(k)}: `) + formatJson(v, inlineDepth, depth + 1, indent))
            .join(', ');
        if (isArray) return `[${inner}]`;
        return inner ? `{ ${inner} }` : '{}';
    }
    if (!entries.length) return '{}';
    const lines = entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${formatJson(v, inlineDepth, depth + 1, indent)}`);
    return `{\n${lines.join(',\n')}\n${indent.repeat(depth)}}`;
}
