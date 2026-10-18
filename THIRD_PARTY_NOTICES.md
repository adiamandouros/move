# Third-party notices

Wayhop's own code is under the GNU AGPL v3 or later ([LICENSE](LICENSE)), and
its hand-maintained data under CC BY-SA 4.0
([data/curated/LICENSE.md](data/curated/LICENSE.md)). It also uses the work
of others.

## Sent to browsers

| What | License | Where it's used |
|---|---|---|
| [Bootstrap](https://getbootstrap.com/) 5, © 2011-2025 The Bootstrap Authors | [MIT](https://github.com/twbs/bootstrap/blob/main/LICENSE) | Every page's styles and scripts (`/vendor/bootstrap/`, unmodified) |
| [Bootstrap Icons](https://icons.getbootstrap.com/), © 2019-2024 The Bootstrap Authors | [MIT](https://github.com/twbs/icons/blob/main/LICENSE) | The icon sprite, `/icons.svg` (server/pages/icons.js) |
| [axe-core](https://github.com/dequelabs/axe-core), © Deque Systems, Inc. | [MPL 2.0](https://github.com/dequelabs/axe-core/blob/develop/LICENSE) | The private admin pages' accessibility check, unmodified |

## On the server

The npm packages in [package.json](package.json) are installed with their
own license files in `node_modules/`. All are under MIT, ISC or BSD
licenses, except:

- **node-unrar-js** (MIT) contains RARLAB's unRAR code, under the unRAR
  license, which isn't compatible with the GPL family. It unpacks OASA's
  `.rar` downloads. See the additional permission in the
  [README](README.md#license).

## Data

- **Timetables, lines and stops**: OASA's open data on
  <https://catalog.growthfund.gr/>, under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Wayhop
  downloads it, converts it and combines it with its own data (see
  [ARCHITECTURE.md](ARCHITECTURE.md)). Station names and platform codes in
  `data/curated/` come from it too.
- **Live bus arrivals and service announcements**: from OASA's and STASY's
  services, shown as they are. Wayhop isn't affiliated with or endorsed by
  OASA, STASY or OSY.
