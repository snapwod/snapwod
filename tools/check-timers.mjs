// Checks the generated timer pages (docs/timer/*.html, built by tools/build-timers.mjs).
//
// For every page in tools/timers.json:
//   - reads the "Open in SnapWOD" link baked into the page (what the button opens before any change),
//   - runs docs/timer/timer.js's own engine on the page's settings and checks it builds the same plan
//     (so the link the script rebuilds in the browser matches the one in the HTML),
//   - validates the plan with the app's link rules (parseInlinePlan in WODBrain/src/lib/share.ts):
//     a copy of those rules below, plus the app's real function when it can be loaded,
//   - runs the page script itself on a small fake DOM (as Android, iPhone and desktop) and checks the
//     link it sets (including the Android intent link) and which settings groups it shows,
//   - checks the plan's shape against the format (EMOM = 1:00 work blocks, AMRAP = one amrap block, ...)
//     and the page's "expect" numbers in timers.json,
//   - checks the page itself: size, title/description/canonical, JSON-LD, links, word count.
// Then every timer type at its smallest and largest settings must still give a valid plan.
//
//   node tools/check-timers.mjs                 (exit 1 on any problem)
//   npx tsx tools/check-timers.mjs              (same, and always loads the app's TypeScript)
// The app repo is expected at ../WODBrain next to this repo; override with --app <dir> or WODBRAIN_DIR.

import { readFileSync, existsSync, statSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEngine } from "./build-timers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, "..", "docs");
const OUT = path.join(DOCS, "timer");
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APP = path.resolve(argVal("--app") || process.env.WODBRAIN_DIR || path.join(here, "..", "..", "WODBrain"));
const MAX_PAGE_BYTES = 60 * 1024;

