import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

// In Greek, a metro stop is a «σταθμός» (station); «στάση» is for bus and tram
// stops. The metro tool's and the station pages' strings must keep to that,
// but for the strings about the tram, named so.
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

for (const path of ['tools/subway/strings.json', 'server/views/stations.json']) {
    test(`${path} calls metro stops «σταθμός», not «στάση»`, () => {
        const offenders = Object.entries(read(path).el).filter(([key, text]) => /[Σσ]τάσ/.test(text) && !key.includes('tram'));
        assert.deepEqual(offenders, []);
    });
}
