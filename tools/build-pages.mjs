// Builds the standalone guide pages at the site root:
//   docs/whiteboard-to-timer.html   what the whiteboard photo reader does, and its limits
//   docs/smartwod-alternative.html  SnapWOD vs SmartWOD vs a wall clock
//   docs/sitemap.xml                these URLs added (other entries kept as they are)
// Competitor facts were checked in November 2026 (store listings, Rogue's EU store); recheck them
// before changing the comparison, and keep it to things that can be verified.
// Plain Node 18+, no dependencies:  node tools/build-pages.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, OG_IMAGE, IOS_STORE_URL, ANDROID_STORE_URL, esc, jsonLd, FONTS, BASE_CSS, header, footer } from "./site.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, "..", "docs");

const PAGE_CSS = `
    main { padding-bottom: 8px; }
    .hero-block { padding: 20px 0 4px; }
    h1.display { font-size: clamp(40px, 11vw, 68px); overflow-wrap: anywhere; }
    .headline { font-size: 18px; color: var(--muted); margin: 12px 0 0; }
    .ticks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .ticks li { display: flex; gap: 12px; align-items: flex-start; color: #d4d4d8; font-size: 16px; }
    .ticks li::before {
      content: ""; flex: none; width: 20px; height: 20px; margin-top: 3px; border-radius: 50%;
      background: var(--cyan) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5 10.5l3.2 3L15 7' fill='none' stroke='%23001014' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;
    }
    .ticks b { color: var(--text); }
    section.block { margin-top: 34px; }
    section.block h2 { font-size: 30px; margin: 0 0 12px; }
    section.block h3 { font-size: 17px; margin: 18px 0 6px; }
    section.block p { color: #d4d4d8; margin: 0 0 12px; }
    section.block ul, section.block ol { color: #d4d4d8; margin: 0 0 12px; padding-left: 22px; }
    section.block li { margin: 0 0 6px; }
    section.block a { color: var(--cyan); }
    section.block b { color: var(--text); }
    .steps { list-style: none; padding: 0 !important; display: grid; gap: 10px; counter-reset: s; }
    .steps li { counter-increment: s; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px 12px 52px; position: relative; margin: 0 !important; }
    .steps li::before { content: counter(s); position: absolute; left: 16px; top: 8px; font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 28px; color: var(--cyan); }
    .board { display: grid; gap: 10px; }
    .board > div { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
    .board .lbl { font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
    .board pre { margin: 0; font: 600 16px/1.5 ui-monospace, Consolas, monospace; color: var(--text); white-space: pre-wrap; }
    .board ol { margin: 0; padding-left: 20px; }
    .tbl { overflow-x: auto; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; font-size: 15px; }
    th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); color: #d4d4d8; }
    thead th { color: var(--text); font-size: 14px; border-bottom: 2px solid var(--line); }
    tbody th { color: var(--text); font-weight: 600; white-space: nowrap; }
    td.us { color: var(--text); }
    .src { font-size: 13px; color: var(--muted); }
    details { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin: 0 0 10px; }
    summary { cursor: pointer; font-weight: 600; color: var(--text); }
    details p { margin: 8px 0 0 !important; }
    .get { margin-top: 40px; text-align: center; padding: 26px 18px; border-radius: 20px; border: 1px solid var(--line);
      background: radial-gradient(60% 90% at 25% 100%, rgba(0, 224, 255, 0.16), transparent 70%), radial-gradient(50% 80% at 85% 0%, rgba(48, 209, 88, 0.12), transparent 70%), var(--surface); }
    .get h2 { font-size: 32px; margin: 0 0 10px; }
    .get p { color: var(--muted); margin: 0 auto 18px; max-width: 460px; font-size: 16px; }
    /* Phones: one card per row, each answer labelled with its product. */
    @media (max-width: 699px) {
      table, tbody, tr, th, td { display: block; }
      thead { display: none; }
      tbody tr { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 8px 14px 10px; margin: 0 0 10px; }
      tbody th, td { border: 0; padding: 5px 0; }
      tbody th { font-family: Rajdhani, sans-serif; font-size: 20px; text-transform: uppercase; }
      td::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
      td.us::before { color: var(--cyan); }
    }
    @media (min-width: 700px) { .board { grid-template-columns: 1fr 1fr; } }`;

const badges = (lazy) => `<div class="badges">
        <a href="${IOS_STORE_URL}" rel="noopener"><img src="app-store-badge.svg" alt="Download on the App Store" width="138" height="46"${lazy ? ' loading="lazy"' : ""} /></a>
        <a href="${ANDROID_STORE_URL}" rel="noopener"><img src="google-play-badge.svg" alt="Get it on Google Play" width="155" height="46"${lazy ? ' loading="lazy"' : ""} /></a>
      </div>`;

