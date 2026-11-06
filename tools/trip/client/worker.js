import { searcher } from './searcher.js';

// The Trip page's searches with a bus, in the background (searcher.js). The
// page starts it with its version (main.js); its imports have none, as the
// page's import map doesn't reach a worker, so the service worker fetches
// them from the server first (sw.js).

const handle = searcher({
    loadBuses: async () => {
        const response = await fetch('/data/buses.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    },
    post: message => postMessage(message),
});

addEventListener('message', event => handle(event.data));
