import js from '@eslint/js';
import globals from 'globals';

// npm run lint: ESLint's recommended checks (unused or undefined names,
// unreachable code, …), with the globals of where each file runs
export default [
    // The service worker templates have {{slots}}, so they aren't JavaScript until filled in
    { ignores: ['node_modules/', 'data/', 'test-results/', 'playwright-report/', 'server/views/sw.js', 'admin/sw.js', 'proxy/.wrangler/'] },
    js.configs.recommended,
    {
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: {
            // Unused parameters and caught errors are often there on purpose (_req, catch (err))
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        files: ['*.js', 'server/**', 'scripts/**', 'test/**', 'proxy/node.js'],
        languageOptions: { globals: globals.node },
    },
    {
        // Browser tests run in Node, but the functions they hand the page run there
        files: ['test/browser/**'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
        // Playwright hooks that only need the test's details take ({}, testInfo)
        rules: { 'no-empty-pattern': 'off' },
    },
    {
        files: ['public/js/**', 'tools/*/client/**', 'admin/client/**'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['proxy/worker.js'],
        languageOptions: { globals: globals.serviceworker },
    },
];
