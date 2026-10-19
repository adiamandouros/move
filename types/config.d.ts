// The app's settings, as server/config.js reads them from the environment.
// Only for checking (npm run typecheck) and editor hints.

/** A setting that was given but can't be used: logged at startup, shown on /admin/diagnostics */
export interface ConfigProblem {
    /** What it's about, e.g. "AdSense", "Home relay fallback" */
    title: string;
    text: string;
    /** What happens meanwhile, or what to do */
    hint: string;
}

/** A relay to OASA (proxy/README.md) whose URL and key are both set */
export interface Relay {
    name: string;
    /** The settings' prefix, e.g. OASA_RELAY for OASA_RELAY_URL and OASA_RELAY_KEY */
    env: string;
    url: string;
    key: string;
}

export interface Config {
    port: string | number;
    /** The public origin without a trailing slash (https://wayhop.gr), or '' */
    siteUrl: string;
    contactEmail: string | null;
    /** What OASA, STASY and the data portal see us as */
    userAgent: string;
    /** '' turns the admin pages off */
    adminPassword: string;
    cspMode: 'report-only' | 'enforce';
    /** client is null while AdSense is off; slots by place (home, info, station) */
    adsense: { client: string | null; slots: Record<string, string> };
    relays: Relay[];
    problems: ConfigProblem[];
}
