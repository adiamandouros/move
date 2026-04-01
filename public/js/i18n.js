import { getLanguage } from './settings.js';

const strings = {
    en: {
        // Nav
        'nav.nearby-buses':       'Nearby Buses',
        'nav.nearby-buses.short': 'Buses',
        'nav.subway':             'Subway',
        'nav.select-tool':        'Select a tool',

        // Nearby Buses
        'buses.getting-location':    'Getting your location\u2026',
        'buses.finding-stops':       'Finding nearby stops\u2026',
        'buses.no-stops':            'No stops found nearby',
        'buses.server-error':        'Could not reach the server',
        'buses.location-denied':     'Location access denied',
        'buses.location-error':      'Could not get location',
        'buses.location-denied-hint':'Please allow location access in your browser settings and try again.',
        'buses.no-arrivals':         'No upcoming arrivals.',
        'buses.no-arrivals-short':   'No arrivals',
        'buses.hide-empty':          'Hide empty stops',
        'buses.show-all':            'Show all stops',
        'buses.updated':             'Arrival times updated',
        'buses.walking-directions-to':'Walking directions to',
        'buses.all-arrivals-for':    'All arrivals for',
        'buses.tap-expand':          'Tap to expand.',
        'buses.next-bus-line':       'Next bus: line',
        'buses.arriving-soon':       'minutes, arriving soon',
        'buses.minutes':             'minutes',
        'buses.no-upcoming':         'No upcoming arrivals',

        // Subway
        'subway.boarding-label':       'Boarding at',
        'subway.boarding-placeholder': 'Type your boarding station\u2026',
        'subway.destination-label':    'Getting off at',
        'subway.destination-placeholder': 'Type your destination\u2026',
        'subway.no-route':             'No route found. Check that both stops are on the Athens metro, or try swapping origin and destination.',
        'subway.option':               'Option',
        'subway.transfer-at':          'Transfer at',
        'subway.exit-at':              'Exit at',
        'subway.exit-left':            'Exit left',
        'subway.change-to':            'Change to',
        'subway.no-position-data':     'No position data for this stop yet.',
        'subway.schedule-disclaimer':  'Departure times are approximate and may not reflect real-time conditions.',
        'subway.train-back':           'BACK',
        'subway.train-front':          'FRONT',
        'subway.diagram-label':        'Train diagram showing where to stand:',
        'subway.toward':               'toward',
        'subway.station-suggestions':  'Station suggestions',
        'subway.schedule-in':          'In',
        'subway.location-prefix':      'Boarding station set to',
        'subway.location-suffix':      'based on your location.',
    },
    el: {
        // Nav
        'nav.nearby-buses':       '\u039a\u03bf\u03bd\u03c4\u03b9\u03bd\u03ac \u039b\u03b5\u03c9\u03c6\u03bf\u03c1\u03b5\u03af\u03b1',
        'nav.nearby-buses.short': '\u039b\u03b5\u03c9\u03c6\u03bf\u03c1\u03b5\u03af\u03b1',
        'nav.subway':             '\u039c\u03b5\u03c4\u03c1\u03cc',
        'nav.select-tool':        '\u0395\u03c0\u03b9\u03bb\u03ad\u03be\u03c4\u03b5 \u03b5\u03c1\u03b3\u03b1\u03bb\u03b5\u03af\u03bf',

        // Nearby Buses
        'buses.getting-location':    '\u039b\u03ae\u03c8\u03b7 \u03c4\u03bf\u03c0\u03bf\u03b8\u03b5\u03c3\u03af\u03b1\u03c2\u2026',
        'buses.finding-stops':       '\u0395\u03cd\u03c1\u03b5\u03c3\u03b7 \u03ba\u03bf\u03bd\u03c4\u03b9\u03bd\u03ce\u03bd \u03c3\u03c4\u03ac\u03c3\u03b5\u03c9\u03bd\u2026',
        'buses.no-stops':            '\u0394\u03b5\u03bd \u03b2\u03c1\u03ad\u03b8\u03b7\u03ba\u03b1\u03bd \u03ba\u03bf\u03bd\u03c4\u03b9\u03bd\u03ad\u03c2 \u03c3\u03c4\u03ac\u03c3\u03b5\u03b9\u03c2',
        'buses.server-error':        '\u0394\u03b5\u03bd \u03ae\u03c4\u03b1\u03bd \u03b4\u03c5\u03bd\u03b1\u03c4\u03ae \u03b7 \u03c3\u03cd\u03bd\u03b4\u03b5\u03c3\u03b7 \u03bc\u03b5 \u03c4\u03bf\u03bd \u03b4\u03b9\u03b1\u03ba\u03bf\u03bc\u03b9\u03c3\u03c4\u03ae',
        'buses.location-denied':     '\u0394\u03b5\u03bd \u03b5\u03c0\u03b9\u03c4\u03c1\u03ac\u03c0\u03b7\u03ba\u03b5 \u03b7 \u03c0\u03c1\u03cc\u03c3\u03b2\u03b1\u03c3\u03b7 \u03c4\u03bf\u03c0\u03bf\u03b8\u03b5\u03c3\u03af\u03b1\u03c2',
        'buses.location-error':      '\u0394\u03b5\u03bd \u03ae\u03c4\u03b1\u03bd \u03b4\u03c5\u03bd\u03b1\u03c4\u03ae \u03b7 \u03bb\u03ae\u03c8\u03b7 \u03c4\u03bf\u03c0\u03bf\u03b8\u03b5\u03c3\u03af\u03b1\u03c2',
        'buses.location-denied-hint':'\u0395\u03c0\u03b9\u03c4\u03c1\u03ad\u03c8\u03c4\u03b5 \u03c4\u03b7\u03bd \u03c0\u03c1\u03cc\u03c3\u03b2\u03b1\u03c3\u03b7 \u03c4\u03bf\u03c0\u03bf\u03b8\u03b5\u03c3\u03af\u03b1\u03c2 \u03c3\u03c4\u03b9\u03c2 \u03c1\u03c5\u03b8\u03bc\u03af\u03c3\u03b5\u03b9\u03c2 \u03c4\u03bf\u03c5 \u03c0\u03c1\u03bf\u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03bf\u03c2 \u03c0\u03b5\u03c1\u03b9\u03ae\u03b3\u03b7\u03c3\u03b7\u03c2 \u03ba\u03b1\u03b9 \u03b4\u03bf\u03ba\u03b9\u03bc\u03ac\u03c3\u03c4\u03b5 \u03be\u03b1\u03bd\u03ac.',
        'buses.no-arrivals':         '\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03bf\u03c5\u03bd \u03b5\u03c0\u03b5\u03c1\u03c7\u03cc\u03bc\u03b5\u03bd\u03b5\u03c2 \u03b1\u03c6\u03af\u03be\u03b5\u03b9\u03c2.',
        'buses.no-arrivals-short':   '\u03a7\u03c9\u03c1\u03af\u03c2 \u03b1\u03c6\u03af\u03be\u03b5\u03b9\u03c2',
        'buses.hide-empty':          '\u0391\u03c0\u03cc\u03ba\u03c1\u03c5\u03c8\u03b7 \u03ac\u03b4\u03b5\u03b9\u03c9\u03bd \u03c3\u03c4\u03ac\u03c3\u03b5\u03c9\u03bd',
        'buses.show-all':            '\u0395\u03bc\u03c6\u03ac\u03bd\u03b9\u03c3\u03b7 \u03cc\u03bb\u03c9\u03bd \u03c4\u03c9\u03bd \u03c3\u03c4\u03ac\u03c3\u03b5\u03c9\u03bd',
        'buses.updated':             '\u039f\u03b9 \u03ce\u03c1\u03b5\u03c2 \u03ac\u03c6\u03b9\u03be\u03b7\u03c2 \u03b5\u03bd\u03b7\u03bc\u03b5\u03c1\u03ce\u03b8\u03b7\u03ba\u03b1\u03bd',
        'buses.walking-directions-to':'\u039f\u03b4\u03b7\u03b3\u03af\u03b5\u03c2 \u03c0\u03b5\u03b6\u03ae \u03b3\u03b9\u03b1',
        'buses.all-arrivals-for':    '\u038c\u03bb\u03b5\u03c2 \u03bf\u03b9 \u03b1\u03c6\u03af\u03be\u03b5\u03b9\u03c2 \u03b3\u03b9\u03b1',
        'buses.tap-expand':          '\u03a0\u03b1\u03c4\u03ae\u03c3\u03c4\u03b5 \u03b3\u03b9\u03b1 \u03b1\u03bd\u03ac\u03c0\u03c4\u03c5\u03be\u03b7.',
        'buses.next-bus-line':       '\u0395\u03c0\u03cc\u03bc\u03b5\u03bd\u03bf \u03bb\u03b5\u03c9\u03c6\u03bf\u03c1\u03b5\u03af\u03bf: \u03b3\u03c1\u03b1\u03bc\u03bc\u03ae',
        'buses.arriving-soon':       '\u03bb\u03b5\u03c0\u03c4\u03ac, \u03c6\u03c4\u03ac\u03bd\u03b5\u03b9 \u03c3\u03cd\u03bd\u03c4\u03bf\u03bc\u03b1',
        'buses.minutes':             '\u03bb\u03b5\u03c0\u03c4\u03ac',
        'buses.no-upcoming':         '\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03bf\u03c5\u03bd \u03b5\u03c0\u03b5\u03c1\u03c7\u03cc\u03bc\u03b5\u03bd\u03b5\u03c2 \u03b1\u03c6\u03af\u03be\u03b5\u03b9\u03c2',

        // Subway
        'subway.boarding-label':       '\u0395\u03c0\u03b9\u03b2\u03af\u03b2\u03b1\u03c3\u03b7 \u03c3\u03c4\u03b7 \u03c3\u03c4\u03ac\u03c3\u03b7',
        'subway.boarding-placeholder': '\u0391\u03bd\u03b1\u03b6\u03ae\u03c4\u03b7\u03c3\u03b7 \u03c3\u03c4\u03b1\u03b8\u03bc\u03bf\u03cd \u03b5\u03c0\u03b9\u03b2\u03af\u03b2\u03b1\u03c3\u03b7\u03c2\u2026',
        'subway.destination-label':    '\u0391\u03c0\u03bf\u03b2\u03af\u03b2\u03b1\u03c3\u03b7 \u03c3\u03c4\u03b7 \u03c3\u03c4\u03ac\u03c3\u03b7',
        'subway.destination-placeholder': '\u0391\u03bd\u03b1\u03b6\u03ae\u03c4\u03b7\u03c3\u03b7 \u03c0\u03c1\u03bf\u03bf\u03c1\u03b9\u03c3\u03bc\u03bf\u03cd\u2026',
        'subway.no-route':             '\u0394\u03b5\u03bd \u03b2\u03c1\u03ad\u03b8\u03b7\u03ba\u03b5 \u03b4\u03b9\u03b1\u03b4\u03c1\u03bf\u03bc\u03ae. \u0392\u03b5\u03b2\u03b1\u03b9\u03c9\u03b8\u03b5\u03af\u03c4\u03b5 \u03cc\u03c4\u03b9 \u03ba\u03b1\u03b9 \u03bf\u03b9 \u03b4\u03cd\u03bf \u03c3\u03c4\u03b1\u03b8\u03bc\u03bf\u03af \u03b1\u03bd\u03ae\u03ba\u03bf\u03c5\u03bd \u03c3\u03c4\u03bf \u03bc\u03b5\u03c4\u03c1\u03cc \u0391\u03b8\u03ae\u03bd\u03b1\u03c2 \u03ae \u03b4\u03bf\u03ba\u03b9\u03bc\u03ac\u03c3\u03c4\u03b5 \u03bd\u03b1 \u03b1\u03bd\u03c4\u03b9\u03c3\u03c4\u03c1\u03ad\u03c8\u03b5\u03c4\u03b5 \u03b1\u03c6\u03b5\u03c4\u03b7\u03c1\u03af\u03b1 \u03ba\u03b1\u03b9 \u03c0\u03c1\u03bf\u03bf\u03c1\u03b9\u03c3\u03bc\u03cc.',
        'subway.option':               '\u0395\u03c0\u03b9\u03bb\u03bf\u03b3\u03ae',
        'subway.transfer-at':          '\u0391\u03bd\u03c4\u03b1\u03c0\u03cc\u03ba\u03c1\u03b9\u03c3\u03b7 \u03c3\u03c4\u03b7 \u03c3\u03c4\u03ac\u03c3\u03b7',
        'subway.exit-at':              '\u0391\u03c0\u03bf\u03b2\u03af\u03b2\u03b1\u03c3\u03b7 \u03c3\u03c4\u03b7 \u03c3\u03c4\u03ac\u03c3\u03b7',
        'subway.exit-left':            '\u0388\u03be\u03bf\u03b4\u03bf\u03c2 \u03b1\u03c1\u03b9\u03c3\u03c4\u03b5\u03c1\u03ac',
        'subway.change-to':            '\u0391\u03bb\u03bb\u03b1\u03b3\u03ae \u03c3\u03b5',
        'subway.no-position-data':     '\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03bf\u03c5\u03bd \u03b1\u03ba\u03cc\u03bc\u03b1 \u03b4\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03b1 \u03b8\u03ad\u03c3\u03b7\u03c2 \u03b3\u03b9\u03b1 \u03b1\u03c5\u03c4\u03ae \u03c4\u03b7 \u03c3\u03c4\u03ac\u03c3\u03b7.',
        'subway.schedule-disclaimer':  '\u039f\u03b9 \u03ce\u03c1\u03b5\u03c2 \u03b1\u03bd\u03b1\u03c7\u03ce\u03c1\u03b7\u03c3\u03b7\u03c2 \u03b5\u03af\u03bd\u03b1\u03b9 \u03ba\u03b1\u03c4\u03ac \u03c0\u03c1\u03bf\u03c3\u03ad\u03b3\u03b3\u03b9\u03c3\u03b7 \u03ba\u03b1\u03b9 \u03b5\u03bd\u03b4\u03ad\u03c7\u03b5\u03c4\u03b1\u03b9 \u03bd\u03b1 \u03bc\u03b7\u03bd \u03b1\u03bd\u03c4\u03b9\u03ba\u03b1\u03c4\u03bf\u03c0\u03c4\u03c1\u03af\u03b6\u03bf\u03c5\u03bd \u03c4\u03b9\u03c2 \u03c0\u03c1\u03b1\u03b3\u03bc\u03b1\u03c4\u03b9\u03ba\u03ad\u03c2 \u03c3\u03c5\u03bd\u03b8\u03ae\u03ba\u03b5\u03c2.',
        'subway.train-back':           '\u03a0\u0399\u03a3\u03a9',
        'subway.train-front':          '\u039c\u03a0\u03a1\u039f\u03a3\u03a4\u0391',
        'subway.diagram-label':        '\u0394\u03b9\u03ac\u03b3\u03c1\u03b1\u03bc\u03bc\u03b1 \u03c4\u03c1\u03ad\u03bd\u03bf\u03c5 \u03c0\u03bf\u03c5 \u03b4\u03b5\u03af\u03c7\u03bd\u03b5\u03b9 \u03c0\u03bf\u03cd \u03bd\u03b1 \u03c3\u03c4\u03b1\u03b8\u03b5\u03af\u03c4\u03b5:',
        'subway.toward':               '\u03c0\u03c1\u03bf\u03c2',
        'subway.station-suggestions':  '\u03a0\u03c1\u03bf\u03c4\u03ac\u03c3\u03b5\u03b9\u03c2 \u03c3\u03c4\u03b1\u03b8\u03bc\u03ce\u03bd',
        'subway.schedule-in':          '\u03a3\u03b5',
        'subway.location-prefix':      '\u0397 \u03c3\u03c4\u03ac\u03c3\u03b7 \u03b5\u03c0\u03b9\u03b2\u03af\u03b2\u03b1\u03c3\u03b7\u03c2 \u03bf\u03c1\u03af\u03c3\u03c4\u03b7\u03ba\u03b5 \u03c3\u03b5',
        'subway.location-suffix':      '\u03b2\u03ac\u03c3\u03b5\u03b9 \u03c4\u03bf\u03c0\u03bf\u03b8\u03b5\u03c3\u03af\u03b1\u03c2.',
    },
};

export function t(key) {
    const lang = getLanguage();
    return strings[lang]?.[key] ?? strings.en[key] ?? key;
}
