# iReal Metronome

A metronome that looks like an iReal Pro chart. Instead of a blinking dot you
get a real-looking lead sheet with a playhead stepping from measure to measure,
beat dots inside the current bar, and the sounding chord picked out in blue.

Click only — there is no backing band. The chord symbols are there so you know
where you are, not because anything plays them.

## Running it

No build, no dependencies, no server:

```
open index.html
```

Plain `<script>` tags rather than ES modules, so opening the file directly
works — modules would be blocked by CORS on `file://`.

## Writing a chart

Click a measure and type chords separated by spaces:

| You type      | You get                           |
|---------------|-----------------------------------|
| `F7`          | one chord for the whole bar       |
| `G-7 C7`      | two chords, split at the halfway  |
| `F7 . . C7`   | beats 1 and 4, `.` leaves a gap   |
| `A7 D7 G7 C7` | one per beat                      |

`Enter` or `Tab` commits and moves to the next measure, `Esc` cancels.

Both notations work, iReal Pro's shorthand and the plain spellings:

| Sound             | Shorthand | Plain            | Renders |
|-------------------|-----------|------------------|---------|
| major 7           | `C^7`     | `Cmaj7`, `CM7`   | C△7     |
| minor 7           | `C-7`     | `Cm7`, `Cmin7`   | C-7     |
| half diminished   | `Ch7`     | `Cm7b5`          | Cø7     |
| diminished 7      | `Co7`     | `Cdim7`          | C°7     |
| augmented         | `C+`      | `Caug`           | C+      |
| minor-major 7     | `C-^7`    | `CmMaj7`         | C-△7    |

Also handled: alterations stacked vertically (`C7b9#11`), slash chords (`F/A`),
sixth-ninths (`Bb69`), suspensions (`G7sus4`), `Calt`, `N.C.`, and `%` for
"same as the last bar". Case matters where the convention does — `M` is major,
`m` is minor.

Select a measure and the panel underneath sets its section letter, repeat
barlines and repeat count, double bar, and inserts or deletes measures.

## Playing

| Control            | What it does                                        |
|--------------------|-----------------------------------------------------|
| Space              | start / stop                                        |
| Tap (or `T`)       | tap tempo, averaged over the last few taps          |
| ↑ / ↓              | tempo ± 1                                           |
| ← / →              | move the selection                                  |
| Enter              | edit the selected measure                           |
| +bpm / repeat      | speeds up each time through, iReal Pro style        |
| Loop               | off means it stops at the end of the form           |

Repeat signs expand into the play order, so `{ … }` with a count of 2 plays the
section twice before moving on. One level deep — nested repeats are not
supported, and a close with no matching open repeats from the top.

## Timing

Beats are scheduled ahead against the Web Audio clock — a 25 ms interval fills
a 100 ms window — so the click does not drift the way `setTimeout` would. The
playhead reads the same queue, which is why the highlight lands with the sound
rather than near it.

## Files

```
index.html      markup for the transport, sheet, and measure editor
css/chart.css   paper, chord typography, barlines, playhead
css/ui.css      transport bar and measure editor
js/chords.js    chord text -> lead-sheet markup
js/chart.js     model, repeat expansion, rendering
js/audio.js     Web Audio click scheduler
js/app.js       wiring, editing, persistence
```

The chart and settings persist to `localStorage`; Export and Import move charts
around as JSON. There is no `irealb://` import — that format would need its own
parser.
