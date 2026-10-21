// Where each stop sits on the schematic tram map, in grid units (x to the
// right, y down; Neo Faliro is 0,0), in map-layout.js's format: lines run
// horizontally, vertically or at 45°, and only meet at stops they share;
// test/map-layouts.test.js checks both. The coast runs down the middle, T6
// comes down Syggrou Avenue on the right, and T7's one-way loop through
// Piraeus is on the top left (out along its upper side, back along the lower).
//
// Each entry is [x, y, label side]. The side is a compass direction from the
// stop: n, s, e, w, ne, nw, se or sw.

export const STATIONS = {
    // T7: the Piraeus loop
    'akti-poseidonos':      [-6, -6, 'w'],
    'agia-triada':          [-5, -6, 'ne'],
    'plateia-ippodameias':  [-4, -5, 'ne'],
    '34ou-syntagmatos':     [-3, -4, 'ne'],
    'androutsou':           [-2, -3, 'ne'],
    'skylitsi':             [-1, -2, 'ne'],
    'sef':                  [0, -1, 'e'],
    'gipedo-karaiskaki':    [-1, 0, 'sw'],
    'mikras-asias':         [-2, -1, 'sw'],
    'lampraki':             [-3, -2, 'sw'],
    'evangelistria':        [-4, -3, 'sw'],
    'plateia-deligianni':   [-5, -4, 'sw'],
    'dimarcheio':           [-6, -5, 'w'],

    // T7: along the coast
    'neo-faliro':           [0, 0, 'e'],
    'moschato':             [0, 1, 'w'],
    'kallithea':            [0, 2, 'w'],
    'tzitzifies':           [0, 3, 'w'],
    'delta-falirou':        [0, 4, 'w'],
    'agia-skepi':           [0, 5, 'w'],
    'trokantero':           [0, 6, 'w'],
    'parko-floisvou':       [0, 7, 'w'],
    'floisvos':             [0, 8, 'w'],
    'batis':                [0, 9, 'w'],
    'edem':                 [0, 10, 'w'],
    'pikrodafni':           [0, 11, 'w'],
    'marina-alimou':        [0, 12, 'w'],
    'kalamaki':             [0, 13, 'w'],
    'zefyros':              [0, 14, 'w'],
    'loutra-alimou':        [0, 15, 'w'],
    'elliniko':             [0, 16, 'w'],
    '1i-agiou-kosma':       [1, 17, 'sw'],
    '2i-agiou-kosma':       [2, 18, 'sw'],
    'agios-alexandros':     [3, 19, 'sw'],
    'ellinon-olympionikon': [4, 20, 'sw'],
    'kentro-istioploias':   [5, 21, 'sw'],
    'plateia-vergoti':      [6, 22, 'sw'],
    'paralia-glyfadas':     [7, 23, 'sw'],
    'palaio-dimarcheio':    [8, 24, 'sw'],
    'plateia-katraki':      [9, 25, 'sw'],
    'angelou-metaxa':       [10, 26, 'sw'],
    'plateia-esperidon':    [11, 27, 'sw'],
    'kolymvitirio':         [11, 28, 'w'],
    'asklipieio-voulas':    [11, 29, 'w'],

    // T6: Syntagma down to the coast
    'syntagma':             [3, -7, 'e'],
    'zappeio':              [3, -6, 'e'],
    'vouliagmenis':         [3, -5, 'e'],
    'fix':                  [3, -4, 'e'],
    'kasomouli':            [3, -3, 'e'],
    'neos-kosmos':          [3, -2, 'e'],
    'baknana':              [3, -1, 'e'],
    'aigaiou':              [3, 0, 'e'],
    'agia-fotini':          [3, 1, 'e'],
    'megalou-alexandrou':   [3, 2, 'e'],
    'agia-paraskevi':       [3, 3, 'e'],
    'mideias-mykalis':      [3, 4, 'e'],
    'evangeliki-scholi':    [3, 5, 'e'],
    'achilleos':            [3, 6, 'e'],
    'amfitheas':            [3, 7, 'e'],
    'panagitsa':            [2, 8, 'e'],
    'mousson':              [1, 9, 'e'],
};

// Corners between two neighbouring stops, keyed "a>b" in either order
export const BENDS = {};

// Where the metro stubs point from a stop that changes to the metro
export const STUBS = {
    'akti-poseidonos': 'nw',
    'dimarcheio': 'sw',
    'neo-faliro': 'se',
    'syntagma': 'w',
    'fix': 'w',
    'neos-kosmos': 'w',
};

// Line badges near the ends of each line (both lines are the same green)
export const BADGES = {
    T6: [[3, -8], [1, 11]],
    T7: [[-6, -7.3], [11, 30.2]],
};
