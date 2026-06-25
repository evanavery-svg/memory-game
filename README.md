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

- **Three modes**
  - **Endless** — clear boards as far as you can.
  - **Sprint** — most points in 60 seconds; a miss costs time instead of a life.
  - **Daily** — a deterministic seed gives everyone the same boards each day.
- **Combo multiplier** — clear a board with no misses to build ×2, ×3 … up to
  ×9. One miss resets it.
- **Gradual difficulty** — the grid grows from 3×3 toward 6×6, lit tiles climb
  slowly, and the flash time eases down. Three presets:
  - **Casual** — longer flash, five lives.
  - **Standard** — balanced, three lives.
  - **Hard** — quick flash, two lives, a faster ramp.
- **Dark mode** — follows the system theme, or lock it Light/Dark. A one-tap
  toggle lives in the top bar.
- **Sound & haptics** — generated WebAudio tones (no asset files) and vibration
  on supported devices. Both can be muted.
- **Stats & history** — games played, tap accuracy, best level, best combo, a
  sparkline of recent scores, and per-mode bests. Saved locally.
- **Shareable result card** — a generated black-and-white image of your score
  via the native share sheet (with a download fallback).
- **Installable PWA** — manifest, icons, and a service worker for full offline
  play.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: HUD, board, and the home/settings/stats/help/end screens |
| `style.css` | Black-and-white design, dark mode, animations |
| `game.js` | Game state, modes, difficulty curve, sound, stats, share card |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker for offline caching |
| `icons/` | App icons (standard + maskable) |
