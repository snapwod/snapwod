/* SnapWOD web timer: one script for every page in /timer/ (pages are built by tools/build-timers.mjs).
 *
 * The engine (top half) is plain functions with no DOM, so the page generator and
 * tools/check-timers.mjs run the same code in Node to make the default "Open in SnapWOD" link.
 * The clock is always worked out from timestamps (Date.now()), never by counting timer ticks:
 * background tabs throttle timers, and the display must still be right when the tab comes back.
 */
(function (root) {
  "use strict";

  // ---------- engine ----------
  // Field limits keep every plan inside the app's link limits (src/lib/share.ts parseInlinePlan:
  // at most 500 blocks and 24 h in total).
  var MODES = {
    emom: {
      name: "EMOM", plan: "EMOM",
      fields: [
        { key: "minutes", label: "Total minutes", min: 1, max: 120, def: 10 },
        { key: "every", label: "Every", def: 60, options: [30, 45, 60, 90, 120, 150, 180, 240, 300] }
      ]
    },
    tabata: {
      name: "Tabata", plan: "TABATA",
      fields: [
        { key: "rounds", label: "Rounds", min: 1, max: 50, def: 8 },
        { key: "work", label: "Work (sec)", min: 5, max: 900, def: 20 },
        { key: "rest", label: "Rest (sec)", min: 0, max: 600, def: 10 }
      ]
    },
    amrap: {
      name: "AMRAP", plan: "AMRAP",
      fields: [{ key: "minutes", label: "Minutes", min: 1, max: 180, def: 20 }]
    },
    fortime: {
      name: "For Time", plan: "FOR_TIME",
      fields: [{ key: "cap", label: "Time cap (min)", min: 1, max: 180, def: 20 }]
    },
    interval: {
      name: "Intervals", plan: "INTERVAL",
      fields: [
        { key: "work", label: "Work (sec)", min: 5, max: 900, def: 40 },
        { key: "rest", label: "Rest (sec)", min: 0, max: 600, def: 20 },
        { key: "rounds", label: "Rounds", min: 1, max: 50, def: 10 }
      ]
    }
  };
  var ORDER = ["emom", "tabata", "amrap", "fortime", "interval"];
  var READY = { key: "ready", label: "Get ready (sec)", min: 0, max: 60, def: 10 };

  /** m:ss (or h:mm:ss) for whole seconds. */
  function clock(sec) {
    var s = Math.max(0, Math.round(sec));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var ss = (r < 10 ? "0" : "") + r;
    return h > 0 ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }
  // Counting down shows the second we're in (0.4 s left reads 0:01); counting up shows whole seconds done.
  function clockDown(sec) { return clock(Math.ceil(Math.max(0, sec) - 1e-6)); }
  function clockUp(sec) { return clock(Math.floor(Math.max(0, sec) + 1e-6)); }

  function clampField(f, v) {
    var n = Math.round(Number(v));
    if (f.options) return f.options.indexOf(n) >= 0 ? n : f.def;
    if (!isFinite(n)) return f.def;
    return Math.min(f.max, Math.max(f.min, n));
  }

  /** Settings for a mode with every field present and in range. */
  function normalize(mode, s) {
    var out = {};
    MODES[mode].fields.forEach(function (f) {
      out[f.key] = clampField(f, s && s[f.key] != null && s[f.key] !== "" ? s[f.key] : f.def);
    });
    return out;
  }
  function defaults(mode) { return normalize(mode, {}); }

  function emomLabel(every) {
    if (every === 60) return "EMOM";
    if (every % 60 === 0) return "E" + every / 60 + "MOM";
    return "Every " + clock(every);
  }

  /**
   * The workout as blocks, in the shapes the app's own whiteboard parser makes (src/lib/parser.ts):
   * EMOM = one work block per interval ("EMOM", "E2MOM"), Tabata = "Tabata N Work"/"Tabata N Rest",
   * intervals = "Work"/"Rest", AMRAP = one amrap block, For Time = one cap block. Like the parser,
   * Tabata and intervals end with the last rest (8 x 20/10 = 4:00). A 0 s rest is left out.
   * Each block also carries round/rounds for the display (stripped from the app plan).
   */
  function buildBlocks(mode, raw) {
    var s = normalize(mode, raw), out = [], i;
    if (mode === "emom") {
      var n = Math.max(1, Math.floor((s.minutes * 60) / s.every));
      for (i = 1; i <= n; i++) out.push({ label: emomLabel(s.every), seconds: s.every, kind: "work", round: i, rounds: n });
    } else if (mode === "tabata" || mode === "interval") {
      for (i = 1; i <= s.rounds; i++) {
        var pre = mode === "tabata" ? "Tabata " + i + " " : "";
        out.push({ label: pre + "Work", seconds: s.work, kind: "work", round: i, rounds: s.rounds });
        if (s.rest > 0) out.push({ label: pre + "Rest", seconds: s.rest, kind: "rest", round: i, rounds: s.rounds });
      }
    } else if (mode === "amrap") {
      out.push({ label: "AMRAP", seconds: s.minutes * 60, kind: "amrap", round: 0, rounds: 0 });
    } else if (mode === "fortime") {
      out.push({ label: "For Time Cap", seconds: s.cap * 60, kind: "cap", round: 0, rounds: 0 });
    }
    return out;
  }

  function totalSeconds(blocks) {
    return blocks.reduce(function (t, b) { return t + b.seconds; }, 0);
  }

  function planName(mode, raw) {
    var s = normalize(mode, raw);
    switch (mode) {
      case "emom": {
        // Named from what actually runs: 10 min "every 1:30" is 6 rounds (9:00), not 10 min.
        var n = buildBlocks(mode, s).length, total = n * s.every;
        return s.every % 60 === 0 ? emomLabel(s.every) + " " + total / 60 + " min" : emomLabel(s.every) + " x " + n + " (" + clock(total) + ")";
      }
      case "tabata":
        return s.work === 20 && s.rest === 10 ? "Tabata, " + s.rounds + " rounds" : "Tabata, " + s.rounds + " x " + s.work + "s/" + s.rest + "s";
      case "amrap": return "AMRAP " + s.minutes + " min";
      case "fortime": return "For Time, " + s.cap + " min cap";
      default: return "Intervals, " + s.rounds + " x " + s.work + "s/" + s.rest + "s";
    }
  }

  /** The app plan for these settings (what goes in wodbrain://plan?d=...). */
  function toPlan(mode, raw) {
    var blocks = buildBlocks(mode, raw);
    var plan = {
      mode: MODES[mode].plan,
      name: planName(mode, raw),
      blocks: blocks.map(function (b) { return { label: b.label, seconds: b.seconds, kind: b.kind }; })
    };
    if (mode === "fortime") plan.capSeconds = blocks[0].seconds;
    return plan;
  }

  /** One line describing the settings. */
  function summary(mode, raw) {
    var s = normalize(mode, raw), blocks = buildBlocks(mode, s), total = clock(totalSeconds(blocks));
    switch (mode) {
      case "emom": return blocks.length + " rounds, a new one every " + clock(s.every) + " (" + total + " total)";
      case "tabata":
      case "interval":
        return s.rounds + " rounds of " + clock(s.work) + " work" + (s.rest ? " / " + clock(s.rest) + " rest" : "") + " (" + total + " total)";
      case "amrap": return "As many rounds as possible in " + total;
      default: return "Counts up to a " + total + " time cap";
    }
  }

  /** Blocks laid out in time (ms from Start), with the get-ready countdown in front. */
  function timeline(blocks, ready) {
    var segs = [], t = 0;
    if (ready > 0) { segs.push({ label: "Get ready", seconds: ready, kind: "ready", round: 0, rounds: 0, start: 0, end: ready * 1000 }); t = ready * 1000; }
    var workStart = t;
    blocks.forEach(function (b) {
      segs.push({ label: b.label, seconds: b.seconds, kind: b.kind, round: b.round, rounds: b.rounds, start: t, end: t + b.seconds * 1000 });
      t += b.seconds * 1000;
    });
    return { segs: segs, total: t, workStart: workStart };
  }

  /** Index of the block running at `ms` from Start, or -1 when it's over. */
  function locate(tl, ms) {
    for (var i = 0; i < tl.segs.length; i++) if (ms < tl.segs[i].end) return i;
    return -1;
  }

  /** Beeps: 3-2-1 short beeps before every block ends, a long one at each change and at the finish. */
  function soundEvents(tl) {
    var ev = [];
    tl.segs.forEach(function (s, i) {
      for (var k = 3; k >= 1; k--) {
        var t = s.end - k * 1000;
        if (t > s.start + 200) ev.push({ t: t, type: "tick" });
      }
      ev.push({ t: s.end, type: i === tl.segs.length - 1 ? "finish" : "change" });
    });
    return ev;
  }

  var engine = {
    MODES: MODES, ORDER: ORDER, READY: READY, clock: clock, clockDown: clockDown, clockUp: clockUp,
    clampField: clampField, normalize: normalize, defaults: defaults, buildBlocks: buildBlocks,
    totalSeconds: totalSeconds, toPlan: toPlan, planName: planName, summary: summary,
    timeline: timeline, locate: locate, soundEvents: soundEvents
  };
  root.SnapWODTimer = engine;

  if (typeof document === "undefined" || !document.getElementById("tmr")) return;

  // ---------- page ----------
  var $ = function (id) { return document.getElementById(id); };
  var config = {};
  try { config = JSON.parse($("timer-config").textContent); } catch (e) {}
  var STORE_KEY = "snapwod.timer.v1", MUTE_KEY = "snapwod.timer.muted";
  var PHASE_COLORS = { ready: "#ffd60a", work: "#30d158", amrap: "#30d158", cap: "#30d158", rest: "#ff453a", done: "#00e0ff", idle: "#a1a1aa", paused: "#a1a1aa" };

  function load(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { window.localStorage.setItem(key, v); } catch (e) {} }

  // Settings: page defaults for the page's own timer; for the other tabs, the visitor's last
  // settings (or the standard ones). The general page (config.restore) reopens on the last timer used.
  var saved = null;
  try { saved = JSON.parse(load(STORE_KEY) || "null"); } catch (e) {}
  if (!saved || typeof saved !== "object") saved = {};
  var savedValues = saved.values && typeof saved.values === "object" ? saved.values : {};
  var mode = ORDER.indexOf(config.mode) >= 0 ? config.mode : "amrap";
  if (config.restore && ORDER.indexOf(saved.mode) >= 0) mode = saved.mode;
  var values = {};
  ORDER.forEach(function (m) {
    var own = m === config.mode && !(config.restore && savedValues[m]);
    values[m] = normalize(m, own ? config.defaults : savedValues[m]);
  });
  var ready = clampField(READY, saved.ready != null ? saved.ready : config.ready != null ? config.ready : READY.def);
  var muted = load(MUTE_KEY) === "1";

  function persist() { save(STORE_KEY, JSON.stringify({ mode: mode, values: values, ready: ready })); }

  // Run state. elapsed = base + (now - runFrom) while running; everything else is derived from it.
  var status = "idle", base = 0, runFrom = 0, finalMs = null, capped = false;
  var tl = null, events = [], nextEv = 0, lastSeg = -2, lastElapsed = 0;

  function elapsed() {
    if (status !== "running") return base;
    var e = base + (Date.now() - runFrom);
    // The wall clock went backwards (clock change, NTP fix): carry on from where we were.
    if (e < lastElapsed) { runFrom = Date.now() - (lastElapsed - base); e = lastElapsed; }
    lastElapsed = e;
    return e;
  }

  // ---------- sound (Web Audio, created on the first tap: mobile Safari only allows it then) ----------
  var audio = null, pending = [];
  function ensureAudio() {
    try {
      if (!audio) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio = new AC();
        tone(440, 30, 0, 0.0002, true); // a silent blip inside the tap unlocks audio on iOS
      }
      resumeAudio();
    } catch (e) {}
  }
  function resumeAudio() {
    try {
      if (audio && audio.state !== "running") {
        var r = audio.resume();
        if (r && r.catch) r.catch(function () {});
      }
    } catch (e) {}
  }
  function tone(freq, ms, delayMs, vol, force) {
    if (!audio || (muted && !force)) return;
    try {
      var t0 = audio.currentTime + Math.max(0, delayMs) / 1000, len = ms / 1000;
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.6, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.connect(g); g.connect(audio.destination);
      o.start(t0); o.stop(t0 + len + 0.05);
      var p = { o: o, g: g };
      pending.push(p);
      o.onended = function () { var i = pending.indexOf(p); if (i >= 0) pending.splice(i, 1); };
    } catch (e) {}
  }
  function cancelTones() {
    pending.forEach(function (p) { try { p.g.disconnect(); p.o.stop(); } catch (e) {} });
    pending = [];
  }
  function playEvent(type, delayMs) {
    if (type === "tick") tone(880, 140, delayMs);
    else if (type === "change") tone(660, 600, delayMs);
    else tone(990, 1100, delayMs);
  }
  // Beeps are put on the audio clock ahead of time, so they land on the second even when the tab is in
  // the background and its timers only run once a second (or once a minute after a while in Chrome).
  function scheduleSound(ms) {
    // A suspended context (phone in the background, or not unlocked yet) would play queued beeps late,
    // all at once when it wakes: wait until it runs; stale events are skipped then.
    if (!muted && (!audio || audio.state !== "running")) return;
    var ahead = document.hidden ? 65000 : 1500;
    while (nextEv < events.length && events[nextEv].t <= ms + ahead) {
      var e = events[nextEv++];
      if (e.t < ms - 300) continue; // already past (e.g. after a resume): don't play it late
      if (!muted) playEvent(e.type, e.t - ms);
    }
  }
  function resyncSound(ms) {
    cancelTones();
    nextEv = 0;
    while (nextEv < events.length && events[nextEv].t < ms) nextEv++;
  }

  // ---------- keep the screen on while it runs ----------
  var wakeLock = null, wakePending = false;
  function keepAwake() {
    try {
      if ("wakeLock" in navigator && !wakeLock && !wakePending) {
        wakePending = true;
        navigator.wakeLock.request("screen").then(function (l) {
          wakePending = false;
          wakeLock = l;
          l.addEventListener("release", function () { if (wakeLock === l) wakeLock = null; });
          if (status !== "running") letSleep();
        }).catch(function () { wakePending = false; });
      }
    } catch (e) { wakePending = false; }
  }
  function letSleep() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
  document.addEventListener("visibilitychange", function () {
    if (status !== "running") return;
    if (!document.hidden) {
      keepAwake();
      // Beeps queued before the tab was hidden may have been held up by a suspended context: drop them
      // and queue again from now.
      cancelTones();
      resumeAudio();
      resyncSound(elapsed());
    }
    scheduleSound(elapsed());
  });

  // ---------- rendering ----------
  var card = $("tmr"), clockEl = $("t-clock"), baseTitle = document.title;
  var shown = {};
  function setText(id, text) { if (shown[id] !== text) { shown[id] = text; $(id).textContent = text; } }
  function setPhase(key, label) {
    if (shown.phaseKey !== key) { shown.phaseKey = key; card.style.setProperty("--phase", PHASE_COLORS[key] || PHASE_COLORS.idle); }
    setText("t-phase", label);
  }
  function setClock(text) {
    setText("t-clock", text);
    clockEl.classList.toggle("long", text.length > 5);
  }
  function setBar(frac) {
    var w = Math.round(Math.min(1, Math.max(0, frac)) * 1000) / 10 + "%";
    if (shown.bar !== w) { shown.bar = w; $("t-bar").style.width = w; }
  }
  function flash() {
    var f = $("t-flash");
    f.style.transition = "none"; f.style.opacity = "0.3";
    requestAnimationFrame(function () { requestAnimationFrame(function () { f.style.transition = "opacity 0.6s"; f.style.opacity = "0"; }); });
  }
  function phaseOf(seg) {
    if (seg.kind === "ready") return ["ready", "Get ready"];
    if (seg.kind === "rest") return ["rest", "Rest"];
    return [seg.kind, "Work"];
  }
  function nextText(i) {
    var seg = tl.segs[i], nx = tl.segs[i + 1];
    if (mode === "fortime") return seg.kind === "ready" ? "Next: clock counts up, cap " + clock(tl.segs[tl.segs.length - 1].seconds) : "Cap " + clock(seg.seconds);
    if (!nx) return "Next: finish";
    var what = nx.kind === "rest" ? "rest " : nx.kind === "amrap" ? "AMRAP " : "work ";
    return "Next: " + (nx.rounds && nx.round !== seg.round ? "round " + nx.round + ", " : "") + what + clock(nx.seconds);
  }
  function roundText(seg) { return seg && seg.rounds ? "Round " + seg.round + " / " + seg.rounds : ""; }

  function render() {
    if (!tl) tl = timeline(buildBlocks(mode, values[mode]), ready);
    var ms = elapsed();
    if (status === "running" && ms >= tl.total) { finish(true); ms = elapsed(); }
    var segs = tl.segs, work = segs.filter(function (s) { return s.kind !== "ready"; });
    var workTotal = tl.total - tl.workStart;
    var title = baseTitle;

    if (status === "idle") {
      var first = work[0];
      setPhase("idle", "Ready");
      setClock(mode === "fortime" ? "0:00" : clock(first.seconds));
      setText("t-round", roundText(first));
      setText("t-next", ready ? ready + " s get-ready countdown, then go" : "Starts as soon as you press Start");
      setText("t-elapsed", "0:00 / " + clock(workTotal / 1000));
      setBar(0);
      clockEl.classList.remove("dim");
    } else if (status === "done") {
      setPhase("done", mode === "fortime" ? (capped ? "Time cap" : "Done") : "Done");
      setClock(mode === "fortime" ? clockUp(finalMs / 1000) : "0:00");
      var last = work[work.length - 1];
      setText("t-round", last.rounds ? "Round " + last.rounds + " / " + last.rounds : "");
      setText("t-next", mode === "fortime" ? (capped ? "Time cap reached: note your reps" : "Your time: " + clockUp(finalMs / 1000)) : "Nice work.");
      setText("t-elapsed", clockUp(Math.min(finalMs, workTotal) / 1000) + " / " + clock(workTotal / 1000));
      setBar(1);
      clockEl.classList.remove("dim");
    } else {
      var i = locate(tl, ms);
      if (i < 0) i = segs.length - 1;
      var seg = segs[i];
      var ph = phaseOf(seg);
      if (status === "paused") setPhase("paused", "Paused");
      else setPhase(ph[0], ph[1]);
      var c = seg.kind === "cap" ? clockUp((ms - seg.start) / 1000) : clockDown((seg.end - ms) / 1000);
      setClock(c);
      clockEl.classList.toggle("dim", status === "paused");
      setText("t-round", roundText(seg.kind === "ready" ? work[0] : seg));
      setText("t-next", nextText(i));
      setText("t-elapsed", clockUp(Math.max(0, ms - tl.workStart) / 1000) + " / " + clock(workTotal / 1000));
      setBar((ms - seg.start) / Math.max(1, seg.end - seg.start));
      if (lastSeg !== -2 && i !== lastSeg && status === "running" && !document.hidden) flash();
      lastSeg = i;
      title = c + " " + (status === "paused" ? "Paused" : ph[1]) + " | " + (config.short || "SnapWOD timer");
      if (status === "running") scheduleSound(ms);
    }
    var showDone = mode === "fortime" && (status === "running" || status === "paused") && ms >= tl.workStart;
    if (doneBtn.hidden === showDone) doneBtn.hidden = !showDone;
    if (document.title !== title) document.title = title;
  }

  // ---------- controls ----------
  var goBtn = $("t-go"), resetBtn = $("t-reset"), doneBtn = $("t-done"), soundBtn = $("t-sound"), fsBtn = $("t-fs");
  var ticker = null;
  function startTicking() { if (!ticker) ticker = setInterval(render, 100); }
  function stopTicking() { clearInterval(ticker); ticker = null; }

  function syncControls() {
    var busy = status === "running" || status === "paused";
    goBtn.textContent = status === "running" ? "Pause" : status === "paused" ? "Resume" : status === "done" ? "Start again" : "Start";
    $("t-set").hidden = busy;
    Array.prototype.forEach.call(document.querySelectorAll(".tmr .mode"), function (b) { b.disabled = busy; });
    card.classList.toggle("is-running", status === "running");
  }

  function start() {
    cancelTones();
    ensureAudio();
    tl = timeline(buildBlocks(mode, values[mode]), ready);
    events = soundEvents(tl);
    nextEv = 0; lastSeg = -2; finalMs = null; capped = false;
    base = 0; lastElapsed = 0; runFrom = Date.now(); status = "running";
    keepAwake(); startTicking(); syncControls(); render();
  }
  function pause() {
    base = elapsed(); status = "paused";
    cancelTones(); letSleep(); stopTicking(); syncControls(); render();
  }
  function resume() {
    ensureAudio();
    runFrom = Date.now(); lastElapsed = base; status = "running";
    resyncSound(base);
    keepAwake(); startTicking(); syncControls(); render();
  }
  function reset() {
    status = "idle"; base = 0; finalMs = null; lastSeg = -2;
    tl = null;
    cancelTones(); letSleep(); stopTicking(); syncControls(); render();
  }
  /** natural: the clock ran out. Otherwise the athlete tapped Done (For Time). */
  function finish(natural) {
    var ms = Math.min(elapsed(), tl.total);
    base = ms; status = "done";
    finalMs = Math.max(0, ms - tl.workStart);
    capped = natural;
    if (!natural) { cancelTones(); playEvent("finish", 0); }
    letSleep(); stopTicking(); syncControls();
  }

  goBtn.addEventListener("click", function () {
    if (status === "running") pause();
    else if (status === "paused") resume();
    else start();
  });
  resetBtn.addEventListener("click", reset);
  doneBtn.addEventListener("click", function () {
    if (status === "idle" || status === "done") return;
    if (elapsed() < tl.workStart) return; // still in the get-ready countdown
    finish(false); render();
  });

  function syncSoundBtn() {
    soundBtn.textContent = muted ? "Sound off" : "Sound on";
    soundBtn.classList.toggle("off", muted);
  }
  soundBtn.addEventListener("click", function () {
    muted = !muted;
    save(MUTE_KEY, muted ? "1" : "0");
    syncSoundBtn();
    ensureAudio();
    if (muted) cancelTones();
    else {
      if (status === "running") { var ms = elapsed(); resyncSound(ms); scheduleSound(ms); }
      tone(880, 120, 0);
    }
  });

  // Full screen: the real thing where the browser allows it on an element (not iPhone Safari),
  // otherwise the timer card is pinned over the page.
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function setPseudoFs(on) {
    card.classList.toggle("pseudo-fs", on);
    document.documentElement.classList.toggle("tmr-lock", on);
    syncFs();
  }
  function syncFs() {
    var on = !!fsElement() || card.classList.contains("pseudo-fs");
    card.classList.toggle("fs", on);
    fsBtn.textContent = on ? "Exit full screen" : "Full screen";
  }
  function toggleFs() {
    if (fsElement()) { var exit = document.exitFullscreen || document.webkitExitFullscreen; if (exit) exit.call(document); return; }
    if (card.classList.contains("pseudo-fs")) { setPseudoFs(false); return; }
    var req = card.requestFullscreen || card.webkitRequestFullscreen;
    if (!req) { setPseudoFs(true); return; }
    try {
      var p = req.call(card);
      if (p && p.catch) p.catch(function () { setPseudoFs(true); });
    } catch (e) { setPseudoFs(true); }
  }
  fsBtn.addEventListener("click", toggleFs);
  document.addEventListener("fullscreenchange", syncFs);
  document.addEventListener("webkitfullscreenchange", syncFs);

  // Keyboard: Space = start/pause, R = reset, F = full screen. Form fields and buttons keep their own keys.
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var tag = (e.target && e.target.tagName) || "";
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if ((e.key === " " || e.code === "Space") && tag !== "BUTTON" && tag !== "A") { e.preventDefault(); goBtn.click(); }
    else if (e.key === "r" || e.key === "R") reset();
    else if (e.key === "f" || e.key === "F") toggleFs();
    else if (e.key === "Escape" && card.classList.contains("pseudo-fs")) setPseudoFs(false);
  });

  // ---------- settings ----------
  function showMode() {
    Array.prototype.forEach.call(document.querySelectorAll(".tmr .mode"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === mode));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tmr .fields"), function (g) {
      var m = g.getAttribute("data-mode");
      if (m) g.hidden = m !== mode; // the get-ready group has no data-mode and always shows
    });
    $("t-name").textContent = MODES[mode].name;
  }
  function fillInputs() {
    Array.prototype.forEach.call(document.querySelectorAll(".tmr [data-key]"), function (el) {
      var m = el.getAttribute("data-mode"), k = el.getAttribute("data-key");
      el.value = String(m ? values[m][k] : ready);
    });
  }
  function settingsChanged(byUser) {
    tl = null;
    $("t-sum").textContent = summary(mode, values[mode]);
    updateOpen();
    if (byUser) persist();
    render();
  }
  function onField(el, commit) {
    var m = el.getAttribute("data-mode"), k = el.getAttribute("data-key");
    var f = m ? MODES[m].fields.filter(function (x) { return x.key === k; })[0] : READY;
    var raw = el.value.trim(), n = Number(raw);
    var ok = raw !== "" && isFinite(n) && (f.options ? f.options.indexOf(n) >= 0 : n >= f.min && n <= f.max && Math.round(n) === n);
    el.setAttribute("aria-invalid", String(!ok && !commit));
    if (!ok && !commit) return; // let them finish typing; it's fixed up on change/blur
    var v = clampField(f, raw === "" ? f.def : n);
    if (commit) { el.value = String(v); el.removeAttribute("aria-invalid"); }
    if (m) values[m][k] = v; else ready = v;
    if (status === "done") { status = "idle"; syncControls(); }
    settingsChanged(true);
  }
  Array.prototype.forEach.call(document.querySelectorAll(".tmr [data-key]"), function (el) {
    el.addEventListener("input", function () { onField(el, false); });
    el.addEventListener("change", function () { onField(el, true); });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".tmr .mode"), function (b) {
    b.addEventListener("click", function () {
      if (status === "running" || status === "paused") return;
      mode = b.getAttribute("data-mode");
      status = "idle";
      showMode(); syncControls(); settingsChanged(true);
    });
  });

  // ---------- Open in SnapWOD (same links as the workout pages, rebuilt when the settings change) ----------
  var ua = navigator.userAgent || "";
  // iPadOS reports itself as a Mac: treat a touch "Mac" as iOS.
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  var isAndroid = /Android/i.test(ua);
  var inApp = /Instagram|FBAN|FBAV|FB_IAB|FB4A|FBiOS/i.test(ua);
  var openBtn = $("open-btn"), openStatus = $("status");

  function updateOpen() {
    var d = encodeURIComponent(JSON.stringify(toPlan(mode, values[mode])));
    if (isAndroid) {
      // Intent URL: opens the app if installed, otherwise Chrome goes to the Play Store.
      openBtn.href = "intent://plan?d=" + d + "#Intent;scheme=wodbrain;package=" + config.androidPackage +
        ";S.browser_fallback_url=" + encodeURIComponent(config.androidStore) + ";end";
    } else {
      openBtn.href = "wodbrain://plan?d=" + d;
    }
    $("open-runs").textContent = "Loads this timer in the app: " + summary(mode, values[mode]) + ".";
  }
  if (isAndroid) $("ios-store").style.display = "none";
  else if (isIOS) $("android-store").style.display = "none";
  else document.documentElement.classList.add("desktop");
  if ((isIOS || isAndroid) && inApp) $("hint").textContent = "Nothing happens? Open this page in your browser (⋯ menu → Open in browser).";

  openBtn.addEventListener("click", function () {
    if (!isIOS && !isAndroid) return;
    openStatus.textContent = "Opening SnapWOD…";
    var t = setTimeout(function () {
      openStatus.textContent = "Don't have SnapWOD yet? It's free: get it below, then tap the button again.";
    }, 1800);
    var cancel = function () { clearTimeout(t); openStatus.textContent = ""; };
    window.addEventListener("pagehide", cancel, { once: true });
    document.addEventListener("visibilitychange", function () { if (document.hidden) cancel(); }, { once: true });
  });

  // ---------- go ----------
  fillInputs();
  showMode();
  syncSoundBtn();
  syncControls();
  syncFs();
  settingsChanged();
})(typeof window !== "undefined" ? window : globalThis);