/** FAQ entries are [question, answer HTML]; the structured data gets the answer as plain text. */
const faqHtml = (faq) => faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join("\n      ");
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

function page(p) {
  const url = SITE + p.slug;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "SnapWOD", item: SITE },
        { "@type": "ListItem", position: 2, name: p.crumb, item: url },
      ] },
      { "@type": "FAQPage", mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(a) } })) },
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
  <link rel="icon" href="snapwod-logo.png" />
  <link rel="apple-touch-icon" href="snapwod-logo.png" />
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
  <style>${BASE_CSS}${PAGE_CSS}
  </style>
</head>
<body>
  ${header("")}
  <main class="wrap">
    <p class="crumbs"><a href="./">SnapWOD</a><span aria-hidden="true">›</span>${esc(p.crumb)}</p>
    <section class="hero-block">
      <h1 class="display">${p.h1}</h1>
      <p class="headline">${p.headline}</p>
    </section>
${p.body}
    <section class="block" aria-labelledby="faq-h">
      <h2 class="display" id="faq-h">Questions</h2>
      ${faqHtml(p.faq)}
    </section>

    <section class="get">
      <h2 class="display">Snap the board. <span class="cyan">Start the clock.</span></h2>
      <p>Free on iPhone and Android. No account needed.</p>
      ${badges(true)}
    </section>
  </main>
  ${footer("")}
</body>
</html>
`;
}

// ---------- pages ----------
const PAGES = [
  {
    slug: "whiteboard-to-timer",
    crumb: "Whiteboard to timer",
    title: "Whiteboard to Timer: Turn a Photo of the WOD into a Workout Clock | SnapWOD",
    ogTitle: "Turn a photo of the whiteboard into a workout timer",
    description:
      "Take a photo of the gym whiteboard and SnapWOD builds the timer: EMOMs, AMRAPs, For Time with a cap, intervals, Tabata and multi-part sessions with the rest built in. Free on iPhone and Android.",
    h1: 'Whiteboard <span class="cyan">to timer</span>',
    headline:
      "Take a photo of the gym whiteboard, or paste the workout from your gym's app, and SnapWOD builds the timer for you. No programming every interval by hand.",
    body: `
    <section class="block" aria-labelledby="how-h">
      <h2 class="display" id="how-h">How it works</h2>
      <ol class="steps">
        <li><b>Snap the board.</b> Open SnapWOD and take a photo of the whiteboard. Copied the workout from your gym's app or a programming site? Paste the text instead.</li>
        <li><b>Check the preview.</b> SnapWOD shows each part it found, with the time, the rounds and the rest. If something's off, take the photo again or type the workout in.</li>
        <li><b>Start the clock.</b> The timer beeps you through every part and keeps running with your phone locked. Coaching a class? Put it on the gym TV.</li>
      </ol>
    </section>

    <section class="block" aria-labelledby="ex-h">
      <h2 class="display" id="ex-h">An example</h2>
      <div class="board">
        <div>
          <p class="lbl">On the whiteboard</p>
          <pre>A) EMOM 12
1: 12 cal row
2: 10 burpees
3: 15 wall balls

Rest 3:00