// ---------- the app's link rules (copy of parseInlinePlan / extractInlinePlanFromUrl, src/lib/share.ts) ----------
const PLAN_MODES = ["INTERVAL", "EMOM", "AMRAP", "FOR_TIME", "TABATA", "COMPOSITE", "RATIO"];
const BLOCK_KINDS = ["work", "rest", "transition", "amrap", "cap"];
const MAX_INLINE_BLOCKS = 500;
const MAX_INLINE_SECONDS = 24 * 60 * 60;
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
function toBlocks(raw) {
  if (!Array.isArray(raw)) return null;
  const blocks = [];
  for (const b of raw) {
    const seconds = Number(b?.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_INLINE_SECONDS) return null;
    if (!BLOCK_KINDS.includes(b?.kind)) return null;
    blocks.push({ label: text(b?.label, 200), seconds: Math.round(seconds), kind: b.kind });
  }
  return blocks;
}
function parseInlinePlanCopy(json) {
  let raw;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== "object" || !PLAN_MODES.includes(raw.mode)) return null;
  const blocks = toBlocks(raw.blocks ?? []);
  if (!blocks) return null;
  let segments;
  if (raw.segments != null) {
    if (!Array.isArray(raw.segments)) return null;
    segments = [];
    for (const seg of raw.segments) {
      const segBlocks = toBlocks(seg?.blocks);
      if (!segBlocks) return null;
      segments.push({ label: text(seg?.label, 200), blocks: segBlocks });
    }
  }
  const all = [...blocks, ...(segments ?? []).flatMap((s) => s.blocks)];
  if (!all.length || all.length > MAX_INLINE_BLOCKS) return null;
  if (all.reduce((t, b) => t + b.seconds, 0) > MAX_INLINE_SECONDS) return null;
  const cap = Number(raw.capSeconds);
  const ratio = raw.ratio;
  return {
    mode: raw.mode,
    name: text(raw.name, 120),
    notes: text(raw.notes, 2000),
    blocks,
    ...(segments ? { segments } : {}),
    capSeconds: Number.isFinite(cap) && cap > 0 && cap <= MAX_INLINE_SECONDS ? Math.round(cap) : null,
    ratio:
      ratio && [ratio.workUnits, ratio.restUnits, ratio.rounds].every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)
        ? { workUnits: ratio.workUnits, restUnits: ratio.restUnits, rounds: ratio.rounds }
        : null,
  };
}
function extractCopy(url) {
  const m = /^wodbrain:\/\/\/?plan\?(?:.*&)?d=([^&#]+)/i.exec(url);
  if (!m) return null;
  try { return parseInlinePlanCopy(decodeURIComponent(m[1])); } catch { return null; }
}

// The app's own functions, if they load (tsx, or Node 22.18+ which strips TypeScript types).
let app = null;
try {
  const share = path.join(APP, "src/lib/share.ts");
  if (existsSync(share)) {
    const mod = await import(pathToFileURL(share).href);
    if (typeof mod.parseInlinePlan === "function") app = mod;
  }
} catch (e) {
  console.log(`(could not load the app's share.ts: ${String(e.message || e).split("\n")[0]})`);
}
console.log(app ? `Validating with the app's parseInlinePlan (${path.join(APP, "src/lib/share.ts")}) and the copy here.\n` : "Validating with the copy of parseInlinePlan in this script (app not loaded).\n");

/** Problems with a plan under the app's rules (copy and, when loaded, the real thing). */
function validate(plan) {
  const problems = [];
  const json = JSON.stringify(plan);
  const link = "wodbrain://plan?d=" + encodeURIComponent(json);
  const parsers = [["copy", parseInlinePlanCopy, extractCopy]];
  if (app) parsers.push(["app", app.parseInlinePlan, app.extractInlinePlanFromUrl]);
  let parsed = null;
  for (const [who, parse, extract] of parsers) {
    const p = parse(json);
    if (!p) { problems.push(`${who}: parseInlinePlan rejected the plan`); continue; }
    if (JSON.stringify(p.blocks) !== JSON.stringify(plan.blocks)) problems.push(`${who}: blocks changed by the validator`);
    if (p.name !== plan.name) problems.push(`${who}: name lost`);
    if ((plan.capSeconds ?? null) !== p.capSeconds) problems.push(`${who}: capSeconds ${plan.capSeconds} became ${p.capSeconds}`);
    if (!extract(link)) problems.push(`${who}: link round trip failed`);
    parsed = parsed || p;
  }
  return { problems, parsed };
}

/** The plan has the shape the app's parser gives that format (see tools/check-plans.mjs). */
function shapeProblems(plan) {
  const b = plan.blocks, out = [];
  switch (plan.mode) {
    case "EMOM": {
      const s = b[0]?.seconds;
      if (!b.every((x) => x.kind === "work" && x.seconds === s)) out.push("EMOM should be equal work blocks");
      break;
    }
    case "AMRAP":
      if (b.length !== 1 || b[0].kind !== "amrap") out.push("AMRAP should be one amrap block");
      break;
    case "FOR_TIME":
      if (b.length !== 1 || b[0].kind !== "cap") out.push("For Time should be one cap block");
      if (plan.capSeconds !== b[0]?.seconds) out.push("capSeconds should equal the cap block");
      break;
    case "TABATA":
    case "INTERVAL": {
      if (!b.length || b[0].kind !== "work") out.push("intervals should start with work");
      for (let i = 1; i < b.length; i++) {
        if (b[i].kind === b[i - 1].kind && b[i].kind === "rest") out.push("two rests in a row");
        if (!["work", "rest"].includes(b[i].kind)) out.push(`unexpected ${b[i].kind} block`);
      }
      break;
    }
    default:
      out.push(`unexpected mode ${plan.mode}`);
  }
  return [...new Set(out)];
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const attr = (html, re) => { const m = re.exec(html); return m ? m[1] : null; };
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// ---------- a small fake DOM to run the page script ----------
const UAS = {
  android: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
};
const SCRIPT_SRC = readFileSync(path.join(OUT, "timer.js"), "utf8");
function fakeEl(tag, attrs, inner) {
  const cls = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  return {
    tagName: tag.toUpperCase(), attrs, inner, cls, hidden: "hidden" in attrs, disabled: false, value: attrs.value || "",
    textContent: inner.replace(/<[^>]+>/g, ""), style: { setProperty() {} },
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => { on = on === undefined ? !cls.has(c) : on; on ? cls.add(c) : cls.delete(c); return on; },
    },
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; },
    addEventListener() {},
    get href() { return attrs.href; }, set href(v) { attrs.href = v; },
  };
}
/** Runs docs/timer/timer.js on the page's markup; returns the elements it touched. */
function runPage(html, ua) {
  const els = [], byId = {};
  for (const m of html.matchAll(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const attrs = {};
    for (const [, k, v] of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[k] = v === undefined ? "" : unesc(v);
    const isGroup = /\bfields\b/.test(attrs.class || "");
    if (!attrs.id && !isGroup && !/\bmode\b/.test(attrs.class || "")) continue;
    // A settings group's content: up to the next group or the end of the settings.
    const inner = isGroup ? html.slice(m.index + m[0].length).split(/<div class="fields"|<p class="sum"/)[0] : "";
    const e = fakeEl(m[1], attrs, inner);
    els.push(e);
    if (attrs.id) byId[attrs.id] = e;
  }
  const htmlEl = fakeEl("html", {}, "");
  const document = {
    title: "", hidden: false, documentElement: htmlEl,
    getElementById: (id) => byId[id] || null,
    querySelectorAll(sel) {
      if (sel === ".tmr .mode") return els.filter((e) => e.cls.has("mode"));
      if (sel === ".tmr .fields") return els.filter((e) => e.cls.has("fields"));
      if (sel === ".tmr [data-key]") return els.filter((e) => e.getAttribute("data-key") != null);
      throw new Error("selector not supported by the check: " + sel);
    },
    addEventListener() {},
  };
  // timer-config's text is the JSON between the tags.
  byId["timer-config"].textContent = attr(html, /<script type="application\/json" id="timer-config">([\s\S]*?)<\/script>/);
  const window = { localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, document };
  const ctx = {
    window, document, navigator: { userAgent: ua, maxTouchPoints: 0 },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {},
  };
  vm.runInNewContext(SCRIPT_SRC, ctx);
  return { byId, htmlEl, groups: els.filter((e) => e.cls.has("fields")) };
}

const engine = loadEngine();
const pages = JSON.parse(readFileSync(path.join(here, "timers.json"), "utf8"));
const workoutSlugs = new Set(JSON.parse(readFileSync(path.join(here, "workouts.json"), "utf8")).map((w) => w.slug));
const sitemap = readFileSync(path.join(DOCS, "sitemap.xml"), "utf8");
const titles = new Map(), descs = new Map();
let failed = 0;

for (const p of pages) {
  const problems = [];
  const file = path.join(OUT, `${p.slug}.html`);
  if (!existsSync(file)) { console.log(`FAIL  ${p.slug}: ${file} missing (run node tools/build-timers.mjs)`); failed++; continue; }
  const html = readFileSync(file, "utf8");
  const bytes = statSync(file).size;
  if (bytes > MAX_PAGE_BYTES) problems.push(`page is ${bytes} bytes (> ${MAX_PAGE_BYTES})`);

  // 1. The default link in the HTML.
  const href = attr(html, /id="open-btn" href="([^"]+)"/);
  let plan = null;
  if (!href) problems.push("no Open in SnapWOD link");
  else {
    const d = /^wodbrain:\/\/plan\?d=([^&#"]+)$/.exec(unesc(href));
    if (!d) problems.push(`unexpected link ${href.slice(0, 60)}`);
    else {
      try { plan = JSON.parse(decodeURIComponent(d[1])); } catch { problems.push("link plan is not JSON"); }
    }
  }

  // 2. The script builds the same plan from the page's config.
  let config = null;
  try { config = JSON.parse(attr(html, /<script type="application\/json" id="timer-config">([\s\S]*?)<\/script>/)); } catch { problems.push("timer-config missing or not JSON"); }
  if (config && plan) {
    const fromScript = engine.toPlan(config.mode, config.defaults);
    if (JSON.stringify(fromScript) !== JSON.stringify(plan)) problems.push("timer.js builds a different plan from the page config than the HTML link");
    if (config.mode !== p.mode) problems.push(`config mode ${config.mode} != ${p.mode}`);
  }

  // 2b. Run the real page script (fake DOM) as Android, iPhone and desktop: the link it sets,
  // and which settings groups it shows.
  if (plan && config) {
    const json = JSON.stringify(plan);
    for (const [who, ua] of Object.entries(UAS)) {
      let dom;
      try { dom = runPage(html, ua); } catch (e) { problems.push(`${who}: page script threw: ${e.message}`); continue; }
      const got = dom.byId["open-btn"].attrs.href || "";
      if (who === "android") {
        const m = /^intent:\/\/plan\?d=([^#]+)#Intent;scheme=wodbrain;package=([^;]+);S\.browser_fallback_url=([^;]+);end$/.exec(got);
        if (!m) problems.push(`android: unexpected link ${got.slice(0, 60)}`);
        else {
          if (decodeURIComponent(m[1]) !== json) problems.push("android: intent link carries a different plan");
          const asLink = "wodbrain://plan?d=" + m[1];
          if (!extractCopy(asLink) || (app && !app.extractInlinePlanFromUrl(asLink))) problems.push("android: plan in the intent link is rejected");
          if (m[2] !== "com.anonymous.wodbrain" || !decodeURIComponent(m[3]).startsWith("https://play.google.com/")) problems.push("android: wrong package or fallback");
        }
        if (dom.byId["ios-store"].style.display !== "none") problems.push("android: App Store badge not hidden");
      } else if (got !== "wodbrain://plan?d=" + encodeURIComponent(json)) problems.push(`${who}: link differs from the HTML default`);
      if (who === "desktop" && !dom.htmlEl.cls.has("desktop")) problems.push("desktop: no .desktop class");
      // The page's own timer group and the get-ready group show; the other timers' groups are hidden.
      for (const g of dom.groups) {
        const m = g.attrs["data-mode"];
        const want = !m || m === config.mode;
        if (g.hidden === want) problems.push(`${who}: settings group "${m || "get ready"}" is ${g.hidden ? "hidden" : "shown"}`);
      }
      if (!dom.groups.some((g) => !g.attrs["data-mode"] && !g.hidden && g.inner.includes('id="f-ready"'))) problems.push(`${who}: get-ready field not visible`);
    }
  }

  // 3. App link rules, format shape and the expected numbers.
  let total = 0;
  if (plan) {
    const v = validate(plan);
    problems.push(...v.problems);
    problems.push(...shapeProblems(plan));
    total = plan.blocks.reduce((t, b) => t + b.seconds, 0);
    const e = p.expect;
    if (plan.mode !== e.mode) problems.push(`mode ${plan.mode} != expected ${e.mode}`);
    if (total !== e.totalSeconds) problems.push(`total ${fmt(total)} != expected ${fmt(e.totalSeconds)}`);
    if (plan.blocks.length !== e.blocks) problems.push(`${plan.blocks.length} blocks != expected ${e.blocks}`);
    if (e.capSeconds != null && plan.capSeconds !== e.capSeconds) problems.push(`capSeconds ${plan.capSeconds} != ${e.capSeconds}`);
  }

  // 4. The page.
  const title = attr(html, /<title>([^<]*)<\/title>/);
  const desc = attr(html, /<meta name="description" content="([^"]*)"/);
  const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/);
  const want = "https://snapwod.github.io/snapwod/timer/" + (p.slug === "index" ? "" : p.slug);
  if (canonical !== want) problems.push(`canonical ${canonical} != ${want}`);
  if (!sitemap.includes(`<loc>${want}</loc>`)) problems.push("not in sitemap.xml");
  if (!title || titles.has(title)) problems.push(`title missing or shared with ${titles.get(title)}`);
  if (!desc || descs.has(desc)) problems.push(`description missing or shared with ${descs.get(desc)}`);
  titles.set(title, p.slug); descs.set(desc, p.slug);
  if (!/<meta property="og:title"/.test(html) || !/<meta property="og:url" content="([^"]*)"/.test(html)) problems.push("Open Graph tags missing");
  try {
    const ld = JSON.parse(attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
    if (!ld["@graph"].some((n) => n["@type"] === "WebApplication")) problems.push("JSON-LD has no WebApplication");
  } catch { problems.push("JSON-LD missing or not JSON"); }
  if (!/<script src="timer\.js\?v=[0-9a-f]+"><\/script>/.test(html)) problems.push("timer.js not referenced");
  if (!/id="t-phase"[^>]*aria-live="polite"/.test(html)) problems.push("phase label has no aria-live");
  for (const [, id] of html.matchAll(/<input id="([^"]+)"/g)) if (!html.includes(`<label for="${id}">`)) problems.push(`input ${id} has no label`);
  for (const [, id] of html.matchAll(/<select id="([^"]+)"/g)) if (!html.includes(`<label for="${id}">`)) problems.push(`select ${id} has no label`);
  for (const [, slug] of html.matchAll(/href="\.\.\/workouts\/([a-z0-9-]+)"/g)) if (!workoutSlugs.has(slug)) problems.push(`link to missing workout ${slug}`);
  for (const [, slug] of html.matchAll(/<a href="([a-z0-9-]+)">/g)) if (!existsSync(path.join(OUT, slug + ".html"))) problems.push(`link to missing timer page ${slug}`);
  if (/crossfit/i.test(html)) problems.push("mentions CrossFit");
  // Words in the text under the timer (the sections and the workout cards).
  const body = [...html.matchAll(/<section class="block"[\s\S]*?<\/section>/g)].map((m) => m[0]).filter((s) => !s.includes('id="more-h"')).join(" ");
  const words = unesc(body.replace(/<[^>]+>/g, " ")).split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
  const minWords = /^\d+-minute-/.test(p.slug) ? 120 : 200;
  if (words < minWords || words > 450) problems.push(`${words} words of text (want ${minWords}-450)`);

  const info = plan ? `${plan.mode.padEnd(8)} ${String(plan.blocks.length).padStart(3)} blocks ${fmt(total).padStart(6)}  ${String(words).padStart(3)} words  ${(bytes / 1024).toFixed(1).padStart(5)} KB` : "";
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${p.slug.padEnd(16)} ${info}`);
  if (plan) console.log(`        ${plan.name}: ${engine.summary(config.mode, config.defaults)}`);
  for (const x of problems) console.log(`        - ${x}`);
  if (problems.length) failed++;
}

// Every timer type at its limits still makes a plan the app accepts.
console.log("\nLimits:");
for (const m of engine.ORDER) {
  for (const which of ["min", "max"]) {
    const s = {};
    for (const f of engine.MODES[m].fields) s[f.key] = f.options ? (which === "min" ? f.options[0] : f.options[f.options.length - 1]) : f[which];
    if (m === "emom" && which === "max") s.every = engine.MODES.emom.fields[1].options[0]; // most blocks: longest time, shortest interval
    const plan = engine.toPlan(m, s);
    const { problems } = validate(plan);
    problems.push(...shapeProblems(plan));
    const total = plan.blocks.reduce((t, b) => t + b.seconds, 0);
    console.log(`${problems.length ? "FAIL" : "ok  "}  ${(m + " " + which).padEnd(16)} ${plan.mode.padEnd(8)} ${String(plan.blocks.length).padStart(3)} blocks ${fmt(total).padStart(7)}  ${JSON.stringify(s)}`);
    for (const x of problems) console.log(`        - ${x}`);
    if (problems.length) failed++;
  }
}

console.log(failed ? `\n${failed} problem(s).` : `\nAll ${pages.length} timer pages and limit plans valid.`);
process.exit(failed ? 1 : 0);
