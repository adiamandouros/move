// Google AdSense for the ad slots on this page (server/ads.js), and the
// "Change your ad choices" button on the privacy page. Google's script also
// shows its consent message in the EU. Offline, or with the script blocked,
// the slots are removed so they don't leave an empty box.

const units = [...document.querySelectorAll('ins.adsbygoogle')];
const choices = document.getElementById('ad-choices');
const client = units[0]?.dataset.adClient ?? choices?.dataset.adClient;

const removeSlots = () => document.querySelectorAll('.ad-slot').forEach(slot => slot.remove());

if (client && navigator.onLine) {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.addEventListener('error', removeSlots);
    // The button only makes sense once Google's script (and its consent tool) is here
    script.addEventListener('load', () => { if (choices) choices.hidden = false; });
    document.head.append(script);
    window.adsbygoogle = window.adsbygoogle || [];
    for (let i = 0; i < units.length; i++) window.adsbygoogle.push({});
} else {
    removeSlots();
}

// Reopen Google's consent message (its "revocation" message)
choices?.addEventListener('click', () => {
    window.googlefc = window.googlefc || {};
    window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
    window.googlefc.callbackQueue.push({
        CONSENT_DATA_READY: () => window.googlefc.showRevocationMessage?.(),
    });
});
