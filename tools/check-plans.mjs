// Checks (and with --write, regenerates) the SnapWOD timer plans in tools/workouts.json.
//
// Each workout has `timer.whiteboard`: the workout written the way a coach writes it on the
// board. The plan comes from the app's own parser (parseWod in WODBrain/src/lib/parser.ts),
// except for the few workouts in HAND_FIXES below, where the parser's answer would run the
// wrong clock. Every final plan is then checked with the app's link validator
// (parseInlinePlan in src/lib/share.ts) and against the workout's type and time.
//
// The app is TypeScript, so run this with tsx (from anywhere):
//   npx tsx tools/check-plans.mjs            check only (exit 1 on any problem)
//   npx tsx tools/check-plans.mjs --write    rebuild every plan, then check
// The app repo is expected at ../WODBrain next to this repo; override with
//   --app C:\path\to\WODBrain   or   WODBRAIN_DIR=...
// The app code is only imported, never modified.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "workouts.json");
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APP = path.resolve(argVal("--app") || process.env.WODBRAIN_DIR || path.join(here, "..", "..", "WODBrain"));
const WRITE = args.includes("--write");

const load = (rel) => import(pathToFileURL(path.join(APP, rel)).href);
const { parseWod } = await load("src/lib/parser.ts");
const { parseInlinePlan, extractInlinePlanFromUrl } = await load("src/lib/share.ts");
const { planTotalSeconds } = await load("src/lib/timerMath.ts");

const block = (label, seconds, kind) => ({ label, seconds, kind });

// Workouts the parser can't express correctly, with the reason and the plan to use instead.
// Shapes copy what the parser itself produces for similar workouts.
const HAND_FIXES = {
  barbara: {
    reason:
      'The parser reads "Rest 3 min between rounds" as a 3-second rest block added after the cap. ' +
      "Barbara's rest comes after each round, which a fixed clock can't place, so the plan is the 45 min cap alone " +
      "and the 3 minute rests are in the notes.",
    build: (w) => ({ mode: "FOR_TIME", blocks: [block("For Time Cap", w.capMinutes * 60, "cap")], capSeconds: w.capMinutes * 60 }),
  },
  "fight-gone-bad": {
    reason:
      "The parser alternates the six 1:00 times as work/rest (station 2 and 4 become rest). " +
      "Hand-written as 3 rounds of five labelled 1:00 work stations with 1:00 rest between rounds (17 min).",
    build: () => {
      const stations = ["Wall-ball shots", "Sumo deadlift high pulls", "Box jumps", "Push presses", "Row (calories)"];
      const blocks = [];
      for (let r = 1; r <= 3; r++) {
        for (const s of stations) blocks.push(block(s, 60, "work"));
        if (r < 3) blocks.push(block("Rest", 60, "rest"));
      }
      return { mode: "INTERVAL", blocks };
    },
  },
  "tabata-something-else": {
    reason:
      'The parser matches "Tabata" in the name first and builds a default 8-round Tabata (4 min) instead of 32 rounds, ' +
      'labelled "Tabata N Work". Hand-written as 32 x (0:20 work / 0:10 rest) in the parser\'s Tabata shape, ' +
      "with each interval labelled by its movement (16 min).",
    build: () => {
      const blocks = [];
      for (const m of ["Pull-ups", "Push-ups", "Sit-ups", "Air squats"]) {
        for (let i = 0; i < 8; i++) blocks.push(block(m, 20, "work"), block("Rest", 10, "rest"));
      }
      return { mode: "TABATA", blocks };
    },
  },
};

/** The notes the app shows in its "Workout" panel: one line per movement. */
function notesFor(w) {
  const lines = [w.workout.scheme, ...w.workout.lines];
  if (w.capMinutes) lines.push(`Time cap: ${w.capMinutes} min`);
  return lines.join("\n");
}

function stripMeta(plan) {
  const { name, notes, ...rest } = plan;
  return rest;
}