B) AMRAP 10
5 pull-ups
10 push-ups
15 air squats</pre>
        </div>
        <div>
          <p class="lbl">The timer SnapWOD builds</p>
          <ol>
            <li><b>EMOM 12:00</b>, 12 one-minute rounds rotating through the row, the burpees and the wall balls, with each minute's movement on screen.</li>
            <li><b>Rest 3:00</b>, counted down, with a beep before part B.</li>
            <li><b>AMRAP 10:00</b>, with the three movements on screen.</li>
          </ol>
        </div>
      </div>
    </section>

    <section class="block" aria-labelledby="what-h">
      <h2 class="display" id="what-h">What it reads</h2>
      <ul class="ticks">
        <li><span><b>EMOM</b>, including E2MOM and E3MOM, and alternating stations minute by minute.</span></li>
        <li><span><b>AMRAP</b> of any length.</span></li>
        <li><span><b>For Time</b>, with the time cap if the board has one.</span></li>
        <li><span><b>Intervals and Tabata</b>: work and rest times, rounds and sets.</span></li>
        <li><span><b>Multi-part sessions</b>: a strength piece, then a conditioning piece, with the rest between them built in.</span></li>
      </ul>
    </section>

    <section class="block" aria-labelledby="read-h">
      <h2 class="display" id="read-h">Smart read and the basic reader</h2>
      <p>SnapWOD has two ways to read a workout.</p>
      <p><b>Smart read</b> handles the whole whiteboard: several parts, the movements for each minute, rest between parts, and messy handwriting. You get 2 smart reads a month free, and up to 100 a month with Premium.</p>
      <p><b>The basic reader</b> runs on your phone, free and unlimited, and works offline. It is good for a single format with the time written clearly, such as "EMOM 12" or "AMRAP 20". For a session with several parts, use a smart read.</p>
      <p>Either way, check the preview before you start. Clear block capitals read best; a photo taken square-on, without glare, reads better than one from across the room.</p>
    </section>

    <section class="block" aria-labelledby="tv-h">
      <h2 class="display" id="tv-h">On the gym TV</h2>
      <p>Coaches can put the timer on any TV with a web browser. Open <a href="tv">snapwod.co.uk/tv</a> on the TV, type the six-letter code from the phone, and run the class from the phone. The TV shows the clock, the movements for the current part, the round and what's next. Nothing to install on the TV. See how it compares with a <a href="smartwod-alternative">timer app or a wall clock</a>.</p>
    </section>

    <section class="block" aria-labelledby="free-h">
      <h2 class="display" id="free-h">Just need a quick timer?</h2>
      <p>The <a href="timer/">free web timer</a> runs EMOM, AMRAP, For Time, Tabata and intervals in your browser with no install. The <a href="workouts/">workout library</a> has the benchmark WODs ready to run.</p>
    </section>
`,
    faq: [
      ["Is it free?", "Yes. SnapWOD is free on iPhone and Android, with 2 smart reads a month and the basic reader without limits. Premium adds up to 100 smart reads a month and cloud backup for up to 30 saved workouts."],
      ["Can it read handwriting?", "Yes, with a smart read. Clear block capitals work best. Check the preview before you start, and take the photo again if something was misread."],
      ["Can I paste a workout from my gym's app?", "Yes. Copy the workout text from your gym's app, website or a programming page and paste it into SnapWOD instead of taking a photo."],
      ["Does it work offline?", "The timer and the basic reader work offline. A smart read needs an internet connection."],
      ["Which formats does it understand?", "EMOM (including E2MOM and E3MOM), AMRAP, For Time with a cap, intervals, Tabata and multi-part sessions with rest between the parts."],
    ],
  },
  {
    slug: "smartwod-alternative",
    crumb: "Compare gym timers",
    title: "SmartWOD Alternative: SnapWOD vs SmartWOD vs a Gym Wall Clock | SnapWOD",
    ogTitle: "SnapWOD vs SmartWOD vs a gym wall clock",
    description:
      "Comparing gym timers: SnapWOD, SmartWOD and a wall clock such as the Rogue Echo. Price, setting up a workout, getting it on the gym TV, and which one suits you.",
    h1: 'SnapWOD vs SmartWOD <span class="cyan">vs a wall clock</span>',
    headline:
      "Three ways to time a WOD: a timer app, a timer app on the gym TV, or a dedicated wall clock. An honest comparison, written by the person who makes SnapWOD.",
    body: `
    <section class="block" aria-labelledby="tbl-h">
      <h2 class="display" id="tbl-h">At a glance</h2>
      <div class="tbl">
        <table>
          <thead><tr><th></th><th>SnapWOD</th><th>SmartWOD</th><th>Wall clock (e.g. Rogue Echo)</th></tr></thead>
          <tbody>
            <tr><th>Price</th><td class="us" data-label="SnapWOD">Free. Premium optional, for more smart reads and cloud backup</td><td data-label="SmartWOD">Free with ads. Paid Premium (subscription or lifetime) and an ad-free purchase</td><td data-label="Wall clock">Hardware. The Rogue Echo is around €290 in Rogue's EU store; most gym clocks cost a few hundred pounds per clock</td></tr>
            <tr><th>Setting up a workout</th><td class="us" data-label="SnapWOD">Photo of the whiteboard or pasted text, or set it up by hand</td><td data-label="SmartWOD">Set up in the app</td><td data-label="Wall clock">Buttons or a remote</td></tr>
            <tr><th>On the gym TV</th><td class="us" data-label="SnapWOD">Any TV with a web browser: open snapwod.co.uk/tv and type a code</td><td data-label="SmartWOD">Cast with Chromecast</td><td data-label="Wall clock">It is the display</td></tr>
            <tr><th>What the screen shows</th><td class="us" data-label="SnapWOD">Clock, the movements for the current part, round, what's next</td><td data-label="SmartWOD">The running timer</td><td data-label="Wall clock">Time and rounds in large digits</td></tr>
            <tr><th>Without wi-fi or a TV</th><td class="us" data-label="SnapWOD">The phone timer works offline; the TV page needs internet</td><td data-label="SmartWOD">The phone timer works offline; casting needs Chromecast</td><td data-label="Wall clock">Works on its own</td></tr>
          </tbody>
        </table>
      </div>
      <p class="src">Checked November 2026 from the App Store listings and Rogue's EU store. Prices vary by country and change; check before you buy.</p>
    </section>

    <section class="block" aria-labelledby="pick-h">
      <h2 class="display" id="pick-h">Which one suits you</h2>
      <h3>Pick SmartWOD if</h3>
      <p>you want a well-established timer app with a long track record and a lot of ratings, you set your own workouts up and you already cast to a TV with Chromecast.</p>
      <h3>Pick a wall clock if</h3>
      <p>you want a timer that's always on the wall, readable from across the room, and never depends on a phone, wi-fi or a TV being switched on. The trade-off is the price per clock and that it only shows numbers.</p>
      <h3>Pick SnapWOD if</h3>
      <p>the workout is already written on the whiteboard and you don't want to set every interval up by hand, or you want members to see the movements for each minute on the TV rather than walking over to the board. It's free, and the TV needs only a web browser.</p>
    </section>

    <section class="block" aria-labelledby="gym-h">
      <h2 class="display" id="gym-h">For coaches and gym owners</h2>
      <ul class="ticks">
        <li><span><b>Use the TV you already have.</b> Smart TV, streaming stick or a laptop on HDMI: anything with a browser.</span></li>
        <li><span><b>Run the class from your phone.</b> Start, pause and skip on the phone; the TV follows.</span></li>
        <li><span><b>Open gym too.</b> Members put their own workout on the TV the same way, from their own phone.</span></li>
        <li><span><b>Free for coaches.</b> Coaches at gyms running SnapWOD on the TV get Premium at no cost: email <a href="mailto:admin@snapwod.co.uk">admin@snapwod.co.uk</a>.</span></li>
      </ul>
      <p style="margin-top:12px">More on <a href="whiteboard-to-timer">how the whiteboard reader works</a>, or try the <a href="timer/">free web timer</a> first.</p>
    </section>
