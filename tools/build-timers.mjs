// Builds the browser workout timer pages from tools/timers.json:
//   docs/timer/index.html       the general timer (mode picker)
//   docs/timer/<slug>.html      one page per format / preset (EMOM, Tabata, 20 minute AMRAP, ...)
//   docs/sitemap.xml            timer URLs added (other entries kept as they are)
// Every page runs the same hand-written script, docs/timer/timer.js. This generator runs that
// script's engine in Node too, so the settings form, the first clock face and the default
// "Open in SnapWOD" link all come from the code the browser runs.
// Plain Node 18+, no dependencies:  node tools/build-timers.mjs
// Check the result with:            node tools/check-timers.mjs

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, OG_IMAGE, IOS_STORE_URL, ANDROID_STORE_URL, ANDROID_PACKAGE, esc, jsonLd, FONTS, BASE_CSS, header, footer } from "./site.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, "..", "docs");
const OUT = path.join(DOCS, "timer");
const DATA = path.join(here, "timers.json");
const SCRIPT = path.join(OUT, "timer.js");
const WORKOUTS = path.join(here, "workouts.json");

const BASE = SITE + "timer/";
const LIB = SITE + "workouts/";

/** The engine from docs/timer/timer.js (it skips the page code when there is no document). */
export function loadEngine(file = SCRIPT) {
  const ctx = {};
  vm.runInNewContext(readFileSync(file, "utf8"), ctx, { filename: file });
  if (!ctx.SnapWODTimer) throw new Error("timer.js did not define SnapWODTimer");
  return ctx.SnapWODTimer;
}

const pageUrl = (p) => (p.slug === "index" ? BASE : BASE + p.slug);
const pageHref = (p) => (p.slug === "index" ? "./" : p.slug);

