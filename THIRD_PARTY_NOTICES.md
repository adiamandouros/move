# Third-party notices

Wayhop's own code is under the GNU AGPL v3 or later ([LICENSE](LICENSE)), and
its hand-maintained data under CC BY-SA 4.0
([data/curated/LICENSE.md](data/curated/LICENSE.md)). It also uses the work
of others.

## Sent to browsers

| What | License | Where it's used |
|---|---|---|
| [Bootstrap](https://getbootstrap.com/) 5, © 2011-2025 The Bootstrap Authors | [MIT](https://github.com/twbs/bootstrap/blob/main/LICENSE) | Every page's styles and scripts (`/vendor/bootstrap/`, unmodified) |
| [Roboto](https://github.com/googlefonts/roboto-classic), © 2011 The Roboto Project Authors, packaged by [Fontsource](https://fontsource.org/) | [SIL Open Font License 1.1](https://openfontlicense.org/) | Every page's text, Latin and Greek (`/vendor/roboto/`, unmodified) |
| [Material Symbols](https://fonts.google.com/icons) (Rounded), © Google, from [@material-symbols/svg-400](https://www.npmjs.com/package/@material-symbols/svg-400) | [Apache 2.0](https://github.com/google/material-design-icons/blob/master/LICENSE) | The icon sprite, `/icons.svg`, from the SVGs copied into `server/icons/` with their license (server/pages/icons.js) |
| [axe-core](https://github.com/dequelabs/axe-core), © Deque Systems, Inc. | [MPL 2.0](https://github.com/dequelabs/axe-core/blob/develop/LICENSE) | The private admin pages' accessibility check, unmodified |

## On the server

The npm packages in [package.json](package.json) are installed with their
own license files in `node_modules/`. All are under MIT, ISC or BSD
licenses.

## Data

- **Metro and tram timetables**: OASA's open data on
  <https://catalog.growthfund.gr/>, under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Wayhop
  downloads it, converts it and combines it with its own data (see
  [ARCHITECTURE.md](ARCHITECTURE.md)). Station names and platform codes in
  `data/curated/` come from it too.
- **Bus lines and stops, live bus arrivals and service announcements**: from
  OASA's and STASY's services, as they give them. The metro's first and last
  trains and its airport trains come from STASY's published timetables, and
  the elevators out of service from STASY's elevator page.
  Wayhop isn't affiliated with or endorsed by OASA, STASY or OSY.
