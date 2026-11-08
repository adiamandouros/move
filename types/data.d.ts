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
    /** The dates the weekly timetable was taken from, as YYYY-MM-DD */
    feed: { validFrom: string; validTo: string; week: Record<string, string> };
    /** The copy of STASY's first and last trains the stops' `hours` come from (YYYY-MM-DD); absent when none do */
    hours?: { fetched: string };
    positions: Position[];
    /** By station id, e.g. "syntagma" */
    stations: Record<string, Station>;
    /** By line id, e.g. "M1" */
    lines: Record<string, Line>;
    /** The tram network, for its map and the planner (server/data/build-tram.js); absent when it couldn't be built */
    tram?: Tram;
}

/** rail.json's `tram`: the shape of its metro part, without car positions */
export interface Tram {
    /** By stop id, e.g. "neo-faliro" */
    stations: Record<string, TramStop>;
    /** By line id, e.g. "T7" */
    lines: Record<string, TramLine>;
}

export interface TramStop extends Station {
    /** The metro station this stop changes to, and its lines */
    metro?: { station: string; lines: string[] };
    /** The metro stations or other stops a short walk from here, and the minutes it takes (data/curated/tram.json) */
    walks?: { metro?: string; stop?: string; minutes: number }[];
}

export interface TramLine {
    name: string;
    /** #rrggbb */
    color: string;
    /** By direction id, e.g. "voula"; the directions may call at different stops (T7's Piraeus loop) */
    directions: Record<string, { toward: Names; stops: { station: string }[]; timetable: Timetable }>;
}

export interface Station {
    name: Names;
    /** [latitude, longitude] */
    coords: [number, number];
    /** Line ids */
    lines: string[];
    /** A tram stop, in the planner's network (withTram in tools/subway/client/network.js) */
    tram?: boolean;
}

export interface Line {
    name: string;
    /** #rrggbb */
    color: string;
    /** By direction id, e.g. "kifisia" */
    directions: Record<string, Direction>;
    /** A tram line, in the planner's network (withTram in tools/subway/client/network.js) */
    tram?: boolean;
}

export interface Direction {
    toward: Names;
    /** In travel order */
    stops: Stop[];
    timetable: Timetable;
}

/** By elevator, by ramp, on the level, step-free without saying how, or not step-free */
export type StepFree = 'lift' | 'ramp' | 'level' | 'yes' | 'no';

/** A stop on a direction, with where to ride for arriving there (data/curated/positions.json) */
export interface Stop {
    /** Station id */
    station: string;
    exits: Position[];
    elevators?: Position[];
    /** The cars nearest an escalator up, and nearest stairs: how the exit is reached, when recorded */
    escalators?: Position[];
    stairs?: Position[];
    centralPlatform?: boolean;
    /** How this platform is reached from the street without steps (server/data/validate.js); absent: not known yet */
    stepFree?: StepFree;
    /** "<line>/<direction>" → where to ride for that connection */
    transfers?: Record<string, Position[]>;
    note?: string;
    /** STASY's first and last trains from here, by where they go (server/data/stasy.js); absent: use the timetable's */
    hours?: Hours[];
}

/**
 * First and last trains from a stop to `to` (a station further on), counting
 * every train that goes at least that far. A value for each weekday (0 =
 * Sunday): seconds since that day's midnight (more than 86400 after
 * midnight), or null when the trains run all night.
 */
export interface Hours {
    to: string;
    first: (number | null)[];
    last: (number | null)[];
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
    /** Pattern index for each weekday, 0 = Sunday: one typical week, for any date */
    days: number[];
    /** Pattern index for the dates ('YYYY-MM-DD') whose trains aren't their weekday's (a holiday), from the feed */
    dates?: Record<string, number>;
}

/** data/build/bus-stops.json, built by server/data/build-bus.js from OASA's live API: one compact row per stop */
export interface BusStops {
    schema: number;
    /** The order of each row's fields: ['code', 'lat', 'lng', 'el', 'en', 'lines'] */
    fields: string[];
    /** [code, lat, lng, Greek name, English name ('' where it's the Greek in Latin letters: latinName), line numbers] */
    stops: [string, number, number, string, string, string[]][];
}

/** data/build/bus-lines.json, built by server/data/build-bus.js from OASA's live API: each line's stops in order */
export interface BusLines {
    schema: number;
    /** Sorted by line number. One or two directions (a circular line has one) */
    lines: {
        line: string;
        name: Names;
        /** `to`: where it goes; `route`: the OASA route its stops are from; `stops`: codes in bus-stops.json, in order */
        directions: { to: Names; route: string; stops: string[] }[];
    }[];
}

/** data/build/buses.json, built by server/data/bus-timetable.js: OASA's bus timetable of August 2026 on today's routes, for the trip search */
export interface Buses {
    schema: number;
    /** When OASA published the timetable, and the dates it was for (YYYY-MM-DD): it stopped in August 2026 */
    feed: { modified: string; validFrom: string; validTo: string };
    /** [code, lat, lng, Greek name, English name ('' where it's the Greek in Latin letters: latinName)] */
    stops: [string, number, number, string, string][];
    routes: {
        line: string;
        mode: 'bus' | 'trolley';
        /** The OASA route, as live arrivals and bus-rides.json name it */
        code: string;
        /** Indexes into `stops`, in order */
        stops: number[];
        /** Ways of running the route: the seconds from each stop to the next, to the 10 s */
        runs: number[][];
        /** One list of trips per distinct day: [seconds after the trip before it (the first, after midnight), run index] */
        patterns: [number, number][][];
        /** Pattern index for each weekday, 0 = Sunday */
        days: number[];
    }[];
}

/** data/build/trains.json, built by server/data/build-suburban.js: the suburban railway's trains by date, from railway.gov.gr (decision 40) */
export interface Trains {
    schema: number;
    /** By id in data/curated/suburban.json: [lat, lng, Greek name, English name] */
    stations: Record<string, [number, number, string, string]>;
    /** suburban.json's walks, as the trip search names its stops ('train:piraeus', 'rail:piraeus'): [from, to, seconds, note where the way needs one] */
    walks: ([string, string, number] | [string, string, number, Names])[];
    /** The stations OASA's ticket doesn't cover: a Hellenic Train ticket */
    outside: string[];
    /** By date (YYYY-MM-DD): yesterday's, today's and the next days' trains, as many as were fetched */
    dates: Record<string, {
        /** The line in suburban.json ('A1'), from the train's corridor and stops */
        line: string;
        /** Station ids, in order */
        stops: string[];
        /** Ways of running these stops: the seconds from the first stop to each */
        profiles: number[][];
        /** [seconds from the date's midnight in Athens when it leaves its first stop (past 86,400 after midnight), profile index] */
        trips: [number, number][];
    }[]>;
}
