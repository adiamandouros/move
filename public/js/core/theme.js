// The colour mode. Auto (the default) follows the phone, but light only when
// the phone asks for it: whoever has no preference, or a browser that can't
// say, gets dark. Light and Dark are a person's own choice, remembered on
// this device. <html data-bs-theme> says which one is showing (style.css).

export const CHOICES = ['auto', 'light', 'dark'];
const KEY = 'theme';

// The browser's bar and the phone's status bar: the colour of the navigation
// (--bs-tertiary-bg of each mode; test/theme.test.js checks)
export const BAR_COLOURS = { dark: '#161b27', light: '#ffffff' };

/** @param {string | null} choice @param {boolean} phoneAsksLight */
export const resolveTheme = (choice, phoneAsksLight) =>
    choice === 'light' || (choice !== 'dark' && phoneAsksLight) ? 'light' : 'dark';

// Run in <head> before the page is drawn, so it never flashes the wrong mode
// (layout.hbs); the same as applyTheme below, in the fewest words
export const FIRST_PAINT_SCRIPT = `try{var l=(${resolveTheme})(localStorage.getItem('${KEY}'),matchMedia('(prefers-color-scheme: light)').matches)==='light';document.documentElement.dataset.bsTheme=l?'light':'dark';document.querySelector('meta[name=theme-color]').content=l?'${BAR_COLOURS.light}':'${BAR_COLOURS.dark}'}catch(e){}`;

const storage = {
    get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    set: choice => { try { choice === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch { /* storage blocked: just this page */ } },
};

const phone = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
const chosen = () => CHOICES.includes(storage.get()) ? storage.get() : 'auto';

// Show the mode for a choice: the page, the bar and the switches
function applyTheme(choice) {
    const theme = resolveTheme(choice, Boolean(phone?.matches));
    document.documentElement.dataset.bsTheme = theme;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', BAR_COLOURS[theme]);
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-theme-choice') === choice));
    }
}

// The switches (in the menu and the sidebar) are hidden until this runs
export function startTheme() {
    // What's chosen is also kept here, for a browser that won't keep it
    let current = chosen();
    applyTheme(current);
    for (const group of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.theme-switch'))) group.hidden = false;
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
        button.addEventListener('click', () => {
            current = button.getAttribute('data-theme-choice');
            storage.set(current);
            applyTheme(current);
        });
    }
    // Auto follows the phone while the page is open (sunset, a setting)
    phone?.addEventListener('change', () => applyTheme(current));
}