/** Text in timers.json: escaped, then **bold** and [text](href) (relative links only). */
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([a-z0-9./#-]+)\)/g, '<a href="$2">$1</a>');
}

// ---------- page CSS ----------
const TIMER_CSS = `
    main { padding-bottom: 8px; }
    .hero-block { padding: 20px 0 4px; }
    h1.display { font-size: clamp(40px, 11vw, 68px); overflow-wrap: anywhere; }
    .headline { font-size: 18px; color: var(--muted); margin: 10px 0 0; }
    .tmr {
      --phase: #a1a1aa; position: relative; overflow: hidden; margin-top: 18px; padding: 14px 14px 16px;
      background: var(--surface); border: 1px solid var(--line); border-radius: 22px; box-shadow: 0 0 60px rgba(0, 224, 255, 0.07);
    }
    .tmr [hidden] { display: none !important; }
    .tmr button { font: inherit; cursor: pointer; }
    .tmr button:focus-visible, .tmr input:focus-visible, .tmr select:focus-visible, .app a:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
    /* Five tabs: 3 + 2 on phones (fits 320 px), one row from 560 px. */
    .modes { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
    .tmr .mode { grid-column: span 2; min-width: 0; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--muted); background: var(--surface-2);
      border: 1px solid var(--line); border-radius: 999px; padding: 8px 4px; }
    .tmr .mode:nth-child(n+4) { grid-column: span 3; }
    .tmr .mode[aria-pressed="true"] { color: #001014; background: var(--cyan); border-color: var(--cyan); }
    .tmr .mode:disabled { cursor: default; opacity: 0.55; }
    .tmr .mode[aria-pressed="true"]:disabled { opacity: 1; }
    .face { text-align: center; padding: 16px 0 4px; }
    .phase { display: inline-flex; align-items: center; gap: 10px; color: var(--phase); font-size: clamp(28px, 8vw, 42px); letter-spacing: 0.08em; }
    .phase::before { content: ""; width: 0.42em; height: 0.42em; border-radius: 50%; background: var(--phase); }
    .clock { font-family: Rajdhani, Inter, sans-serif; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 0.95;
      font-size: clamp(92px, 30vw, 210px); letter-spacing: -0.01em; margin: 4px 0 6px; }
    .clock.long { font-size: clamp(66px, 20vw, 150px); }
    .clock.dim { opacity: 0.45; }
    .bar { height: 8px; max-width: 560px; margin: 0 auto; border-radius: 99px; background: #1e1e26; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: var(--phase); border-radius: 99px; }
    .meta { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 22px; margin-top: 12px; color: var(--muted); font-size: 15px; font-weight: 600; }
    .meta b { color: var(--text); font-variant-numeric: tabular-nums; }
    .round { color: var(--text); font-family: Rajdhani, Inter, sans-serif; font-size: 22px; line-height: 1.1; }
    .round:empty { display: none; }
    .next { margin: 8px 0 0; color: #d4d4d8; font-size: 15px; min-height: 1.5em; }
    .ctrls { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .ctrls button { flex: 1 1 auto; white-space: nowrap; padding: 12px 12px; border-radius: 999px; font-weight: 600; font-size: 15px;
      color: var(--text); background: var(--surface-2); border: 1px solid var(--line); }
    .ctrls button.off { color: var(--muted); }
    .ctrls .go { flex: 1 1 100%; padding: 15px 20px; border: 0; background: var(--cyan); color: #001014;
      font-family: Rajdhani, Inter, sans-serif; font-weight: 700; font-size: 22px; letter-spacing: 0.1em; text-transform: uppercase; }
    .is-running .go { background: var(--surface-2); color: var(--text); border: 1px solid var(--line); }
    .ctrls .done { background: var(--green); color: #00150a; border: 0; }
    .set { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
    .set-h { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
    .set-h b { color: var(--text); }
    .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
    .fields + .fields { margin-top: 12px; }
    .fields label { display: block; font-size: 13px; color: var(--muted); font-weight: 600; margin-bottom: 5px; }
    .fields input, .fields select { width: 100%; font: inherit; font-size: 20px; font-weight: 600; color: var(--text); background: var(--bg);
      border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; }
    .fields input[aria-invalid="true"] { border-color: #ff453a; }
    .sum { margin: 12px 0 0; color: #d4d4d8; font-size: 15px; }
    .keys { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
    .t-flash { position: absolute; inset: 0; background: var(--phase); opacity: 0; pointer-events: none; }
    .nojs { margin: 0; color: #d4d4d8; }
    /* Full screen (real, or the card pinned over the page where the browser can't). */
    .tmr.fs { position: fixed; inset: 0; z-index: 100; margin: 0; border: 0; border-radius: 0; background: var(--bg);
      display: flex; flex-direction: column; padding: max(14px, env(safe-area-inset-top)) 16px max(14px, env(safe-area-inset-bottom)); overflow: auto; }
    .tmr.fs .modes, .tmr.fs .set { display: none !important; }
    .tmr.fs .live { flex: 1; display: flex; flex-direction: column; }
    .tmr.fs .face { flex: 1; display: flex; flex-direction: column; justify-content: center; }
    .tmr.fs .phase { font-size: min(9vw, 8vh); align-self: center; }
    .tmr.fs .clock { font-size: min(30vw, 48vh); }
    .tmr.fs .clock.long { font-size: min(20vw, 44vh); }
    .tmr.fs .bar { max-width: 80vw; width: 100%; height: 1.2vh; min-height: 8px; }
    .tmr.fs .meta, .tmr.fs .next { font-size: clamp(15px, 2.6vh, 30px); }
    .tmr.fs .round { font-size: clamp(22px, 4.4vh, 52px); }
    .tmr.fs .ctrls { width: 100%; max-width: 760px; margin: 12px auto 0; }
    .tmr.fs .ctrls .go { flex: 2 1 0; }
    html.tmr-lock, html.tmr-lock body { overflow: hidden; }
    .app { margin-top: 20px; padding: 20px 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px 20px; border: 0; border-radius: 999px;
      background: var(--cyan); color: #001014; font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 20px; letter-spacing: 0.1em; text-transform: uppercase; }
    .btn:hover { filter: brightness(1.08); }
    .open-row { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .runs, .status, .note, .desk { margin: 0; color: var(--muted); font-size: 14px; }
    .status:empty, .note:empty { display: none; }
    .desk { display: none; color: #d4d4d8; font-size: 15px; }
    .desktop .desk { display: block; }
    .desktop #open-btn, .desktop #open-runs, .desktop #status { display: none; }
    .app h2 { font-size: 26px; margin: 22px 0 12px; }
    .ticks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .ticks li { display: flex; gap: 12px; align-items: flex-start; color: #d4d4d8; font-size: 16px; }
    .ticks li::before {
      content: ""; flex: none; width: 20px; height: 20px; margin-top: 3px; border-radius: 50%;
      background: var(--cyan) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5 10.5l3.2 3L15 7' fill='none' stroke='%23001014' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;
    }
    .ticks b { color: var(--text); }
    section.block { margin-top: 34px; }
    section.block h2 { font-size: 30px; margin: 0 0 12px; }
    section.block p { color: #d4d4d8; margin: 0 0 12px; }
    section.block ul { color: #d4d4d8; margin: 0 0 12px; padding-left: 22px; }
    section.block li { margin: 0 0 6px; }
    section.block a, .app a.cyan { color: var(--cyan); }
    .rel { display: grid; gap: 10px; }
    .rel > * { display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
    .rel a:hover { border-color: color-mix(in srgb, var(--cyan) 55%, transparent); }
    .rel b { font-family: Rajdhani, sans-serif; font-size: 22px; text-transform: uppercase; display: block; line-height: 1.1; color: var(--text); }
    .rel .t { font-size: 13px; font-weight: 600; color: var(--cyan); }
    .rel p { margin: 4px 0 0; font-size: 15px; color: #d4d4d8; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    section.block .chips a { color: var(--text); font-size: 14px; font-weight: 600; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; }
    section.block .chips a:hover { border-color: var(--cyan); }
    .get { margin-top: 40px; text-align: center; padding: 26px 18px; border-radius: 20px; border: 1px solid var(--line);
      background: radial-gradient(60% 90% at 25% 100%, rgba(0, 224, 255, 0.16), transparent 70%), radial-gradient(50% 80% at 85% 0%, rgba(48, 209, 88, 0.12), transparent 70%), var(--surface); }
    .get h2 { font-size: 32px; margin: 0 0 10px; }
    .get p { color: var(--muted); margin: 0 auto 18px; max-width: 460px; font-size: 16px; }
    @media (min-width: 560px) {
      .modes { grid-template-columns: repeat(5, minmax(0, 1fr)); }
      .tmr .mode, .tmr .mode:nth-child(n+4) { grid-column: auto; }
    }
    @media (min-width: 700px) {
      .tmr { padding: 18px 26px 20px; }
      .ctrls .go { flex: 2 1 0; }
      .app { padding: 24px 30px; }
      .rel { grid-template-columns: 1fr 1fr; }
      .why { grid-template-columns: 1fr 1fr; }
    }`;

// ---------- page parts ----------
function fieldHtml(engine, mode, f, value) {
  const id = mode ? `f-${mode}-${f.key}` : `f-${f.key}`;
  const data = `${mode ? ` data-mode="${mode}"` : ""} data-key="${f.key}"`;
  if (f.options) {
    const opts = f.options
      .map((o) => {
        const lab = engine.clock(o) + (o === 60 ? " (EMOM)" : o % 60 === 0 ? ` (E${o / 60}MOM)` : "");
        return `<option value="${o}"${o === value ? " selected" : ""}>${lab}</option>`;
      })
      .join("");
    return `<div><label for="${id}">${esc(f.label)}</label><select id="${id}"${data}>${opts}</select></div>`;
  }
  return `<div><label for="${id}">${esc(f.label)}</label><input id="${id}" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" step="1" value="${value}"${data} /></div>`;
}

function timerCard(engine, p) {
  const mode = p.mode;
  const vals = engine.normalize(mode, p.defaults);
  const blocks = engine.buildBlocks(mode, vals);
  const first = blocks[0];
  const total = engine.totalSeconds(blocks);
  const tabs = engine.ORDER.map(
    (m) => `<button type="button" class="mode" data-mode="${m}" aria-pressed="${m === mode}">${esc(engine.MODES[m].name)}</button>`,
  ).join("\n          ");
  const groups = engine.ORDER.map((m) => {
    const v = m === mode ? vals : engine.defaults(m);
    const fields = engine.MODES[m].fields.map((f) => fieldHtml(engine, m, f, v[f.key])).join("\n            ");
    return `<div class="fields" data-mode="${m}"${m === mode ? "" : " hidden"}>
            ${fields}
          </div>`;
  }).join("\n          ");
  return `<section class="tmr" id="tmr" aria-label="Workout timer">
      <noscript><p class="nojs">The timer needs JavaScript. Everything else on this page works without it, and the SnapWOD app runs the same timer on your phone.</p></noscript>
      <div class="live">
        <div class="modes" role="group" aria-label="Timer type">
          ${tabs}
        </div>
        <div class="face">
          <div class="phase display" id="t-phase" aria-live="polite" aria-atomic="true">Ready</div>
          <div class="clock" id="t-clock" role="timer">${mode === "fortime" ? "0:00" : engine.clock(first.seconds)}</div>
          <div class="bar"><i id="t-bar"></i></div>
          <div class="meta"><span class="round" id="t-round">${first.rounds ? `Round 1 / ${first.rounds}` : ""}</span><span>Elapsed <b id="t-elapsed">0:00 / ${engine.clock(total)}</b></span></div>
          <p class="next" id="t-next">10 s get-ready countdown, then go</p>
        </div>
        <div class="ctrls">
          <button type="button" class="go" id="t-go">Start</button>
          <button type="button" class="done" id="t-done" hidden>Done</button>
          <button type="button" id="t-reset">Reset</button>
          <button type="button" id="t-sound">Sound on</button>
          <button type="button" id="t-fs">Full screen</button>
        </div>
        <div class="set" id="t-set">
          <p class="set-h"><b id="t-name">${esc(engine.MODES[mode].name)}</b> settings</p>
          ${groups}
          <div class="fields">
            ${fieldHtml(engine, null, engine.READY, 10)}
          </div>
          <p class="sum" id="t-sum">${esc(engine.summary(mode, vals))}</p>
          <p class="keys">Keyboard: Space start/pause, R reset, F full screen.</p>
        </div>
      </div>
      <div class="t-flash" id="t-flash"></div>
    </section>`;
}

const WHY = [
  ["Lock-screen timer and notifications", "the clock keeps running with your phone locked or in your pocket."],
  ["Scan the whiteboard", "snap the gym board and SnapWOD builds the timer, multi-part workouts included."],
  ["Gym TV mode", "put the running clock on the big screen with a code."],
];

function appBox(engine, p) {
  const plan = engine.toPlan(p.mode, p.defaults);
  const d = encodeURIComponent(JSON.stringify(plan));
  return `<section class="app" aria-labelledby="app-h">
      <div class="open-row">
        <a class="btn" id="open-btn" href="wodbrain://plan?d=${d}">▶ Open in SnapWOD</a>
        <p class="runs" id="open-runs">Loads this timer in the app: ${esc(engine.summary(p.mode, p.defaults))}.</p>
        <p class="status" id="status" aria-live="polite"></p>
        <p class="note" id="hint"></p>
        <p class="desk">On a computer? Get SnapWOD on your phone and open this page there to load the timer in the app.</p>
        <div class="badges">
          <a id="ios-store" href="${IOS_STORE_URL}" rel="noopener"><img src="../app-store-badge.svg" alt="Download on the App Store" width="138" height="46" /></a>
          <a id="android-store" href="${ANDROID_STORE_URL}" rel="noopener"><img src="../google-play-badge.svg" alt="Get it on Google Play" width="155" height="46" /></a>
        </div>
      </div>
      <h2 class="display" id="app-h">More in the free app</h2>
      <ul class="ticks why">
        ${WHY.map(([b, t]) => `<li><span><b>${esc(b)}</b>: ${esc(t)}</span></li>`).join("\n        ")}
      </ul>
    </section>`;
}

function textSections(p) {
  return p.sections
    .map((s, i) => {
      const id = `s${i + 1}-h`;
      const paras = (s.p || []).map((t) => `<p>${inline(t)}</p>`).join("\n      ");
      const list = s.ul ? `<ul>\n        ${s.ul.map((t) => `<li>${inline(t)}</li>`).join("\n        ")}\n      </ul>` : "";
      return `<section class="block" aria-labelledby="${id}">
      <h2 class="display" id="${id}">${esc(s.h)}</h2>
      ${[paras, list].filter(Boolean).join("\n      ")}
    </section>`;
    })
    .join("\n\n    ");
}

function timeChip(w) {
  const m = w.capMinutes ?? w.durationMinutes;
  if (w.type === "For Time") return `For time · ${m} min cap`;
  return `${m} min ${w.type === "Intervals" ? "intervals" : w.type}`;
}

function examples(p, workoutsBySlug) {
  if (!p.examples?.length) return "";
  const cards = p.examples.map((e) => {
    const w = workoutsBySlug.get(e.slug);
    if (!w) throw new Error(`${p.slug}: example workout ${e.slug} is not in workouts.json`);
    return `<a href="../workouts/${w.slug}"><b>${esc(w.name)}</b><span class="t">${esc(timeChip(w))}</span><p>${esc(e.note)}</p></a>`;
  });
  return `<section class="block" aria-labelledby="ex-h">
      <h2 class="display" id="ex-h">Workouts to try</h2>
      <div class="rel">
        ${cards.join("\n        ")}
      </div>
      <p style="margin-top:12px"><a href="../workouts/">Browse the workout library →</a></p>
    </section>`;
}

function moreTimers(p, pages) {
  const links = pages.filter((o) => o.slug !== p.slug).map((o) => `<a href="${o.slug === "index" ? "./" : o.slug}">${esc(o.nav)}</a>`);
  return `<section class="block" aria-labelledby="more-h">
      <h2 class="display" id="more-h">More timers</h2>
      <nav class="chips" aria-label="More timers">
        ${links.join("\n        ")}
      </nav>
    </section>`;
}

function page(engine, p, pages, workoutsBySlug, scriptVer) {
  const url = pageUrl(p);
  const name = `${p.h1[0]} ${p.h1[1]}`;
  const crumbs =
    p.slug === "index"
      ? `<a href="../">SnapWOD</a><span aria-hidden="true">›</span>Timer`
      : `<a href="../">SnapWOD</a><span aria-hidden="true">›</span><a href="./">Timer</a><span aria-hidden="true">›</span>${esc(p.nav)}`;
  const config = {
    mode: p.mode,
    defaults: engine.normalize(p.mode, p.defaults),
    ready: 10,
    restore: !!p.restore,
    short: p.short,
    androidPackage: ANDROID_PACKAGE,
    androidStore: ANDROID_STORE_URL,
  };
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "SnapWOD", item: SITE },
          { "@type": "ListItem", position: 2, name: "Workout timer", item: BASE },
          ...(p.slug === "index" ? [] : [{ "@type": "ListItem", position: 3, name, item: url }]),
        ],
      },
      {
        "@type": "WebApplication",
        "@id": url + "#timer",
        name: p.ogTitle,
        url,
        description: p.description,
        applicationCategory: "HealthApplication",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript",
        inLanguage: "en",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        image: OG_IMAGE,
        publisher: { "@type": "Organization", name: "SnapWOD", url: SITE },
        isPartOf: { "@type": "WebSite", name: "SnapWOD", url: SITE },
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(p.title)}</title>
  <meta name="description" content="${esc(p.description)}" />
  <meta name="robots" content="index,follow" />
  <meta name="theme-color" content="#040406" />
  <link rel="canonical" href="${url}" />
  <link rel="icon" href="../snapwod-logo.png" />
  <link rel="apple-touch-icon" href="../snapwod-logo.png" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="SnapWOD" />
  <meta property="og:title" content="${esc(p.ogTitle)}" />
  <meta property="og:description" content="${esc(p.description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(p.ogTitle)}" />
  <meta name="twitter:description" content="${esc(p.description)}" />
  <meta name="twitter:image" content="${OG_IMAGE}" />
  <script type="application/ld+json">
