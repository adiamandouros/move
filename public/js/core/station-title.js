// A station page's title (server/views/stations/station.hbs): the station's
// sign, and its star at the far right of the same line. When both don't fit,
// the star drops its word; when even that doesn't fit, it goes under the
// sign, centred, with its word again. Measured, as names differ in length.

/** @param {HTMLElement} title @param {HTMLElement} star */
function fit(title, star) {
    // Shown by /js/core/favourites.js
    if (star.hidden) return;
    // Alone, its word is for screen readers only
    const word = star.querySelector('span');
    const alone = on => { title.classList.toggle('star-alone', on); word?.classList.toggle('sr-only', on); };
    title.classList.remove('star-below');
    alone(false);
    // The sign on one line, as wide as it wants
    title.classList.add('measuring');
    const width = el => el.getBoundingClientRect().width;
    const room = width(title);
    const sign = width(title.querySelector('h1')) + (parseFloat(getComputedStyle(title).columnGap) || 0);
    const full = width(star);
    alone(true);
    const small = width(star);
    alone(false);
    title.classList.remove('measuring');
    if (sign + full <= room) return;
    if (sign + small <= room) alone(true);
    else title.classList.add('star-below');
}

// Run once per page (shell.js): only station pages have one
export function fitStationTitle() {
    const title = /** @type {HTMLElement | null} */ (document.querySelector('.station-title'));
    const star = /** @type {HTMLElement | null} */ (title?.querySelector('.favourite-btn'));
    if (!title || !star) return;
    // The page's width, the text size, and the star being shown. On the next
    // frame: fitting resizes the star, which would set the observer off again
    // inside its own callback (WebKit reports that as an error)
    const observer = new ResizeObserver(() => requestAnimationFrame(() => fit(title, star)));
    observer.observe(title);
    observer.observe(star);
    document.fonts?.ready.then(() => fit(title, star));
}
