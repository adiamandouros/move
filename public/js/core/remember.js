// The tools open where they were left. Each tool's choices are in its address
// (Subway's stations, the bus stop or line shown); its last one is kept for
// this tab or app session, and the links to a tool (the navigation and the
// home tiles, a[data-tool]) go back to it. The link to the page you're on
// starts the tool over.

// sessionStorage can be missing or blocked (private windows, some settings)
const storage = {
    get: key => { try { return sessionStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* not kept: the tool starts over */ } },
    remove: key => { try { sessionStorage.removeItem(key); } catch { /* nothing kept */ } },
};

const key = tool => `view:${tool}`;

// Keep a tool's choices, as its address's query ('?from=a&to=b'); none
// ('' or '?') forgets them
export function remember(tool, search) {
    const query = search.replace(/^\?/, '');
    if (query) storage.set(key(tool), `?${query}`);
    else storage.remove(key(tool));
}

// Where a link to a tool goes: the tool as it was left, or as it starts
export function rememberedHref(tool, path) {
    return path + (storage.get(key(tool)) ?? '');
}

// Point the links to the tools at what's kept, except the one to this page.
// Run on load and when the browser brings a page back (Back, pageshow).
export function restoreLinks() {
    /** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll('a[data-tool]')).forEach(link => {
        link.href = link.pathname === location.pathname ? link.pathname : rememberedHref(link.dataset.tool, link.pathname);
    });
}
