(() => {
  "use strict";

  const VERSION = "1.18.1";

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
  const wordmark = $("wordmark");
  const dailyDateEl = $("daily-date");
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
    modes: $("modes-screen"),
    settings: $("settings-screen"),
    stats: $("stats-screen"),
    help: $("help-screen"),
    archive: $("archive-screen"),
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
      dailyReminder: false,
      accent: "mono", // selected board theme (see THEMES)
      focus: false, // hide score/level/combo during play
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
      best: { endless: 0, expert: 0, sprint: 0, daily: 0, sequence: 0 },
      recent: [],
      recentAcc: [], // last games' tap accuracy (%) — for the trend sparkline
      playHours: [], // 24 counts, one per hour-of-day a game ended
      modeAgg: {}, // per-mode { runs, levelSum } for average-level stats
      dailyScores: {}, // { "YYYY-MM-DD": score } for the Daily weekly strip
      streak: { current: 0, longest: 0, last: null },
      freezes: 0, // streak freezes held (earned every 7 streak days, max 2)
      playDays: [], // ["YYYY-MM-DD", ...]
      achievements: [], // unlocked ids
      themesUnlocked: [], // earned board themes (mono is always available)
      calib: 0, // adaptive flash-time offset in ms (negative = harder)
      dailyDone: null, // local date key of the last completed Daily run
    },
    readJSON(STATS_KEY, {})
  );
  // Backfill nested defaults for older saves.
  stats.streak = Object.assign({ current: 0, longest: 0, last: null }, stats.streak);
  stats.best = Object.assign({ endless: 0, expert: 0, sprint: 0, daily: 0, sequence: 0 }, stats.best);
  if (!Array.isArray(stats.playDays)) stats.playDays = [];
  if (!Array.isArray(stats.achievements)) stats.achievements = [];
  if (!Array.isArray(stats.themesUnlocked)) stats.themesUnlocked = [];
  if (typeof stats.freezes !== "number") stats.freezes = 0;
  if (!Array.isArray(stats.recentAcc)) stats.recentAcc = [];
  if (!Array.isArray(stats.playHours) || stats.playHours.length !== 24)
    stats.playHours = Array(24).fill(0);
  if (!stats.modeAgg || typeof stats.modeAgg !== "object") stats.modeAgg = {};
  if (!stats.dailyScores || typeof stats.dailyScores !== "object")
    stats.dailyScores = {};
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
    expert: {
      label: "Level",
      timed: false,
      headStart: 8,
      hint: "For veterans — skip the grind, start at level 8.",
    },
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
    versus: {
      label: "Level",
      timed: false,
      hint: "Two players, same boards — take turns; the higher score wins.",
    },
  };

  const DIFFS = {
    casual: { lives: 5, flashBonus: 420, scale: 0.8, hint: "Longer flash. Five lives." },
    standard: { lives: 3, flashBonus: 0, scale: 1, hint: "Balanced flash time. Three lives." },
    hard: { lives: 2, flashBonus: -260, scale: 1.3, hint: "Quick flash. Two lives." },
  };

  // Friendly display name for a mode key (Order is stored as "sequence").
  const MODE_NAMES = {
    endless: "Endless",
    expert: "Expert",
    sprint: "Sprint",
    daily: "Daily",
    sequence: "Order",
    versus: "Versus",
  };
  const modeLabel = (m) =>
    MODE_NAMES[m] || (m ? m[0].toUpperCase() + m.slice(1) : "");

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
    snaking: false, // a Snake interlude is running
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
  // Seed for an arbitrary local date key ("YYYY-MM-DD" → yyyymmdd), matching
  // dailySeed()'s format so an archived day replays that day's exact boards.
  const seedFromKey = (key) => parseInt(key.replace(/-/g, ""), 10);

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
  // A human-friendly date for the Daily masthead, e.g. "June 27, 2026".
  function dailyDateLabel() {
    try {
      return new Date().toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return todayKey();
    }
  }
  // Short label for an archived date key, e.g. "June 27".
  function archiveDateLabel(key) {
    try {
      return new Date(key + "T00:00:00").toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      });
    } catch {
      return key;
    }
  }
  // Daily is one-and-done per local calendar day; it unlocks again at midnight
  // because todayKey() rolls over to a new date.
  const dailyDoneToday = () => stats.dailyDone === todayKey();
  function daysBetween(aKey, bKey) {
    const a = new Date(aKey + "T00:00:00");
    const b = new Date(bKey + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }

  // Called when a game begins — records today as played and advances the streak.
  // A held streak freeze bridges exactly one missed day instead of resetting.
  function registerPlay() {
    const today = todayKey();
    const s = stats.streak;
    let advanced = false;
    if (s.last === today) {
      // already counted today
    } else if (s.last && daysBetween(s.last, today) === 1) {
      s.current += 1; // consecutive day
      advanced = true;
    } else if (s.last && daysBetween(s.last, today) === 2 && stats.freezes > 0) {
      // Missed exactly one day with a freeze in hand — spend it, streak lives.
      stats.freezes -= 1;
      s.current += 1;
      advanced = true;
      showToast({
        name: "Streak freeze used",
        icon: "flake",
        sub: `Saved your ${s.current}-day streak`,
      });
    } else {
      s.current = 1; // first play, or a gap broke the streak
    }
    s.last = today;
    s.longest = Math.max(s.longest, s.current);
    // Every 7th consecutive day banks a freeze (hold at most 2).
    if (advanced && s.current % 7 === 0 && stats.freezes < 2) {
      stats.freezes += 1;
      showToast({
        name: "Streak freeze earned",
        icon: "flake",
        sub: "Covers one missed day",
      });
    }
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
    palette:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a9 9 0 100 18c1.1 0 1.8-.9 1.8-1.9 0-1.2-1-1.8-1-2.8 0-.8.7-1.4 1.5-1.4H16a5 5 0 005-5c0-3.9-4-6.9-9-6.9z"/><circle cx="7.5" cy="11.5" r="1" fill="currentColor"/><circle cx="11" cy="7.5" r="1" fill="currentColor"/><circle cx="15" cy="8.5" r="1" fill="currentColor"/></svg>',
    flake:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M5 7.5l14 9M19 7.5l-14 9M12 3l-2.2 2.2M12 3l2.2 2.2M12 21l-2.2-2.2M12 21l2.2-2.2"/></svg>',
  };

  // Each achievement carries a goal and a `prog(ctx)` reading so the Stats
  // screen can show how close you are to the locked ones. `test` stays the
  // source of truth for unlocking.
  const ACHIEVEMENTS = [
    { id: "first", name: "First Steps", icon: "flag", goal: 1, unit: "game", prog: (c) => c.gamesPlayed, test: (c) => c.gamesPlayed >= 1 },
    { id: "combo5", name: "Sharp", icon: "bolt", goal: 5, unit: "×combo", prog: (c) => c.bestCombo, test: (c) => c.bestCombo >= 5 },
    { id: "combo9", name: "Flawless", icon: "star", goal: 9, unit: "×combo", prog: (c) => c.bestCombo, test: (c) => c.bestCombo >= 9 },
    { id: "level10", name: "Double Digits", icon: "medal", goal: 10, unit: "level", prog: (c) => c.bestLevel, test: (c) => c.bestLevel >= 10 },
    { id: "level15", name: "Mastermind", icon: "crown", goal: 15, unit: "level", prog: (c) => c.bestLevel, test: (c) => c.bestLevel >= 15 },
    { id: "sprintClean", name: "Marksman", icon: "target", goal: 1, unit: "", prog: (c) => (c.cleanSprint ? 1 : 0), test: (c) => c.cleanSprint },
    { id: "score500", name: "High Roller", icon: "trophy", goal: 500, unit: "pts", prog: (c) => c.bestSingle, test: (c) => c.bestSingle >= 500 },
    { id: "streak7", name: "Dedicated", icon: "flame", goal: 7, unit: "days", prog: (c) => c.streak.longest, test: (c) => c.streak.longest >= 7 },
    { id: "games25", name: "Persistent", icon: "infinity", goal: 25, unit: "games", prog: (c) => c.gamesPlayed, test: (c) => c.gamesPlayed >= 25 },
  ];

  // The same context object checkAchievements builds — reused by the Stats
  // screen to compute live progress toward locked badges.
  function achContext() {
    return {
      gamesPlayed: stats.gamesPlayed,
      bestCombo: stats.bestCombo,
      bestLevel: stats.bestLevel,
      streak: stats.streak,
      bestSingle: Math.max(0, ...stats.recent, ...Object.values(stats.best)),
      cleanSprint: false,
    };
  }

  function checkAchievements(extra = {}) {
    const ctx = Object.assign(achContext(), extra);
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
    $("toast-sub").textContent = a.sub || "Achievement unlocked";
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
  let master = null; // shared output chain (filter → limiter → out, + reverb)
  function ac() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  // A short, generated impulse response — decaying noise — used for a subtle
  // reverb that gives the tones a sense of space instead of a dead, dry beep.
  function makeImpulse(ctx, seconds, decay) {
    const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  // Build the shared output chain once: a gentle low-pass rounds off harsh
  // edges, a soft limiter glues overlapping notes so nothing clips, and a quiet
  // reverb send adds air. Everything routes through this.
  function audioMaster(ctx) {
    if (master) return master;
    try {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      lp.Q.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 26;
      comp.ratio.value = 3;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      lp.connect(comp).connect(ctx.destination);
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx, 0.5, 2.6);
      conv.connect(comp); // reverb returns just before the limiter
      master = { input: lp, reverb: conv };
    } catch {
      master = { input: ctx.destination, reverb: null };
    }
    return master;
  }
  function tone(
    freq,
    dur,
    { type = "sine", gain = 0.06, slideTo = null, body = false, reverb = 0.14 } = {}
  ) {
    if (!prefs.sound) return;
    const ctx = ac();
    if (!ctx) return;
    const m = audioMaster(ctx);
    const t0 = ctx.currentTime;
    // Per-tone mix node: fans the note out to the master chain and, optionally,
    // the reverb send.
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(m.input);
    if (reverb > 0 && m.reverb) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      out.connect(send).connect(m.reverb);
    }
    const tail = dur + 0.06;
    const voice = (f, g, ty, to, detune) => {
      const osc = ctx.createOscillator();
      const gn = ctx.createGain();
      osc.type = ty;
      if (detune) osc.detune.value = detune;
      osc.frequency.setValueAtTime(f, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      gn.gain.setValueAtTime(0, t0);
      gn.gain.linearRampToValueAtTime(g, t0 + 0.012); // soft attack — no click
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + tail); // smooth tail
      osc.connect(gn).connect(out);
      osc.start(t0);
      osc.stop(t0 + tail + 0.03);
    };
    // The main note, gently doubled a few cents apart for a warmer, fuller body.
    voice(freq, gain, type, slideTo, 0);
    voice(freq, gain * 0.5, type, slideTo, 7);
    // A faint octave-below sine adds low-end weight without muddiness.
    if (body) voice(freq / 2, gain * 0.36, "sine", slideTo ? slideTo / 2 : null, 0);
  }
  function vibrate(pattern) {
    if (prefs.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }
  const sfx = {
    flash: () => tone(523.25, 0.12, { gain: 0.05, body: true }),
    correct: (n = 0) => {
      tone(440 + n * 55, 0.14, { gain: 0.05, body: true });
      vibrate(8);
    },
    wrong: () => {
      tone(150, 0.22, { type: "sawtooth", gain: 0.05, slideTo: 80 });
      vibrate([18, 40, 18]);
    },
    win: () => {
      tone(523.25, 0.12, { gain: 0.05, body: true });
      setTimeout(() => tone(659.25, 0.12, { gain: 0.05, body: true }), 90);
      setTimeout(() => tone(783.99, 0.18, { gain: 0.05, body: true }), 180);
      vibrate(14);
    },
    over: () => {
      tone(330, 0.3, { type: "triangle", gain: 0.06, slideTo: 130 });
      vibrate([30, 60, 30]);
    },
    tick: () => tone(880, 0.05, { gain: 0.04, reverb: 0 }),
    unlock: () => {
      tone(659.25, 0.1, { gain: 0.05, body: true });
      setTimeout(() => tone(987.77, 0.16, { gain: 0.05, body: true }), 70);
    },
    checkpoint: () => {
      tone(523.25, 0.1, { gain: 0.05, body: true });
      setTimeout(() => tone(784, 0.1, { gain: 0.05, body: true }), 80);
      setTimeout(() => tone(1046.5, 0.22, { gain: 0.05, body: true }), 160);
      vibrate([12, 40, 12]);
    },
    // A power-up lands: a soft two-note lift, a touch quieter than a clear.
    earn: () => {
      tone(784, 0.1, { gain: 0.045, body: true });
      setTimeout(() => tone(1174.66, 0.16, { gain: 0.045, body: true }), 90);
      vibrate([10, 30, 10]);
    },
    // A colorful board cleared: one brief high shimmer over the usual win.
    milestone: () => {
      tone(1318.51, 0.13, { gain: 0.03 });
      setTimeout(() => tone(1567.98, 0.2, { gain: 0.03 }), 110);
    },
    // Peek re-reveals — a gentle upward "open".
    peek: () => tone(587.33, 0.14, { type: "triangle", gain: 0.045, slideTo: 880 }),
    // Skip sweeps the board clear — a quick downward whoosh before the win.
    skip: () => tone(880, 0.16, { type: "triangle", gain: 0.045, slideTo: 440 }),
  };

  /* ============================================================
     Theme
     ============================================================ */
  // The app always follows the phone's light/dark setting — no manual override.
  const systemDark = () =>
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  function applyTheme() {
    // No data-theme attribute means the CSS prefers-color-scheme rules drive
    // the palette. Just keep the status-bar / browser theme color in sync.
    document.documentElement.removeAttribute("data-theme");
    themeColorMeta.setAttribute("content", systemDark() ? "#000000" : "#ffffff");
  }
  // Flip live when the phone switches between light and dark.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applyTheme);

  /* ============================================================
     Board themes (cosmetic accent for lit/cleared tiles), unlocked by play.
     ============================================================ */
  const THEMES = [
    { id: "mono", name: "Mono", color: null, need: null },
    { id: "ocean", name: "Ocean", color: "#0a84ff", need: { test: () => stats.gamesPlayed >= 3, label: "Play 3 games" } },
    { id: "forest", name: "Forest", color: "#34c759", need: { test: () => stats.bestLevel >= 10, label: "Reach level 10" } },
    { id: "sunset", name: "Sunset", color: "#ff9500", need: { test: () => stats.bestCombo >= 9, label: "Hit a ×9 combo" } },
    { id: "grape", name: "Grape", color: "#bf5af2", need: { test: () => stats.streak.longest >= 7, label: "A 7-day streak" } },
    { id: "rose", name: "Rose", color: "#ff2d55", need: { test: () => stats.gamesPlayed >= 50, label: "Play 50 games" } },
    { id: "gold", name: "Gold", color: "#ffcc00", need: { test: () => stats.bestLevel >= 20, label: "Reach level 20" } },
  ];
  // Mono is always available; a colored theme counts as unlocked only once it
  // has been *earned* (added to stats.themesUnlocked) — never derived on the fly
  // from accumulated stats, so everyone starts with only Mono.
  const themeUnlocked = (t) => !t.need || stats.themesUnlocked.includes(t.id);
  const themeEligible = (t) => !t.need || t.need.test();
  function applyAccent() {
    let t = THEMES.find((x) => x.id === prefs.accent) || THEMES[0];
    if (!themeUnlocked(t)) t = THEMES[0]; // not earned (yet) → fall back to mono
    if (t.color) document.documentElement.style.setProperty("--accent", t.color);
    else document.documentElement.style.removeProperty("--accent");
  }
  // After a game, earn at most one newly-eligible theme — a steady drip rather
  // than a burst — and toast it.
  function checkThemeUnlocks() {
    for (const t of THEMES) {
      if (!t.need || stats.themesUnlocked.includes(t.id)) continue;
      if (themeEligible(t)) {
        stats.themesUnlocked.push(t.id);
        saveStats();
        showToast({ name: `${t.name} theme`, icon: "palette", sub: "Board theme unlocked" });
        return;
      }
    }
  }

  const LOCK_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  function setThemeHint(text) {
    const h = $("theme-hint");
    if (h) h.textContent = text;
  }
  // Build the Settings swatch row: pick an unlocked theme, or tap a locked one
  // to see what unlocks it.
  function renderThemes() {
    const grid = $("theme-grid");
    if (!grid) return;
    grid.innerHTML = "";
    for (const t of THEMES) {
      const unlocked = themeUnlocked(t);
      const el = document.createElement("button");
      el.type = "button";
      el.className =
        "swatch" +
        (prefs.accent === t.id ? " selected" : "") +
        (unlocked ? "" : " locked");
      el.style.setProperty("--sw", t.color || "var(--ink)");
      el.setAttribute(
        "aria-label",
        unlocked ? t.name : `${t.name}, locked — ${t.need.label}`
      );
      if (!unlocked) el.innerHTML = LOCK_SVG;
      el.addEventListener("click", () => {
        if (themeUnlocked(t)) {
          prefs.accent = t.id;
          savePrefs();
          applyAccent();
          renderThemes();
          vibrate(8);
        } else {
          setThemeHint(`${t.name} — ${t.need.label}`);
        }
      });
      grid.appendChild(el);
    }
    const cur = THEMES.find((x) => x.id === prefs.accent) || THEMES[0];
    setThemeHint(cur.id === "mono" ? "Mono — the classic black & white" : cur.name);
  }

  /* ============================================================
     Difficulty curve
     ============================================================ */
  // A rare board (5% of levels) breaks the black-and-white palette: tiles flash
  // in color and a correct tap pops with a ring burst. Rolled fresh each level.
  const MILESTONE_CHANCE = 0.05;
  const MILESTONE_COLORS = [
    "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be",
    "#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d55",
  ]; // Apple system colors — legible on both light and dark backgrounds.

  function boardSpec(level) {
    const d = DIFFS[state.diff];
    const grow = (level - 1) * d.scale;
    const gridSize = Math.min(3 + Math.floor(grow / 3), 6);
    const cells = gridSize * gridSize;
    let lit = clamp(
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
    // Daily ramps up sharply from level 15 on: more tiles to hold and a much
    // shorter look, so the one-run-a-day challenge bites for strong players.
    if (state.mode === "daily" && level >= 15) {
      const over = level - 14;
      lit = Math.min(lit + Math.floor(over / 2), Math.floor(cells * 0.6));
      flashMs = clamp(flashMs - over * 100, 380, 3200);
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
    renderGoal();
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
  // Score juice: float "+N" up from the board on every clear. Bigger combos get
  // slightly bigger type, so a hot streak visibly escalates.
  function floatPoints(gained, combo) {
    if (prefersReducedMotion() || prefs.focus) return;
    const el = document.createElement("span");
    el.className = "float-pts";
    el.textContent = `+${gained}`;
    el.style.fontSize = `${Math.min(22 + combo * 2, 40)}px`;
    boardEl.parentNode.appendChild(el);
    const anim = el.animate(
      [
        { opacity: 0, transform: "translate(-50%, 0) scale(0.8)" },
        { opacity: 1, transform: "translate(-50%, -30px) scale(1)", offset: 0.25 },
        { opacity: 0, transform: "translate(-50%, -74px) scale(1)" },
      ],
      { duration: 950, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
    anim.onfinish = () => el.remove();
  }
  function renderCombo() {
    if (state.combo >= 2) {
      comboEl.classList.add("show");
      comboX.textContent = "×" + state.combo;
      // The multiplier grows with the streak — ×9 should look hot.
      comboX.style.fontSize = `${Math.min(12 + state.combo * 1.2, 23)}px`;
      comboX.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }],
        { duration: 450, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
      );
    } else {
      comboEl.classList.remove("show");
    }
    renderGoal();
  }
  // The nearest locked achievement, judged on live run values where they apply,
  // so there's always a concrete near-term target on screen.
  function nextGoal() {
    const ctx = Object.assign(achContext(), {
      bestCombo: Math.max(stats.bestCombo, state.bestCombo),
      bestLevel: Math.max(stats.bestLevel, state.level),
      bestSingle: Math.max(0, state.score, ...stats.recent, ...Object.values(stats.best)),
    });
    const unlocked = new Set(stats.achievements);
    let best = null;
    for (const a of ACHIEVEMENTS) {
      if (unlocked.has(a.id) || a.goal <= 1) continue;
      const cur = Math.max(0, Math.min(a.goal, a.prog(ctx)));
      const remaining = a.goal - cur;
      if (remaining <= 0) continue;
      if (
        !best ||
        remaining < best.remaining ||
        (remaining === best.remaining && a.goal < best.goal)
      )
        best = { name: a.name, remaining, goal: a.goal };
    }
    return best;
  }
  function renderGoal() {
    const el = $("goal");
    if (!el) return;
    const g = state.playing ? nextGoal() : null;
    if (!g) {
      el.hidden = true;
      return;
    }
    el.textContent = `${g.remaining} to ${g.name}`;
    el.hidden = false;
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

  let boardSize = 3; // current grid dimension, for gap-snapping input

  function buildBoard(size) {
    boardSize = size;
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
      boardEl.appendChild(tile);
    }
  }
  const tileAt = (i) => boardEl.children[i];

  // One delegated pointerdown for the whole board (multi-touch safe: each
  // finger fires its own event). Landing on a tile counts directly; landing in
  // the gap between tiles snaps to the nearest one, so the entire board surface
  // is live — no dead zones during fast, imprecise tapping.
  boardEl.addEventListener("pointerdown", (e) => {
    const tile = e.target.closest(".tile");
    if (tile && tile.parentNode === boardEl) {
      onTileClick(+tile.dataset.index, tile);
      return;
    }
    if (!boardEl.children.length) return;
    const rect = boardEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const col = clamp(
      Math.floor(((e.clientX - rect.left) / rect.width) * boardSize),
      0,
      boardSize - 1
    );
    const row = clamp(
      Math.floor(((e.clientY - rect.top) / rect.height) * boardSize),
      0,
      boardSize - 1
    );
    const idx = row * boardSize + col;
    const t = tileAt(idx);
    if (t) onTileClick(idx, t);
  });

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

    // A small chance each level turns the board colorful. buildBoard() rebuilds
    // the grid each round, so per-tile colors clear on their own — only the
    // board-level class needs toggling. The roll uses Math.random (not the daily
    // seed) so it never perturbs which tiles are chosen.
    state.milestone = Math.random() < MILESTONE_CHANCE;
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
    if (state.locked || !state.playing || state.snaking) return;
    if (state.found.has(index)) return;
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
    // A colorful board earns a brief shimmer on top of the win.
    if (state.milestone) sfx.milestone();

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
    floatPoints(gained, state.combo);

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

    // A rare (~1%) Snake interlude instead of the next board.
    // (Skipped in two-player — that mode is a straight head-to-head.)
    const bonus = state.mode !== "versus" && Math.random() < SNAKE_CHANCE;

    if (granted) {
      promptEl.textContent = "Power-up earned";
      // Let the win arpeggio breathe, then a soft pickup lift marks the reward.
      setTimeout(() => { if (state.playing) sfx.earn(); }, 420);
    } else {
      promptEl.textContent =
        state.combo >= 2 ? `Perfect · ×${state.combo}` : "Perfect";
    }
    if (bonus) {
      setTimeout(() => {
        if (state.playing)
          startSnake(() => {
            if (state.playing) startRound();
          });
      }, 700);
    } else {
      setTimeout(() => {
        if (state.playing) startRound();
      }, 820);
    }
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
      // Don't lock the board here: only the tapped tile itself is inert (its
      // "wrong" class already blocks re-taps in onTileClick) — other tiles stay
      // live so a burst of fast taps never gets silently swallowed.
      setTimeout(() => {
        wrongTile.classList.remove("wrong");
        // Only restore the tally prompt if the round's still in play — a miss
        // that lands just before the round/game ends shouldn't stomp that text.
        if (state.playing && state.timeLeft > 0 && boardEl.classList.contains("interactive")) {
          promptEl.textContent = `Tap ${state.target.size - state.found.size} more`;
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
    promptEl.textContent =
      state.lives === 1 ? "Last life — careful" : "Missed one";
    setTimeout(() => {
      wrongTile.classList.remove("wrong");
      if (state.playing && state.lives > 0 && boardEl.classList.contains("interactive")) {
        promptEl.textContent = `Tap ${state.target.size - state.found.size} more`;
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
    sfx.peek();
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
    sfx.skip();
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

  // The top-bar back button: leave a Snake interlude, or return to the menu.
  function onBack() {
    if (state.snaking) endSnake();
    else goHome();
  }

  /* ============================================================
     Snake interlude (every five levels — tap Start to play)
     ============================================================ */
  const SNAKE_N = 5; // a little 5×5 cube field
  const SNAKE_CHANCE = 0.01; // ~1% of cleared boards spawn a Snake interlude
  const SNAKE_KEY = "recall.snakeBest";
  const SNAKE_SEEN_KEY = "recall.snakeSeen"; // first-encounter explainer flag
  let snake = null;
  let snakeCells = null;

  const snakeBest = () => {
    try {
      return parseInt(localStorage.getItem(SNAKE_KEY) || "0", 10) || 0;
    } catch {
      return 0;
    }
  };
  const setSnakeBest = (v) => {
    try {
      localStorage.setItem(SNAKE_KEY, String(v));
    } catch {
      /* ignore */
    }
  };

  function buildSnakeGrid() {
    const grid = $("snake-grid");
    grid.style.setProperty("--n", SNAKE_N);
    grid.innerHTML = "";
    snakeCells = [];
    for (let i = 0; i < SNAKE_N * SNAKE_N; i++) {
      const c = document.createElement("div");
      c.className = "snake-cell";
      grid.appendChild(c);
      snakeCells.push(c);
    }
    // Swipe controls — a flick on the grid steers the snake.
    let start = null;
    grid.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY };
    });
    grid.addEventListener("pointerup", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      if (Math.abs(dx) > Math.abs(dy)) setSnakeDir(dx > 0 ? 1 : -1, 0);
      else setSnakeDir(0, dy > 0 ? 1 : -1);
    });
  }

  function setSnakeDir(x, y) {
    if (!snake || !snake.running) return;
    if (snake.dir && snake.dir.x === -x && snake.dir.y === -y) return; // no reversal
    snake.nextDir = { x, y };
  }
  function snakeKey(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const map = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    };
    const v = map[k];
    if (!v) return;
    e.preventDefault();
    setSnakeDir(v[0], v[1]);
  }

  function placeFood() {
    const occ = new Set(snake.body.map((s) => s.y * SNAKE_N + s.x));
    const free = [];
    for (let i = 0; i < SNAKE_N * SNAKE_N; i++) if (!occ.has(i)) free.push(i);
    if (!free.length) return snakeWin(); // filled the whole board — a clean win
    const idx = free[Math.floor(Math.random() * free.length)];
    snake.food = { x: idx % SNAKE_N, y: Math.floor(idx / SNAKE_N) };
  }

  function renderSnake() {
    for (const c of snakeCells) c.className = "snake-cell";
    snake.body.forEach((s, i) => {
      const cell = snakeCells[s.y * SNAKE_N + s.x];
      if (!cell) return;
      cell.classList.add("on");
      if (i === snake.body.length - 1) cell.classList.add("head");
    });
    if (snake.food) {
      const f = snakeCells[snake.food.y * SNAKE_N + snake.food.x];
      if (f) f.classList.add("food");
    }
  }

  function snakeTickFn() {
    if (!snake.nextDir) return; // sits still until the first swipe / arrow
    const dir = snake.nextDir;
    snake.dir = dir;
    const head = snake.body[snake.body.length - 1];
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;
    if (nx < 0 || nx >= SNAKE_N || ny < 0 || ny >= SNAKE_N) return snakeDie();
    const grow = snake.food && nx === snake.food.x && ny === snake.food.y;
    // The tail frees up as you move, unless you're growing this step.
    const collide = (grow ? snake.body : snake.body.slice(1)).some(
      (s) => s.x === nx && s.y === ny
    );
    if (collide) return snakeDie();
    snake.body.push({ x: nx, y: ny });
    if (grow) {
      snake.score += 1;
      $("snake-score").textContent = snake.score;
      sfx.correct(snake.score);
      placeFood();
      snake.tick = Math.max(110, snake.tick - 16); // starts slow, quickens each bite
      if (snake.running) restartSnakeLoop();
    } else {
      snake.body.shift();
    }
    if (snake.running) renderSnake();
  }
  function restartSnakeLoop() {
    if (snake.iv) clearInterval(snake.iv);
    snake.iv = setInterval(snakeTickFn, snake.tick);
  }

  function snakeDie() {
    if (!snake || !snake.running) return;
    snake.running = false;
    if (snake.iv) clearInterval(snake.iv);
    sfx.wrong();
    const best = Math.max(snakeBest(), snake.score);
    setSnakeBest(best);
    $("snake-hint").textContent = `Score ${snake.score} · best ${best}`;
    $("snake-continue").hidden = false;
  }

  // Filled the whole board — a clean win. Big reward: double your run score.
  function snakeWin() {
    if (!snake || !snake.running) return;
    snake.running = false;
    if (snake.iv) clearInterval(snake.iv);
    snake.food = null;
    renderSnake(); // show the fully-filled board
    state.score *= 2;
    renderHUD();
    bump(scoreEl);
    sfx.win();
    setTimeout(() => sfx.milestone(), 160);
    const best = Math.max(snakeBest(), snake.score);
    setSnakeBest(best);
    $("snake-kicker").textContent = "Board cleared!";
    $("snake-hint").textContent = "Perfect — your score just doubled.";
    $("snake-continue").hidden = false;
  }

  // Show the interlude with an idle board and a Start button — it doesn't begin
  // until the player taps Start (and then doesn't move until the first swipe).
  function startSnake(onDone) {
    if (!snakeCells) buildSnakeGrid();
    state.snaking = true;
    state.locked = true;
    hidePowerups();
    if (MODES[state.mode].timed) pauseTimer(); // the bonus doesn't burn Sprint time
    const mid = Math.floor(SNAKE_N / 2);
    snake = {
      body: [{ x: mid, y: mid }],
      dir: null,
      nextDir: null,
      food: null,
      score: 0,
      tick: 320, // starts slow; quickens with every bite
      running: false,
      iv: null,
      onDone,
    };
    placeFood();
    $("snake-score").textContent = "0";
    $("snake-kicker").textContent = `Level ${state.level} reached`;
    // The first time you ever hit a Snake round, explain what it is.
    let snakeSeen = false;
    try {
      snakeSeen = !!localStorage.getItem(SNAKE_SEEN_KEY);
    } catch {
      snakeSeen = true;
    }
    $("snake-hint").textContent = snakeSeen
      ? "Eat the squares — swipe or use arrow keys."
      : "Bonus round! Eat the squares to grow — fill the whole board and your score doubles. Swipe or use the arrow keys.";
    try {
      localStorage.setItem(SNAKE_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    $("snake-start").hidden = false;
    $("snake-continue").hidden = true;
    $("snake-screen").hidden = false;
    renderSnake();
  }

  // Tap Start: arm controls and run the loop (the snake waits for a direction).
  function beginSnakePlay() {
    if (!snake || snake.running) return;
    snake.running = true;
    $("snake-start").hidden = true;
    document.addEventListener("keydown", snakeKey);
    restartSnakeLoop();
  }

  // Leave the interlude and pick the run back up where it left off.
  function endSnake() {
    if (!state.snaking) return;
    if (snake && snake.iv) clearInterval(snake.iv);
    document.removeEventListener("keydown", snakeKey);
    state.snaking = false;
    $("snake-screen").hidden = true;
    $("snake-start").hidden = true;
    $("snake-continue").hidden = true;
    if (MODES[state.mode].timed && state.playing) resumeTimer();
    const done = snake && snake.onDone;
    snake = null;
    if (state.playing && done) done();
  }

  /* ============================================================
     Two-player (pass-and-play). Both players face the same seeded boards;
     highest score wins. No Snake interludes here.
     ============================================================ */
  function startVersusPlayer(n) {
    state.vs.player = n;
    state.level = 1;
    state.score = 0;
    state.combo = 1;
    state.bestCombo = 1;
    state.taps = 0;
    state.hits = 0;
    state.roundMisses = 0;
    state.lives = state.maxLives;
    state.peek = 0;
    state.skip = 0;
    state.usedSkip = false;
    state.usedPeek = false;
    state.playing = true;
    state.locked = true;
    // Same seed for both players → identical boards, a fair head-to-head.
    state.rng = mulberry32(state.vs.seed);
    dailyDateEl.textContent = `Player ${n}`;
    dailyDateEl.hidden = false;
    $("versus-screen").hidden = true;
    powerupsEl.classList.remove("show", "reserved");
    renderHUD();
    renderLives();
    startRound();
  }

  function versusRunEnded() {
    const vs = state.vs;
    vs.scores[vs.player - 1] = state.score;
    vs.levels[vs.player - 1] = state.level;
    dailyDateEl.hidden = true;
    if (vs.player === 1) {
      vs.phase = "handoff";
      $("versus-kicker").textContent = "Player 1 done";
      $("versus-title").textContent = "Pass the device";
      $("versus-detail").textContent = `Player 1 scored ${vs.scores[0]} · level ${vs.levels[0]}`;
      $("versus-next").textContent = "Player 2, go";
      $("versus-home").hidden = true;
    } else {
      vs.phase = "result";
      const [s1, s2] = vs.scores;
      $("versus-kicker").textContent = "Result";
      $("versus-title").textContent =
        s1 === s2 ? "It's a tie!" : s1 > s2 ? "Player 1 wins!" : "Player 2 wins!";
      $("versus-detail").textContent = `P1 ${s1} · L${vs.levels[0]}     P2 ${s2} · L${vs.levels[1]}`;
      $("versus-next").textContent = "Rematch";
      $("versus-home").hidden = false;
      sfx.win();
    }
    $("versus-screen").hidden = false;
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
  // When set, the next Daily run replays this past date instead of today —
  // practice only: no lock, no streak/record effects beyond a normal game.
  let archiveDate = null;

  function newGame(modeOverride) {
    ac(); // unlock audio
    // Two-player is launched as an override (Endless → 2 Players); event
    // handlers pass an Event here, so only honour a real string.
    const mode = typeof modeOverride === "string" ? modeOverride : prefs.mode;
    if (mode !== "daily") archiveDate = null; // stale picks never leak across modes
    const archive = mode === "daily" ? archiveDate : null;
    // Daily is locked to one run per day — already played today? Bounce home.
    // (Archive replays are practice and never locked.)
    if (mode === "daily" && !archive && dailyDoneToday()) {
      goHome();
      return;
    }
    state.archive = archive;
    state.mode = mode;
    state.diff = prefs.difficulty;
    // Expert skips the gentle early boards and drops you in deep.
    state.level = MODES[state.mode].headStart || 1;
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
    state.snaking = false;

    state.rng = MODES[state.mode].seeded
      ? mulberry32(state.archive ? seedFromKey(state.archive) : dailySeed())
      : Math.random;

    // Daily locks the moment it starts — one attempt per day, no resuming.
    // Archive replays don't lock anything.
    if (state.mode === "daily" && !state.archive) {
      stats.dailyDone = todayKey();
      // Let the reminder worker know today's Daily is handled.
      metaSet("dailyPlayed", todayKey());
    }

    // Record today's play and advance the streak.
    registerPlay();
    pushStreakMeta(); // keep the reminder worker's streak info fresh
    checkAchievements();

    hudEl.hidden = false;
    comboEl.classList.remove("show");
    backBtn.hidden = false;
    wordmark.hidden = false;
    // Daily shows its date under the wordmark; other modes don't.
    if (state.mode === "daily") {
      dailyDateEl.textContent = state.archive
        ? `${archiveDateLabel(state.archive)} · Archive`
        : dailyDateLabel();
      dailyDateEl.hidden = false;
    } else {
      dailyDateEl.hidden = true;
    }
    powerupsEl.classList.remove("show", "reserved");
    $("snake-screen").hidden = true;
    $("versus-screen").hidden = true;
    $("players-screen").hidden = true;
    renderHUD();
    renderLives();
    closeAllScreens();

    // Two-player: set up a shared-seed match and hand the first turn to Player 1.
    if (state.mode === "versus") {
      state.vs = {
        seed: (Math.random() * 1e9) | 0,
        player: 1,
        scores: [0, 0],
        levels: [0, 0],
        phase: null,
      };
      startVersusPlayer(1);
      return;
    }

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

    // Two-player runs stay out of the single-player stats; hand off instead.
    if (state.mode === "versus") {
      setTimeout(versusRunEnded, 650);
      return;
    }

    // Record stats.
    const reachedLevel = state.level; // level you were attempting
    stats.gamesPlayed++;
    stats.totalTaps += state.taps;
    stats.correctTaps += state.hits;
    stats.bestLevel = Math.max(stats.bestLevel, reachedLevel);
    stats.bestCombo = Math.max(stats.bestCombo, state.bestCombo);
    const practice = !!state.archive; // archive replay — no Daily records
    const prevBest = stats.best[state.mode] || 0; // best before this run
    const isBest = !practice && state.score >= prevBest;
    if (!practice) stats.best[state.mode] = Math.max(prevBest, state.score);
    stats.recent.push(state.score);
    if (stats.recent.length > 16) stats.recent = stats.recent.slice(-16);

    // Per-game accuracy, for the trend sparkline.
    const acc = state.taps > 0 ? Math.round((state.hits / state.taps) * 100) : 0;
    stats.recentAcc.push(acc);
    if (stats.recentAcc.length > 16) stats.recentAcc = stats.recentAcc.slice(-16);

    // When you play, for the time-of-day distribution.
    stats.playHours[new Date().getHours()] += 1;

    // Per-mode run aggregate, for average level reached.
    const agg = (stats.modeAgg[state.mode] = stats.modeAgg[state.mode] || {
      runs: 0,
      levelSum: 0,
    });
    agg.runs += 1;
    agg.levelSum += reachedLevel;

    // Daily keeps a per-day score for the weekly strip (real runs only).
    if (state.mode === "daily" && !practice)
      stats.dailyScores[todayKey()] = state.score;

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
      prevBest,
      archive: state.archive,
      // How many tiles short you were on the board you went out on.
      missedBy: state.target.size - state.found.size,
    };

    checkThemeUnlocks(); // a fresh board theme is a reward beat
    revealMissed(state.lastResult);
  }

  // Game-over replay: show the full board you were meant to clear, then mark
  // which tiles you got (filled) vs. missed (dashed), before the end screen.
  async function revealMissed(result) {
    for (const t of boardEl.children)
      t.classList.remove("wrong", "correct", "missed", "pop", "lit");
    await wait(260);
    // The whole pattern lights up — here's what the board was.
    for (const idx of state.target) {
      const t = tileAt(idx);
      if (t) t.classList.add("lit");
    }
    sfx.flash();
    await wait(720);
    // Now separate the hits from the misses.
    for (const idx of state.target) {
      const t = tileAt(idx);
      if (!t) continue;
      t.classList.remove("lit");
      t.classList.add(state.found.has(idx) ? "correct" : "missed");
    }
    const missedCount = state.target.size - state.found.size;
    if (missedCount > 0)
      promptEl.textContent = `You missed ${missedCount} tile${
        missedCount > 1 ? "s" : ""
      }`;
    await wait(1250);
    // If the player bailed to the menu mid-replay, don't pop the end screen.
    if (screens.home.hidden) showEndScreen(result);
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

  /* ============================================================
     Daily reminder — a single "the new Daily is ready" nudge ~noon
     ============================================================ */
  // A small bit of state the service worker can also read, so it knows whether
  // reminders are on and whether today's Daily was already played. localStorage
  // isn't visible to the worker, so we stash it in a Cache both sides can reach.
  async function metaSet(key, value) {
    try {
      const c = await caches.open("recall-meta");
      await c.put("/__meta/" + key, new Response(String(value)));
    } catch {
      /* caches unavailable — reminders just won't fire */
    }
  }
  // Share the current streak with the worker so the evening "about to expire"
  // nudge can tell you exactly what's on the line.
  function pushStreakMeta() {
    metaSet("streakCurrent", stats.streak.current || 0);
    metaSet("streakLast", stats.streak.last || "");
  }
  const PERIODIC_TAG = "daily-ready";
  const REMINDER_MININTERVAL = 12 * 60 * 60 * 1000; // ~twice a day
  const notifSupported = () =>
    "Notification" in window && "serviceWorker" in navigator;
  const notifGranted = () =>
    notifSupported() && Notification.permission === "granted";

  function setReminderSwitch(on) {
    const sw = $("reminder-toggle");
    if (!sw) return;
    sw.classList.toggle("is-on", on);
    sw.setAttribute("aria-checked", String(on));
  }

  // Reflect support/permission state in the Settings hint, and disable the
  // toggle where notifications can't work at all (e.g. iOS Safari in a tab).
  function refreshReminderHint() {
    const hint = $("reminder-hint");
    const sw = $("reminder-toggle");
    if (!hint || !sw) return;
    let text;
    let disabled = false;
    if (!notifSupported()) {
      disabled = true;
      text = isIosSafari()
        ? "Add Recall to your Home Screen to enable reminders."
        : "This browser doesn’t support notifications.";
    } else if (Notification.permission === "denied") {
      disabled = true;
      text = "Notifications are blocked — turn them on in your browser settings.";
    } else if (prefs.dailyReminder) {
      text =
        "On — a nudge around noon when the new Daily is ready, and an evening heads-up before it resets.";
    } else {
      text =
        "A nudge around noon when the new Daily is ready, plus an evening heads-up before it resets (and your streak’s on the line).";
    }
    hint.textContent = text;
    sw.toggleAttribute("disabled", disabled);
    const test = $("test-notif");
    if (test) test.toggleAttribute("disabled", disabled);
  }

  // Ask the worker to wake up periodically; on supported installs it'll check
  // the clock and post the reminder. (No backend — best effort where available.)
  async function registerDailyReminder() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.periodicSync) {
        await reg.periodicSync.register(PERIODIC_TAG, {
          minInterval: REMINDER_MININTERVAL,
        });
      }
    } catch {
      /* periodic sync unavailable (most browsers) — toggle still set for part 2 */
    }
  }
  async function unregisterDailyReminder() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.periodicSync) await reg.periodicSync.unregister(PERIODIC_TAG);
    } catch {
      /* ignore */
    }
  }

  // Turn reminders on: confirm permission first, then arm the worker.
  async function enableReminders() {
    if (!notifSupported()) return false;
    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        return false;
      }
    }
    if (perm !== "granted") return false;
    await metaSet("reminderOn", "1");
    await registerDailyReminder();
    return true;
  }
  async function disableReminders() {
    await metaSet("reminderOn", "0");
    await unregisterDailyReminder();
  }

  // Fire one reminder right now so you can see exactly what it looks like.
  // Requests permission first if it hasn't been asked yet.
  async function sendTestNotification() {
    const btn = $("test-notif");
    if (!notifSupported() || (btn && btn.hasAttribute("disabled"))) return;
    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        return;
      }
    }
    if (perm !== "granted") {
      refreshReminderHint();
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("Today’s Daily is ready", {
        body: "Test notification — you’re all set.",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: "daily-ready",
        data: { url: "./?daily=1" },
      });
      vibrate(12);
      if (btn) {
        const label = btn.textContent;
        btn.textContent = "Sent ✓";
        setTimeout(() => (btn.textContent = label), 1600);
      }
    } catch {
      /* showNotification can fail if the worker isn't ready yet */
    }
  }

  async function onReminderToggle() {
    const sw = $("reminder-toggle");
    if (sw && sw.hasAttribute("disabled")) return;
    if (!prefs.dailyReminder) {
      const ok = await enableReminders();
      prefs.dailyReminder = ok;
      if (ok) vibrate(12);
    } else {
      prefs.dailyReminder = false;
      await disableReminders();
    }
    savePrefs();
    setReminderSwitch(prefs.dailyReminder);
    refreshReminderHint();
  }

  // On launch: re-arm if it was on (and permission still holds), or clear it.
  function initReminders() {
    setReminderSwitch(!!prefs.dailyReminder);
    pushStreakMeta();
    if (prefs.dailyReminder && notifGranted()) {
      metaSet("reminderOn", "1");
      registerDailyReminder();
    } else if (prefs.dailyReminder) {
      // Permission was revoked since last time — fall back to off.
      prefs.dailyReminder = false;
      savePrefs();
      setReminderSwitch(false);
      metaSet("reminderOn", "0");
    } else {
      metaSet("reminderOn", "0");
    }
    refreshReminderHint();
  }

  function goHome() {
    state.playing = false;
    // Tear down any Snake interlude / versus match that was up.
    if (snake && snake.iv) clearInterval(snake.iv);
    document.removeEventListener("keydown", snakeKey);
    snake = null;
    state.snaking = false;
    state.vs = null;
    state.archive = null;
    archiveDate = null;
    $("snake-screen").hidden = true;
    $("versus-screen").hidden = true;
    $("players-screen").hidden = true;
    stopTimer();
    clearTimeout(quoteTimer);
    hudEl.hidden = true;
    comboEl.classList.remove("show");
    $("goal").hidden = true;
    powerupsEl.classList.remove("show", "reserved");
    backBtn.hidden = true;
    wordmark.hidden = true;
    dailyDateEl.hidden = true;
    // Reset the mode screen's quote/transition state for a clean next entry.
    screens.modes.classList.remove("quoting");
    const mq = $("modes-quote");
    mq.style.transition = "";
    mq.style.opacity = "";
    mq.style.transform = "";
    mq.style.top = "";
    mq.style.bottom = "";
    rollSubtitle();
    showScreen("home");
    syncHomeHints();
  }

  function showEndScreen(r) {
    let kicker = r.mode === "sprint" ? "Time’s up" : "Game over";
    $("end-score").textContent = r.score;
    const detail =
      r.mode === "sprint"
        ? `Level ${r.level} reached`
        : `Reached level ${r.level}`;
    $("end-detail").textContent =
      detail + (r.combo >= 2 ? ` · best ×${r.combo}` : "");

    // Relationship to your personal best for this mode, plus a "so close" hook
    // that nudges one more run when you only just fell short.
    const name = modeLabel(r.mode);
    const eb = $("end-best");
    const eg = $("end-gap");
    const beat = r.prevBest > 0 && r.score > r.prevBest;
    const gap = r.prevBest - r.score;
    // Within ~10% (min 20 pts) of your best counts as a near-miss.
    const closeToBest =
      !beat && r.prevBest > 0 && gap > 0 && gap <= Math.max(20, Math.round(r.prevBest * 0.1));

    if (beat) {
      eb.textContent = `New ${name} best · +${r.score - r.prevBest}`;
      eb.hidden = false;
      eg.hidden = true;
    } else if (r.prevBest === 0 && r.score > 0) {
      eb.textContent = `Your first ${name} score`;
      eb.hidden = false;
      eg.hidden = true;
    } else {
      eb.hidden = true;
      // Daily is one run per day, so never invite "go again" (archive can).
      const daily = r.mode === "daily" && !r.archive;
      if (r.missedBy === 1) {
        kicker = "So close!";
        eg.textContent = daily
          ? "One tile from clearing today’s board."
          : "One tile from clearing it — go again?";
        eg.hidden = false;
      } else if (closeToBest) {
        kicker = "So close!";
        eg.textContent = daily
          ? `Just ${gap} from your Daily best.`
          : `Just ${gap} from your best — one more run?`;
        eg.hidden = false;
      } else if (r.prevBest > 0) {
        eg.textContent =
          gap > 0 ? `${gap} from your ${name} best` : `Matched your ${name} best`;
        eg.hidden = false;
      } else {
        eg.hidden = true;
      }
    }

    $("end-kicker").textContent = kicker;
    // The share string always describes *today's* Daily — hide it on archive runs.
    $("copy-result").hidden = r.mode !== "daily" || !!r.archive;
    // Daily can't be replayed today (archive replays can), so home is primary.
    $("again-btn").textContent =
      r.mode === "daily" && !r.archive ? "Back to home" : "Play again";
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
    // A streak counts as current only if you played today or yesterday.
    const last = stats.streak.last;
    const live =
      last && daysBetween(last, todayKey()) <= 1 ? stats.streak.current : 0;
    $("streak-current").textContent = live;
    $("streak-longest").textContent = stats.streak.longest;
    $("freeze-count").textContent = stats.freezes;
    renderCalendar();
    renderDailyWeek();
    renderAchievements();
    renderSpark();
    renderAccSpark();
    renderHours();
    renderBestList();
  }

  // Per-mode bests with average level reached underneath each.
  function renderBestList() {
    const list = $("best-list");
    if (!list) return;
    // Only modes reachable from the current UI (Expert/Sprint are hidden).
    const rows = ["endless", "daily", "sequence"];
    list.innerHTML = rows
      .map((key) => {
        const best = stats.best[key] || 0;
        const agg = stats.modeAgg[key] || { runs: 0, levelSum: 0 };
        const avg = agg.runs ? Math.round(agg.levelSum / agg.runs) : 0;
        const sub = agg.runs
          ? `<small class="best-sub">avg level ${avg}</small>`
          : "";
        return `<li><span>${modeLabel(key)} best${sub}</span><b>${best}</b></li>`;
      })
      .join("");
  }

  // The current week's Daily scores, Sun–Sat, with the best day highlighted.
  function renderDailyWeek() {
    const strip = $("week-strip");
    if (!strip) return;
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay()); // back to Sunday
    const labels = ["S", "M", "T", "W", "T", "F", "S"];
    const todayStr = todayKey();
    let total = 0;
    let topScore = -1;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const key = dateKey(d);
      const has = Object.prototype.hasOwnProperty.call(stats.dailyScores, key);
      const score = has ? stats.dailyScores[key] : null;
      if (has) total += score;
      if (has && score > topScore) topScore = score;
      days.push({ key, score, has, future: d > today, isToday: key === todayStr, dow: d.getDay() });
    }
    strip.innerHTML = days
      .map((d) => {
        let cls = "week-cell";
        if (d.future) cls += " future";
        else if (!d.has) cls += " empty";
        if (d.isToday) cls += " today";
        if (d.has && d.score === topScore && topScore > 0) cls += " top";
        const val = d.future ? "" : d.has ? d.score : "—";
        return (
          `<div class="${cls}"><span class="week-val">${val}</span>` +
          `<span class="week-dow">${labels[d.dow]}</span></div>`
        );
      })
      .join("");
    $("week-total").textContent = total > 0 ? `${total} total` : "";
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
    const ctx = achContext();
    for (const a of ACHIEVEMENTS) {
      const has = unlocked.has(a.id);
      const el = document.createElement("div");
      el.className = "ach" + (has ? "" : " locked");
      let inner =
        `<span class="ach-badge">${ICONS[a.icon]}</span>` +
        `<span class="ach-name">${a.name}</span>`;
      if (!has) {
        // Show how close you are: a thin bar plus current / goal.
        const cur = Math.max(0, Math.min(a.goal, a.prog(ctx)));
        const pct = Math.round((cur / a.goal) * 100);
        const label = a.goal > 1 ? `${cur}/${a.goal}` : "Locked";
        inner +=
          `<span class="ach-prog"><span class="ach-prog-fill" style="width:${pct}%"></span></span>` +
          `<span class="ach-prog-num">${label}</span>`;
      }
      el.innerHTML = inner;
      el.title = a.name;
      grid.appendChild(el);
    }
    $("ach-count").textContent = `${unlocked.size} / ${ACHIEVEMENTS.length}`;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  // Shared line-sparkline: auto-scales `data` to fill the 300×80 viewBox.
  function drawSpark(svg, data, emptyMsg) {
    svg.innerHTML = "";
    if (data.length < 2) {
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("x", "150");
      t.setAttribute("y", "44");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "empty");
      t.textContent = emptyMsg;
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
    const poly = document.createElementNS(SVGNS, "polyline");
    poly.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    svg.appendChild(poly);
    const last = pts[pts.length - 1];
    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "3.5");
    svg.appendChild(dot);
  }
  function renderSpark() {
    drawSpark($("spark"), stats.recent.slice(-12), "Play a few games to see your trend");
  }
  function renderAccSpark() {
    const data = stats.recentAcc.slice(-12);
    drawSpark($("acc-spark"), data, "Accuracy shows after a couple of games");
    $("acc-last").textContent = data.length ? `${data[data.length - 1]}%` : "";
  }

  // A 24-bar distribution of when you finish games, by hour of day.
  function renderHours() {
    const svg = $("hours");
    svg.innerHTML = "";
    const data = stats.playHours;
    const total = data.reduce((a, b) => a + b, 0);
    if (total === 0) {
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("x", "150");
      t.setAttribute("y", "40");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "empty");
      t.textContent = "Your play times appear here";
      svg.appendChild(t);
      $("hours-peak").textContent = "";
      return;
    }
    const W = 300,
      H = 70,
      pad = 6,
      n = 24;
    const max = Math.max(...data);
    const slot = (W - pad * 2) / n;
    const bw = slot * 0.62;
    for (let h = 0; h < n; h++) {
      const bh = data[h] > 0 ? Math.max(3, (data[h] / max) * (H - pad * 2 - 10)) : 1;
      const x = pad + h * slot + (slot - bw) / 2;
      const y = H - pad - 10 - bh;
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", x.toFixed(1));
      rect.setAttribute("y", y.toFixed(1));
      rect.setAttribute("width", bw.toFixed(1));
      rect.setAttribute("height", bh.toFixed(1));
      rect.setAttribute("rx", "1.5");
      rect.setAttribute("class", data[h] === max ? "hour-bar peak" : "hour-bar");
      svg.appendChild(rect);
    }
    // Axis ticks at 0 / 6 / 12 / 18 so the day reads left→right.
    [0, 6, 12, 18].forEach((h) => {
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("x", (pad + h * slot + bw / 2).toFixed(1));
      t.setAttribute("y", H - 1);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "hour-tick");
      t.textContent = h === 0 ? "12a" : h === 12 ? "12p" : h === 6 ? "6a" : "6p";
      svg.appendChild(t);
    });
    const peak = data.indexOf(max);
    const fmtHr = (h) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);
    $("hours-peak").textContent = `peak ${fmtHr(peak)}`;
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

    const dark = systemDark();
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
    const modeName = modeLabel(r.mode);
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

  // Share the app itself — invite someone to play. Native share sheet when
  // available, otherwise copy the link with a brief "Copied!" confirmation.
  async function shareApp() {
    const url = location.origin + location.pathname;
    const text = "Recall — a minimalist memory game. Can you keep up?";
    if (navigator.share) {
      try {
        await navigator.share({ title: "Recall", text, url });
        return;
      } catch {
        /* user cancelled — done */
        return;
      }
    }
    const btn = $("share-app");
    const flash = () => {
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Share"), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        flash();
      } catch {
        /* clipboard blocked — nothing more to do */
      }
    }
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
  // Focus mode: hide score/level/combo/goal during play for a calmer run.
  function applyFocus() {
    document.documentElement.toggleAttribute("data-focus", !!prefs.focus);
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
    const dailyLocked = prefs.mode === "daily" && dailyDoneToday();
    $("mode-hint").textContent = dailyLocked
      ? "Today’s Daily is done. New boards at midnight."
      : MODES[prefs.mode].hint;
    $("diff-hint").textContent = DIFFS[prefs.difficulty].hint;
    const play = $("start-btn");
    play.disabled = dailyLocked;
    play.textContent = dailyLocked ? "Come back tomorrow" : "Play";
    // The archive entry point only makes sense on the Daily tab.
    $("archive-link").hidden = prefs.mode !== "daily";
  }

  // Build the archive list: the last 14 days (yesterday back), with the score
  // you posted on days you actually played that Daily.
  function renderArchive() {
    const list = $("archive-list");
    list.innerHTML = "";
    const today = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dateKey(d);
      const played = Object.prototype.hasOwnProperty.call(stats.dailyScores, key);
      const li = document.createElement("li");
      li.className = "archive-day";
      const label = d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      li.innerHTML =
        `<span>${label}</span>` +
        `<b>${played ? stats.dailyScores[key] : "—"}</b>`;
      li.addEventListener("click", () => {
        archiveDate = key;
        newGame("daily");
      });
      list.appendChild(li);
    }
  }

  /* ============================================================
     Wire up
     ============================================================ */
  initSegmented("mode-seg", (v) => {
    prefs.mode = v;
    savePrefs();
    syncHomeHints();
  });
  initSegmented("diff-seg", (v) => {
    prefs.difficulty = v;
    savePrefs();
    $("diff-hint").textContent = DIFFS[v].hint;
  });
  initSwitch("sound-toggle", "sound");
  initSwitch("haptics-toggle", "haptics");
  initSwitch("adaptive-toggle", "adaptive");
  initSwitch("contrast-toggle", "contrast", applyContrast);
  initSwitch("focus-toggle", "focus", applyFocus);

  $("archive-link").addEventListener("click", () => {
    renderArchive();
    showScreen("archive");
  });
  $("play-btn").addEventListener("click", enterModes);
  // Endless asks 1P or 2P first; the other modes start straight away.
  $("start-btn").addEventListener("click", () => {
    if (prefs.mode === "endless") $("players-screen").hidden = false;
    else newGame();
  });
  $("players-1").addEventListener("click", () => newGame("endless"));
  $("players-2").addEventListener("click", () => newGame("versus"));
  $("players-back").addEventListener("click", () => {
    $("players-screen").hidden = true;
  });
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
  backBtn.addEventListener("click", onBack);
  $("snake-start").addEventListener("click", beginSnakePlay);
  $("snake-continue").addEventListener("click", endSnake);
  $("snake-skip").addEventListener("click", endSnake);
  $("versus-next").addEventListener("click", () => {
    if (state.vs && state.vs.phase === "handoff") startVersusPlayer(2);
    else newGame("versus"); // rematch — a fresh shared seed
  });
  $("versus-home").addEventListener("click", goHome);

  $("reminder-toggle").addEventListener("click", onReminderToggle);
  $("test-notif").addEventListener("click", sendTestNotification);
  $("open-settings").addEventListener("click", () => {
    refreshReminderHint(); // permission may have changed outside the app
    renderThemes(); // reflect any themes unlocked since last open
    showScreen("settings");
  });
  $("open-help").addEventListener("click", () => showScreen("help"));
  $("share-app").addEventListener("click", shareApp);
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
        // Settings/Stats/Help are reached from the mode bar — go back to it.
        showScreen("modes");
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
      stats.best = { endless: 0, expert: 0, sprint: 0, daily: 0, sequence: 0 };
      stats.recent = [];
      stats.recentAcc = [];
      stats.playHours = Array(24).fill(0);
      stats.modeAgg = {};
      stats.dailyScores = {};
      stats.streak = { current: 0, longest: 0, last: null };
      stats.freezes = 0;
      stats.playDays = [];
      stats.achievements = [];
      stats.themesUnlocked = [];
      stats.calib = 0;
      stats.dailyDone = null;
      // Cosmetic themes re-lock with the stats that earned them.
      prefs.accent = "mono";
      savePrefs();
      applyAccent();
      saveStats();
      renderStatsScreen();
      renderThemes();
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
    // Coming back after midnight should re-open the Daily on the home screen.
    if (!document.hidden && !state.playing) syncHomeHints();
  });

  /* ============================================================
     Init
     ============================================================ */
  // Modes shown on the bar. Expert/Sprint/Versus still exist in MODES but aren't
  // selectable here, so fold any stale saved preference back to a visible one.
  const BAR_MODES = ["endless", "daily", "sequence"];

  function init() {
    applyTheme();
    if (!BAR_MODES.includes(prefs.mode)) {
      prefs.mode = "endless";
      savePrefs();
    }
    syncSegmented("mode-seg", prefs.mode);
    syncSegmented("diff-seg", prefs.difficulty);
    syncHomeHints();
    bestEl.textContent = stats.best[prefs.mode] || 0;

    // Decorative animated mark — on the home hero, the mode screen's top-left
    // logo, and the Add-to-Home-Screen prompt. All cycle the same pattern so
    // they stay in step.
    const markCells = ["hero-mark", "mode-mark", "a2hs-mark"]
      .map($)
      .filter(Boolean)
      .map((mark) => {
        const cells = [];
        for (let i = 0; i < 9; i++) {
          const c = document.createElement("i");
          mark.appendChild(c);
          cells.push(c);
        }
        return cells;
      });
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
      markCells.forEach((cells) =>
        cells.forEach((c, i) => c.classList.toggle("on", p.has(i)))
      );
      pi++;
    };
    cycle();
    setInterval(cycle, 1400);

    $("app-version").textContent = "v" + VERSION;
    rollSubtitle();
    applyContrast();
    applyFocus();
    // Everyone starts with only Mono; colored themes are earned through play.
    applyAccent();
    renderThemes();
    initReminders();

    // Idle board behind the home screen.
    buildBoard(3);

    // Opened from a Daily reminder? Preselect Daily and go straight in.
    const wantDaily =
      new URLSearchParams(location.search).get("daily") === "1";

    // First run: walk the player through a guided round.
    let seen = false;
    try {
      seen = !!localStorage.getItem(TUT_KEY);
    } catch {
      seen = true;
    }
    if (seen) {
      if (wantDaily) {
        prefs.mode = "daily";
        savePrefs();
        syncSegmented("mode-seg", "daily");
        syncHomeHints();
        history.replaceState(null, "", location.pathname); // clear the param
        enterModes();
      } else {
        showScreen("home");
        maybePromptA2HS();
      }
    } else {
      Object.values(screens).forEach((s) => (s.hidden = true));
      $("tutorial-screen").hidden = false;
      startTutorial();
    }
  }

  /* ============================================================
     Quote interstitial — a little inspiration on memory & the mind.
     One quote shows briefly after Play, then the mode bar fades in.
     They advance each time, so consecutive runs never repeat.
     ============================================================ */
  const QUOTES = [
    { t: "Memory is the treasury and guardian of all things.", by: "Cicero" },
    { t: "The true art of memory is the art of attention.", by: "Samuel Johnson" },
    { t: "We are our memory, we are that chimerical museum of shifting shapes.", by: "Jorge Luis Borges" },
    { t: "Memory is the diary we all carry about with us.", by: "Oscar Wilde" },
    { t: "A mind that is stretched by a new experience can never go back to its old dimensions.", by: "Oliver Wendell Holmes" },
    { t: "What we learn with pleasure we never forget.", by: "Alfred Mercier" },
    { t: "Practice does not make perfect. Perfect practice makes perfect.", by: "Vince Lombardi" },
    { t: "The things we remember best are the things best forgotten.", by: "Baltasar Gracián" },
    { t: "Attention is the rarest and purest form of generosity.", by: "Simone Weil" },
    { t: "Nothing fixes a thing so intensely in the memory as the wish to forget it.", by: "Montaigne" },
  ];
  let quoteIdx = Math.floor(Math.random() * QUOTES.length);
  let quoteTimer = null;

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function paintQuote() {
    const q = QUOTES[quoteIdx % QUOTES.length];
    $("solo-quote-text").textContent = "“" + q.t + "”";
    $("solo-quote-by").textContent = q.by;
  }

  // Park the quote just beneath the (still-hidden but laid-out) mode nav, so it
  // comes to rest right below Stats / Settings / How to play.
  function restQuoteBelowNav(quote) {
    const nav = screens.modes.querySelector(".home-nav");
    if (!nav) return;
    const r = nav.getBoundingClientRect();
    quote.style.bottom = "auto";
    quote.style.top = Math.round(r.bottom + 24) + "px";
  }

  // Lift the quote from its resting place up to the vertical centre of the
  // viewport, and remember how far it travelled.
  function centerQuote(quote) {
    quote.style.transform = "translateY(0) scale(1)";
    const r = quote.getBoundingClientRect();
    const delta = window.innerHeight / 2 - (r.top + r.height / 2);
    quote.dataset.delta = String(delta);
    quote.style.transform = `translateY(${delta}px) scale(1.04)`;
  }

  // Play on the landing screen → cross-fade to a single centred quote, hold it
  // briefly, then let it float down. The mode bar only appears once the float
  // has fully completed.
  function enterModes() {
    if (state.playing) return;
    const screen = screens.modes;
    const quote = $("modes-quote");
    paintQuote();
    quoteIdx++; // next run gets the next quote

    // Reveal the mode screen in its quote-only phase, with the quote centred
    // and ready to fade in.
    screen.classList.add("quoting");
    quote.style.transition = "none";
    quote.style.opacity = "0";
    screen.hidden = false;
    closeScreen(screens.home); // landing cross-fades away beneath it

    requestAnimationFrame(() => {
      restQuoteBelowNav(quote);
      centerQuote(quote);
      requestAnimationFrame(() => {
        quote.style.transition = ""; // restore the CSS opacity transition
        quote.style.opacity = "1"; // fade the quote in
      });
    });

    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => floatDown(quote), 1100);
  }

  function floatDown(quote) {
    const delta = parseFloat(quote.dataset.delta || "0");

    // The mode bar, brand and copyright stay hidden until the quote has fully
    // settled — they fade in only once the float completes.
    const reveal = () => {
      screens.modes.classList.remove("quoting");
      syncHomeHints();
    };

    // Float the quote down to its resting place — slow, even, weightless, with
    // a soft landing. A gentle ease-in-out (no fast initial drop) keeps it
    // classy rather than abrupt.
    quote.style.transform = "translateY(0) scale(1)";
    if (prefersReducedMotion()) {
      reveal();
      return;
    }
    const anim = quote.animate(
      [
        { transform: `translateY(${delta}px) scale(1.04)` },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 2050, easing: "cubic-bezier(0.37, 0, 0.63, 1)" }
    );
    anim.onfinish = reveal;
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