${jsonLd(ld)}
  </script>
  ${FONTS}
  <style>${BASE_CSS}${TIMER_CSS}
  </style>
  <noscript><style>.tmr .live, .tmr .t-flash { display: none; }</style></noscript>
</head>
<body>
  ${header("../")}
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>

    <div class="hero-block">
      <h1 class="display">${esc(p.h1[0])} <span class="cyan">${esc(p.h1[1])}</span></h1>
      <p class="headline">${esc(p.lead)}</p>
    </div>

    ${timerCard(engine, p)}

    ${appBox(engine, p)}

    ${textSections(p)}

    ${examples(p, workoutsBySlug)}

    ${moreTimers(p, pages)}

    <section class="get">
      <h2 class="display">Snap the board. <span class="cyan">Start the clock.</span></h2>
      <p>SnapWOD turns any workout on the whiteboard into a timer: EMOM, AMRAP, For Time, intervals and multi-part sessions. Free on iPhone and Android.</p>
      <div class="badges">
        <a href="${IOS_STORE_URL}" rel="noopener"><img src="../app-store-badge.svg" alt="Download on the App Store" width="138" height="46" loading="lazy" /></a>
        <a href="${ANDROID_STORE_URL}" rel="noopener"><img src="../google-play-badge.svg" alt="Get it on Google Play" width="155" height="46" loading="lazy" /></a>
      </div>
    </section>
  </main>
  ${footer("../")}
  <script type="application/json" id="timer-config">${JSON.stringify(config).replace(/</g, "\\u003c")}</script>
  <script src="timer.js?v=${scriptVer}"></script>
