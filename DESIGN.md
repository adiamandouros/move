# How Wayhop looks

The rules for Wayhop's look, from the
[Wayhop Design Guide](https://claude.ai/artifact/AkCzboJyryavTDHviJ87Sv)
(version 1, agreed 24 October 2026), which has the reasons, the palettes,
the contrast numbers and pictures of each piece. Changing a rule means
changing the guide and this file together. Where a rule can be checked, a
test checks it; the tests are named under each section.

The guide is being built in six steps (roadmap item 34): foundations, lines
and stations, icons, components, the light theme, brand. Rules marked
*(step n)* aren't in the code yet.

## Principles

- **A line is always its pill.** Wherever Wayhop names a line, it shows the
  line's pill: round, in the line's colour. Buses get neutral
  square-cornered plates. Operators' own text (announcements) stays as
  written.
- **One meaning per colour, one meaning per icon.** If two things look the
  same, they mean the same.
- **The answer is the loudest thing.** Times, lines and where to stand are
  big and strong. Labels, sources and chrome are quiet.
- **Never colour alone.** Every coloured state also has a word, an icon or a
  shape.
- **One set of names, two themes.** Rules use token names, never values.
  Light and dark are two blocks of values. *(light: step 5)*
- **Change what's broken, keep what works.** The bottom bar, the yellow
  menu, the train diagram, the yellow disruption alert and the black maps
  stay.

## Tokens

All in `:root` at the top of `public/css/style.css`; the colours are in the
colour-mode block below them ([ARCHITECTURE.md](ARCHITECTURE.md#views)
has how colours work).

### Text

Roboto everywhere. Six sizes, nothing smaller than 12 px:

| Token | Size | For |
|---|---|---|
| `--wh-fs-xs` | 0.75rem (12) | Captions, stop codes, carriage labels, small capitals |
| `--wh-fs-sm` | 0.875rem (14) | Secondary text, chips, buttons, notices |
| `--wh-fs-md` | 1rem (16) | Body text |
| `--wh-fs-lg` | 1.125rem (18) | Card titles, line headings |
| `--wh-fs-xl` | 1.375rem (22) | Page titles, big bus plates |
| `--wh-fs-2xl` | 1.75rem (28) | The station name on its page |

A page's `<h1>` is xl (Bootstrap's own heading sizes follow the screen's
width, so `style.css` sets it); the station page's name is 2xl. Bootstrap's
`fs-*` classes are for icons only, until the icons step.

- Weights: 400 text, 600 labels and emphasis, 700 headings, pills and
  times, 800 only in the wordmark.
- Tabular figures for every time, minute count, distance and stop code.
- Small capitals: one style, xs, weight 700, 0.06em letter spacing, the
  faint colour (`--bs-tertiary-color`). *(step 4)*
- Text pages stay under 70 characters a line.

### Units

- **rem** for type, spacing and the size of anything that holds text:
  inputs, buttons, the navigation, carriages, page widths. Breakpoints in
  **em**. This is what makes Wayhop follow the text size a person has
  chosen.
- **em** inside components that grow with their own text: pill, sign and
  chip padding, icons at 1em.
- **px** only for what must stay thin: 1px edges, the 3px focus ring,
  shadows, the maps' lines and the train diagram's carriage edges. The
  maps' labels are in the drawing's own units, and the shaped end
  carriages keep their own corners.

### Large text

Everything has to work with the text at 200% (WCAG 1.4.4): nothing scrolls
sideways, no text spills out of its box, no word breaks where it would have
fit. What doesn't fit side by side wraps (`flex-wrap`), and a word longer
than its whole box may break (`overflow-wrap: anywhere`). Where wrapping
isn't enough, the part changes shape by its own width, with a container
query measured in `em` (so it follows the text size, not the screen):

- The train diagram: below 17em, the labels under the cars give way to a
  line of words ("Ride in: Near Back").
- A bus stop's row: below 18em, the stop's name, code and distance go on a
  line of their own above the next bus.
- The bottom bar's labels end in "…" when they don't fit (the link's name
  is still the whole word).

### Corners

| Token | Size | For |
|---|---|---|
| `--wh-radius-sm` | 0.375rem (6) | Small things in rows: plates, time chips, arrival badges, station notes, inputs |
| `--wh-radius-lg` | 0.75rem (12) | Containers: cards, notices, Info sections, the map, the suggestion list |
| `--wh-radius-round` | 50rem | Line pills, tags, pill buttons, the toast, round icon buttons |

A box inside a container with a 1px edge uses
`calc(var(--wh-radius-lg) - 1px)`. The train diagram's shaped end carriages
keep their own shapes.

### Space

A 4px grid: `--wh-space-1` (4), `-2` (8), `-3` (12), `-4` (16), `-6` (24),
`-8` (32), `-12` (48). Bootstrap's spacing utilities (`p-2`, `gap-3`…) are
on the same grid and fine to use. The page gutter is 16px on phones, card
padding 16px, gaps between cards 12px.

### Depth and edges

- Wayhop is flat: edges and surface steps separate things. `--wh-shadow` is
  the one shadow, only for what floats over content: the toast, the
  floating bus buttons, the suggestion list, the map controls. A ring with
  no offset and no blur (`0 0 0 1px …`) is an edge, not a shadow.
- `--wh-control-edge` is the edge of an input or select: 3:1 against the
  page and cards (WCAG 1.4.11).

### Touch and focus

44px minimum for main controls, 24px for anything that can be pressed. The
focus ring (`--focus-ring`) is 3px of the primary blue at 60%.

## Colour

The palettes and every contrast number are in the guide.

- **Yellow** = warnings only (and the brand: logo dot, menu button).
- **Blue** = what can be pressed, and the current page.
- **Green** = how soon a departure is, for buses and trains alike: solid
  when due (≤ 3 min), a tint when close (4–8), neutral later (9+). *(step 4)*
- Last trains: the last is red, the second-last amber, and late at night a
  line of words says so too. *(step 4)*
- Clock times (tomorrow, station timetables) are neutral chips.
- The maps stay black in both themes.
- Light theme: follows the phone, with Auto / Light / Dark in the menu; dark
  when unsure. *(step 5)*

## Lines and stations

- One builder, `/js/core/lines.js`: `linePill(id, name, size)` for metro
  and tram lines, `busPlate(number, size)` for buses; views write
  `{{pill "M3"}}` and `{{plate "X95"}}`. Never a line's name as bare text.
- Three sizes, in em inside: **S** in lists (station suggestions, the
  stations by line, a stop's lines), **M** in sentences, arrival rows and
  tables, **L** in the headers of leg cards, station sections and bus stops.
- A station page's line section is headed by the large pill alone, with
  "Line 2" for screen readers.
- Bus numbers are neutral plates everywhere, the stop header's too. A plate
  that opens its line has blue text.
- Several pills in a row have a space between them and a comma for screen
  readers (`pillList`).
- **Station signs** *(step 2, second part)*, like the real ones (a white panel with the line
  colours on its top and bottom edges), only for the direction of travel:
  the leg card's header (`[M1] → [Kifisia]`), the station page's direction
  cards and its heading. In the page's language only, tight, one line. A
  label, not a link. Change and get-off stations stay plain links.

## Icons *(step 3)*

Material Symbols Rounded. Outline beside words; filled when an icon stands
alone, for status icons and for the current tab. One meaning per icon; the
guide has the table. The walking figure is walking directions only.

## Components *(step 4)*

One notice component in four tones, replacing today's six boxes. One time
badge for buses and trains. One style each for tags, small capitals and list
rows.

## Tests

- `test/design.test.js`: the tokens are the scale; sizes, corners, shadows,
  px and breakpoints in `style.css` use them.
- `test/accessibility.test.js`: every text colour on every surface, the line
  colours, the control edge; and that no page shows a line's name outside
  its pill (`bareLineProblems` in `test/support/markup.js`, which the
  checks on what the browser draws run too).
- `test/browser/text-size.spec.js`: every page at 200% text, as above, and
  the two parts that change shape.