function buildPlan(w) {
  const fix = HAND_FIXES[w.slug];
  let core;
  if (fix) core = fix.build(w);
  else {
    const res = parseWod(w.timer.whiteboard);
    if (!res.ok) throw new Error(`${w.slug}: parser failed: ${res.error}`);
    core = res.plan;
  }
  return { mode: core.mode, name: w.name, notes: notesFor(w), ...stripMeta(core) };
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function checkPlan(w) {
  const problems = [];
  const plan = w.timer.plan;
  if (!plan) return ["no plan (run with --write)"];
  const json = JSON.stringify(plan);
  const parsed = parseInlinePlan(json);
  if (!parsed) return ["parseInlinePlan rejected the plan"];
  if (!extractInlinePlanFromUrl("wodbrain://plan?d=" + encodeURIComponent(json))) problems.push("link round trip failed");
  if (JSON.stringify(parsed.blocks) !== JSON.stringify(plan.blocks)) problems.push("blocks changed by the validator");
  if (parsed.name !== w.name) problems.push("name lost");

  const total = planTotalSeconds(parsed);
  const blocks = parsed.blocks;
  const want = (w.capMinutes ?? w.durationMinutes) * 60;
  if (!(want > 0)) problems.push("workout has no capMinutes/durationMinutes");
  if (total !== want) problems.push(`total ${fmt(total)} != expected ${fmt(want)}`);

  switch (w.type) {
    case "For Time":
      if (parsed.mode === "FOR_TIME") {
        if (blocks.length !== 1 || blocks[0].kind !== "cap") problems.push("For Time should be one cap block");
        if (parsed.capSeconds !== want) problems.push(`capSeconds ${parsed.capSeconds} != ${want}`);
      } else if (parsed.mode === "EMOM") {
        // For time with a task at the top of every minute (Kalsu): minute blocks up to the cap.
        if (!blocks.every((b) => b.kind === "work" && b.seconds === 60)) problems.push("EMOM blocks should be 1:00 work");
      } else problems.push(`For Time workout has mode ${parsed.mode}`);
      break;
    case "AMRAP":
      if (parsed.mode !== "AMRAP" || blocks.length !== 1 || blocks[0].kind !== "amrap") problems.push("AMRAP should be one amrap block");
      break;
    case "EMOM":
      if (parsed.mode !== "EMOM" || !blocks.every((b) => b.kind === "work" && b.seconds === 60)) problems.push("EMOM should be 1:00 work blocks");
      break;
    case "Intervals":
    case "Tabata":
      if (!["INTERVAL", "TABATA"].includes(parsed.mode)) problems.push(`interval workout has mode ${parsed.mode}`);
      if (!blocks.some((b) => b.kind === "work")) problems.push("no work blocks");
      break;
    default:
      problems.push(`unknown type ${w.type}`);
  }

  // Was the parser's own answer used, or is this a declared hand fix?
  const res = parseWod(w.timer.whiteboard);
  const fromParser = res.ok && JSON.stringify(stripMeta({ ...res.plan })) === JSON.stringify(stripMeta({ ...plan }));
  if (!fromParser && !HAND_FIXES[w.slug]) problems.push("plan differs from the parser's output but is not a declared hand fix");
  if (fromParser && HAND_FIXES[w.slug]) problems.push("declared hand fix is no longer needed: the parser now agrees");
  return { problems, total, mode: parsed.mode, blocks: blocks.length, source: HAND_FIXES[w.slug] ? "hand" : "parser" };
}

const workouts = JSON.parse(readFileSync(DATA, "utf8"));
if (WRITE) {
  for (const w of workouts) {
    w.timer.plan = buildPlan(w);
    if (HAND_FIXES[w.slug]) w.timer.handFixed = HAND_FIXES[w.slug].reason;
    else delete w.timer.handFixed;
  }
  writeFileSync(DATA, JSON.stringify(workouts, null, 2) + "\n");
  console.log(`Wrote ${workouts.length} plans to ${path.relative(process.cwd(), DATA)}`);
}

let failed = 0;
const slugs = new Set();
for (const w of workouts) {
  if (slugs.has(w.slug)) { console.log(`DUPLICATE slug ${w.slug}`); failed++; }
  slugs.add(w.slug);
  const r = checkPlan(w);
  const problems = Array.isArray(r) ? r : r.problems;
  const info = Array.isArray(r) ? "" : `${r.mode.padEnd(9)} ${String(r.blocks).padStart(3)} blocks  ${fmt(r.total).padStart(6)}  ${r.source}`;
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${w.slug.padEnd(22)} ${w.type.padEnd(9)} ${info}`);
  for (const p of problems) console.log(`        - ${p}`);
  if (problems.length) failed++;
}
console.log(failed ? `\n${failed} workout(s) with problems.` : `\nAll ${workouts.length} plans valid.`);
process.exit(failed ? 1 : 0);
