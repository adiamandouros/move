// The pages every-page specs visit (pages.spec.js, text-size.spec.js): each
// page in the registry, plus the states of a page that draw something else.
// New pages in the registry are picked up by themselves.
import { loadTools, sitePages } from '../../server/pages/registry.js';

export const PAGES = [
    ...sitePages(loadTools()).map(p => p.path),
    '/subway?from=kifisia&to=airport',
    '/buses?stop=10341',
    '/buses?line=040',
    '/subway/stations',
    '/subway/stations/omonia',
    // STASY's first and last trains, with the airport ones under the table
    '/subway/stations/dimotiko-theatro',
    '/nope',
];

// What to wait for before checking a page whose content comes from its scripts
export const READY = {
    '/buses': '.stop-item .arrival-badge',
    '/info': '#sec-announcements li',
    '/subway?from=kifisia&to=airport': '.result-card',
    '/buses?stop=10341': '.stop-item .arrival-row',
    '/buses?line=040': '.stop-item .stop-toggle',
};

export const greek = path => path === '/' ? '/el' : `/el${path}`;

// Each page in both languages, as [path, lang, url]
export const EVERY_PAGE = PAGES.flatMap(path => [[path, 'en', path], [path, 'el', greek(path)]]);
