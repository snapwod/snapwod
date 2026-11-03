// Builds the public workout library from tools/workouts.json:
//   docs/workouts/index.html      the library (search + category filter)
//   docs/workouts/<slug>.html     one page per workout
//   docs/sitemap.xml              workout URLs added (other entries kept as they are)
// Plain Node 18+, no dependencies:  node tools/build-workouts.mjs
// Plans in workouts.json are made and checked by tools/check-plans.mjs.

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, OG_IMAGE, IOS_STORE_URL, ANDROID_STORE_URL, ANDROID_PACKAGE, esc, jsonLd, FONTS, BASE_CSS, header, footer } from "./site.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const DOCS = path.join(ROOT, "docs");
const OUT = path.join(DOCS, "workouts");
const DATA = path.join(here, "workouts.json");

const LIB = SITE + "workouts/";
// qrcodejs from cdnjs, pinned with SRI (same file docs/tv.html uses). Loaded on desktop only.
const QR_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
const QR_SRI = "sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSQX0FslNhTDadL4O5SAGapGt4FodqL8My0mA==";

const CATEGORIES = {
  girls: { label: "The Girls", long: "Classic benchmark" },
  hero: { label: "Hero", long: "Hero workout" },
  classic: { label: "Classic", long: "Classic benchmark" },
};

const workouts = JSON.parse(readFileSync(DATA, "utf8"));
const bySlug = new Map(workouts.map((w) => [w.slug, w]));
// lastmod follows the data file, so rebuilding without changes gives identical output.
const LASTMOD = statSync(DATA).mtime.toISOString().slice(0, 10);

// ---------- helpers ----------
const pageUrl = (w) => LIB + w.slug;
const minutes = (w) => w.capMinutes ?? w.durationMinutes;

function timeChip(w) {
  const m = minutes(w);
  switch (w.type) {
    case "For Time": return `For time · ${m} min cap`;
    case "AMRAP": return `${m} min AMRAP`;
    case "EMOM": return `${m} min EMOM`;
    case "Tabata": return `${m} min Tabata`;
    default: return `${m} min ${w.type.toLowerCase()}`;
  }
}

/** One line on what the SnapWOD timer runs, in the app's own words (src/review/planSummary.ts). */
function timerLine(w) {
  const p = w.timer.plan;
  const blocks = p.segments?.length ? p.segments.flatMap((s) => s.blocks) : p.blocks;
  const total = blocks.reduce((t, b) => t + b.seconds, 0);
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  switch (p.mode) {
    case "FOR_TIME": return `For Time with a ${clock(p.capSeconds)} cap.`;
    case "AMRAP": return `A ${clock(total)} AMRAP clock.`;
    case "EMOM": return `EMOM: ${blocks.length} rounds of 1:00, with a beep at the top of every minute.`;
    case "TABATA": {
      const work = blocks.filter((b) => b.kind === "work").length;
      return `Tabata: ${work} rounds of 0:20 work / 0:10 rest, labelled by movement (${clock(total)} total).`;
    }
    default: {
      const work = blocks.filter((b) => b.kind === "work").length;
      const rest = blocks.filter((b) => b.kind === "rest").length;
      return `Intervals: ${work} one-minute stations${rest ? ` and ${rest} rests` : ""}, labelled by station (${clock(total)} total).`;
    }
  }
}

function capText(w) {
  const m = minutes(w);
  if (w.type === "For Time") {
    return `Most gyms cap ${esc(w.name)} at about <b>${m} minutes</b>. If the clock runs out, note how many reps you completed. Change the cap in the app before you start if your gym uses a different one.`;
  }
  if (w.type === "AMRAP") return `The workout lasts <b>${m} minutes</b>. Your score is the rounds and reps you complete before the clock stops.`;
  if (w.type === "EMOM") return `The workout lasts <b>${m} minutes</b>, with a new round starting at the top of every minute.`;
  return `The whole workout takes <b>${m} minutes</b> on the clock.`;
}

