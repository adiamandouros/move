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

// The ad unit for a place ({ client, slot }, drawn by the layout,
// server/views/layout.hbs), or null when that place has no slot
/** @param {AdSense} adsense @param {string | null} place @returns {{ client: string, slot: string } | null} */
export function adUnit(adsense, place) {
    const slot = place && adsense.slots[place];
    return slot ? { client: adsense.client, slot } : null;
}

// /ads.txt: Google is allowed to sell this site's ad space (null when off)
/** @param {AdSense} adsense */
export function adsTxt(adsense) {
    return adsense.client ? `google.com, ${adsense.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : null;
}
