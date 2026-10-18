// What the pages' scripts use from the browser beyond the standard DOM.
// Only for checking (npm run typecheck) and editor hints.

export {};

declare global {
    interface Window {
        /** Bootstrap's JavaScript (bootstrap.min.js, loaded before the page's scripts) */
        bootstrap: { Toast: { getOrCreateInstance(el: Element, options?: { delay?: number }): { show(): void } } };
        /** Google AdSense's queue of ad slots to fill (core/ads.js) */
        adsbygoogle?: object[];
        /** Google's consent message (Funding Choices), when ads are on */
        googlefc?: { callbackQueue?: Array<Record<string, () => void> | (() => void)>; showRevocationMessage?: () => void };
    }
    interface Navigator {
        /** iPhones: true when opened from the home screen */
        standalone?: boolean;
    }
}
