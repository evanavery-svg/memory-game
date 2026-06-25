# Recall

A minimalist memory game. A pattern of tiles flashes for a moment — tap every
tile you saw. Clear a board and a new, slightly harder one appears. One miss
costs a life; three misses end the run.

Inspired by tools like Lumosity, designed to feel like an Apple product:
black and white only, generous whitespace, soft motion.

## Play

Open `index.html` in any modern browser. No build step, no dependencies.

## How it works

- **Gradual difficulty** — the grid grows from 3×3 toward 6×6 about every three
  levels, the number of lit tiles climbs slowly, and the flash time eases from
  1.5s down to a 0.7s floor.
- **Three lives** per run, shown as dots beneath the board.
- **Scoring** rewards harder boards and deeper levels; your best score is saved
  locally between sessions.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and layout |
| `style.css` | Black-and-white visual design and animations |
| `game.js` | Game state, difficulty curve, and round flow |
