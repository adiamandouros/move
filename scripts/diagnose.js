// Server health check: npm run diagnose  (add -- --json for machine-readable output)
//
// On cPanel without SSH: Setup Node.js App → your app → "Run JS script" → diagnose.
// The same checks are at /admin/diagnostics while the app is running.
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { formatReport, runDiagnostics } from '../server/diagnostics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });

// Written by the running app every minute (server/oasa/index.js)
let appStatus = null;
try { appStatus = JSON.parse(readFileSync(join(ROOT, 'data', 'cache', 'oasa-status.json'), 'utf8')); } catch { /* app not running here */ }

const result = await runDiagnostics({ dataDir: join(ROOT, 'data'), appStatus });
console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : formatReport(result));
process.exitCode = result.summary.status === 'fail' ? 1 : 0;
