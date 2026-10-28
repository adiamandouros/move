# 3. Every page in each language, rendered on the server

Decided 2026-10-18 · In force

## Situation

Wayhop is for people who live in Athens and for visitors. Translating in
the browser would show the wrong language first, and search engines would
only ever see one.

## Decision

- Every page exists once per language: English at its address, Greek under
  `/el` (`/el/subway`). The server renders each one fully in its language;
  the browser never translates.
- Short text lives in `strings.json` files, with `en` and `el`. Longer text
  is written in both languages side by side (`{{#ifLang}}`), and the About,
  Privacy and Contact pages are one file per language.
- The language link opens the same page in the other language and remembers
  the choice on the device; a small script in `<head>` sends later visits to
  that language before the page shows.

## What follows

- Search engines index both languages, and each page carries only its own
  language's strings.
- Two languages are built in: the other language is worked out as "not this
  one", `{{#ifLang "en"}}…{{else}}…{{/ifLang}}` means "English, else Greek",
  the language link is a toggle, and only Greek has its own addresses. A
  third language means making those work for any number of languages first.
- Station and stop names and the announcements come from OASA and STASY in
  Greek and English only, so pages in another language would show them in
  English, marked with `lang` for screen readers.

## Look again when

- A third language is added.
