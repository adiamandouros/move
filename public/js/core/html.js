// Escape text for safe use inside HTML built with template strings
export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Text colour for a label on `background` (#rrggbb): whichever of white and
// near-black has the higher contrast, so line badges stay readable (WCAG AA)
export function textOn(background) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(background.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.0607 ? '#fff' : '#0f131c';
}
