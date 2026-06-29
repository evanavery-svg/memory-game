# Recall

A minimalist memory game. A pattern of tiles flashes for a moment — tap every
tile you saw. Clear a board and a new, slightly harder one appears.

Designed mobile-first to feel like an Apple product: black and white only,
generous whitespace, soft spring motion. Works great on desktop too.

The landing screen is deliberately spare — just the mark, the name, and a
single **Play** button. Tapping it cross-fades to a quiet memory quote, held
for a moment; the quote then floats gently down to rest just below the
mode nav. Only once it has fully settled do the mode bar (and Stats, Settings,
How to play), the top-left **Recall** wordmark + animated mark, and the footer
copyright fade in.

## Play

Open `index.html` in any modern browser, or serve the folder and add it to your
home screen — it installs as a standalone app and works offline.

No build step, no dependencies.

## Features

- **Five modes**
  - **Endless** — clear boards as far as you can.
  - **Expert** — for veterans: skips the gentle early boards and drops you in at
    level 8, with its own best score.
  - **Sprint** — most points in 60 seconds; a miss costs time instead of a life.
  - **Daily** — a deterministic seed gives everyone the same boards each day,
    with a spoiler-free, Wordle-style result you can copy and share. One run per
    day — it locks the moment you start (no retries) and resets at midnight local
    time. The ramp turns brutal from level 15 on. Today's date sits as a quiet
    caption under the wordmark while you play.
  - **Order** — tiles flash one at a time; tap them back in the same sequence.
- **Adaptive difficulty** — flash time self-calibrates to your skill as you play
  (off in Daily, and can be disabled in Settings).
- **First-run tutorial** — a short guided round the first time you open the app.
- **Combo multiplier** — clear a board with no misses to build ×2, ×3 … up to
  ×9. One miss resets it.
- **Power-ups** — combos earn **Peek** (re-flash the pattern) and **Skip**
  (auto-clear a board). They surface beside the board only when you have them.
- **Snake interludes** — every five levels (5, 10, 15…) the run pauses for a
  quick game of Snake on the same cube grid. Swipe or use the arrow keys; eat
  the squares to grow. It's a pure bonus — your score and lives carry on
  untouched when you continue, and Sprint's clock is frozen while you play. Your
  best Snake score is kept locally.
- **Pause / resume** — the back button mid-run freezes everything (timer, flash,
  board) behind a Resume / Quit overlay, so an interruption never costs you a
  run.
- **Replay what you missed** — on game over the full board you were meant to
  clear flashes back, then marks which tiles you got versus missed, before the
  end screen.
- **Rare color levels** — about one board in twenty breaks the black-and-white
  palette: tiles flash in color and a correct tap pops with a small ring.
  Everything else stays strictly monochrome.
- **Daily streaks** — playing on consecutive days builds a streak, with a
  contribution-style calendar of prior days and your longest run, plus a
  **this-week strip** of your Daily scores with the best day highlighted.
- **Achievements** — nine unlockable badges (combos, levels, streaks, a clean
  Sprint…) with a toast when you earn one. Locked badges show a progress bar and
  how close you are to earning them.
- **Gradual difficulty** — the grid grows from 3×3 toward 6×6 and lit tiles climb
  slowly. Flash time scales with how many tiles you must memorize, so harder
  boards get a longer look. Three presets:
  - **Casual** — longer flash, five lives.
  - **Standard** — balanced, three lives.
  - **Hard** — quick flash, two lives, a faster ramp.
- **Dark mode** — automatically follows your device's light/dark setting and
  flips live when the system theme changes. No toggle to manage.
- **Accessibility** — a high-contrast option, keyboard focus outlines, live
  status announcements for each round phase, and reduced-motion support.
- **Sound & haptics** — generated WebAudio tones (no asset files) and vibration
  on supported devices. The palette is deliberately minimal: short, quiet cues,
  each gently detuned for warmth and run through a shared mastering chain — a
  soft low-pass, a limiter to glue overlapping notes, and a subtle reverb for
  space — so nothing sounds like a raw beep. Distinct touches for earning a
  power-up, using Peek vs. Skip, and clearing a colorful board. Both sound and
  haptics can be muted.
- **Stats & history** — games played, tap accuracy, best level, best combo,
  sparklines of recent scores and your accuracy trend, a "when you play"
  time-of-day chart, and per-mode bests with the average level you reach in each.
  Saved locally.
- **Personal-best deltas** — the end screen tells you how a run stacks up against
  your best for that mode: "+N over your best" when you beat it, or how far you
  fell short.
- **Daily reminder** — an optional, off-by-default notification that nudges you
  around noon when the new Daily is ready, plus an evening "last call" before it
  resets at midnight — streak-aware, so it tells you when a run is on the line.
  Tapping either opens straight to Daily.
  Toggle it in Settings (needs notification permission, and on iOS the app must
  be added to the Home Screen), where a **Send a test notification** button lets
  you preview it. Delivered locally where the browser supports periodic
  background sync — guaranteed scheduled delivery would need a small push
  backend.
- **Back up & restore** — export your progress to a JSON file and import it on
  another device.
- **Shareable result card** — a generated black-and-white image of your score
  via the native share sheet (with a download fallback). A **Share** link in the
  menu also invites a friend to play — the native share sheet when available, or
  the app link copied to your clipboard otherwise.
- **Installable PWA** — manifest, icons, and a service worker for full offline
  play. Online, the app loads network-first so you always get the latest
  version, and it auto-reloads once when a new version takes over — no manual
  refresh or reinstall. First-time iOS Safari visitors get a one-time hint
  showing the Share → Add to Home Screen flow.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: HUD, board, and the home/settings/stats/help/end screens |
| `style.css` | Black-and-white design, dark mode, animations |
| `game.js` | Game state, modes, difficulty curve, sound, stats, share card |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker for offline caching |
| `icons/` | App icons (standard + maskable) |
