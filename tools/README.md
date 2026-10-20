# Tools

Each folder here is one page of the app, at the URL given in its `tool.json`.
The server reads these folders at startup to build the routes, the navigation,
the offline page's tiles and the offline cache list. To add a tool, copy an existing
folder and edit it; no other file needs to change.

```
tools/<id>/
  tool.json      settings (below)
  page.hbs       the page's view, placed inside <main> (a Handlebars template, see ARCHITECTURE.md, "Views")
  strings.json   { "en": { "key": "text" }, "el": { … } } — use with {{t "key"}} in page.hbs, or t('key') in a script
  data.json      optional: the values page.hbs gets, e.g. when its facts were checked ({{> checked checked.hours}})
  client/        browser files, served at /tools/<id>/
```

| `tool.json` field | Meaning |
|---|---|
| `path` | URL of the page, e.g. `/subway` |
| `order` | Position in the navigation |
| `icon` | [Bootstrap icon](https://icons.getbootstrap.com/) name, without `bi-`; add it to `ICONS` in `server/pages/icons.js` |
| `title`, `shortTitle`, `description` | `{ "en": …, "el": … }`. `shortTitle` is used in the mobile nav, if given |
| `offline` | `true` to cache the page and its `client/` files for offline use |
| `scripts` | Files in `client/` to load as modules, e.g. `["main.js"]` |
| `precache` | Data URLs to cache for offline use, e.g. `["/data/rail.json"]` (best-effort: a missing file doesn't break the cache) |
| `rail` | `true` to draw the page from rail.json too: its `data.json` `lastTrains` rows (`{ line, from, to }`) get their times as `metro` (`server/pages/last-trains.js`), and the page is drawn again when rail.json changes |

Longer text that doesn't suit single strings (paragraphs with links, lists)
can be written twice in `page.hbs`, as `{{#ifLang "en"}}…{{else}}…{{/ifLang}}`
(English first); the server keeps only the page's language. Every
page is rendered on the server in its language (English, or Greek under `/el`),
so the browser never translates anything.

Shared browser modules live in `public/js/core/` and are imported by absolute
path, e.g. `import { t } from '/js/core/i18n.js'`.
