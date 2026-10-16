// Google AdSense. Everything here is off until the .env settings exist:
//   ADSENSE_CLIENT=ca-pub-…        the verification tag on every page, /ads.txt,
//                                  and the ads version of the privacy page
//   ADSENSE_SLOT_<PLACE>=<number>  an ad unit at that place: HOME (below the
//                                  announcements), INFO (end of the info page)
//                                  and STATION (end of the station pages)
// Slots sit after the page's content, never inside live arrivals or route
// results, at a fixed size so nothing moves when the ad loads.
// /js/core/ads.js loads Google's script, which also shows Google's consent
// message to visitors in the EU (set up in AdSense → Privacy & messaging).

const CLIENT = /^ca-pub-\d{16}$/;
const SLOT = /^\d{6,12}$/;

export function adsenseClient() {
    const client = process.env.ADSENSE_CLIENT?.trim();
    return client && CLIENT.test(client) ? client : null;
}

const slotId = place => {
    const id = process.env[`ADSENSE_SLOT_${place.toUpperCase()}`]?.trim();
    return adsenseClient() && id && SLOT.test(id) ? id : null;
};

// Tells AdSense which account the site belongs to (its site review checks for it)
export const adsenseMeta = () => adsenseClient() ? `    <meta name="google-adsense-account" content="${adsenseClient()}">` : '';

// The ad unit for a place, or '' when that place has no slot
export function adSlot(place) {
    const id = place && slotId(place);
    if (!id) return '';
    return `
            <aside class="ad-slot" aria-labelledby="ad-label">
                <p class="ad-label" id="ad-label" data-i18n="ads.label">Advertisement</p>
                <ins class="adsbygoogle ad-unit" data-ad-client="${adsenseClient()}" data-ad-slot="${id}"></ins>
            </aside>`;
}

// /ads.txt: Google is allowed to sell this site's ad space (null when off)
export function adsTxt() {
    const client = adsenseClient();
    return client ? `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : null;
}

// Settings that were given but can't be used, for a warning at startup
export function adsenseProblems(env = process.env) {
    const problems = [];
    if (env.ADSENSE_CLIENT && !CLIENT.test(env.ADSENSE_CLIENT.trim())) problems.push('ADSENSE_CLIENT should look like ca-pub-1234567890123456');
    for (const [key, value] of Object.entries(env)) {
        if (!key.startsWith('ADSENSE_SLOT_') || !value) continue;
        if (!SLOT.test(value.trim())) problems.push(`${key} should be the ad unit's number (data-ad-slot)`);
        else if (!CLIENT.test(env.ADSENSE_CLIENT?.trim() ?? '')) problems.push(`${key} needs ADSENSE_CLIENT too`);
    }
    return problems;
}
