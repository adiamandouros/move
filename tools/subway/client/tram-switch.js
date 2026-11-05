// Whether the tram is hidden on this device: the Subway page's switch, which
// the Trip page follows too (decision 29). localStorage can be missing or
// blocked: then the tram is shown.
export const TRAM_HIDDEN = 'tram-hidden';

export function tramHidden() {
    try { return localStorage.getItem(TRAM_HIDDEN) === '1'; } catch { return false; }
}
