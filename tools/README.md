# Tools

Each folder here is one page of the app, at the URL given in its `tool.json`.
The server reads these folders at startup to build the routes, the navigation,
the home page tiles and the offline cache list. To add a tool, copy an existing
folder and edit it; no other file needs to change.

```
tools/<id>/
  tool.json      settings (below)
  page.html      the page's markup, placed inside <main>
  strings.json   { "en": { "key": "text" }, "el": { … } } — use with data-i18n="key" (also data-i18n-placeholder, -aria-label, -title) or t('key')
  client/        browser files, served at /tools/<id>/
```

| `tool.json` field | Meaning |
|---|---|
| `path` | URL of the page, e.g. `/subway` |
| `order` | Position in the navigation |
| `icon` | [Bootstrap icon](https://icons.getbootstrap.com/) name, without `bi-` |
| `title`, `shortTitle`, `description` | `{ "en": …, "el": … }`. `shortTitle` is used in the mobile nav, if given |
| `offline` | `true` to cache the page and its `client/` files for offline use |
| `scripts` | Files in `client/` to load as modules, e.g. `["main.js"]` |
| `precache` | Data URLs to cache for offline use, e.g. `["/data/rail.json"]` (best-effort: a missing file doesn't break the cache) |

Shared browser modules live in `public/js/core/` and are imported by absolute
path, e.g. `import { t } from '/js/core/i18n.js'`.
