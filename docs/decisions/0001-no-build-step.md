# 1. No build step and no front-end framework

Decided 2026-03-28 · In force

## Situation

One person builds and runs Wayhop, on shared hosting, and its main users
are on phones, often with a weak signal underground. A bundler or a
framework would add a toolchain to install, update and debug, and code to
download before anything shows.

## Decision

The browser gets the JavaScript modules and stylesheets exactly as they are
in the repository: no bundler, no transpiler, no framework.

- Modules import each other by absolute URL (`/js/core/i18n.js`). An import
  map in every page points each URL at the file's version (`?v=<hash>`,
  `versionOf` in [assets.js](../../server/pages/assets.js)), so a deploy
  never mixes old and new files.
- Types are checked from JSDoc comments (`npm run typecheck`), never
  compiled.
- Bootstrap, Roboto and the Material Symbols come from `node_modules` and
  are served by Wayhop itself, not a CDN.

## What follows

- The code in the browser is the code in the repository, and pages stay
  small.
- What a page shows and when it changes is written by hand. That needs
  discipline as a page grows: logic that doesn't need the page belongs in a
  module of its own, tested in Node.
- Nothing is trimmed at build time: Bootstrap's CSS arrives whole (about 9
  of its 31 KB gzipped are used), and since each file has its own version, a
  deploy only re-sends the files it changed.

## Look again when

- A page's state is still too hard to follow after splitting it into
  modules.
- A dependency Wayhop needs only ships in a form browsers can't load as it
  is.
