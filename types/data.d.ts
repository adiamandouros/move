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
    /** The metro stations or other stops a short walk from here, and the minutes it takes (data/curated/tram.json); `exit`: the metro station's exit it uses, its place in the station's `exits` */
    walks?: { metro?: string; stop?: string; minutes: number; exit?: number }[];
}

export interface TramLine {
    name: string;
    /** #rrggbb ('' for the suburban railway's) */
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
    /** A suburban railway station, in the planner's network (withSuburban in tools/subway/client/network.js) */
    suburban?: boolean;
    /** A suburban railway station OASA's ticket doesn't cover (withSuburban) */
    oasaTicket?: false;
    /** A metro station's exits to the street with a place (data/curated/street.json), for the Trip page's walks (decision 51) */
    exits?: Exit[];
}

/** An exit to the street, as the Trip page walks to it (streetExits in server/data/build-rail.js) */
export interface Exit {
    /** As its sign says it, without "Exit" or "Έξοδος"; either language while the other isn't known; none: not known */
    name?: { el?: string; en?: string };
    /** [latitude, longitude] */
    at: [number, number];
    /** How it's reached from inside, when that's not every way: 'stairs', 'escalator-up' (toward the street), 'escalator-down' */
    way?: string[];
    /** The lines it serves, at a station that's two buildings (decision 73); none: every line there */
    lines?: string[];
}

