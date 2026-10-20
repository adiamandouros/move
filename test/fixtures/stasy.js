// STASY's timetable pages, the way its site marks them up (server/data/stasy.js
// reads them): one first-and-last table per direction, notes in rows of their
// own, and tables the reader leaves alone (frequencies, hourly airport trains).

// Stations as stations.json has them. STASY writes "ΒΗΤΑ ΣΤΑΘΜΟΣ" for beta (its
// `stasy` name) and mixes in Latin letters that look Greek ("ΓAMMA").
export const stasyStations = {
    alpha: { name: { el: 'Άλφα', en: 'Alpha' } },
    beta: { name: { el: 'Βήτα', en: 'Beta' }, stasy: ['ΒΗΤΑ ΣΤΑΘΜΟΣ'] },
    gamma: { name: { el: 'Γάμμα', en: 'Gamma' } },
    delta: { name: { el: 'Δέλτα', en: 'Delta' } },
    airport: { name: { el: 'Αεροδρόμιο', en: 'Airport' } },
};

const cell = text => `<td style="text-align: center;"><strong>${text}</strong></td>`;
const row = cells => `<tr>${cells.map(cell).join('')}</tr>`;

// A table: its headings, its rows ([station, time or '', …]) and notes (a row
// each, across the table)
export function stasyTable(header, rows, notes = []) {
    return `<table class="tablepress"><tbody>${row(header.map(() => ''))}${row(header)}${rows.map(row).join('')}`
        + `${notes.map(n => `<tr><td colspan="${header.length}">${n}</td></tr>`).join('')}</tbody></table>`;
}

// A page with these tables, after the ones every page has
export function stasyPage(tables) {
    return `<html><body><h2>ΣΥΧΝΟΤΗΤΑ ΔΡΟΜΟΛΟΓΙΩΝ</h2>${stasyTable(['ΗΜΕΡΑ', 'ΩΡΑ', 'ΣΥΧΝΟΤΗΤΑ'], [['Δευτέρα', '05:30 - 06:00', '10&#8242;']])}`
        + `${stasyTable(['ΑΠΟ ΣΤΑΘΜΟ', 'ΚΑΘΕ ΩΡΑ ΑΠΟ 06 ΕΩΣ 22', 'ΑΠΟ ΣΤΑΘΜΟ', 'ΚΑΘΕ ΩΡΑ ΑΠΟ 07 ΕΩΣ 23'], [['ΑΛΦΑ', 'στις 01΄', 'ΑΕΡΟΔΡΟΜΙΟ', 'στις 02΄']])}`
        + `<h2>ΠΡΩΤΑ &amp; ΤΕΛΕΥΤΑΙΑ ΔΡΟΜΟΛΟΓΙΑ</h2>${tables.join('')}</body></html>`;
}

const ALL_NIGHT = 'Σημείωση: Κάθε Σάββατο υπάρχει 24ωρη λειτουργία στις Γραμμές 2 και 9 του Μετρό, καθώς και στη Γραμμή του Τραμ. Από την 24ωρη λειτουργία εξαιρούνται τα δρομολόγια της Γραμμής 9 από και προς το Αεροδρόμιο (Δέλτα - Αεροδρόμιο και αντίστροφα).';

