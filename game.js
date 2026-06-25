(() => {
  "use strict";

  /* ============================================================
     Elements
     ============================================================ */
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const hudEl = $("hud");
  const primaryEl = $("stat-primary");
  const primaryLabel = $("label-primary");
  const scoreEl = $("score");
  const bestEl = $("best");
  const livesEl = $("lives");
  const promptEl = $("prompt");
  const comboEl = $("combo");
  const comboX = $("combo-x");
  const backBtn = $("back-btn");
  const themeBtn = $("theme-btn");
  const themeColorMeta = $("theme-color");

  const screens = {
    home: $("home-screen"),
    settings: $("settings-screen"),
    stats: $("stats-screen"),
    help: $("help-screen"),
    end: $("end-screen"),
  };

  /* ============================================================
     Persistence
     ============================================================ */
  const PREFS_KEY = "recall.prefs";
  const STATS_KEY = "recall.stats";

  const prefs = Object.assign(
    {
      mode: "endless",
      difficulty: "standard",
      theme: "system",
      sound: true,
      haptics: true,
    },
    readJSON(PREFS_KEY, {})
  );

  const stats = Object.assign(
    {
      gamesPlayed: 0,
      totalTaps: 0,
      correctTaps: 0,
      bestLevel: 0,
      bestCombo: 0,
      best: { endless: 0, sprint: 0, daily: 0 },
      recent: [],
    },
    readJSON(STATS_KEY, {})
  );

  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }
  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }
  function saveStats() {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }

  /* ============================================================
     Config: modes & difficulty
     ============================================================ */
  const MODES = {
    endless: { label: "Level", timed: false, hint: "Clear boards forever. Three lives." },
    sprint: {
      label: "Time",
      timed: true,
      duration: 60,
      wrongPenalty: 2,
      hint: "Most points in 60 seconds. Misses cost time.",
    },
    daily: { label: "Level", timed: false, seeded: true, hint: "The same boards for everyone, every day." },
  };

  const DIFFS = {
    casual: { lives: 5, flashBonus: 420, scale: 0.8, hint: "Longer flash. Five lives." },
    standard: { lives: 3, flashBonus: 0, scale: 1, hint: "Balanced flash time. Three lives." },
    hard: { lives: 2, flashBonus: -260, scale: 1.3, hint: "Quick flash. Two lives." },
  };

  /* ============================================================
     State
     ============================================================ */
  const MAX_LIVES_DISPLAY = 6;
  const state = {
    mode: prefs.mode,
    diff: prefs.difficulty,
    level: 1,
    score: 0,
    lives: 3,
    maxLives: 3,
    combo: 1,
    bestCombo: 1,
    target: new Set(),
    found: new Set(),
    taps: 0,
    hits: 0,
    locked: true,
    playing: false,
    rng: Math.random,
    timeLeft: 0,
    timerId: null,
  };

  /* ============================================================
     Seeded RNG (mulberry32) for Daily mode
     ============================================================ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailySeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /* ============================================================
     Sound (WebAudio, generated tones) + haptics
     ============================================================ */
  let audioCtx = null;
  function ac() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, { type = "sine", gain = 0.06, slideTo = null } = {}) {
    if (!prefs.sound) return;
    const ctx = ac();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function vibrate(pattern) {
    if (prefs.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }
  const sfx = {
    flash: () => tone(523.25, 0.12, { gain: 0.05 }),
    correct: (n = 0) => {
      tone(440 + n * 55, 0.14, { gain: 0.05 });
      vibrate(8);
    },
    wrong: () => {
      tone(150, 0.22, { type: "sawtooth", gain: 0.05, slideTo: 80 });
      vibrate([18, 40, 18]);
    },
    win: () => {
      tone(523.25, 0.12, { gain: 0.05 });
      setTimeout(() => tone(659.25, 0.12, { gain: 0.05 }), 90);
      setTimeout(() => tone(783.99, 0.18, { gain: 0.05 }), 180);
      vibrate(14);
    },
    over: () => {
      tone(330, 0.3, { type: "triangle", gain: 0.06, slideTo: 130 });
      vibrate([30, 60, 30]);
    },
    tick: () => tone(880, 0.05, { gain: 0.04 }),
  };

  /* ============================================================
     Theme
     ============================================================ */
  function applyTheme() {
    const t = prefs.theme;
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    // Sync the status-bar / browser theme color.
    const dark =
      t === "dark" ||
      (t === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    themeColorMeta.setAttribute("content", dark ? "#000000" : "#ffffff");
  }
  themeBtn.addEventListener("click", () => {
    // Quick toggle between light & dark (leaves "system" via settings).
    const dark =
      prefs.theme === "dark" ||
      (prefs.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    prefs.theme = dark ? "light" : "dark";
    savePrefs();
    applyTheme();
    syncSegmented("theme-seg", prefs.theme);
    ac(); // unlock audio on first interaction
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (prefs.theme === "system") applyTheme();
    });

  /* ============================================================
     Difficulty curve
     ============================================================ */
  function boardSpec(level) {
    const d = DIFFS[state.diff];
    const grow = (level - 1) * d.scale;
    const gridSize = Math.min(3 + Math.floor(grow / 3), 6);
    const cells = gridSize * gridSize;
    const lit = clamp(
      2 + Math.ceil(level * d.scale * 0.9),
      3,
      Math.floor(cells * 0.45)
    );
    const flashMs = clamp(1500 - (level - 1) * 70 + d.flashBonus, 600, 2600);
    return { gridSize, lit, flashMs };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ============================================================
     Rendering
     ============================================================ */
  function renderHUD() {
    primaryLabel.textContent = MODES[state.mode].label;
    if (MODES[state.mode].timed) primaryEl.textContent = fmtTime(state.timeLeft);
    else primaryEl.textContent = state.level;
    scoreEl.textContent = state.score;
    bestEl.textContent = stats.best[state.mode] || 0;
  }
  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return s + "s";
  }
  function bump(el) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
  function renderCombo() {
    if (state.combo >= 2) {
      comboEl.hidden = false;
      comboX.textContent = "×" + state.combo;
      comboEl.classList.remove("pulse");
      void comboEl.offsetWidth;
      comboEl.classList.add("pulse");
    } else {
      comboEl.hidden = true;
    }
  }
  function renderLives() {
    livesEl.innerHTML = "";
    if (MODES[state.mode].timed) {
      const t = document.createElement("span");
      t.className = "timer" + (state.timeLeft <= 10 ? " low" : "");
      t.textContent = fmtTime(state.timeLeft);
      livesEl.appendChild(t);
      return;
    }
    for (let i = 0; i < state.maxLives; i++) {
      const dot = document.createElement("span");
      dot.className = "life" + (i >= state.lives ? " lost" : "");
      livesEl.appendChild(dot);
    }
  }

  function buildBoard(size) {
    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardEl.classList.remove("interactive");
    boardEl.innerHTML = "";
    const total = size * size;
    for (let i = 0; i < total; i++) {
      const tile = document.createElement("button");
      tile.className = "tile enter";
      tile.style.animationDelay = `${i * 10}ms`;
      tile.dataset.index = String(i);
      tile.setAttribute("role", "gridcell");
      tile.addEventListener("click", () => onTileClick(i, tile));
      boardEl.appendChild(tile);
    }
  }
  const tileAt = (i) => boardEl.children[i];

  function sample(total, count) {
    const pool = Array.from({ length: total }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(state.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return new Set(pool.slice(0, count));
  }

  /* ============================================================
     Round flow
     ============================================================ */
  async function startRound() {
    const { gridSize, lit, flashMs } = boardSpec(state.level);
    state.locked = true;
    state.found = new Set();

    buildBoard(gridSize);
    state.target = sample(gridSize * gridSize, lit);

    renderHUD();
    promptEl.textContent = "Memorize";

    await wait(420);
    if (!state.playing) return;
    sfx.flash();
    for (const idx of state.target) tileAt(idx).classList.add("lit");

    if (MODES[state.mode].timed) pauseTimer();
    await wait(flashMs);
    if (!state.playing) return;
    for (const idx of state.target) tileAt(idx).classList.remove("lit");
    if (MODES[state.mode].timed) resumeTimer();

    await wait(240);
    if (!state.playing) return;
    promptEl.textContent = `Tap ${state.target.size} tile${
      state.target.size > 1 ? "s" : ""
    }`;
    boardEl.classList.add("interactive");
    state.locked = false;
  }

  function onTileClick(index, tile) {
    if (state.locked || !state.playing || state.found.has(index)) return;

    tile.classList.add("tap");
    setTimeout(() => tile.classList.remove("tap"), 300);

    state.taps++;
    if (state.target.has(index)) {
      state.hits++;
      state.found.add(index);
      tile.classList.add("correct");
      sfx.correct(state.found.size);
      if (state.found.size === state.target.size) roundWon();
    } else {
      tile.classList.add("wrong");
      sfx.wrong();
      missed();
    }
  }

  function roundWon() {
    state.locked = true;
    boardEl.classList.remove("interactive");
    sfx.win();

    const perfect = state.roundMisses === 0;
    if (perfect) {
      state.combo = Math.min(state.combo + 1, 9);
    }
    state.bestCombo = Math.max(state.bestCombo, state.combo);

    const base = state.target.size * 10 + state.level * 5;
    const gained = Math.round(base * state.combo);
    state.score += gained;

    if (MODES[state.mode].timed) {
      // Reward speed: small time bonus for a clean board.
      if (perfect) state.timeLeft += 1.5;
    }

    state.level += 1;
    state.roundMisses = 0;

    if (state.score > (stats.best[state.mode] || 0)) {
      stats.best[state.mode] = state.score;
      bump(bestEl);
    }
    renderHUD();
    bump(scoreEl);
    bump(primaryEl);
    renderCombo();

    promptEl.textContent =
      state.combo >= 2 ? `Perfect · ×${state.combo}` : "Perfect";
    setTimeout(() => {
      if (state.playing) startRound();
    }, 820);
  }

  function missed() {
    state.roundMisses = (state.roundMisses || 0) + 1;
    // A miss breaks the combo.
    if (state.combo > 1) {
      state.combo = 1;
      renderCombo();
    }

    if (MODES[state.mode].timed) {
      // Time penalty instead of lives.
      state.timeLeft = Math.max(0, state.timeLeft - MODES[state.mode].wrongPenalty);
      renderLives();
      renderHUD();
      promptEl.textContent = `−${MODES[state.mode].wrongPenalty}s`;
      state.locked = true;
      setTimeout(() => {
        const w = boardEl.querySelector(".tile.wrong");
        if (w) w.classList.remove("wrong");
        if (state.playing && state.timeLeft > 0) {
          promptEl.textContent = `Tap ${state.target.size - state.found.size} more`;
          state.locked = false;
        }
      }, 480);
      return;
    }

    state.lives -= 1;
    renderLives();
    if (state.lives <= 0) {
      gameOver();
      return;
    }
    state.locked = true;
    promptEl.textContent =
      state.lives === 1 ? "Last life — careful" : "Missed one";
    setTimeout(() => {
      const w = boardEl.querySelector(".tile.wrong");
      if (w) w.classList.remove("wrong");
      if (state.playing && state.lives > 0) {
        promptEl.textContent = `Tap ${state.target.size - state.found.size} more`;
        state.locked = false;
      }
    }, 700);
  }

  /* ============================================================
     Timer (Sprint)
     ============================================================ */
  let timerPaused = false;
  function startTimer() {
    state.timeLeft = MODES[state.mode].duration;
    timerPaused = false;
    let last = performance.now();
    clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (timerPaused || !state.playing) return;
      const prev = Math.ceil(state.timeLeft);
      state.timeLeft -= dt;
      const cur = Math.ceil(state.timeLeft);
      if (cur !== prev && cur <= 5 && cur > 0) sfx.tick();
      renderLives();
      renderHUD();
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        gameOver();
      }
    }, 100);
  }
  const pauseTimer = () => (timerPaused = true);
  const resumeTimer = () => (timerPaused = false);
  function stopTimer() {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  /* ============================================================
     Game lifecycle
     ============================================================ */
  function newGame() {
    ac(); // unlock audio
    state.mode = prefs.mode;
    state.diff = prefs.difficulty;
    state.level = 1;
    state.score = 0;
    state.combo = 1;
    state.bestCombo = 1;
    state.taps = 0;
    state.hits = 0;
    state.roundMisses = 0;
    state.maxLives = DIFFS[state.diff].lives;
    state.lives = state.maxLives;
    state.playing = true;

    state.rng = MODES[state.mode].seeded
      ? mulberry32(dailySeed())
      : Math.random;

    hudEl.hidden = false;
    comboEl.hidden = true;
    backBtn.hidden = false;
    renderHUD();
    renderLives();
    closeAllScreens();

    if (MODES[state.mode].timed) startTimer();
    startRound();
  }

  function gameOver() {
    if (!state.playing) return;
    state.playing = false;
    state.locked = true;
    stopTimer();
    boardEl.classList.remove("interactive");
    sfx.over();

    // Reveal any missed tiles for closure.
    for (const idx of state.target) {
      if (!state.found.has(idx)) {
        const t = tileAt(idx);
        if (t) t.classList.add("missed");
      }
    }

    // Record stats.
    const reachedLevel = state.level; // level you were attempting
    stats.gamesPlayed++;
    stats.totalTaps += state.taps;
    stats.correctTaps += state.hits;
    stats.bestLevel = Math.max(stats.bestLevel, reachedLevel);
    stats.bestCombo = Math.max(stats.bestCombo, state.bestCombo);
    const isBest = state.score >= (stats.best[state.mode] || 0);
    stats.best[state.mode] = Math.max(stats.best[state.mode] || 0, state.score);
    stats.recent.push(state.score);
    if (stats.recent.length > 16) stats.recent = stats.recent.slice(-16);
    saveStats();

    state.lastResult = {
      score: state.score,
      level: reachedLevel,
      mode: state.mode,
      combo: state.bestCombo,
      isBest: isBest && state.score > 0,
    };

    setTimeout(() => showEndScreen(state.lastResult), 900);
  }

  /* ============================================================
     Screens
     ============================================================ */
  function showScreen(name) {
    Object.values(screens).forEach((s) => {
      s.hidden = true;
      s.classList.remove("closing");
    });
    screens[name].hidden = false;
  }
  function closeScreen(s) {
    s.classList.add("closing");
    setTimeout(() => {
      s.hidden = true;
      s.classList.remove("closing");
    }, 380);
  }
  function closeAllScreens() {
    Object.values(screens).forEach((s) => {
      if (!s.hidden) closeScreen(s);
    });
  }

  function goHome() {
    state.playing = false;
    stopTimer();
    hudEl.hidden = true;
    comboEl.hidden = true;
    backBtn.hidden = true;
    showScreen("home");
    syncHomeHints();
  }

  function showEndScreen(r) {
    $("end-kicker").textContent =
      r.mode === "sprint" ? "Time’s up" : "Game over";
    $("end-score").textContent = r.score;
    const detail =
      r.mode === "sprint"
        ? `Level ${r.level} reached`
        : `Reached level ${r.level}`;
    $("end-detail").textContent =
      detail + (r.combo >= 2 ? ` · best ×${r.combo}` : "");
    $("end-best").hidden = !r.isBest;
    showScreen("end");
  }

  /* ============================================================
     Stats screen rendering
     ============================================================ */
  function renderStatsScreen() {
    $("s-games").textContent = stats.gamesPlayed;
    const acc =
      stats.totalTaps > 0
        ? Math.round((stats.correctTaps / stats.totalTaps) * 100) + "%"
        : "—";
    $("s-acc").textContent = acc;
    $("s-level").textContent = stats.bestLevel;
    $("s-streak").textContent = stats.bestCombo >= 1 ? stats.bestCombo : 0;
    $("best-endless").textContent = stats.best.endless || 0;
    $("best-sprint").textContent = stats.best.sprint || 0;
    $("best-daily").textContent = stats.best.daily || 0;
    renderSpark();
  }
  function renderSpark() {
    const svg = $("spark");
    const data = stats.recent.slice(-12);
    svg.innerHTML = "";
    if (data.length < 2) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", "150");
      t.setAttribute("y", "44");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "empty");
      t.textContent = "Play a few games to see your trend";
      svg.appendChild(t);
      return;
    }
    const W = 300,
      H = 80,
      pad = 8;
    const max = Math.max(...data),
      min = Math.min(...data);
    const span = max - min || 1;
    const pts = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / span) * (H - pad * 2);
      return [x, y];
    });
    const poly = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline"
    );
    poly.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    svg.appendChild(poly);
    const last = pts[pts.length - 1];
    const dot = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle"
    );
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "3.5");
    svg.appendChild(dot);
  }

  /* ============================================================
     Share card (canvas → image)
     ============================================================ */
  async function shareResult() {
    const r = state.lastResult;
    if (!r) return;
    const canvas = $("share-canvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width,
      H = canvas.height;

    const dark =
      prefs.theme === "dark" ||
      (prefs.theme !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    const bg = dark ? "#000000" : "#ffffff";
    const ink = dark ? "#ffffff" : "#000000";
    const sub = "#8d8d93";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = sub;
    ctx.font = "600 40px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillText("RECALL", W / 2, 200);

    // Mini grid mark
    drawMark(ctx, W / 2 - 90, 250, 180, ink, bg);

    ctx.fillStyle = ink;
    ctx.font = "700 280px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillText(String(r.score), W / 2, 760);

    ctx.fillStyle = sub;
    ctx.font = "500 46px -apple-system, Helvetica, Arial, sans-serif";
    const modeName = r.mode.charAt(0).toUpperCase() + r.mode.slice(1);
    ctx.fillText(`${modeName} · Level ${r.level}`, W / 2, 850);
    if (r.combo >= 2)
      ctx.fillText(`Best combo ×${r.combo}`, W / 2, 910);

    ctx.fillStyle = ink;
    ctx.font = "600 38px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillText("Can you beat it?", W / 2, 1180);

    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) return;
    const file = new File([blob], "recall-score.png", { type: "image/png" });
    const text = `I scored ${r.score} in Recall (${modeName}, level ${r.level}). Can you beat it?`;

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Recall", text });
        return;
      } catch {
        /* user cancelled — fall through to download */
      }
    }
    // Fallback: download the image.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recall-score.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function drawMark(ctx, x, y, size, ink, bg) {
    const r = 36;
    roundRect(ctx, x, y, size, size, r);
    ctx.fillStyle = ink;
    ctx.fill();
    const pad = 30,
      gap = 12;
    const cell = (size - pad * 2 - gap * 2) / 3;
    const on = new Set([0, 4, 5, 7]);
    for (let i = 0; i < 9; i++) {
      const cx = x + pad + (i % 3) * (cell + gap);
      const cy = y + pad + Math.floor(i / 3) * (cell + gap);
      roundRect(ctx, cx, cy, cell, cell, 8);
      ctx.fillStyle = on.has(i) ? bg : "rgba(255,255,255,0.18)";
      ctx.fill();
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ============================================================
     Segmented controls + toggles
     ============================================================ */
  function initSegmented(id, onChange) {
    const seg = $(id);
    const buttons = [...seg.querySelectorAll(".seg")];
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg");
      if (!btn) return;
      const idx = buttons.indexOf(btn);
      seg.style.setProperty("--idx", idx);
      buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
      ac();
      onChange(btn.dataset.value);
    });
  }
  function syncSegmented(id, value) {
    const seg = $(id);
    const buttons = [...seg.querySelectorAll(".seg")];
    const idx = buttons.findIndex((b) => b.dataset.value === value);
    if (idx < 0) return;
    seg.style.setProperty("--idx", idx);
    buttons.forEach((b, i) => b.classList.toggle("is-active", i === idx));
  }

  function initSwitch(id, key) {
    const sw = $(id);
    const set = (on) => {
      sw.classList.toggle("is-on", on);
      sw.setAttribute("aria-checked", String(on));
    };
    set(prefs[key]);
    sw.addEventListener("click", () => {
      prefs[key] = !prefs[key];
      set(prefs[key]);
      savePrefs();
      if (key === "sound" && prefs.sound) {
        ac();
        sfx.correct(2);
      }
      if (key === "haptics" && prefs.haptics) vibrate(12);
    });
  }

  function syncHomeHints() {
    $("mode-hint").textContent = MODES[prefs.mode].hint;
    $("diff-hint").textContent = DIFFS[prefs.difficulty].hint;
  }

  /* ============================================================
     Wire up
     ============================================================ */
  initSegmented("mode-seg", (v) => {
    prefs.mode = v;
    savePrefs();
    $("mode-hint").textContent = MODES[v].hint;
  });
  initSegmented("diff-seg", (v) => {
    prefs.difficulty = v;
    savePrefs();
    $("diff-hint").textContent = DIFFS[v].hint;
  });
  initSegmented("theme-seg", (v) => {
    prefs.theme = v;
    savePrefs();
    applyTheme();
  });
  initSwitch("sound-toggle", "sound");
  initSwitch("haptics-toggle", "haptics");

  $("play-btn").addEventListener("click", newGame);
  $("again-btn").addEventListener("click", newGame);
  $("end-home").addEventListener("click", goHome);
  $("share-btn").addEventListener("click", shareResult);
  backBtn.addEventListener("click", goHome);

  $("open-settings").addEventListener("click", () => showScreen("settings"));
  $("open-help").addEventListener("click", () => showScreen("help"));
  $("open-stats").addEventListener("click", () => {
    renderStatsScreen();
    showScreen("stats");
  });

  document.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const screen = btn.closest(".screen");
      if (screen === screens.end) {
        goHome();
      } else if (state.playing) {
        closeScreen(screen);
      } else {
        showScreen("home");
        syncHomeHints();
      }
    })
  );

  $("reset-stats").addEventListener("click", () => {
    if (confirm("Reset all stats and best scores?")) {
      stats.gamesPlayed = 0;
      stats.totalTaps = 0;
      stats.correctTaps = 0;
      stats.bestLevel = 0;
      stats.bestCombo = 0;
      stats.best = { endless: 0, sprint: 0, daily: 0 };
      stats.recent = [];
      saveStats();
      renderStatsScreen();
    }
  });

  // Keyboard: space/enter starts from home or end screen.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (!screens.home.hidden || !screens.end.hidden) {
      e.preventDefault();
      newGame();
    }
  });

  // Pause an active timed game if the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.playing && MODES[state.mode].timed) pauseTimer();
  });

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    applyTheme();
    syncSegmented("mode-seg", prefs.mode);
    syncSegmented("diff-seg", prefs.difficulty);
    syncSegmented("theme-seg", prefs.theme);
    syncHomeHints();
    bestEl.textContent = stats.best[prefs.mode] || 0;

    // Decorative animated mark on the home hero.
    const mark = $("hero-mark");
    const cells = [];
    for (let i = 0; i < 9; i++) {
      const c = document.createElement("i");
      mark.appendChild(c);
      cells.push(c);
    }
    const patterns = [
      [0, 4, 8],
      [2, 4, 6, 0],
      [1, 3, 5, 7],
      [0, 1, 4, 8],
      [4, 0, 2, 6, 8],
    ];
    let pi = 0;
    const cycle = () => {
      const p = new Set(patterns[pi % patterns.length]);
      cells.forEach((c, i) => c.classList.toggle("on", p.has(i)));
      pi++;
    };
    cycle();
    setInterval(cycle, 1400);

    // Idle board behind the home screen.
    buildBoard(3);
    showScreen("home");
  }
  init();

  /* ============================================================
     Service worker (offline)
     ============================================================ */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
