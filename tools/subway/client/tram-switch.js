// Whether the tram is hidden on this device, or the suburban railway: the
// Subway page's switches, which the Trip page follows too (decisions 29 and
// 41). localStorage can be missing or blocked: then they're shown.
export const TRAM_HIDDEN = 'tram-hidden';
export const SUBURBAN_HIDDEN = 'suburban-hidden';

const hidden = key => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
};

export const tramHidden = () => hidden(TRAM_HIDDEN);
export const suburbanHidden = () => hidden(SUBURBAN_HIDDEN);
