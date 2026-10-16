const listeners = new Set();

// The saved choice, or else the page's own language (Greek under /el)
export function getLanguage() {
    return localStorage.getItem('language') ?? document.documentElement.dataset.pageLang ?? 'en';
}

export function setLanguage(lang) {
    localStorage.setItem('language', lang);
    document.documentElement.lang = lang;
    [...listeners].forEach(fn => fn(lang));
}

export function onLanguageChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}
