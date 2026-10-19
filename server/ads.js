// Google AdSense. Everything here is off until the .env settings exist
// (read and checked in server/config.js):
//   ADSENSE_CLIENT=ca-pub-…        the verification tag on every page, /ads.txt,
//                                  and the ads version of the privacy page
//   ADSENSE_SLOT_<PLACE>=<number>  an ad unit at that place: HOME (below the
//                                  announcements), INFO (end of the info page)
//                                  and STATION (end of the station pages)
// Slots sit after the page's content, never inside live arrivals or route
// results, at a fixed size so nothing moves when the ad loads.
// /js/core/ads.js loads Google's script, which also shows Google's consent
// message to visitors in the EU (set up in AdSense → Privacy & messaging).

/** @typedef {import('../types/config.js').Config['adsense']} AdSense */

// Tells AdSense which account the site belongs to (its site review checks for it)
/** @param {AdSense} adsense */
export const adsenseMeta = adsense => adsense.client ? `    <meta name="google-adsense-account" content="${adsense.client}">` : '';

// The ad unit for a place, or '' when that place has no slot
/** @param {AdSense} adsense @param {string | null} place */
export function adSlot(adsense, place) {
    const id = place && adsense.slots[place];
    if (!id) return '';
    return `
            <aside class="ad-slot" aria-labelledby="ad-label">
                <p class="ad-label" id="ad-label" data-i18n="ads.label">Advertisement</p>
                <ins class="adsbygoogle ad-unit" data-ad-client="${adsense.client}" data-ad-slot="${id}"></ins>
            </aside>`;
}

// /ads.txt: Google is allowed to sell this site's ad space (null when off)
/** @param {AdSense} adsense */
export function adsTxt(adsense) {
    return adsense.client ? `google.com, ${adsense.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : null;
}
