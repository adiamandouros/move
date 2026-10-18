// The home page's "Get the Wayhop app" card (server/views/home.html). It only
// shows where installing is possible and the app isn't installed yet:
//   - Chrome, Edge, Samsung Internet (Android, desktop): the browser offers
//     to install through beforeinstallprompt, and the button opens it
//   - iPhone and iPad: there's no such event, so the card says how (Share,
//     then "Add to Home Screen")
// "Not now" hides it for good on this device.

const DISMISSED_KEY = 'install-dismissed';

const card = document.getElementById('install');
const button = document.getElementById('install-btn');
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isApple = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let dismissed = null;
try { dismissed = localStorage.getItem(DISMISSED_KEY); } catch { /* storage blocked: offer it */ }
let offer = null;

if (card && !installed && !dismissed) {
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        offer = event;
        button.hidden = false;
        card.hidden = false;
    });

    button.addEventListener('click', async () => {
        if (!offer) return;
        offer.prompt();
        await offer.userChoice;
        // Installed or not, this offer is used up; the browser may make another later
        offer = null;
        card.hidden = true;
    });

    window.addEventListener('appinstalled', () => { card.hidden = true; });

    if (isApple) {
        document.getElementById('install-ios').hidden = false;
        card.hidden = false;
    }

    document.getElementById('install-close').addEventListener('click', () => {
        card.hidden = true;
        try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* just this page */ }
        document.getElementById('app-content').focus();
    });
}
