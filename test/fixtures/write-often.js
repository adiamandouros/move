// Writes one file through writeFileAtomic (server/files.js) again and again,
// as each copy of the server saves oasa-usage.json: the test starts two of
// these at once on the same file. Prints how many writes failed.
import { writeFileAtomic } from '../../server/files.js';

const [file, times] = process.argv.slice(2);
let failed = 0;
for (let i = 0; i < Number(times); i++) {
    try { writeFileAtomic(file, JSON.stringify({ pid: process.pid, i })); } catch { failed++; }
}
console.log(failed);
