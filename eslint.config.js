import js from '@eslint/js';
import globals from 'globals';

// npm run lint: ESLint's recommended checks (unused or undefined names,
// unreachable code, …), with the globals of where each file runs
export default [
    // The service worker templates have {{slots}}, so they aren't JavaScript until filled in
    { ignores: ['node_modules/', 'data/', 'server/views/sw.js', 'admin/sw.js', 'proxy/.wrangler/'] },
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
        files: ['public/js/**', 'tools/*/client/**', 'admin/client/**'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['proxy/worker.js'],
        languageOptions: { globals: globals.serviceworker },
    },
];
