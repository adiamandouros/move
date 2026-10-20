// The data files the server builds (server/data/) and the browser and the
// station pages read. Only for checking (npm run typecheck) and editor hints:
// nothing here is loaded when the app runs. Use them in JSDoc, e.g.
//   /** @param {import('../../types/data.js').Rail} rail */

/** A text in English and Greek */
export interface Names {
    el: string;
    en: string;
}

/** Part of the train, back to front (rail.json's `positions`) */
export type Position = 'back' | 'center-back' | 'center' | 'center-front' | 'front';

/** data/build/rail.json, built by server/data/build-rail.js: everything the subway page needs */
export interface Rail {
    schema: number;
    generated: string;
    /** The dates the weekly timetable was taken from, as YYYY-MM-DD */
    feed: { validFrom: string; validTo: string; week: Record<string, string> };
    positions: Position[];
    /** By station id, e.g. "syntagma" */
    stations: Record<string, Station>;
    /** By line id, e.g. "M1" */
    lines: Record<string, Line>;
}

export interface Station {
    name: Names;
    /** [latitude, longitude] */
    coords: [number, number];
    /** Line ids */
    lines: string[];
}

export interface Line {
    name: string;
    /** #rrggbb */
    color: string;
    /** By direction id, e.g. "kifisia" */
    directions: Record<string, Direction>;
}

export interface Direction {
    toward: Names;
    /** In travel order */
    stops: Stop[];
    timetable: Timetable;
}

/** A stop on a direction, with where to ride for arriving there (data/curated/positions.json) */
export interface Stop {
    /** Station id */
    station: string;
    exits: Position[];
    elevators?: Position[];
    centralPlatform?: boolean;
    /** "<line>/<direction>" → where to ride for that connection */
    transfers?: Record<string, Position[]>;
    note?: string;
}

/**
 * A trip leaves its first stop at `start` seconds after midnight (more than
 * 86400 after midnight) and reaches stops[profile.stops[i]] at start + offsets[i].
 */
export interface Timetable {
    /** Run-time profiles shared by trips: indexes into `stops`, and seconds from the first of them */
    profiles: { stops: number[]; offsets: number[] }[];
    /** One list of trips per distinct day: [start, profile index] */
    patterns: [number, number][][];
    /** Pattern index for each weekday, 0 = Sunday */
    days: number[];
}

/** data/build/bus-stops.json, built by server/data/build-bus.js from OASA's live API: one compact row per stop */
export interface BusStops {
    schema: number;
    /** When the network was fetched from OASA (ISO time) */
    fetched: string;
    /** The order of each row's fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'] */
    fields: string[];
    /** [code, lat, lng, Greek name, English name (may be empty), line numbers] */
    stops: [string, number, number, string, string, string[]][];
}

/** data/build/bus-lines.json, built by server/data/build-bus.js from OASA's live API: each line's stops in order */
export interface BusLines {
    schema: number;
    /** When the network was fetched from OASA (ISO time) */
    fetched: string;
    /** Sorted by line number. One or two directions (a circular line has one) */
    lines: {
        line: string;
        name: Names;
        /** `to`: where it goes; `stops`: codes in bus-stops.json, in order */
        directions: { to: Names; stops: string[] }[];
    }[];
}