`,
    faq: [
      ["Is SnapWOD a free alternative to SmartWOD?", "Yes. SnapWOD is free on iPhone and Android. Premium is optional and adds more smart whiteboard reads and cloud backup."],
      ["Do I need a Chromecast or a TV app?", "No. The TV only needs a web browser. Open snapwod.co.uk/tv, type the code shown on the phone, and the phone runs the timer."],
      ["Can SnapWOD replace a wall clock?", "If the gym has a TV or monitor, yes: it shows the clock, the round and the movements. A wall clock is still the better pick if you want something that works with no phone, wi-fi or TV."],
      ["Can members use it in open gym?", "Yes. Any member can put their own workout on the TV from their own phone with the same code system."],
      ["Who makes SnapWOD?", "SnapWOD is made by Rob, who trains at a gym in Surbiton, UK. Questions: admin@snapwod.co.uk."],
    ],
  },
];

// ---------- sitemap ----------
function updateSitemap(pages, lastmod) {
  const file = path.join(DOCS, "sitemap.xml");
  const xml = readFileSync(file, "utf8");
  const nl = xml.includes("\r\n") ? "\r\n" : "\n";
  const urls = new Set(pages.map((p) => SITE + p.slug));
  const kept = xml.split(/\r?\n/).filter((l) => ![...urls].some((u) => l.includes(`<loc>${u}</loc>`)));
  // After the main pages (before the timer section), so the generators can run in any order.
  let at = kept.findIndex((l) => l.includes(`<loc>${SITE}timer/</loc>`));
  if (at < 0) at = kept.findIndex((l) => l.trim() === "</urlset>");
  if (at < 0) throw new Error("sitemap.xml: no </urlset>");
  const ours = pages.map((p) => `  <url><loc>${SITE + p.slug}</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`);
  writeFileSync(file, [...kept.slice(0, at), ...ours, ...kept.slice(at)].join(nl));
}

const lastmod = new Date().toISOString().slice(0, 10);
for (const p of PAGES) writeFileSync(path.join(DOCS, `${p.slug}.html`), page(p));
updateSitemap(PAGES, lastmod);
console.log(`Built ${PAGES.length} pages (${PAGES.map((p) => p.slug).join(", ")}), sitemap updated (lastmod ${lastmod}).`);
