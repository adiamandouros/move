const listeners = new Set();

export function getLanguage() {
    return localStorage.getItem('language') ?? 'en';
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
