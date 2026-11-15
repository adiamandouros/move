// Where each station sits on the schematic suburban railway map, in grid
// units (x to the right, y down; Athens is 0,0), in map-layout.js's format:
// lines run horizontally, vertically or at 45°, and only meet at stations
// they share (but CROSSINGS); test/map-layouts.test.js checks both. Only the
// city's stations and the Airport are drawn (decision 54): A3 and A4 go on
// past SKA and Magoula, as BEYOND says. Piraeus is on the bottom left, the
// lines go north through Agioi Anargyroi, A4 off west to Ano Liosia, and A1
// and A2 north-east from Metamorfosi, then down to the Airport.
//
// Each entry is [x, y, label side]. The side is a compass direction from the
// station: n, s, e, w, ne, nw, se or sw; null for none (SKA's A3 station is
// named by the A2 one beside it).

export const STATIONS = {
    // A1 and A4 from Piraeus
    'piraeus':              [-5, 5, 's'],
    'lefka':                [-4, 4, 'se'],
    'rentis':               [-3, 3, 'se'],
    'tavros':               [-2, 2, 'se'],
    'rouf':                 [-1, 1, 'se'],
    'athens':               [0, 0, 'e'],
    'agioi-anargyroi':      [0, -2, 'e'],
    'pyrgos-vasilissis':    [-1, -3, 'w'],
    'kato-acharnai':        [-1, -4, 'w'],

    // A4 west, then on to Kiato
    'zefyri':               [-2, -5, 'w'],
    'ano-liosia':           [-3, -6, 'sw'],
    'aspropyrgos':          [-4.5, -6, 'n'],
    'magoula':              [-6.5, -6, 's'],

    // A2 and A3 at SKA, a footbridge apart; A3 goes on to Chalkida
    'ska':                  [-0.5, -7, 'nw'],
    'ska-a3':               [0, -6.5, null],

    // A1 and A2 to the Airport
    'metamorfosi':          [2, -7, 'se'],
    'irakleio':             [3, -8, 'se'],
    'nerantziotissa':       [4, -9, 'se'],
    'kifisias':             [5, -10, 'nw'],
    'pentelis':             [6, -11, 'nw'],
    'doukissis-plakentias': [7, -12, 'n'],
    'pallini':              [8, -11, 'sw'],
    'paiania-kantza':       [9, -10, 'sw'],
    'koropi':               [10, -9, 'sw'],
    'airport':              [11, -8, 'sw'],
};

// Corners between two neighbouring stations, keyed "a>b" in either order
export const BENDS = {
    'ano-liosia>ska': [[-2, -7]],
};

// Lines side by side on shared track: a higher lane to the left of A1's way
// from the Airport (A3 east of A1 into Athens, A4 west; A2 north-west of it;
// M3, thin, beside them to the Airport)
export const LANES = { A1: 0, A2: -1, A3: 1, A4: -1, M3: -1.82 };

// Where the metro runs on the railway's track: M3 from Doukissis Plakentias
// to the Airport, drawn thin beside A1 and A2
export const ALONGSIDE = [['doukissis-plakentias', 'airport']];

// Where the lines go on past the city, and which way the arrow points
export const BEYOND = {
    'ska-a3': 'n',
    'magoula': 'w',
};

// Two lines that cross between stations, as the tracks do: A3 runs north
// to SKA under A1's way to Metamorfosi
export const CROSSINGS = [['A1', 'A3']];

// Where the metro stubs point from a station a walk from the metro
// (suburban.json's walks); past Doukissis Plakentias M3 runs alongside
export const STUBS = {
    'piraeus': 'w',
    'athens': 'w',
    'nerantziotissa': 'nw',
    'doukissis-plakentias': 'w',
};

// A badge beside each line near an end (A1's yellow and A3's green can look
// alike)
export const BADGES = {
    A1: [[-3.6, 5.4]],
    A2: [[-2.6, -7.6]],
    A3: [[0.6, -3.5]],
    A4: [[-5.6, 3.6]],
};
