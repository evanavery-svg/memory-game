# Recall

A minimalist memory game. A pattern of tiles flashes for a moment — tap every
tile you saw. Clear a board and a new, slightly harder one appears.

Designed mobile-first to feel like an Apple product: black and white only,
generous whitespace, soft spring motion. Works great on desktop too.

## Play

Open `index.html` in any modern browser, or serve the folder and add it to your
home screen — it installs as a standalone app and works offline.

No build step, no dependencies.

## Features

- **Four modes**
  - **Endless** — clear boards as far as you can.
  - **Sprint** — most points in 60 seconds; a miss costs time instead of a life.
  - **Daily** — a deterministic seed gives everyone the same boards each day,
    with a spoiler-free, Wordle-style result you can copy and share.
  - **Order** — tiles flash one at a time; tap them back in the same sequence.
- **Adaptive difficulty** — flash time self-calibrates to your skill as you play
  (off in Daily, and can be disabled in Settings).
- **First-run tutorial** — a short guided round the first time you open the app.
- **Combo multiplier** — clear a board with no misses to build ×2, ×3 … up to
  ×9. One miss resets it.
- **Power-ups** — combos earn **Peek** (re-flash the pattern) and **Skip**
  (auto-clear a board). They surface beside the board only when you have them.
- **Level-up checkpoints** — every five levels, a brief full-screen beat marks
  the milestone.
- **Colored milestone levels** — the opening level and every fifth one break the
  black-and-white palette: tiles flash in color and a correct tap pops with an
  expanding ring. Everything else stays strictly monochrome.
- **Daily streaks** — playing on consecutive days builds a streak, with a
  contribution-style calendar of prior days and your longest run.
- **Achievements** — nine unlockable badges (combos, levels, streaks, a clean
  Sprint…) with a toast when you earn one.
- **Gradual difficulty** — the grid grows from 3×3 toward 6×6 and lit tiles climb
  slowly. Flash time scales with how many tiles you must memorize, so harder
  boards get a longer look. Three presets:
  - **Casual** — longer flash, five lives.
  - **Standard** — balanced, three lives.
  - **Hard** — quick flash, two lives, a faster ramp.
- **Dark mode** — follows the system theme, or lock it Light/Dark. A one-tap
  toggle lives in the top bar.
- **Accessibility** — a high-contrast option, keyboard focus outlines, live
  status announcements for each round phase, and reduced-motion support.
- **Sound & haptics** — generated WebAudio tones (no asset files) and vibration
  on supported devices. Both can be muted.
- **Stats & history** — games played, tap accuracy, best level, best combo, a
  sparkline of recent scores, and per-mode bests. Saved locally.
- **Back up & restore** — export your progress to a JSON file and import it on
  another device.
- **Shareable result card** — a generated black-and-white image of your score
  via the native share sheet (with a download fallback).
- **Installable PWA** — manifest, icons, and a service worker for full offline
  play. Online, the app loads network-first so you always get the latest
  version, and it auto-reloads once when a new version takes over — no manual
  refresh or reinstall.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: HUD, board, and the home/settings/stats/help/end screens |
| `style.css` | Black-and-white design, dark mode, animations |
| `game.js` | Game state, modes, difficulty curve, sound, stats, share card |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker for offline caching |
| `icons/` | App icons (standard + maskable) |
