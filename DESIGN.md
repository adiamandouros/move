# How Wayhop looks

The rules for Wayhop's look, from the
[Wayhop Design Guide](https://claude.ai/artifact/AkCzboJyryavTDHviJ87Sv)
(version 1, agreed 24 October 2026; version 2, the Trip page, agreed 10
November 2026), which has the reasons, the palettes, the contrast numbers
and pictures of each piece. Changing a rule means changing the guide and
this file together. Where a rule can be checked, a test checks it; the
tests are named under each section.

Version 1 is built. Version 2 adds the Trip page and a few rules for every
page; rules marked *(v2)* aren't in the code yet, and lose the mark in the
pull request that builds them (the guide's plan of attack has the order).

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
  Light and dark are two blocks of values.
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
width, so `style.css` sets it); the station page's name is 2xl.

- Weights: 400 text, 600 labels and emphasis, 700 headings, pills and
  times, 800 only in the wordmark.
- Tabular figures for every time, minute count, distance and stop code.
- Minutes are written `7'` everywhere, sentences included ("Walk ~3'",
  "next in 12'"), never ′ or "min"; screen readers always hear "7 minutes"
  (the mark `aria-hidden`, the words `sr-only`). One helper writes them:
  `minutesMark` in `/js/core/times.js` (`{{minutes 36}}` in views), with
  `~` and "about" for a guess and "16–19'" for a range. Ticket names
  ("90-minute ticket") and the text pages (About, Privacy) keep words.
- Small capitals: one style, xs, weight 700, 0.06em letter spacing, the
  faint colour (`--bs-tertiary-color`). One rule in `style.css` for the
  route heading, the search headings and the Info sub-headings.
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
padding 16px, gaps between cards 12px. Every card's padding is 16px, the
Subway page's leg cards (20px today) and the Trip page's (12px) too. *(v2)*

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
  when due (≤ 3 min), a tint when close (4–8), neutral later (9+). Every
  time a vehicle comes for you is a badge on it, counted from now, whether
  it's from a timetable or live. *(v2)*
- Last trains: the last is red, the second-last amber, and a line of words
  says so too.
- Clock times (tomorrow, station timetables) are neutral chips. A trip's
  own clock times are plain text: when to be at the stop, when you arrive,
  "due at 12:14" in a sentence; so are walks and how long a ride takes.
  *(v2)*
- **~** marks a guess from a timetable: a bus by OASA's timetable
  (`~12:06`), a walk (`~16'`). A live time has none: a bus on OASA's live
  times, a suburban train whose lateness is known. *(v2)*
- The maps stay black in both themes.

### Light and dark

`<html data-bs-theme>` says which one shows; `style.css` has one block of
colour variables for each, with the same names (a test checks), and the
colours that don't change (lines, signs, maps) in `:root`. Never a colour
value outside those blocks.

- **Auto** (the default) follows the phone, but is light only when the phone
  asks for it; a browser that can't say, or can't store, gets dark.
  **Light** and **Dark** are a person's choice, kept on the device
  (`theme` in localStorage, listed on the privacy page). The choice is in the
  menu on phones and the sidebar on wide screens.
- A script in `<head>` sets the mode before anything is drawn
  (`public/js/core/theme.js`, hashed in the CSP); the bar colour
  (`theme-color`) follows it.
- Light colours are the guide's, darkened where a tint over the grey page
  fell under 4.5:1 (green, red, ride-here orange, the menu's gold).
- The logo is drawn in the page (`partials/logo.hbs`), its ring in
  `--wh-brand-dot`: `#ffc107` on dark, `#e89b00` on light.
  The browser-tab icon (`favicon.svg`) does the same by itself when the
  browser asks for light; the app icons, share image and PNG favicons are
  fixed, dark tiles (a home screen can't switch). A station sign's off-white panel gets a grey edge on light.
- Forced colours: pills, signs and maps keep their own colours; the car to
  ride in gets an outline; time badges an edge.

## Lines and stations

- One builder, `/js/core/lines.js`: `linePill(id, name, size)` for metro
  and tram lines, `busPlate(number, size)` for buses; views write
  `{{pill "M3"}}` and `{{plate "X95"}}`. Never a line's name as bare text.
- Three sizes, in em inside: **S** in lists (station suggestions, the
  stations by line, a stop's lines), **M** in sentences, arrival rows and
  tables, **L** in the headers of leg cards, station sections and bus stops.
  The Trip page's step headings, the quicker way's sentence and its other
  ways' lines are M. *(v2)*
- The text in a pill sits dead centre: its box is trimmed to the capitals
  (`text-box`), so the padding is the same above and below the letters, and
  M1's pill makes up for Roboto's off-centre 1
  (`test/browser/pills.spec.js` measures it).
- A station page's line section is headed by the large pill alone, with
  "Line 2" for screen readers.
- Bus numbers are neutral plates everywhere, the stop header's too. A plate
  that opens its line has blue text.
- Several pills in a row have a space between them and a comma for screen
  readers (`pillList`).
- **Station signs** (`stationSign`), like the real ones: an off-white
  panel, the same in both themes, with the line colours on its top and
  bottom edges. Only metro lines are edges, the lower number on top
  (Syntagma: M2 above, M3 below) until the field trip checks the other
  interchanges. They show the direction of travel: the leg card's header
  (`[M1] → [Kifisia]`) and the station page's direction cards, both with
  the large pill; and the station page's title, in the large size.
- **A direction's sign names where the line ends**, as the real ones do,
  even when the next train turns back sooner: M3 toward the airport is
  "Airport", not "Doukissis / Airport" (`lineEnd` in `/js/core/metro.js`).
  So does "Changing to M3 toward …" and what screen readers hear.
  The suburban railway is the exception: a train names where **it** ends,
  as many end sooner than their line (A1 and A4 at Tavros, A3 at Afidnes or
  Oinoi) and trains are rare, so the one that comes is the one to read
  (decided 8 November 2026, decision 41), named as the train shows it,
  without the "(suburban)" that tells its station apart in the subway
  planner's list.
- In the page's language only, tight, one line where it fits (a name too
  long for the screen at large text wraps). A label, not a link. Change and
  get-off stations stay plain links. The name is centred top to bottom like
  the pills' (side to side it's a word: its letters have their own spaces).

## Icons

Material Symbols Rounded, by meaning: code names what an icon means
(`icon('walk')`, `{{icon "change-trains"}}`), and `MEANINGS` in
`server/pages/icons.js` is the one list of meanings and their pictures.

- **One meaning per icon, one icon per meaning.** Walking directions are
  the walking figure everywhere; changing trains is one figure, not two
  arrows.
- **Outline beside a word. Filled when the icon stands alone as the
  information**: status (all clear, warning, error) and the symbols in the
  train (the way out, a lift). **The current tab is filled**, the others
  outline.
- **A toggle's icon is outline when off, filled when on**: the favourites'
  star, gold when starred, and Nearest and My location, blue when on
  (`aria-pressed` says it to screen readers). *(v2: My location)*
- Each carriage to ride in shows how it leads off the platform, filled: an
  escalator up, stairs, or, while that isn't recorded (`escalators` and
  `stairs` in positions.json, set in the station editor), an up arrow. A
  lift is marked on its own carriage. The walking figure is for walking
  directions only.
- Under every set of train diagrams (trip results, a station's page), a
  legend says in words what they show: open, closable, only the symbols
  that are there (`diagramLegend` in `/js/core/metro.js`).
- Sizes: 1.25em beside words (Material draws inside a margin), centred on
  the capitals; 1.5rem in the navigation (`icon-nav`); 1.75rem on the home
  tiles; 3rem above a page's message (`icon-message`).
- Colour follows the text, except the home tiles and section heads
  (primary), the carriage to ride in, the lift, and status icons.
- A new icon: add its meaning to `MEANINGS`, then `npm run icons` copies its
  SVG into `server/icons/` (the package is a dev dependency; the server
  never installs it).

## Components

### Notice

One boxed message, `notice(tone, icon, content)` in `/js/core/html.js`: an
icon and the text, in a 12px-cornered box with a 1px edge, text at `sm`.
Four tones, each also told by its icon and its words, never by colour
alone. The tone follows what the message means for the answer *(v2)*:

| Tone | For | Icon |
|---|---|---|
| `danger` | Something Wayhop uses isn't working, so the answer is missing it: bus or train times that didn't load, live times unavailable (buses or trains), a lift status missing or over 30 minutes old *(v2)* | error |
| `warn` | The answer may be off: an old timetable, no route, paused or stale times, a disruption, a station that can't be reached step-free | warning |
| `info` | How to read the answer: tomorrow's first trains, a long walk, a newer Wayhop waiting, lifts out where the station can still be reached | what it's about: night, walk, bus, step-free *(v2)* |
| `ok` | All clear: no disruption announcements | ok |

An error, a warning and all clear always show their own status icon,
filled, except the step-free notice, which keeps the step-free symbol as a
warning too, so the people who rely on lifts spot it at once (decided 10
November 2026). Margins come from where it's put (`mb-3`), not from the
notice.
Yellow is for warnings only.

Nothing under an answer says where its times come from: the About page
credits every source. *(v2)*

### Step-free notice

`liftNotice` in `/js/core/lifts.js`, above an answer that uses stations: the
stations that can't be reached step-free (`warn`) or have lifts out but can
still be reached (`info`), with the step-free symbol in both, closable to
its first line, which names them. On
the Subway page, and on the Trip page for every station its rides use
*(v2)*. No source line under it *(v2)*. A lift status over 30 minutes old,
or none, is an error ("Lift status unavailable right now, so lifts out of
service aren't shown"), with any outages already known still listed under
it *(v2)*. A notice that only lists platforms with steps ends with
`liftCaution` (decision 18).

### Time badge

One badge for when something leaves, buses and trains alike:
`timeBadge(tier, content)` in `/js/core/times.js`, text at `sm`, weight 700,
tabular figures, 6px corners. Its colour is how soon:

| Tier | When | Look |
|---|---|---|
| `due` | 3 minutes or less | solid green, dark text |
| `close` | 4 to 8 | green tint |
| `later` | 9 or more, and every clock time (tomorrow, the first trains of the morning) | neutral |

For trains, the **last** train is red and the **second to last** amber,
overriding the green. Never colour alone: the badge's text for screen
readers and its `title` say it, and a line of its own under the line and its times says it to the
eyes ("Last train 23:57", with the clock time, so it's clear which badge it
means). The tints are 10% of their colour, which keeps the text on them at
4.5:1 on every surface (`test/accessibility.test.js`).

A late suburban train's badge is when it actually leaves: no timetable
time and no "running late" line. *(v2)*

### Tag

A short fact about the thing beside it ("Doors open on the left", "Only
available in Greek"): `.tag`, a pill with a 1px control edge, 14px text in
the body colour, an icon in front when it helps. Quiet: a tag never takes
a meaning colour, and it is not pressable (blue is for what you can press).

### List rows

A stop, an arrival and a search result each end in the same quiet line
(`--wh-divider`), none under the last. A stop's row at large text (below
18em wide) stacks: the stop's band runs the whole width, the next bus under
it, the time and the walking directions on a line of their own under that.

### Walking directions

The walking figure, grey, as tall as its row, at the far right: a bus
stop's row on the Buses page, and each walk on the Trip page *(v2)*. The
words beside it ("Walk to Tavros") are plain text, not a link; screen
readers hear "Walking directions to Tavros".

### Start from here

Nearest on the Subway page and My location on the Trip page are one toggle
*(v2: My location)*. Off: grey, the icon outline. On: blue, the icon
filled, following where you are. On by default when the page opens without
a start, from a recent position or a location the browser already allows;
nothing asks for location when the page opens. Typing or picking a start,
swapping, or blocked location turns it off; pressed again, it looks again.

### Switch

For a setting that stays until it's changed, like showing the tram stops or
the suburban railway's stations, in words on one line, side by side while they
fit: Bootstrap's switch with its label, in `--bs-primary` when on
(Bootstrap's own blue is fixed), and the whole row at least 2.75rem high. What
acts on the page right now stays a button, like Nearest.

## The Trip page *(v2)*

The Trip page came a week after version 1; version 2 of the guide has its
rules, with a picture of a way shown in full.

- **The way shown in full** is one card. Its heading is how long the trip
  takes and when you arrive, both in the body colour. Walks and bus rides
  are rows with a 3rem column on the left; metro, tram and suburban rides
  are the Subway page's leg card, inside the trip's card. Every other way
  is one line. Nothing under the answer.
- **A walk**: `~16'` on the left, "Walk to …" in plain text with the
  distance under it, walking directions at the far right.
- **A bus ride**: on the left, the clock time it leaves, `md`, bold, the
  body colour, with `~` when it's from OASA's timetable. The heading is the
  M plate and "towards …" in words (a bus shows where it goes on its front,
  so no station sign). At the right end of the heading's line, the bus's
  badge and the next one's; none an hour or more away, as the clock time
  says it. Where any of several buses will do, the stops with their lines
  and badges, or "Not on live times yet".
- **A metro, tram or suburban ride** is the Subway page's card as it is:
  where to board, the L pill → the direction's sign, the badges, the
  last-train words, the train diagram (metro), notes, where to change or get
  off, the stations on the way. Its badges start at the first train the
  rider can catch: now plus the walk to the platform, or after a ride, from
  when they get there; past an hour, clock times. The suburban railway is
  the same as the metro and the tram, with no time on the left. The legend
  of what the train shows comes under the way; no "Where to stand" button.
- **Above the answer**: notices by their tones, and the step-free notice.
- **My location** works exactly like Nearest. It re-plans when the rider is
  200m or more from where the trip was last planned, at most every 2
  minutes, and keeps following while they ride (numbers for OASA's sake,
  agreed 10 November 2026; the pull request comes with its decision page).
- **Later, agreed**: with "Following your own ride", a way 3' or more
  sooner found on the way is switched to after 10 seconds unless the rider
  keeps theirs: a visible countdown that pauses while the notice is touched
  or has the keyboard, "Back to my route" after, a declined way not offered
  again, on the page only (a vibration on Android). The "Any of these
  buses" stops become the Buses page's stop rows.

## Tests

- `test/design.test.js`: the tokens are the scale; sizes, corners, shadows,
  px and breakpoints in `style.css` use them.
- `test/accessibility.test.js`: in both colour modes, every text colour on every surface, the line
  colours, the control edge; and that no page shows a line's name outside
  its pill (`bareLineProblems` in `test/support/markup.js`, which the
  checks on what the browser draws run too).
- `test/icons.test.js`: every icon the code shows is a meaning, every
  meaning is shown, no picture means two things, status and train symbols
  are filled, `server/icons/` matches the list and the package.
- `test/theme.test.js`, `test/browser/theme.spec.js`: the mode logic, the
  switch, remembering, forced colours; `pages.spec.js` runs axe-core on
  every page in light too.
- `test/times.test.js`: minutes are written one way: no string writes
  ′, "min" or "{minutes} minutes", and no script draws the mark but
  `times.js`.
- `test/browser/text-size.spec.js`: every page at 200% text, as above, the
  Trip page's answers (a way by bus with live times, the quicker way, a way
  by suburban train), and the two parts that change shape.
