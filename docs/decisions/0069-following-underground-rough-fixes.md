# 69. Following underground: a trace first, then rough fixes on rail, provisionally

Decided 2026-11-22 · In force

## Situation

The Trip page follows the rider along their way from My location
([50](0050-trip-follows-the-ride.md), [60](0060-trip-follows-within-20-metres.md)).
Underground there's no GPS. Any fix less exact than 200 m, which is what a
cell tower or a Wi-Fi network gives, places nobody (`follow.js`
`ROUGH_METRES`). So the page stays at the last station where the GPS
worked, and From's status line counts the minutes since then.

On 17 November 2026 the rider turned down moving them on by the
timetable with no fix: timetables are often off, with a train at the
platform while Wayhop says 3 minutes. Their call was to use whatever
signal the phone gets on the way, as best it can (roadmap Signal).

What a phone actually gets underground in Athens isn't known: rough
fixes, and how rough and how often, or nothing at all. If it's nothing,
no rule about rough fixes can help.

## Decision

Agreed with the rider on 22 November 2026, every option as recommended.

- **A trace first.** `/trip?trace` turns on a recorder on the Trip page
  (`tools/trip/client/trace.js`), and it stays on, the app opened again
  included, until "Stop and delete". It writes down:
  - every position the page gets, with its accuracy and speed, and when
    it reached the page
  - the page hidden and shown, and location problems
  - the way followed, and where `follow.js` placed the rider on it after
    each position
  - the stations the rider marks with "At a station" as the doors open,
    which is the truth any rule is scored against

  It records the same browser, with the same location settings, that
  following uses. It's kept on the phone only (the last 10,000 entries),
  and leaves it only when the rider saves it as a file and sends it.
  Off, nothing is kept. The privacy page says so.
- **Location only.** The motion sensor isn't recorded. Counting a
  train's stops from it would need the page open and a permission on
  iPhone, and trains also stop at red signals in tunnels. Recording it
  waits until the trace shows rough fixes are too rare.
- **Then the rule, with numbers from the trace**, proposed to the rider
  before it's built:
  - Only on rail: metro and suburban rides, waiting for them, and a change
    between two of them underground. Never on walks, buses, trolleys or
    trams, whose stops are close together and above ground.
  - A rough fix moves the rider to a station only when it's the only
    station of the ride inside the fix's accuracy circle, and the fix is
    no rougher than a cap. Station spacing decides by itself: a Wi-Fi fix
    of 50 m at a station counts, but a cell fix of 1.5 km in the centre,
    where stations are 600 m apart, doesn't.
  - Never back, never off the way, never a re-plan from a rough fix, and
    never past the ride's last station. The exact fix after surfacing
    walks the rider out.
  - **Provisional**: the next exact fix places the rider from the last
    station an exact fix confirmed. A wrong jump ahead is then corrected,
    rather than taken as the rider being off the way, which "never back"
    would otherwise make it, with a re-plan as they surface.
- OASA is asked as before: nothing here changes how often.

## What follows

- Step 1, the trace, in its own pull request. Step 2, the rider's rides
  with it on (the M3, and the M2 if possible), replayed by Claude through
  the candidate rules, and the numbers proposed. Step 3, the rule in
  `follow.js` with a test along the M3 using rough fixes. This page will
  be replaced if the numbers change the rule's shape.
- What the rider sees then: the arrival time timed from the real station,
  the step marked moving on through a change underground, and the search
  ahead for a quicker way at each station, as above ground.
- The trace can stay for later checks on the road, Follow · motion among
  them.

## Look again when

- The trace shows no fixes at all underground: then the rough-fix rule is
  moot, and the motion sensor, or nothing, is what's left.
- The trace shows rough fixes that are wrong more often than their
  accuracy says.