function related(w) {
  const tags = new Set(w.tags);
  return workouts
    .filter((o) => o.slug !== w.slug)
    .map((o) => {
      const shared = o.tags.filter((t) => tags.has(t)).length;
      const union = new Set([...o.tags, ...w.tags]).size;
      return { o, score: shared / union + (o.category === w.category ? 0.15 : 0) + (o.type === w.type ? 0.05 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.o.name.localeCompare(b.o.name))
    .slice(0, 4)
    .map((x) => x.o);
}

function metaDescription(w) {
  let d = `${w.name} workout: ${w.summary} Rx loads, scaling, tips and a free timer.`;
  if (d.length > 160) d = `${w.name} workout: ${w.summary}`;
  if (d.length > 160) d = d.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  return d;
}

function pageTitle(w) {
  const t = `${w.name} Workout: ${w.headline} | SnapWOD`;
  if (t.length <= 70) return t;
  const short = `${w.name} Workout: ${w.headline}`;
  return short.length <= 80 ? short : `${w.name} Workout: Rx, Scaling & Timer | SnapWOD`;
}

// ---------- workout page ----------
const WORKOUT_CSS = `
    main { padding-bottom: 8px; }
    .hero-block { padding: 22px 0 6px; }
    .hero-block .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .pill.type { color: var(--muted); }
    h1.display { font-size: clamp(44px, 12vw, 76px); overflow-wrap: anywhere; }
    .headline { font-size: 19px; color: var(--muted); margin: 10px 0 0; }
    .honour { margin: 14px 0 0; padding: 12px 14px; border-left: 3px solid var(--orange); background: var(--surface); border-radius: 0 12px 12px 0; font-size: 15px; color: #d4d4d8; }
    .intro { margin: 18px 0 0; color: #d4d4d8; }
    .card {
      margin-top: 26px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px;
      padding: 22px 18px; box-shadow: 0 0 60px rgba(0, 224, 255, 0.07);
    }
    .board .scheme { color: var(--cyan); font-weight: 600; margin: 0 0 10px; }
    .board ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
    .board li { padding: 10px 2px; border-bottom: 1px solid var(--line); font-weight: 600; font-size: 18px; overflow-wrap: anywhere; }
    .board .cap { margin: 14px 0 0; color: var(--muted); font-size: 15px; }
    .board .cap b { color: var(--text); }
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;
      margin-top: 20px; padding: 15px 20px; border: 0; border-radius: 999px; cursor: pointer;
      background: var(--cyan); color: #001014; text-align: center;
      font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 20px; letter-spacing: 0.1em; text-transform: uppercase;
    }
    .btn:hover { filter: brightness(1.08); }
    .btn:active { transform: scale(0.98); }
    .open-row { display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .open-row .badges { margin-top: 4px; }
    .status { text-align: center; color: var(--muted); font-size: 14px; margin: 10px 0 0; min-height: 21px; }
    .note { text-align: center; color: var(--muted); font-size: 13px; margin: 2px 0 0; }
    .runs { text-align: center; font-size: 14px; color: var(--muted); margin: 6px 0 0; }
    .qr { display: none; margin-top: 20px; text-align: center; }
    .qr .code { width: 176px; height: 176px; margin: 0 auto 10px; background: #fff; border-radius: 14px; overflow: hidden; }
    .qr .code svg { width: 100%; height: 100%; display: block; }
    .qr p { margin: 0 0 14px; font-weight: 600; }
    .desktop .qr { display: block; }
    .desktop #open-btn, .desktop #status { display: none; }
    section.block { margin-top: 34px; }
    section.block h2 { font-size: 30px; margin: 0 0 12px; }
    .rx { display: grid; gap: 10px; }
    .rx-row { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
    .rx-row .mv { font-weight: 600; margin-bottom: 6px; }
    .rx-row .loads { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; font-size: 15px; color: #d4d4d8; }
    .rx-row .loads span { color: var(--muted); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; display: block; }
    .small { font-size: 15px; color: var(--muted); margin: 10px 0 0; }
    .ticks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .ticks li { display: flex; gap: 12px; align-items: flex-start; color: #d4d4d8; }
    .ticks li::before {
      content: ""; flex: none; width: 20px; height: 20px; margin-top: 3px; border-radius: 50%;
      background: var(--tick, var(--cyan)) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5 10.5l3.2 3L15 7' fill='none' stroke='%23001014' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;
    }
    .ticks.green { --tick: var(--green); }
    .rel { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
    .rel a { display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
    .rel a:hover { border-color: color-mix(in srgb, var(--cyan) 55%, transparent); }
    .rel b { font-family: Rajdhani, sans-serif; font-size: 22px; text-transform: uppercase; display: block; line-height: 1.1; }
    .rel span { font-size: 13px; color: var(--muted); }
    .get { margin-top: 40px; text-align: center; padding: 26px 18px; border-radius: 20px; border: 1px solid var(--line);
      background: radial-gradient(60% 90% at 25% 100%, rgba(0, 224, 255, 0.16), transparent 70%), radial-gradient(50% 80% at 85% 0%, rgba(48, 209, 88, 0.12), transparent 70%), var(--surface); }
    .get h2 { font-size: 32px; margin: 0 0 10px; }
    .get p { color: var(--muted); margin: 0 auto 18px; max-width: 460px; font-size: 16px; }
    @media (min-width: 700px) {
      .card { padding: 28px 30px; }
      .rel { grid-template-columns: repeat(4, 1fr); }
    }`;

// Runs on the workout page. No auto-open: the app only opens when the button is tapped.
const WORKOUT_JS = `
    (function () {
      var IOS_STORE_URL = ${JSON.stringify(IOS_STORE_URL)};
      var ANDROID_STORE_URL = ${JSON.stringify(ANDROID_STORE_URL)};
      var ANDROID_PACKAGE = ${JSON.stringify(ANDROID_PACKAGE)};
      var QR_SRC = ${JSON.stringify(QR_SRC)};
      var QR_SRI = ${JSON.stringify(QR_SRI)};
      function el(id) { return document.getElementById(id); }
      var ua = navigator.userAgent || "";
      // iPadOS reports itself as a Mac: treat a touch "Mac" as iOS.
      var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
      var isAndroid = /Android/i.test(ua);
      var inApp = /Instagram|FBAN|FBAV|FB_IAB|FB4A|FBiOS/i.test(ua);
      var btn = el("open-btn");
      // The plan is already in the button's default (iOS) link; reuse it for Android.
      var d = btn.getAttribute("href").split("?d=")[1];
      var status = el("status");

      if (isAndroid) {
        // Intent URL: opens the app if installed, otherwise Chrome goes to the Play Store.
        btn.href = "intent://plan?d=" + d + "#Intent;scheme=wodbrain;package=" + ANDROID_PACKAGE +
          ";S.browser_fallback_url=" + encodeURIComponent(ANDROID_STORE_URL) + ";end";
        el("ios-store").style.display = "none";
      } else if (isIOS) {
        btn.href = "wodbrain://plan?d=" + d;
        el("android-store").style.display = "none";
      } else {
        document.documentElement.classList.add("desktop");
        loadQr();
      }
      if ((isIOS || isAndroid) && inApp) el("hint").textContent = "Nothing happens? Open this page in your browser (\\u22EF menu \\u2192 Open in browser).";

      btn.addEventListener("click", function () {
        if (!isIOS && !isAndroid) return;
        status.textContent = "Opening SnapWOD\\u2026";
        var t = setTimeout(function () {
          status.textContent = "Don't have SnapWOD yet? It's free: get it below, then tap the button again.";
        }, 1800);
        var cancel = function () { clearTimeout(t); status.textContent = ""; };
        window.addEventListener("pagehide", cancel, { once: true });
        document.addEventListener("visibilitychange", function () { if (document.hidden) cancel(); }, { once: true });
      });

      function loadQr() {
        var s = document.createElement("script");
        s.src = QR_SRC; s.integrity = QR_SRI; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer";
        s.onload = drawQr;
        s.onerror = function () { el("qr-code").style.display = "none"; };
        document.head.appendChild(s);
      }
      function drawQr() {
        var box = el("qr-code");
        try {
          // qrcodejs builds the module matrix; drawn as an SVG so it stays sharp.
          var q = new QRCode(document.createElement("div"), { text: box.getAttribute("data-url"), width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });
          var m = q._oQRCode, n = m.getModuleCount(), quiet = 4, p = "";
          for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m.isDark(r, c)) p += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
          var size = n + quiet * 2;
          box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + " " + size +
            '" shape-rendering="crispEdges" role="img" aria-label="QR code for this page"><path fill="#000" d="' + p + '"/></svg>';
        } catch (e) { box.style.display = "none"; }
      }
    })();`;

function rxSection(w) {
  if (!w.rx.length) {
    return `<p class="small" style="margin-top:0">Bodyweight only: no loads to set.</p>`;
  }
  const hasWomen = w.rx.some((r) => r.women);
  const rows = w.rx
    .map((r) => {
      const loads = hasWomen
        ? `<div><span>Men</span>${esc(r.men)}</div><div><span>Women</span>${r.women ? esc(r.women) : "Not specified"}</div>`
        : `<div><span>Rx</span>${esc(r.men)}</div>`;
      return `<div class="rx-row"><div class="mv">${esc(r.movement)}</div><div class="loads">${loads}</div></div>`;
    })
    .join("\n        ");
  return `<div class="rx">
        ${rows}
      </div>${w.rxNote ? `\n      <p class="small">${esc(w.rxNote)}</p>` : ""}`;
}

function workoutPage(w) {
  const url = pageUrl(w);
  const title = pageTitle(w);
  const desc = metaDescription(w);
  const cat = CATEGORIES[w.category];
  const d = encodeURIComponent(JSON.stringify(w.timer.plan));
  const rel = related(w);
  const honour = w.category === "hero" ? (w.honour || "A Hero workout honouring a fallen service member.") : "";
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "SnapWOD", item: SITE },
          { "@type": "ListItem", position: 2, name: "Workout library", item: LIB },
          { "@type": "ListItem", position: 3, name: `${w.name} workout`, item: url },
        ],
      },
      {
        "@type": "WebPage",
        "@id": url,
        url,
        name: title,
        description: desc,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: "SnapWOD", url: SITE },
        primaryImageOfPage: { "@type": "ImageObject", url: OG_IMAGE },
        about: { "@type": "Thing", name: `${w.name} (${cat.long.toLowerCase()})` },
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="robots" content="index,follow" />
  <meta name="theme-color" content="#040406" />
  <link rel="canonical" href="${url}" />
  <link rel="icon" href="../snapwod-logo.png" />
  <link rel="apple-touch-icon" href="../snapwod-logo.png" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="SnapWOD" />
  <meta property="og:title" content="${esc(`${w.name} workout: ${w.headline}`)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(`${w.name} workout: ${w.headline}`)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${OG_IMAGE}" />
  <script type="application/ld+json">
${jsonLd(ld)}
  </script>
  ${FONTS}
  <style>${BASE_CSS}${WORKOUT_CSS}
  </style>
</head>
<body>
  ${header("../")}
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">SnapWOD</a><span aria-hidden="true">›</span><a href="./">Workouts</a><span aria-hidden="true">›</span>${esc(w.name)}</nav>

    <div class="hero-block">
      <div class="pills"><span class="pill ${w.category}">${esc(cat.label)}</span><span class="pill type">${esc(timeChip(w))}</span></div>
      <h1 class="display">${esc(w.name)} <span class="cyan">workout</span></h1>
      <p class="headline">${esc(w.headline)}</p>${honour ? `\n      <p class="honour">${esc(honour)}</p>` : ""}
      <p class="intro">${esc(w.intro)}</p>
    </div>

    <section class="card board" aria-labelledby="wod-h">
      <h2 class="display" id="wod-h" style="font-size:28px;margin:0 0 12px">The workout</h2>
      <p class="scheme">${esc(w.workout.scheme)}</p>
      <ul>
        ${w.workout.lines.map((l) => `<li>${esc(l)}</li>`).join("\n        ")}
      </ul>
      <p class="cap">${w.capMinutes ? `Time cap: <b>${w.capMinutes} min</b>` : `Duration: <b>${w.durationMinutes} min</b>`}</p>

      <div class="open-row">
        <a class="btn" id="open-btn" href="wodbrain://plan?d=${d}">▶ Open in SnapWOD</a>
        <p class="runs">Loads the timer ready to go: ${esc(timerLine(w))}</p>
        <p class="status" id="status" aria-live="polite"></p>
        <p class="note" id="hint"></p>
        <div class="qr">
          <div class="code" id="qr-code" data-url="${url}"></div>
          <p>Scan to open on your phone</p>
        </div>
        <div class="badges">
          <a id="ios-store" href="${IOS_STORE_URL}" rel="noopener"><img src="../app-store-badge.svg" alt="Download on the App Store" width="138" height="46" /></a>
          <a id="android-store" href="${ANDROID_STORE_URL}" rel="noopener"><img src="../google-play-badge.svg" alt="Get it on Google Play" width="155" height="46" /></a>
        </div>
        <p class="note">Needs the latest version of SnapWOD.</p>
      </div>
    </section>

    <section class="block" aria-labelledby="rx-h">
      <h2 class="display" id="rx-h">Rx loads</h2>
      ${rxSection(w)}
    </section>

    <section class="block" aria-labelledby="cap-h">
      <h2 class="display" id="cap-h">${w.type === "For Time" ? "Time cap" : "Duration"}</h2>
      <p class="small" style="margin-top:0;color:#d4d4d8">${capText(w)}</p>
    </section>

    <section class="block" aria-labelledby="scale-h">
      <h2 class="display" id="scale-h">Scaling options</h2>
      <ul class="ticks">
        ${w.scaling.map((s) => `<li>${esc(s)}</li>`).join("\n        ")}
      </ul>
    </section>

    <section class="block" aria-labelledby="tips-h">
      <h2 class="display" id="tips-h">Strategy tips</h2>
      <ul class="ticks green">
        ${w.tips.map((s) => `<li>${esc(s)}</li>`).join("\n        ")}
      </ul>
    </section>

    <section class="block" aria-labelledby="rel-h">
      <h2 class="display" id="rel-h">Related workouts</h2>
      <div class="rel">
        ${rel.map((o) => `<a href="${o.slug}"><b>${esc(o.name)}</b><span>${esc(timeChip(o))}</span></a>`).join("\n        ")}
      </div>
      <p class="small"><a href="./" class="cyan">Browse all ${workouts.length} workouts →</a></p>
    </section>

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
  <script>${WORKOUT_JS}
  </script>
</body>
</html>
`;
}

// ---------- library index ----------
const INDEX_CSS = `
    .intro-block { padding: 30px 0 8px; }
    .intro-block h1 { font-size: clamp(44px, 11vw, 80px); margin: 14px 0 14px; }
    .intro-block p { color: var(--muted); margin: 0; max-width: 620px; }
    .intro-block p.timer-link { margin-top: 12px; font-size: 15px; font-weight: 600; }
    .tools { position: sticky; top: 60px; z-index: 10; background: rgba(4, 4, 6, 0.92); padding: 14px 0 12px; margin-top: 18px;
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .search { width: 100%; font: inherit; font-size: 17px; color: var(--text); background: var(--surface); border: 1px solid var(--line);
      border-radius: 999px; padding: 12px 18px; outline: none; }
    .search:focus { border-color: var(--cyan); }
    .search::placeholder { color: #71717a; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .chip { font: inherit; font-size: 14px; font-weight: 600; color: var(--muted); background: var(--surface); border: 1px solid var(--line);
      border-radius: 999px; padding: 7px 14px; cursor: pointer; }
    .chip[aria-pressed="true"] { color: #001014; background: var(--cyan); border-color: var(--cyan); }
    .count { font-size: 14px; color: var(--muted); margin: 6px 0 12px; }
    .grid { display: grid; gap: 12px; }
    .wcard { display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 16px 16px 15px; }
    .wcard:hover { border-color: color-mix(in srgb, var(--cyan) 55%, transparent); }
    .wcard .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .wcard h2 { font-size: 28px; overflow-wrap: anywhere; }
    .wcard .t { font-size: 13px; font-weight: 600; color: var(--cyan); white-space: nowrap; }
    .wcard p { margin: 6px 0 0; font-size: 15px; color: #d4d4d8; }
    .wcard .cat { display: block; margin-top: 8px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
    .wcard .cat.hero { color: var(--orange); }
    .empty { display: none; color: var(--muted); padding: 30px 0; text-align: center; }
    .get { margin-top: 44px; text-align: center; padding: 26px 18px; border-radius: 20px; border: 1px solid var(--line); background: var(--surface); }
    .get h2 { font-size: 32px; margin: 0 0 10px; }
    .get p { color: var(--muted); margin: 0 auto 18px; max-width: 460px; font-size: 16px; }
    @media (min-width: 700px) { .grid { grid-template-columns: 1fr 1fr; } }`;

const INDEX_JS = `
    (function () {
      var q = document.getElementById("q");
      var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
      var cards = Array.prototype.slice.call(document.querySelectorAll(".wcard"));
      var count = document.getElementById("count");
      var empty = document.getElementById("empty");
      var cat = "all";
      function apply() {
        var words = q.value.toLowerCase().trim().split(/\\s+/).filter(Boolean);
        var shown = 0;
        cards.forEach(function (c) {
          var hay = c.getAttribute("data-s");
          var ok = (cat === "all" || c.getAttribute("data-c") === cat) && words.every(function (w) { return hay.indexOf(w) >= 0; });
          c.hidden = !ok;
          if (ok) shown++;
        });
        count.textContent = shown + (shown === 1 ? " workout" : " workouts");
        empty.style.display = shown ? "none" : "block";
      }
      chips.forEach(function (b) {
        b.addEventListener("click", function () {
          cat = b.getAttribute("data-c");
          chips.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
          apply();
        });
      });
      q.addEventListener("input", apply);
      apply();
    })();`;

function indexPage() {
  const title = "Benchmark & Hero Workouts: Murph, Fran, Cindy and More | SnapWOD";
  const desc = `${workouts.length} classic benchmark and Hero workouts with Rx loads, time caps, scaling and tips. Open any of them in SnapWOD and the timer is ready to go.`;
  const order = ["girls", "hero", "classic"];
  const sorted = [...workouts].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "SnapWOD", item: SITE },
          { "@type": "ListItem", position: 2, name: "Workout library", item: LIB },
        ],
      },
      {
        "@type": "CollectionPage",
        "@id": LIB,
        url: LIB,
        name: title,
        description: desc,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: "SnapWOD", url: SITE },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: sorted.length,
          itemListElement: sorted.map((w, i) => ({ "@type": "ListItem", position: i + 1, url: pageUrl(w), name: `${w.name} workout` })),
        },
      },
    ],
  };
  const cards = sorted
    .map((w) => {
      const s = [w.name, w.type, CATEGORIES[w.category].label, w.headline, w.summary, ...w.tags].join(" ").toLowerCase();
      return `<a class="wcard" href="${w.slug}" data-c="${w.category}" data-s="${esc(s)}">
          <div class="row"><h2 class="display">${esc(w.name)}</h2><span class="t">${esc(timeChip(w))}</span></div>
          <p>${esc(w.summary)}</p>
          <span class="cat ${w.category}">${esc(CATEGORIES[w.category].label)}</span>
        </a>`;
    })
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="robots" content="index,follow" />
  <meta name="theme-color" content="#040406" />
  <link rel="canonical" href="${LIB}" />
  <link rel="icon" href="../snapwod-logo.png" />
  <link rel="apple-touch-icon" href="../snapwod-logo.png" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="SnapWOD" />
  <meta property="og:title" content="Benchmark &amp; Hero workout library" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${LIB}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Benchmark &amp; Hero workout library" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${OG_IMAGE}" />
  <script type="application/ld+json">
${jsonLd(ld)}
  </script>
  ${FONTS}
  <style>${BASE_CSS}${INDEX_CSS}
  </style>
</head>
<body>
  ${header("../")}
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">SnapWOD</a><span aria-hidden="true">›</span>Workouts</nav>
    <div class="intro-block">
      <span class="pill girls">Workout library</span>
      <h1 class="display">Benchmark &amp; <span class="cyan">Hero workouts</span></h1>
      <p>The classic named workouts, from Fran and Cindy to Murph and DT. Each one has the standard Rx, a typical time cap, scaling options and pacing tips, plus a button that opens it in SnapWOD with the timer ready to go.</p>
      <p class="timer-link"><a href="../timer/" class="cyan">Need a clock right now? Use the free online WOD timer →</a></p>
    </div>

    <div class="tools">
      <input class="search" id="q" type="search" placeholder="Search: Murph, thrusters, AMRAP…" aria-label="Search workouts" autocomplete="off" />
      <div class="chips" role="group" aria-label="Filter by category">
        <button class="chip" type="button" data-c="all" aria-pressed="true">All</button>
        <button class="chip" type="button" data-c="girls" aria-pressed="false">The Girls</button>
        <button class="chip" type="button" data-c="hero" aria-pressed="false">Hero</button>
        <button class="chip" type="button" data-c="classic" aria-pressed="false">Classic</button>
      </div>
    </div>
    <p class="count" id="count" aria-live="polite">${workouts.length} workouts</p>
    <div class="grid">
        ${cards}
    </div>
    <p class="empty" id="empty">No workouts match that search.</p>

    <section class="get">
      <h2 class="display">Your gym's board, <span class="cyan">on the clock</span></h2>
      <p>Not on the list? Snap the whiteboard and SnapWOD builds the timer for you. Free on iPhone and Android.</p>
      <div class="badges">
        <a href="${IOS_STORE_URL}" rel="noopener"><img src="../app-store-badge.svg" alt="Download on the App Store" width="138" height="46" loading="lazy" /></a>
        <a href="${ANDROID_STORE_URL}" rel="noopener"><img src="../google-play-badge.svg" alt="Get it on Google Play" width="155" height="46" loading="lazy" /></a>
      </div>
    </section>
  </main>
  ${footer("../")}
  <script>${INDEX_JS}
  </script>
</body>
</html>
`;
}

// ---------- sitemap ----------
function updateSitemap() {
  const file = path.join(DOCS, "sitemap.xml");
  const xml = readFileSync(file, "utf8");
  const nl = xml.includes("\r\n") ? "\r\n" : "\n";
  const lines = xml.split(/\r?\n/);
  // Keep every entry that isn't ours; drop the old workout entries, then append fresh ones.
  const kept = lines.filter((l) => !l.includes(`<loc>${LIB}`));
  const end = kept.findIndex((l) => l.trim() === "</urlset>");
  if (end < 0) throw new Error("sitemap.xml: no </urlset>");
  const ours = [
    `  <url><loc>${LIB}</loc><lastmod>${LASTMOD}</lastmod><priority>0.8</priority></url>`,
    ...workouts.map((w) => `  <url><loc>${pageUrl(w)}</loc><lastmod>${LASTMOD}</lastmod><priority>0.7</priority></url>`),
  ];
  const out = [...kept.slice(0, end), ...ours, ...kept.slice(end)].join(nl);
  writeFileSync(file, out);
}

// ---------- build ----------
for (const w of workouts) {
  for (const k of ["slug", "name", "category", "type", "headline", "summary", "intro", "workout", "rx", "scaling", "tips", "tags", "timer"]) {
    if (w[k] == null) throw new Error(`${w.slug || "?"}: missing ${k}`);
  }
  if (!/^[a-z0-9-]+$/.test(w.slug)) throw new Error(`bad slug ${w.slug}`);
  if (!CATEGORIES[w.category]) throw new Error(`${w.slug}: unknown category ${w.category}`);
  if (!w.timer.plan) throw new Error(`${w.slug}: no timer plan (run: npx tsx tools/check-plans.mjs --write)`);
  if (!minutes(w)) throw new Error(`${w.slug}: needs capMinutes or durationMinutes`);
  if (/crossfit/i.test(JSON.stringify({ ...w, timer: null }))) throw new Error(`${w.slug}: don't use the CrossFit trademark`);
}
mkdirSync(OUT, { recursive: true });
// Remove pages for workouts that were taken out of the data.
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".html") && f !== "index.html" && !bySlug.has(f.slice(0, -5))) unlinkSync(path.join(OUT, f));
}
for (const w of workouts) writeFileSync(path.join(OUT, `${w.slug}.html`), workoutPage(w));
writeFileSync(path.join(OUT, "index.html"), indexPage());
updateSitemap();
console.log(`Built ${workouts.length} workout pages + index in docs/workouts, sitemap updated (lastmod ${LASTMOD}).`);
