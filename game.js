(() => {
  "use strict";

  // ---------- Elements ----------
  const boardEl = document.getElementById("board");
  const levelEl = document.getElementById("level");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const livesEl = document.getElementById("lives");
  const promptEl = document.getElementById("prompt");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const cta = document.getElementById("cta");
  const resetBtn = document.getElementById("reset");

  // ---------- Constants ----------
  const MAX_LIVES = 3;
  const BEST_KEY = "recall.best";

  // ---------- State ----------
  const state = {
    level: 1,
    score: 0,
    best: Number(localStorage.getItem(BEST_KEY)) || 0,
    lives: MAX_LIVES,
    target: new Set(), // indices that were lit
    found: new Set(), // indices correctly tapped
    gridSize: 3,
    locked: true, // input disabled while flashing / transitioning
    playing: false,
  };

  bestEl.textContent = state.best;

  // ---------- Difficulty curve ----------
  // Gradual: grid grows slowly, lit-tile count scales with the board,
  // and the flash time shrinks gently as you go.
  function difficultyFor(level) {
    // Grid grows one step roughly every 3 levels: 3,3,3,4,4,4,5,5,5,6...
    const gridSize = Math.min(3 + Math.floor((level - 1) / 3), 6);
    const cells = gridSize * gridSize;

    // Lit tiles: start at 3, climb gently, capped near ~45% of the board.
    const lit = Math.min(2 + Math.ceil(level * 0.9), Math.floor(cells * 0.45));

    // Flash time eases from 1500ms down to a 700ms floor.
    const flashMs = Math.max(1500 - (level - 1) * 70, 700);

    return { gridSize, lit: Math.max(3, lit), flashMs };
  }

  // ---------- Rendering ----------
  function renderStats() {
    levelEl.textContent = state.level;
    scoreEl.textContent = state.score;
    bestEl.textContent = state.best;
  }

  function bump(el) {
    el.classList.remove("bump");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("bump");
  }

  function renderLives() {
    livesEl.innerHTML = "";
    for (let i = 0; i < MAX_LIVES; i++) {
      const dot = document.createElement("span");
      dot.className = "life" + (i >= state.lives ? " lost" : "");
      livesEl.appendChild(dot);
    }
  }

  function buildBoard(size) {
    state.gridSize = size;
    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardEl.classList.remove("interactive");
    boardEl.innerHTML = "";
    const total = size * size;
    for (let i = 0; i < total; i++) {
      const tile = document.createElement("button");
      tile.className = "tile enter";
      tile.style.animationDelay = `${i * 12}ms`;
      tile.dataset.index = String(i);
      tile.setAttribute("role", "gridcell");
      tile.setAttribute("aria-label", "tile");
      tile.addEventListener("click", () => onTileClick(i, tile));
      boardEl.appendChild(tile);
    }
  }

  function tileAt(index) {
    return boardEl.children[index];
  }

  // ---------- Helpers ----------
  function sample(total, count) {
    const pool = Array.from({ length: total }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return new Set(pool.slice(0, count));
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Round flow ----------
  async function startRound() {
    const { gridSize, lit, flashMs } = difficultyFor(state.level);

    state.locked = true;
    state.found = new Set();

    buildBoard(gridSize);
    state.target = sample(gridSize * gridSize, lit);

    promptEl.textContent = "Memorize";
    promptEl.style.opacity = "1";

    // Let the entrance animation breathe, then flash the pattern.
    await wait(420);
    for (const idx of state.target) tileAt(idx).classList.add("lit");

    await wait(flashMs);
    for (const idx of state.target) tileAt(idx).classList.remove("lit");

    await wait(260);
    promptEl.textContent = `Find ${state.target.size} tile${state.target.size > 1 ? "s" : ""}`;
    boardEl.classList.add("interactive");
    state.locked = false;
  }

  function onTileClick(index, tile) {
    if (state.locked || !state.playing) return;
    if (state.found.has(index)) return;

    tile.classList.add("tap");
    setTimeout(() => tile.classList.remove("tap"), 300);

    if (state.target.has(index)) {
      // Correct pick
      state.found.add(index);
      tile.classList.add("correct");
      if (state.found.size === state.target.size) {
        roundWon();
      }
    } else {
      // Wrong pick
      tile.classList.add("wrong");
      loseLife();
    }
  }

  function roundWon() {
    state.locked = true;
    boardEl.classList.remove("interactive");

    // Score rewards board difficulty and remaining lives.
    const gained = state.target.size * 10 + state.level * 5;
    state.score += gained;
    state.level += 1;

    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(BEST_KEY, String(state.best));
      bump(bestEl);
    }

    renderStats();
    bump(scoreEl);
    bump(levelEl);

    promptEl.textContent = "Perfect";

    setTimeout(startRound, 850);
  }

  function loseLife() {
    state.lives -= 1;
    renderLives();

    if (state.lives <= 0) {
      gameOver();
      return;
    }

    // Brief lock so the shake reads, then let them keep trying this board.
    state.locked = true;
    promptEl.textContent =
      state.lives === 1 ? "Last life — careful" : "Missed one";
    setTimeout(() => {
      const last = boardEl.querySelector(".tile.wrong");
      if (last) last.classList.remove("wrong");
      if (state.playing && state.lives > 0) {
        promptEl.textContent = `Find ${state.target.size - state.found.size} more`;
        state.locked = false;
      }
    }, 700);
  }

  // ---------- Game lifecycle ----------
  function newGame() {
    state.level = 1;
    state.score = 0;
    state.lives = MAX_LIVES;
    state.playing = true;
    renderStats();
    renderLives();
    hideOverlay();
    startRound();
  }

  function gameOver() {
    state.locked = true;
    state.playing = false;
    boardEl.classList.remove("interactive");

    // Reveal the tiles that were missed for a beat of closure.
    for (const idx of state.target) {
      if (!state.found.has(idx)) tileAt(idx).classList.add("missed");
    }

    const isBest = state.score >= state.best && state.score > 0;
    setTimeout(() => {
      showOverlay(
        "Game Over",
        `You reached level ${state.level} with a score of ${state.score}.` +
          (isBest ? "<br />A new personal best." : ""),
        "Play again"
      );
    }, 900);
  }

  // ---------- Overlay ----------
  function showOverlay(title, html, ctaLabel) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    cta.textContent = ctaLabel;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  // ---------- Events ----------
  cta.addEventListener("click", newGame);
  resetBtn.addEventListener("click", () => {
    if (
      !state.playing ||
      window.confirm("Restart the game? Your current run will end.")
    ) {
      state.playing = false;
      showOverlay(
        "Recall",
        "A pattern of tiles will flash for a moment.<br />Tap every tile you saw. One miss costs a life.",
        "Start"
      );
    }
  });

  // Keyboard: space / enter to start when overlay is up.
  document.addEventListener("keydown", (e) => {
    if (
      !overlay.classList.contains("hidden") &&
      (e.key === " " || e.key === "Enter")
    ) {
      e.preventDefault();
      newGame();
    }
  });

  // Build an idle board behind the overlay for visual warmth.
  buildBoard(3);
  renderLives();
})();
