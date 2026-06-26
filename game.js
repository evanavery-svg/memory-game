(() => {
  "use strict";

  const VERSION = "1.5.2";

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
  const powerupsEl = $("powerups");
  const peekBtn = $("power-peek");
  const skipBtn = $("power-skip");
  const peekN = $("peek-n");
  const skipN = $("skip-n");
  const checkpointEl = $("checkpoint");
  const toastEl = $("toast");

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
  const A2HS_KEY = "recall.a2hsSeen";

  const prefs = Object.assign(
    {
      mode: "endless",
      difficulty: "standard",
      theme: "system",
      sound: true,
      haptics: true,
      adaptive: true,
      contrast: false,
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
      best: { endless: 0, sprint: 0, daily: 0, sequence: 0 },
      recent: [],
      streak: { current: 0, longest: 0, last: null },
      playDays: [], // ["YYYY-MM-DD", ...]
      achievements: [], // unlocked ids
      calib: 0, // adaptive flash-time offset in ms (negative = harder)
    },
    readJSON(STATS_KEY, {})
  );
  // Backfill nested defaults for older saves.
  stats.streak = Object.assign({ current: 0, longest: 0, last: null }, stats.streak);
  stats.best = Object.assign({ endless: 0, sprint: 0, daily: 0, sequence: 0 }, stats.best);
  if (!Array.isArray(stats.playDays)) stats.playDays = [];
  if (!Array.isArray(stats.achievements)) stats.achievements = [];
  if (typeof stats.calib !== "number") stats.calib = 0;

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
    sequence: {
      label: "Level",
      timed: false,
      ordered: true,
      hint: "Tiles flash in order — tap them back in the same order.",
    },
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
    order: [], // ordered indices for Sequence mode
    seqStep: 0, // next index to tap in the sequence
    found: new Set(),
    taps: 0,
    hits: 0,
    locked: true,
    playing: false,
    rng: Math.random,
    timeLeft: 0,
    timerId: null,
    peek: 0,
    skip: 0,
    usedSkip: false,
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
     Dates & streaks
     ============================================================ */
  function dateKey(d) {
    // Local calendar date as YYYY-MM-DD.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const todayKey = () => dateKey(new Date());
  function daysBetween(aKey, bKey) {
    const a = new Date(aKey + "T00:00:00");
    const b = new Date(bKey + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }

  // Called when a game begins — records today as played and advances the streak.
  function registerPlay() {
    const today = todayKey();
    const s = stats.streak;
    if (s.last === today) {
      // already counted today
    } else if (s.last && daysBetween(s.last, today) === 1) {
      s.current += 1; // consecutive day
    } else {
      s.current = 1; // first play, or a gap broke the streak
    }
    s.last = today;
    s.longest = Math.max(s.longest, s.current);
    if (!stats.playDays.includes(today)) stats.playDays.push(today);
    // Keep the play-day log bounded (~1 year).
    if (stats.playDays.length > 400) stats.playDays = stats.playDays.slice(-400);
    saveStats();
  }

  /* ============================================================
     Achievements
     ============================================================ */
  const ICONS = {
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6L12 16.9 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
    target:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
    crown:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4 4 5-7 5 7 4-4-2 12H5z"/></svg>',
    flame:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4-3 5-3 9a3 3 0 006 0c0-1-.5-2-1-2.5.3 2-1.2 2.5-1.2 2.5C13 9 16 8 12 2z"/><path d="M8.5 13a3.5 3.5 0 107 0c0 4-3.5 5-3.5 8-0 0-3.5-1-3.5-8z" opacity="0.45"/></svg>',
    medal:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="15" r="6"/><path d="M9 4l3 5 3-5"/></svg>',
    trophy:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h10v3a5 5 0 01-10 0zM5 4h2v2a3 3 0 01-2-3zM17 4h2a3 3 0 01-2 3zM10 13h4l1 3h-6zM8 18h8v2H8z"/></svg>',
    infinity:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12c0-2-1.5-3.5-3-3.5S2 10 2 12s1.5 3.5 3 3.5 3-1.5 4-3.5 2.5-3.5 4-3.5 3 1.5 3 3.5-1.5 3.5-3 3.5-3-1.5-4-3.5"/></svg>',
  };

  const ACHIEVEMENTS = [
    { id: "first", name: "First Steps", icon: "flag", test: (c) => c.gamesPlayed >= 1 },
    { id: "combo5", name: "Sharp", icon: "bolt", test: (c) => c.bestCombo >= 5 },
    { id: "combo9", name: "Flawless", icon: "star", test: (c) => c.bestCombo >= 9 },
    { id: "level10", name: "Double Digits", icon: "medal", test: (c) => c.bestLevel >= 10 },
    { id: "level15", name: "Mastermind", icon: "crown", test: (c) => c.bestLevel >= 15 },
    { id: "sprintClean", name: "Marksman", icon: "target", test: (c) => c.cleanSprint },
    { id: "score500", name: "High Roller", icon: "trophy", test: (c) => c.bestSingle >= 500 },
    { id: "streak7", name: "Dedicated", icon: "flame", test: (c) => c.streak.longest >= 7 },
    { id: "games25", name: "Persistent", icon: "infinity", test: (c) => c.gamesPlayed >= 25 },
  ];

  function checkAchievements(extra = {}) {
    const ctx = Object.assign(
      {
        gamesPlayed: stats.gamesPlayed,
        bestCombo: stats.bestCombo,
        bestLevel: stats.bestLevel,
        streak: stats.streak,
        bestSingle: Math.max(0, ...stats.recent, ...Object.values(stats.best)),
      },
      extra
    );
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (stats.achievements.includes(a.id)) continue;
      if (a.test(ctx)) {
        stats.achievements.push(a.id);
        changed = true;
        showToast(a);
      }
    }
    if (changed) saveStats();
  }

  let toastTimer = null;
  const toastQueue = [];
  let toastShowing = false;
  function showToast(a) {
    toastQueue.push(a);
    if (!toastShowing) nextToast();
  }
  function nextToast() {
    const a = toastQueue.shift();
    if (!a) {
      toastShowing = false;
      return;
    }
    toastShowing = true;
    $("toast-icon").innerHTML = ICONS[a.icon] || "";
    $("toast-title").textContent = a.name;
    $("toast-sub").textContent = "Achievement unlocked";
    toastEl.classList.remove("out");
    toastEl.hidden = false;
    sfx.unlock();
    vibrate([10, 30, 10]);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add("out");
      setTimeout(() => {
        toastEl.hidden = true;
        nextToast();
      }, 400);
    }, 2200);
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
    unlock: () => {
      tone(659.25, 0.1, { gain: 0.05 });
      setTimeout(() => tone(987.77, 0.16, { gain: 0.05 }), 70);
    },
    checkpoint: () => {
      tone(523.25, 0.1, { gain: 0.05 });
      setTimeout(() => tone(784, 0.1, { gain: 0.05 }), 80);
      setTimeout(() => tone(1046.5, 0.22, { gain: 0.05 }), 160);
      vibrate([12, 40, 12]);
    },
    power: () => tone(700, 0.12, { type: "triangle", gain: 0.05 }),
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
  // Milestone levels (the opener and every fifth) break the black-and-white
  // palette: tiles flash in color and a correct tap pops with a ring burst.
  function isMilestone(level) {
    return level === 1 || level % 5 === 0;
  }
  const MILESTONE_COLORS = [
    "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be",
    "#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d55",
  ]; // Apple system colors — legible on both light and dark backgrounds.

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
    // Flash time scales with how many tiles you must memorize — harder boards
    // (more lit tiles) get a longer look, rather than a shrinking one.
    let flashMs = clamp(900 + lit * 130 + d.flashBonus, 600, 3200);
    // Adaptive difficulty: nudge flash time by a learned offset so the game
    // self-calibrates to your skill. Never in Daily — it must stay identical
    // for everyone.
    if (prefs.adaptive && state.mode !== "daily") {
      flashMs = clamp(flashMs + stats.calib, 500, 2800);
    }
    return { gridSize, lit, flashMs };
  }
  // Shift the adaptive offset: clean rounds make it a touch harder, misses ease
  // it back. Bounded so it can't run away.
  function adapt(delta) {
    if (!prefs.adaptive) return;
    stats.calib = clamp(stats.calib + delta, -500, 700);
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
    el.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }],
      { duration: 500, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
    );
  }
  function renderCombo() {
    if (state.combo >= 2) {
      comboEl.classList.add("show");
      comboX.textContent = "×" + state.combo;
      comboX.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }],
        { duration: 450, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
      );
    } else {
      comboEl.classList.remove("show");
    }
  }
  function renderLives() {
    if (MODES[state.mode].timed) {
      const s = Math.max(0, Math.ceil(state.timeLeft));
      if (!timerSpan || timerSpan.parentNode !== livesEl) {
        livesEl.innerHTML = "";
        timerSpan = document.createElement("span");
        livesEl.appendChild(timerSpan);
      }
      timerSpan.className = "timer" + (s <= 10 ? " low" : "");
      timerSpan.textContent = fmtTime(s);
      return;
    }
    timerSpan = null;
    livesEl.innerHTML = "";
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
      // pointerdown (not click) fires the instant a finger lands — no tap delay.
      tile.addEventListener("pointerdown", () => onTileClick(i, tile));
      boardEl.appendChild(tile);
    }
  }
  const tileAt = (i) => boardEl.children[i];

  // Shuffle 0..total-1 and take `count` — returns an ordered list.
  function sampleList(total, count) {
    const pool = Array.from({ length: total }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(state.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  /* ============================================================
     Round flow
     ============================================================ */
  async function startRound() {
    const { gridSize, lit, flashMs } = boardSpec(state.level);
    const ordered = MODES[state.mode].ordered;
    state.locked = true;
    state.found = new Set();
    state.seqStep = 0;
    state.usedSkip = false;
    state.usedPeek = false;
    hidePowerups();

    buildBoard(gridSize);
    state.order = sampleList(gridSize * gridSize, lit);
    state.target = new Set(state.order);

    // Milestone levels get a colored treatment. buildBoard() rebuilds the grid
    // each round, so per-tile colors clear on their own — only the board-level
    // class needs toggling.
    state.milestone = isMilestone(state.level);
    boardEl.classList.toggle("milestone", state.milestone);
    if (state.milestone) {
      let ci = 0;
      for (const idx of state.target) {
        tileAt(idx).style.setProperty(
          "--c",
          MILESTONE_COLORS[ci++ % MILESTONE_COLORS.length]
        );
      }
    }

    renderHUD();
    promptEl.textContent = "Memorize";

    await wait(420);
    if (!state.playing) return;

    if (ordered) {
      // Sequence mode: flash each tile one at a time, in order.
      promptEl.textContent = "Watch the order";
      const stepOn = clamp(560 - state.level * 12, 280, 560);
      for (let k = 0; k < state.order.length; k++) {
        if (!state.playing) return;
        const t = tileAt(state.order[k]);
        t.classList.add("lit");
        sfx.correct(k);
        await wait(stepOn);
        if (!state.playing) return;
        t.classList.remove("lit");
        await wait(130);
      }
    } else {
      sfx.flash();
      for (const idx of state.target) tileAt(idx).classList.add("lit");
      if (MODES[state.mode].timed) pauseTimer();
      await wait(flashMs);
      if (!state.playing) return;
      for (const idx of state.target) tileAt(idx).classList.remove("lit");
      if (MODES[state.mode].timed) resumeTimer();
    }

    await wait(240);
    if (!state.playing) return;
    promptEl.textContent = ordered
      ? `Tap the order — ${state.order.length}`
      : `Tap ${state.target.size} tile${state.target.size > 1 ? "s" : ""}`;
    boardEl.classList.add("interactive");
    state.locked = false;
    renderPowerups();
  }

  function onTileClick(index, tile) {
    if (state.locked || !state.playing || state.found.has(index)) return;
    // Belt-and-suspenders against a stray double pointerdown on one press:
    // never process a tile that's already shown its result this round.
    if (tile.classList.contains("wrong") || tile.classList.contains("correct"))
      return;

    state.taps++;

    // Sequence mode: only the next tile in the order counts.
    if (MODES[state.mode].ordered) {
      if (index === state.order[state.seqStep]) {
        state.hits++;
        state.found.add(index);
        state.seqStep++;
        tile.classList.add("correct");
        if (state.milestone) tile.classList.add("pop");
        sfx.correct(state.seqStep);
        if (state.seqStep === state.order.length) roundWon();
      } else {
        tile.classList.add("wrong");
        sfx.wrong();
        missed(tile);
      }
      return;
    }

    if (state.target.has(index)) {
      state.hits++;
      state.found.add(index);
      tile.classList.add("correct");
      if (state.milestone) tile.classList.add("pop");
      sfx.correct(state.found.size);
      if (state.found.size === state.target.size) roundWon();
    } else {
      tile.classList.add("wrong");
      sfx.wrong();
      missed(tile);
    }
  }

  function roundWon() {
    state.locked = true;
    boardEl.classList.remove("interactive");
    hidePowerups();
    sfx.win();

    // A board only grows the combo if it was cleared cleanly and unaided.
    const perfect = state.roundMisses === 0 && !state.usedSkip && !state.usedPeek;
    let granted = false;
    if (perfect) {
      state.combo = Math.min(state.combo + 1, 9);
      granted = earnPowerups(state.combo);
      adapt(-30); // cleared cleanly — tighten the flash a little
    }
    state.bestCombo = Math.max(state.bestCombo, state.combo);

    const base = state.target.size * 10 + state.level * 5;
    const gained = Math.round(base * state.combo);
    state.score += gained;

    if (MODES[state.mode].timed && perfect) state.timeLeft += 1.5;

    state.level += 1;
    state.roundMisses = 0;
    state.usedSkip = false;
    state.usedPeek = false;

    if (state.score > (stats.best[state.mode] || 0)) {
      stats.best[state.mode] = state.score;
      bump(bestEl);
    }

    // Live stats so achievements can pop mid-run.
    stats.bestCombo = Math.max(stats.bestCombo, state.bestCombo);
    stats.bestLevel = Math.max(stats.bestLevel, state.level);
    checkAchievements({ bestSingle: state.score });

    renderHUD();
    bump(scoreEl);
    bump(primaryEl);
    renderCombo();

    // Level-up checkpoint every 5 levels.
    const checkpoint = state.level % 5 === 0;
    if (checkpoint) showCheckpoint(state.level);

    if (granted) {
      promptEl.textContent = "Power-up earned";
    } else {
      promptEl.textContent =
        state.combo >= 2 ? `Perfect · ×${state.combo}` : "Perfect";
    }
    setTimeout(
      () => {
        if (state.playing) startRound();
      },
      checkpoint ? 1450 : 820
    );
  }

  function missed(wrongTile) {
    state.roundMisses = (state.roundMisses || 0) + 1;
    adapt(90); // missed — give a bit more time next round
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
        wrongTile.classList.remove("wrong");
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
      wrongTile.classList.remove("wrong");
      if (state.playing && state.lives > 0) {
        promptEl.textContent = `Tap ${state.target.size - state.found.size} more`;
        state.locked = false;
      }
    }, 700);
  }

  /* ============================================================
     Power-ups (earned by combos)
     ============================================================ */
  // Grant tokens as the combo crosses thresholds. Returns true if any granted.
  function earnPowerups(combo) {
    let granted = false;
    if (combo === 3) {
      state.peek++;
      granted = true;
    } else if (combo === 5) {
      state.skip++;
      granted = true;
    } else if (combo === 7) {
      state.peek++;
      state.skip++;
      granted = true;
    }
    return granted;
  }

  function renderPowerups() {
    peekBtn.hidden = state.peek <= 0;
    skipBtn.hidden = state.skip <= 0;
    peekN.textContent = state.peek;
    skipN.textContent = state.skip;
    const hasTokens = state.peek > 0 || state.skip > 0;
    powerupsEl.classList.toggle("reserved", hasTokens);
    powerupsEl.classList.toggle("show", hasTokens && !state.locked && state.playing);
  }
  function hidePowerups() {
    // Hide the buttons but keep the reserved space; fully cleared on a new game.
    powerupsEl.classList.remove("show");
  }

  async function doPeek() {
    if (state.peek <= 0 || state.locked || !state.playing) return;
    state.peek--;
    state.usedPeek = true; // a peeked board doesn't grow the combo
    renderPowerups();
    sfx.power();
    hidePowerups();
    const wasLocked = state.locked;
    state.locked = true;
    if (MODES[state.mode].timed) pauseTimer();

    if (MODES[state.mode].ordered) {
      // Re-flash the rest of the sequence, in order.
      const remaining = state.order.slice(state.seqStep);
      for (let k = 0; k < remaining.length; k++) {
        if (!state.playing) return;
        const t = tileAt(remaining[k]);
        t.classList.add("lit");
        sfx.correct(k);
        await wait(340);
        if (!state.playing) return;
        t.classList.remove("lit");
        await wait(110);
      }
    } else {
      // Re-flash the tiles not yet found.
      const reveal = [...state.target].filter((i) => !state.found.has(i));
      for (const i of reveal) tileAt(i).classList.add("lit");
      promptEl.textContent = "Peek";
      await wait(680);
      if (!state.playing) return;
      for (const i of reveal) tileAt(i).classList.remove("lit");
    }

    if (MODES[state.mode].timed) resumeTimer();
    promptEl.textContent = MODES[state.mode].ordered
      ? `Tap the order — ${state.order.length - state.seqStep} left`
      : `Tap ${state.target.size - state.found.size} more`;
    state.locked = wasLocked;
    renderPowerups();
  }

  function doSkip() {
    if (state.skip <= 0 || state.locked || !state.playing) return;
    state.skip--;
    state.usedSkip = true; // a skipped board doesn't grow the combo
    sfx.power();
    hidePowerups();
    // Auto-complete the board.
    for (const i of state.target) {
      if (!state.found.has(i)) {
        state.found.add(i);
        const t = tileAt(i);
        if (t) t.classList.add("correct");
      }
    }
    state.seqStep = state.order.length; // sequence is fully resolved
    roundWon();
  }

  peekBtn.addEventListener("click", doPeek);
  skipBtn.addEventListener("click", doSkip);

  /* ============================================================
     Level-up checkpoint
     ============================================================ */
  function showCheckpoint(level) {
    $("checkpoint-num").textContent = level;
    checkpointEl.classList.remove("closing");
    checkpointEl.hidden = false;
    // Restart the fade animation.
    checkpointEl.style.animation = "none";
    void checkpointEl.offsetWidth;
    checkpointEl.style.animation = "";
    sfx.checkpoint();
    clearTimeout(checkpointEl._t);
    checkpointEl._t = setTimeout(() => {
      checkpointEl.hidden = true;
    }, 1300);
  }

  /* ============================================================
     Timer (Sprint)
     ============================================================ */
  let timerPaused = false; // paused for a flash / peek reveal
  let tabHidden = false; // paused because the tab/app is backgrounded
  let timerSpan = null;

  function startTimer() {
    state.timeLeft = MODES[state.mode].duration;
    timerPaused = false;
    timerSpan = null;
    let last = performance.now();
    let prevDisplay = -1;

    const tick = (now) => {
      if (!state.playing) return;
      const paused = timerPaused || tabHidden;
      // Clamp dt: while backgrounded rAF stalls, so the first frame back could
      // otherwise carry the entire hidden duration and drain the clock at once.
      const dt = paused ? 0 : Math.min((now - last) / 1000, 0.25);
      last = now;
      if (!paused) {
        state.timeLeft = Math.max(0, state.timeLeft - dt);
        const display = Math.ceil(state.timeLeft);
        if (display !== prevDisplay) {
          prevDisplay = display;
          if (display <= 5 && display > 0) sfx.tick();
          renderLives();
          renderHUD();
          if (state.timeLeft <= 0) {
            gameOver();
            return;
          }
        }
      }
      state.timerId = requestAnimationFrame(tick);
    };
    if (state.timerId) cancelAnimationFrame(state.timerId);
    state.timerId = requestAnimationFrame(tick);
  }
  const pauseTimer = () => { timerPaused = true; };
  const resumeTimer = () => { timerPaused = false; };
  function stopTimer() {
    if (state.timerId) cancelAnimationFrame(state.timerId);
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
    state.peek = 0;
    state.skip = 0;
    state.usedSkip = false;
    state.usedPeek = false;
    state.playing = true;

    state.rng = MODES[state.mode].seeded
      ? mulberry32(dailySeed())
      : Math.random;

    // Record today's play and advance the streak.
    registerPlay();
    checkAchievements();

    hudEl.hidden = false;
    comboEl.classList.remove("show");
    backBtn.hidden = false;
    powerupsEl.classList.remove("show", "reserved");
    checkpointEl.hidden = true;
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
    hidePowerups();
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

    // A clean Sprint = at least one tap and zero wrong taps.
    const cleanSprint =
      state.mode === "sprint" && state.taps > 0 && state.hits === state.taps;
    checkAchievements({ cleanSprint, bestSingle: state.score });
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

  /* ============================================================
     First-run "Add to Home Screen" hint (iOS Safari only)
     ============================================================ */
  // Safari is the only iOS browser that can add a web app to the home screen,
  // and it's the only one whose share sheet exposes the option — so the hint is
  // scoped to it. Chrome/Firefox/Edge/Opera on iOS are excluded.
  function isIosSafari() {
    const ua = navigator.userAgent;
    const iOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS 13+ poses as Mac
    return iOS && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  }
  function isStandalone() {
    return (
      navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches
    ); // already installed — no need to nag
  }
  function maybePromptA2HS() {
    let seen = true;
    try {
      seen = !!localStorage.getItem(A2HS_KEY);
    } catch {
      seen = true;
    }
    if (seen || state.playing || !isIosSafari() || isStandalone()) return;
    // Let the home screen settle first so it doesn't stack on a transition.
    setTimeout(() => {
      if (!state.playing) $("a2hs-screen").hidden = false;
    }, 700);
  }
  function dismissA2HS() {
    try {
      localStorage.setItem(A2HS_KEY, "1");
    } catch {
      /* ignore */
    }
    closeScreen($("a2hs-screen"));
  }

  function goHome() {
    state.playing = false;
    stopTimer();
    hudEl.hidden = true;
    comboEl.classList.remove("show");
    powerupsEl.classList.remove("show", "reserved");
    backBtn.hidden = true;
    rollSubtitle();
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
    $("copy-result").hidden = r.mode !== "daily";
    showScreen("end");
  }

  /* ============================================================
     Daily share string (Wordle-style, spoiler-free)
     ============================================================ */
  function dailyIndex() {
    const epoch = new Date("2025-01-01T00:00:00");
    const today = new Date(todayKey() + "T00:00:00");
    return Math.max(1, Math.round((today - epoch) / 86400000) + 1);
  }
  function dailyShareText(r) {
    const filled = Math.min(5, Math.max(1, Math.ceil(r.level / 3)));
    let bar = "";
    for (let i = 0; i < 5; i++) bar += i < filled ? "🟦" : "⬜";
    return `Recall Daily #${dailyIndex()}\nLevel ${r.level} · ${r.score} pts\n${bar}`;
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
    $("best-sequence").textContent = stats.best.sequence || 0;
    // A streak counts as current only if you played today or yesterday.
    const last = stats.streak.last;
    const live =
      last && daysBetween(last, todayKey()) <= 1 ? stats.streak.current : 0;
    $("streak-current").textContent = live;
    $("streak-longest").textContent = stats.streak.longest;
    renderCalendar();
    renderAchievements();
    renderSpark();
  }

  function renderCalendar() {
    const cal = $("calendar");
    cal.innerHTML = "";
    const played = new Set(stats.playDays);
    const today = new Date();
    const todayStr = todayKey();
    // Show whole weeks ending this week (Sun–Sat columns).
    const WEEKS = 14;
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay())); // Saturday of this week
    const totalDays = WEEKS * 7;
    const start = new Date(end);
    start.setDate(start.getDate() - (totalDays - 1));
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const cell = document.createElement("span");
      const key = dateKey(d);
      if (d > today) {
        cell.className = "cal-cell blank";
      } else {
        cell.className = "cal-cell";
        if (played.has(key)) cell.classList.add("played");
        if (key === todayStr) cell.classList.add("today");
        cell.title = key;
      }
      cal.appendChild(cell);
    }
    $("cal-legend").innerHTML =
      '<span class="cal-cell" style="width:11px;height:11px"></span>—<span class="cal-cell played" style="width:11px;height:11px"></span>';
  }

  function renderAchievements() {
    const grid = $("ach-grid");
    grid.innerHTML = "";
    const unlocked = new Set(stats.achievements);
    for (const a of ACHIEVEMENTS) {
      const has = unlocked.has(a.id);
      const el = document.createElement("div");
      el.className = "ach" + (has ? "" : " locked");
      el.innerHTML =
        `<span class="ach-badge">${ICONS[a.icon]}</span>` +
        `<span class="ach-name">${has ? a.name : "Locked"}</span>`;
      el.title = a.name;
      grid.appendChild(el);
    }
    $("ach-count").textContent = `${unlocked.size} / ${ACHIEVEMENTS.length}`;
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
    const modeName =
      r.mode === "sequence"
        ? "Order"
        : r.mode.charAt(0).toUpperCase() + r.mode.slice(1);
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
    // Unlit cells are a faint tint of the page background so they read against
    // the mark in both light (black mark) and dark (white mark) themes.
    const off = bg === "#000000" ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.18)";
    for (let i = 0; i < 9; i++) {
      const cx = x + pad + (i % 3) * (cell + gap);
      const cy = y + pad + Math.floor(i / 3) * (cell + gap);
      roundRect(ctx, cx, cy, cell, cell, 8);
      ctx.fillStyle = on.has(i) ? bg : off;
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

  function initSwitch(id, key, onToggle) {
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
      if (onToggle) onToggle(prefs[key]);
    });
  }

  function applyContrast() {
    document.documentElement.toggleAttribute("data-contrast", !!prefs.contrast);
  }

  // The home subtitle is usually "Memory, beautifully simple." — but every so
  // often it carries a little message. ♥
  function rollSubtitle() {
    const el = $("hero-sub");
    if (!el) return;
    el.textContent =
      Math.random() < 0.25
        ? "Anna, I love you!"
        : "Memory, beautifully simple.";
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
  initSwitch("adaptive-toggle", "adaptive");
  initSwitch("contrast-toggle", "contrast", applyContrast);

  $("play-btn").addEventListener("click", newGame);
  $("again-btn").addEventListener("click", newGame);
  $("end-home").addEventListener("click", goHome);
  $("share-btn").addEventListener("click", shareResult);
  $("copy-result").addEventListener("click", async () => {
    const r = state.lastResult;
    if (!r) return;
    const text = dailyShareText(r);
    const btn = $("copy-result");
    const flash = () => {
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy daily result"), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        flash();
        return;
      } catch {
        /* fall through */
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        /* user cancelled */
      }
    }
  });
  backBtn.addEventListener("click", goHome);

  $("open-settings").addEventListener("click", () => showScreen("settings"));
  $("open-help").addEventListener("click", () => showScreen("help"));
  $("tut-start").addEventListener("click", finishTutorial);
  $("tut-skip").addEventListener("click", finishTutorial);
  $("a2hs-got-it").addEventListener("click", dismissA2HS);
  $("a2hs-later").addEventListener("click", dismissA2HS);
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
    if (confirm("Reset all stats, streaks, and achievements?")) {
      stats.gamesPlayed = 0;
      stats.totalTaps = 0;
      stats.correctTaps = 0;
      stats.bestLevel = 0;
      stats.bestCombo = 0;
      stats.best = { endless: 0, sprint: 0, daily: 0, sequence: 0 };
      stats.recent = [];
      stats.streak = { current: 0, longest: 0, last: null };
      stats.playDays = [];
      stats.achievements = [];
      stats.calib = 0;
      saveStats();
      renderStatsScreen();
    }
  });

  /* ============================================================
     Export / import progress
     ============================================================ */
  $("export-btn").addEventListener("click", () => {
    const payload = {
      app: "recall",
      version: 1,
      exportedAt: new Date().toISOString(),
      prefs,
      stats,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recall-backup-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("import-btn").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.app !== "recall" || !data.stats)
          throw new Error("Not a Recall backup");
        if (
          !confirm(
            "Restore this backup? It will replace your current stats and settings."
          )
        )
          return;
        localStorage.setItem(STATS_KEY, JSON.stringify(data.stats));
        if (data.prefs)
          localStorage.setItem(PREFS_KEY, JSON.stringify(data.prefs));
        location.reload();
      } catch (err) {
        alert("That file isn’t a valid Recall backup.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  });

  // Keyboard: space/enter starts from home or end screen — but only when no
  // control is focused, so it doesn't fire alongside a button/link/segment
  // activation (which would otherwise start two games or open a screen at once).
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (e.target.closest("button, a, input, select, textarea, [role='switch'], [role='tab']"))
      return;
    if (!screens.home.hidden || !screens.end.hidden) {
      e.preventDefault();
      newGame();
    }
  });

  // Freeze the Sprint clock while the tab/app is backgrounded, and resume it on
  // return. (Kept separate from flash/peek pausing so the two never collide.)
  document.addEventListener("visibilitychange", () => {
    tabHidden = document.hidden;
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

    startQuotes();
    $("app-version").textContent = "v" + VERSION;
    rollSubtitle();
    applyContrast();

    // Idle board behind the home screen.
    buildBoard(3);

    // First run: walk the player through a guided round.
    let seen = false;
    try {
      seen = !!localStorage.getItem(TUT_KEY);
    } catch {
      seen = true;
    }
    if (seen) {
      showScreen("home");
      maybePromptA2HS();
    } else {
      Object.values(screens).forEach((s) => (s.hidden = true));
      $("tutorial-screen").hidden = false;
      startTutorial();
    }
  }

  /* ============================================================
     Home quotes — a little inspiration on memory & the mind
     ============================================================ */
  const QUOTES = [
    { t: "Memory is the treasury and guardian of all things.", by: "Cicero" },
    { t: "The true art of memory is the art of attention.", by: "Samuel Johnson" },
    { t: "We are our memory, we are that chimerical museum of shifting shapes.", by: "Jorge Luis Borges" },
    { t: "Memory is the diary we all carry about with us.", by: "Oscar Wilde" },
    { t: "A mind that is stretched by a new experience can never go back to its old dimensions.", by: "Oliver Wendell Holmes" },
    { t: "The palest ink is better than the best memory — so train the best memory.", by: "Proverb, adapted" },
    { t: "Practice does not make perfect. Perfect practice makes perfect.", by: "Vince Lombardi" },
    { t: "The things we remember best are the things best forgotten.", by: "Baltasar Gracián" },
    { t: "Attention is the rarest and purest form of generosity.", by: "Simone Weil" },
    { t: "Nothing fixes a thing so intensely in the memory as the wish to forget it.", by: "Montaigne" },
  ];
  function startQuotes() {
    const fig = $("home-quote");
    const txt = $("quote-text");
    const by = $("quote-by");
    if (!fig || !txt || !by) return;
    let i = Math.floor(Math.random() * QUOTES.length);
    const paint = () => {
      const q = QUOTES[i % QUOTES.length];
      txt.textContent = "“" + q.t + "”";
      by.textContent = q.by;
    };
    paint();
    setInterval(() => {
      // Only rotate while the home screen is actually visible.
      if (screens.home.hidden) return;
      fig.classList.add("fade");
      setTimeout(() => {
        i++;
        paint();
        fig.classList.remove("fade");
      }, 600);
    }, 7000);
  }

  /* ============================================================
     First-run tutorial — a single guided round
     ============================================================ */
  const TUT_KEY = "recall.tutorialSeen";
  function startTutorial() {
    const board = $("tut-board");
    const coach = $("tut-coach");
    const dotsEl = $("tut-dots");
    const startBtn = $("tut-start");
    startBtn.hidden = true;
    board.style.gridTemplateColumns = "repeat(3, 1fr)";
    board.innerHTML = "";
    dotsEl.innerHTML = "";

    const tiles = [];
    for (let i = 0; i < 9; i++) {
      const t = document.createElement("button");
      t.className = "tile";
      t.disabled = true;
      board.appendChild(t);
      tiles.push(t);
    }
    const target = [1, 3, 5, 7]; // a simple diamond
    for (let i = 0; i < target.length; i++) dotsEl.appendChild(document.createElement("i"));
    const dots = [...dotsEl.children];
    const found = new Set();

    coach.textContent = "Watch which tiles light up.";
    setTimeout(() => target.forEach((i) => tiles[i].classList.add("lit")), 700);
    setTimeout(() => {
      target.forEach((i) => tiles[i].classList.remove("lit"));
      coach.textContent = "Now tap them all — in any order.";
      tiles.forEach((t, i) => {
        t.disabled = false;
        t.addEventListener("pointerdown", () => tutTap(i));
      });
    }, 2200);

    function tutTap(i) {
      if (found.has(i)) return;
      if (target.includes(i)) {
        found.add(i);
        tiles[i].classList.add("correct");
        tiles[i].disabled = true;
        ac();
        sfx.correct(found.size);
        dots[found.size - 1].classList.add("on");
        if (found.size === target.length) {
          coach.textContent = "That's it — clear boards to go further.";
          startBtn.hidden = false;
        }
      } else {
        tiles[i].classList.add("wrong");
        sfx.wrong();
        setTimeout(() => tiles[i].classList.remove("wrong"), 450);
      }
    }
  }
  function finishTutorial() {
    try {
      localStorage.setItem(TUT_KEY, "1");
    } catch {
      /* ignore */
    }
    $("tutorial-screen").hidden = true;
    rollSubtitle();
    showScreen("home");
    syncHomeHints();
    maybePromptA2HS();
  }

  init();

  /* ============================================================
     Service worker (offline)
     ============================================================ */
  if ("serviceWorker" in navigator) {
    // When a freshly installed worker takes control, reload exactly once so the
    // new version applies without a manual refresh. Guarded against the first
    // ever install (no prior controller) and against reload loops.
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .then((reg) => reg.update().catch(() => {}))
        .catch(() => {});
    });
  }
})();