export interface Line {
    name: string;
    /** #rrggbb */
    color: string;
    /** By direction id, e.g. "kifisia" */
    directions: Record<string, Direction>;
    /** A tram line, in the planner's network (withTram in tools/subway/client/network.js) */
    tram?: boolean;
    /** A suburban railway line, in the planner's network (withSuburban; its colour is the style sheet's, so '') */
    suburban?: boolean;
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
    /** One list of trips per distinct day: [start, profile index], and a suburban train's number (withSuburban in tools/subway/client/network.js) */
    patterns: ([number, number] | [number, number, string])[][];
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

/** data/build/bus-rides.json, built by server/data/build-rides.js from the buses the server saw pass: the days of passes used, and per OASA route and stretch (two stops), by kind of day and hour ('wd 8', Athens time), [rides, median seconds, slowest tenth's seconds] */
export interface BusRides {
    schema: number;
    from: string | null;
    to: string | null;
    days: number;
    rides: { route: string; line: string; from: string; to: string; times: Record<string, [number, number, number]> }[];
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

/** A train on railway.gov.gr's schedule board for a day (data/raw/railway/boards/, server/data/railway.js): what Wayhop reads of it */
export interface RailwaySchedule {
    /** e.g. "2539-20261126-0000", as the live stream names the train */
    scheduleNumber: string;
    trainNumber: string;
    /** 'Suburban' for the suburban railway's */
    serviceType: string;
    /** 'scheduled', 'cancelled'… */
    status: string;
    corridor: string;
    /** When it leaves its first stop (ISO), and its minutes late at the end, once the day is over */
    scheduledDeparture?: string;
    delay?: number | null;
    /** Its stops, in the order of `index`, with their times (ISO) */
    routeStations?: { stationId: string; index: number; name?: string; nameGreek?: string; scheduledArrival?: string | null; scheduledDeparture?: string | null }[];
}

/** data/build/trains.json, built by server/data/build-suburban.js: the suburban railway's trains by date, from railway.gov.gr (decision 41) */
export interface Trains {
    schema: number;
    /** suburban.json's lines: what each is called and its colour (#rrggbb), for the Info page's map */
    lines: Record<string, { name: string, color: string }>;
    /** By id in data/curated/suburban.json: [lat, lng, Greek name, English name] */
    stations: Record<string, [number, number, string, string]>;
    /** suburban.json's walks, as the trip search names its stops ('train:piraeus', 'rail:piraeus'): [from, to, seconds, note where the way needs one, the metro station's exit it goes through by its Greek name where one is said (decision 73)] */
    walks: ([string, string, number] | [string, string, number, Names] | [string, string, number, Names | null, string])[];
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
        /** [seconds from the date's midnight in Athens when it leaves its first stop (past 86,400 after midnight), profile index, the train's number on railway.gov.gr (decision 42; not in copies built before it)] */
        trips: [number, number, string?][];
    }[]>;
}

/** data/build/meta.json, written by server/data/index.js: when the data was built, and how each output went */
export interface BuildMeta {
    /** When the build ran (ISO) */
    generated: string;
    /** By file name: built (with its warnings; rail.json's nightly checks against STASY, server/data/rail-checks.js), or failed, the previous version kept or not */
    outputs?: Record<string, {
        ok: boolean;
        warnings?: string[];
        checks?: { problems: string[]; notes: string[] };
        error?: string;
        keptPrevious?: boolean;
    }>;
}

/** How far a fetch of the bus network got: done of total */
export interface FetchProgress {
    done: number;
    total: number;
}

/** data/raw/oasa/last-fetch.json, written by server/data/oasa-network.js: the last fetch of the bus network from OASA, when it began and how long it took; finished, or stopped with how far it got (the lines' routes first, then the routes' stops) */
export type NetworkFetch = { at: string; seconds: number; requests?: number }
    & ({ ok: true; lines: FetchProgress; stops: FetchProgress } | { ok: false; error: string; lines?: FetchProgress; stops?: FetchProgress });

/** data/raw/stasy/last-fetch.json, written by server/data/stasy.js: the last fetch of STASY's timetables, and the route it came through; `unreadable`: fetched, but STASY's pages changed so they couldn't be read */
export type StasyFetch = { at: string }
    & ({ ok: true; route: string; error?: undefined; unreadable?: undefined } | { ok: false; error: string; unreadable?: true; route?: string });

/** data/raw/stasy/airport-check.json, written by server/data/airport-check.js: the last check of STASY's airport timetable against data/curated/airport.json (`against`: a hash of its PDFs), what it found changed and the route it came through; or a check that failed, with the last one that didn't if there was one */
export type AirportCheck = { at: string; checked: string; against: string; changes: string[]; route: string | null; error?: undefined }
    | { at: string; error: string; checked: string; against: string; changes: string[]; route?: undefined }
    | { at: string; error: string; checked?: undefined; against?: undefined; changes?: undefined; route?: undefined };

/** data/raw/railway/last-fetch.json, written by server/data/railway.js: the last fetch of railway.gov.gr's boards, for the Athens day `today` ('YYYYMMDD'), how far it got, and when the last one that went through began (ISO, null for none) */
export interface RailwayFetch {
    at: string;
    today: string;
    ok: boolean;
    seconds: number;
    boards: FetchProgress;
    fetched: string | null;
    error?: string;
}

// ── The curated files (data/curated/), as server/data/validate.js checks them ──

/** data/curated/stations.json: the metro's stations by id, with their GTFS stop codes and how STASY writes a name where it differs; `ignoreGtfs`: stop codes left out */
export interface CuratedStations {
    stations: Record<string, { name: Names; gtfs: string[]; stasy?: string[] }>;
    ignoreGtfs?: string[];
}

/** A direction of a curated line: the GTFS's direction_id for it, and where it goes */
export interface CuratedDirection {
    gtfsDirection: string;
    toward: Names;
}

/** data/curated/lines.json: the metro's lines by id */
export type CuratedLines = Record<string, { name: string; color: string; directions: Record<string, CuratedDirection> }>;

/** A platform's elevator: where on the train, and its name as STASY's lift page writes it */
export interface CuratedElevator {
    at: Position;
    name?: string;
}

/** A platform's way to the other side of the tracks: where to stand for it, over a footbridge or through an underpass, how it's reached */
export interface Crossing {
    at?: Position[];
    via?: string;
    way?: string[];
}

/** A platform in positions.json: where to ride for its exits and more; elevators 'none' when it has none (absent: not known yet) */
export interface CuratedPlatform {
    exits?: Position[];
    elevators?: CuratedElevator[] | 'none';
    escalators?: Position[];
    stairs?: Position[];
    centralPlatform?: boolean;
    stepFree?: StepFree;
    transfers?: Record<string, Position[]>;
    crossing?: Crossing;
    note?: string;
}

/** data/curated/positions.json: by line, direction and station */
export type CuratedPositions = Record<string, Record<string, Record<string, CuratedPlatform>>>;

/** A station's exit to the street (street.json): its name as signed, where it is, how it's reached from inside */
export interface StreetExit {
    name?: { el?: string; en?: string };
    coords?: [number, number];
    way?: string[];
    lines?: string[];
}

/** data/curated/street.json: each station's exits and lifts on the street, and OpenStreetMap's exits there the field trips have dealt with */
export type CuratedStreet = Record<string, { exits?: StreetExit[]; lifts?: { name?: string; coords?: [number, number] }[]; osm?: string[] }>;

/** data/curated/osm.json (scripts/osm-exits.js): OpenStreetMap's exits at the metro's stations; `only`: an exit one way only */
export interface CuratedOsm {
    fetched: string;
    exits: Record<string, { ids: string[]; name?: Names; coords: [number, number]; only?: 'in' | 'out' }[]>;
}

/** data/curated/airport.json: STASY's airport trains by line and direction, each train's times at `stations` (HH:MM), and the PDF they came from */
export interface CuratedAirport {
    checked: string;
    page: string;
    lines: Record<string, Record<string, { pdf: string; sha256: string; serves: string; stations: string[]; trains: { train?: string; times: string[] }[] }>>;
}

/** data/curated/tram.json: the tram's lines, and its stops with the metro station each changes to and the walks from it */
export interface CuratedTram {
    lines: CuratedLines;
    stops: Record<string, { name: Names; gtfs: string[]; metro?: string; walks?: { metro?: string; stop?: string; minutes: number; exit?: string }[] }>;
}

/** A suburban railway station (suburban.json, decision 41) */
export interface SuburbanStation {
    name: Names;
    ose: string[];
    lines?: string[];
    coords: [number, number];
    metro?: string;
    walks?: { metro?: string; station?: string; minutes: number; note?: Names; exit?: string }[];
    oasaTicket?: false;
}

/** data/curated/suburban.json: the suburban railway's lines (each a corridor's trains, or with `stopsAt` those stopping there) and stations */
export interface CuratedSuburban {
    lines: Record<string, { name: string; color: string; corridor: string; stopsAt?: string }>;
    stations: Record<string, SuburbanStation>;
}

/** Every curated file, as loadCurated reads them (server/data/index.js); the optional ones can be missing */
export interface Curated {
    stations: CuratedStations;
    lines: CuratedLines;
    positions: CuratedPositions;
    airport?: CuratedAirport;
    tram?: CuratedTram;
    street?: CuratedStreet;
    suburban?: CuratedSuburban;
    osm?: CuratedOsm;
}
