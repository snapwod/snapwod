// Shared parts of the generated pages (tools/build-workouts.mjs, tools/build-timers.mjs):
// site constants, the header/footer and the base CSS, so every generated page has the same nav.

export const SITE = "https://snapwod.co.uk/";
export const OG_IMAGE = SITE + "og-image.png";
export const IOS_STORE_URL = "https://apps.apple.com/us/app/snapwod/id6755497026";
export const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.anonymous.wodbrain";
export const ANDROID_PACKAGE = "com.anonymous.wodbrain";

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const jsonLd = (obj) => JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");

export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Rajdhani:wght@700&display=swap" rel="stylesheet" />`;

// Same palette and type as docs/index.html and docs/open.html.
export const BASE_CSS = `
    :root {
      --bg: #040406; --surface: #111115; --surface-2: #17171d; --line: #26262e;
      --text: #ffffff; --muted: #a1a1aa; --cyan: #00e0ff; --green: #30d158; --orange: #ff9f0a;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0; color: var(--text); background: var(--bg);
      font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 17px; line-height: 1.55;
      -webkit-font-smoothing: antialiased; overflow-x: hidden;
    }
    a { color: inherit; text-decoration: none; }
    img { max-width: 100%; }
    .wrap { max-width: 860px; margin: 0 auto; padding: 0 16px; }
    .display { font-family: Rajdhani, Inter, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.01em; line-height: 0.95; margin: 0; }
    .cyan { color: var(--cyan); }
    header.top {
      position: sticky; top: 0; z-index: 20; background: rgba(4, 4, 6, 0.85);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line);
    }
    .nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 60px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand img { width: 32px; height: 32px; border-radius: 8px; outline: 1px solid var(--line); }
    .brand span { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 22px; }
    .nav-r { display: flex; align-items: center; gap: 18px; white-space: nowrap; }
    @media (max-width: 360px) { .nav-r { gap: 12px; } .nav a.lib { font-size: 14px; } }
    .nav a.lib { font-size: 15px; color: var(--muted); }
    .nav a.lib:hover { color: var(--text); }
    .pill {
      display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 5px 12px; border-radius: 999px; border: 1.5px solid currentColor;
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .pill.hero { color: var(--orange); } .pill.girls { color: var(--cyan); } .pill.classic { color: var(--green); }
    .badges { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: center; }
    .badges img { height: 46px; width: auto; display: block; }
    footer.foot { border-top: 1px solid var(--line); margin-top: 56px; padding: 26px 0 40px; font-size: 14px; color: var(--muted); }
    footer.foot .wrap { display: flex; flex-wrap: wrap; gap: 10px 22px; justify-content: space-between; }
    footer.foot nav { display: flex; flex-wrap: wrap; gap: 8px 20px; }
    footer.foot a:hover { color: var(--text); }
    .crumbs { font-size: 14px; color: var(--muted); margin: 18px 0 0; }
    .crumbs a:hover { color: var(--text); }
    .crumbs span[aria-hidden] { margin: 0 6px; }`;

export const header = (rel) => `<header class="top">
    <div class="wrap nav">
      <a class="brand" href="${rel}"><img src="${rel}snapwod-logo.png" alt="" width="32" height="32" /><span>SnapWOD</span></a>
      <div class="nav-r"><a class="lib" href="${rel}timer/">Timer</a><a class="lib" href="${rel}workouts/">Workout library</a></div>
    </div>
  </header>`;

export const footer = (rel) => `<footer class="foot">
    <div class="wrap">
      <div>© 2026 SnapWOD</div>
      <nav>
        <a href="${rel}">SnapWOD app</a>
        <a href="${rel}workouts/">Workout library</a>
        <a href="${rel}timer/">Workout timer</a>
        <a href="${rel}support.html">Support</a>
        <a href="${rel}privacy.html">Privacy</a>
      </nav>
    </div>
  </footer>`;