</body>
</html>
`;
}

// ---------- sitemap ----------
function updateSitemap(pages, lastmod) {
  const file = path.join(DOCS, "sitemap.xml");
  const xml = readFileSync(file, "utf8");
  const nl = xml.includes("\r\n") ? "\r\n" : "\n";
  const lines = xml.split(/\r?\n/);
  // Keep every entry that isn't ours; put the timer entries just before the workout library
  // (or at the end), so this and build-workouts.mjs can run in any order without reshuffling.
  const kept = lines.filter((l) => !l.includes(`<loc>${BASE}`));
  let at = kept.findIndex((l) => l.includes(`<loc>${LIB}`));
  if (at < 0) at = kept.findIndex((l) => l.trim() === "</urlset>");
  if (at < 0) throw new Error("sitemap.xml: no </urlset>");
  const ours = pages.map(
    (p) => `  <url><loc>${pageUrl(p)}</loc><lastmod>${lastmod}</lastmod><priority>${p.slug === "index" ? "0.8" : "0.7"}</priority></url>`,
  );
  writeFileSync(file, [...kept.slice(0, at), ...ours, ...kept.slice(at)].join(nl));
}

// ---------- build ----------
function build() {
  const engine = loadEngine();
  const pages = JSON.parse(readFileSync(DATA, "utf8"));
  const workoutsBySlug = new Map(JSON.parse(readFileSync(WORKOUTS, "utf8")).map((w) => [w.slug, w]));
  const scriptSrc = readFileSync(SCRIPT);
  const scriptVer = createHash("sha256").update(scriptSrc).digest("hex").slice(0, 10);
  // lastmod follows the data file and the script, so rebuilding without changes gives identical output.
  const lastmod = new Date(Math.max(statSync(DATA).mtimeMs, statSync(SCRIPT).mtimeMs)).toISOString().slice(0, 10);

  const seen = new Set();
  for (const p of pages) {
    for (const k of ["slug", "nav", "title", "description", "ogTitle", "h1", "short", "lead", "mode", "defaults", "sections", "expect"]) {
      if (p[k] == null) throw new Error(`${p.slug || "?"}: missing ${k}`);
    }
    if (!/^[a-z0-9-]+$/.test(p.slug)) throw new Error(`bad slug ${p.slug}`);
    if (seen.has(p.slug)) throw new Error(`duplicate slug ${p.slug}`);
    seen.add(p.slug);
    if (!engine.MODES[p.mode]) throw new Error(`${p.slug}: unknown mode ${p.mode}`);
    const norm = engine.normalize(p.mode, p.defaults);
    for (const [k, v] of Object.entries(p.defaults)) {
      if (norm[k] !== v) throw new Error(`${p.slug}: default ${k}=${v} is outside the timer's limits (would be ${norm[k]})`);
    }
    if (/crossfit/i.test(JSON.stringify(p))) throw new Error(`${p.slug}: don't use the CrossFit trademark`);
    if (p.title.length > 60) throw new Error(`${p.slug}: title is ${p.title.length} chars (max 60)`);
    if (p.description.length > 160) throw new Error(`${p.slug}: description is ${p.description.length} chars (max 160)`);
  }
  if (!pages.some((p) => p.slug === "index")) throw new Error("timers.json needs an index page");

  mkdirSync(OUT, { recursive: true });
  // Remove pages that were taken out of the data.
  for (const f of readdirSync(OUT)) {
    if (f.endsWith(".html") && !seen.has(f.slice(0, -5))) unlinkSync(path.join(OUT, f));
  }
  for (const p of pages) writeFileSync(path.join(OUT, `${p.slug}.html`), page(engine, p, pages, workoutsBySlug, scriptVer));
  updateSitemap(pages, lastmod);
  console.log(`Built ${pages.length} timer pages in docs/timer (timer.js v=${scriptVer}), sitemap updated (lastmod ${lastmod}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
