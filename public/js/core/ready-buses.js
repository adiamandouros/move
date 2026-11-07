// The Trip page's bus timetable (/data/buses.json, decision 39), fetched in
// the background once a page has loaded, so it's kept (by the service worker,
// or the browser before that's installed) by the time someone plans a trip.
// Loaded by Home, Subway, Buses and the station pages, not by the pages people
// only read (Info, About, Terms, Contact, Privacy); the Trip page loads it
// itself. Not when the browser asks to save data, nor offline. It changes
// once a night, so most visits only ask whether it has.

const BUSES = '/data/buses.json';
// Waited for at most, for the page to be idle
const IDLE_MS = 5_000;

// Read to the end, so the browser keeps it
const fetchBuses = () => {
    if (!navigator.onLine) return;
    fetch(BUSES).then(response => response.blob()).catch(() => { /* the Trip page loads it itself */ });
};

if (!navigator.connection?.saveData) {
    const whenIdle = () => (window.requestIdleCallback ? requestIdleCallback(fetchBuses, { timeout: IDLE_MS }) : setTimeout(fetchBuses, IDLE_MS));
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle, { once: true });
}