// Line M9 like STASY's line 3: alpha → beta → gamma → delta, and on to the
// airport for some trains; all night on Saturdays, but not to or from the
// airport; on Fridays later. Out: the last train only as far as gamma (like
// line 1's "as far as Omonia") and the second airport train, which isn't used.
export const lineOut = stasyTable(
    ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟΣ', 'ΠΡΩΤΟ (ΑΕΡΟΔΡΟΜΙΟ)', 'ΔΕΥΤΕΡΟ (ΑΕΡΟΔΡΟΜΙΟ)', 'ΤΕΛΕΥΤΑΙΟ (ΑΕΡΟΔΡΟΜΙΟ)', 'ΤΕΛΕΥΤΑΙΟ (Έως Στ.Γάμμα)', 'ΤΕΛΕΥΤΑΙΟ (ΔΕΛΤΑ) [ΔΕΥ - ΠΕΜ &amp; ΚΥΡ]', 'ΤΕΛΕΥΤΑΙΟ (ΔΕΛΤΑ) [ΠΑΡ]'],
    [
        ['ΑΛΦΑ', '05:30', '05:30', '06:06', '22:54', '00:20', '23:57', '01:34'],
        ['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:32', '05:32', '06:08', '22:56', '00:22', '23:59', '01:36'],
        ['ΓAMMA', '05:35', '05:35', '06:11', '22:59', '00:25', '00:02', '01:39'],
        ['Δέλτα', '05:40', '05:40', '06:16', '23:04', '', '00:07', '01:44'],
        ['ΑΕΡΟΔΡΟΜΙΟ', '', '06:00', '06:36', '23:24', '', '', ''],
    ],
    [ALL_NIGHT],
);

// Back: trains from delta, and airport trains, both to alpha
export const lineBack = stasyTable(
    ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΠΡΩΤΟ (ΑΕΡΟΔΡΟΜΙΟ)', 'ΤΕΛΕΥΤΑΙΟ (ΑΕΡΟΔΡΟΜΙΟ)', 'ΤΕΛΕΥΤΑΙΟ (ΔΕΥ - ΠΕΜ &amp; ΚΥΡ)', 'ΤΕΛΕΥΤΑΙΟ (ΠΑΡ)'],
    [
        ['ΑΕΡΟΔΡΟΜΙΟ', '', '06:10', '23:34', '', ''],
        ['ΔΕΛΤΑ', '05:30', '06:30', '23:54', '00:01', '01:38'],
        ['ΓΑΜΜΑ', '05:34', '06:34', '23:58', '00:05', '01:42'],
        ['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:37', '06:37', '00:01', '00:08', '01:45'],
        ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ ΑΛΦΑ', '05:39', '06:39', '00:03', '00:10', '01:47'],
    ],
    [ALL_NIGHT],
);

// A line like STASY's line 2, with first trains by days and no airport:
// alpha → beta → gamma, and back
export const daysOut = stasyTable(
    ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ (ΔΕΥ-ΠΑΡ)', 'ΠΡΩΤΟ (Σ/Κ) *', 'ΤΕΛΕΥΤΑΙΟ (ΔΕΥ- ΠΕΜ &amp; ΚΥΡ)', 'ΤΕΛΕΥΤΑΙΟ (ΠΑΡ)'],
    [['ΑΛΦΑ', '05:30', '05:40', '00:06', '01:43'], ['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:31', '05:41', '00:07', '01:44'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ ΓΑΜΜΑ', '05:33', '05:43', '00:09', '01:46']],
    ['* Κάθε Σάββατο υπάρχει 24ωρη λειτουργία στις Γραμμές 2 και 3 του Μετρό, καθώς και στη Γραμμή του Τραμ.'],
);
export const daysBack = stasyTable(
    ['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ (ΔΕΥ- ΠΕΜ &amp; ΚΥΡ)', 'ΤΕΛΕΥΤΑΙΟ (ΠΑΡ)'],
    [['ΓΑΜΜΑ', '05:30', '00:03', '01:40'], ['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:32', '00:05', '01:42'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ ΑΛΦΑ', '05:34', '00:07', '01:44']],
);

// A line like STASY's line 1: the same first and last trains every day
export const plainOut = stasyTable(['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ'], [['ΑΛΦΑ', '05:00', '00:15'], ['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:02', '00:17'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ ΓΑΜΜΑ', '05:04', '00:19']]);
export const plainBack = stasyTable(['ΑΠΟ ΣΤΑΘΜΟ', 'ΠΡΩΤΟ', 'ΤΕΛΕΥΤΑΙΟ'], [['ΓΑΜΜΑ', '05:00', '00:15'], ['ΒΗΤΑ ΣΤΑΘΜΟΣ', '05:02', '00:17'], ['ΑΦΙΞΗ ΣΤΟ ΣΤΑΘΜΟ ΑΛΦΑ', '05:04', '00:19']]);
