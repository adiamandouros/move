// STASY's lift page (https://www.stasy.gr/elevators/), the way its site marks
// it up (server/info/lifts.js reads it): a list of stations per line, each
// with a status class, its name, and its lifts, each working or not.

// Every station on the page, per line, as STASY writes them (27 Oct 2026):
// some differ from stations.json ("Νέο Φάληρο", "Άγιος Δημήτριος –"), and
// Nerantziotissa and the airport branch have no lifts listed (Unknown)
export const STASY_LINES = {
    line118: ['Κηφισιά', 'ΚΑΤ', 'Μαρούσι', 'Νερατζιώτισσα', 'Ειρήνη', 'Ηράκλειο', 'Νέα Ιωνία', 'Πευκάκια', 'Περισσός', 'Άνω Πατήσια', 'Άγιος Ελευθέριος', 'Κάτω Πατήσια', 'Άγιος Νικόλαος', 'Αττική', 'Βικτώρια', 'Ομόνοια', 'Μοναστηράκι', 'Θησείο', 'Πετράλωνα', 'Ταύρος &#8211; Ελ. Βενιζέλος', 'Καλλιθέα', 'Μοσχάτο', 'Νέο Φάληρο', 'Πειραιάς'],
    line117: ['Ανθούπολη', 'Περιστέρι', 'Άγιος Αντώνιος', 'Σεπόλια', 'Αττική', 'Σταθμός Λαρίσης', 'Μεταξουργείο', 'Ομόνοια', 'Πανεπιστήμιο', 'Σύνταγμα', 'Ακρόπολη', 'Συγγρού-Φιξ', 'Νέος Κόσμος', 'Άγιος Ιωάννης', 'Δάφνη', 'Άγιος Δημήτριος &#8211; ', 'Ηλιούπολη', 'Άλιμος', 'Αργυρούπολη', 'Ελληνικό'],
    line119: ['Δημοτικό Θέατρο', 'Πειραιάς', 'Μανιάτικα', 'Νίκαια', 'Κορυδαλλός', 'Αγία Βαρβάρα', 'Αγία Μαρίνα', 'Αιγάλεω', 'Ελαιώνας', 'Κεραμεικός', 'Μοναστηράκι', 'Σύνταγμα', 'Ευαγγελισμός', 'Μέγαρο Μουσικής', 'Αμπελόκηποι', 'Πανόρμου', 'Κατεχάκη', 'Εθνική Άμυνα', 'Χολαργός', 'Νομισματοκοπείο', 'Αγία Παρασκευή', 'Χαλάνδρι', 'Δουκίσσης Πλακεντίας', 'Παλλήνη', 'Παιανία &#8211; Κάντζα', 'Κορωπί', 'Αεροδρόμιο'],
};
const NO_LIFTS = new Set(['Νερατζιώτισσα', 'Παλλήνη', 'Παιανία &#8211; Κάντζα', 'Κορωπί', 'Αεροδρόμιο']);

const lift = (name, ok) => `<li class='jw_elevatorStatus${ok ? 'Ok' : 'Error'}'>${name}<span class='jw_sr-only'> is ${ok ? '' : 'not '}functional</span></li>`;

// One station: status 'Ok', 'Warning', 'Error' or 'Unknown'; lifts [[name, working]]
function station(line, i, name, status, lifts) {
    return `<li class="jw_line_station ${line}station${i} jw_status${status}${lifts.length ? '' : ' jw_station__empty'}">
        <ul class="jw_other_lines"></ul>
        <button data-info="#stationDetails${line}${i}" class="jw_station_info">
            <span class="jw_sr-only"> ${name}: …</span>
            <span class="jw_station__status">&nbsp;</span>
            <span class="jw_station__name">${name}</span>
        </button>
        <div class="jw_station__details" id="stationDetails${line}${i}"><div class="jw_elevators_container">
            <ul class="jw_elevators_list jw_elevators_list__left">${lifts.slice(0, 1).map(([n, ok]) => lift(n, ok)).join('')}</ul>
            <ul class="jw_elevators_list jw_elevators_list__right">${lifts.slice(1).map(([n, ok]) => lift(n, ok)).join('')}</ul>
        </div></div>
    </li>`;
}

// The whole page: every station with its lifts working, except those in
// `changes`: { [line]: { [name as in STASY_LINES]: { status, lifts } } }.
// `lines`: other lists of stations (a page that has changed).
export function liftsPage(changes = {}, lines = STASY_LINES) {
    const content = Object.entries(lines).map(([line, names]) => `<div class="jw_line_content" id="${line}"><ul class="jw_line_stations">${names.map((name, i) => {
        const change = changes[line]?.[name];
        if (change) return station(line, i, name, change.status, change.lifts);
        return NO_LIFTS.has(name) ? station(line, i, name, 'Unknown', []) : station(line, i, name, 'Ok', [['Προς Α', true], ['Προς Β', true]]);
    }).join('')}</ul></div>`).join('');
    return `<html><body><div class="jw_elevatorsWrapper"><div class="jw_line_selector"><ul class="jw_lines"></ul></div>${content}</div></body></html>`;
}
