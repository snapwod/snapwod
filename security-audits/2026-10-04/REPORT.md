# SnapWOD static sites: security audit report (run-1)

## 1. Run scope
- **Profile:** `quick`. This is a partial pass by design: one hunter wave and one final coverage critic.
- **Targets:**
  - `snapwod/snapwod` @ `82df09f431b4bc20f82591eb126e5ef5fa913440` (`docs/`, GitHub Pages)
  - `salarycliff/snapwod` @ `2343d3ed3cb7411d9a7f8d78717e2ae257b97e1a`
- **Budget:** none set. Agents used: 1 hunter and 1 final critic. Reconnaissance was done by the parent because the targets total 11 files.
- **Execution:** sandboxed, source and local only. Inline scripts ran in Node inside the no-network sandbox against a mocked DOM. The live site was not contacted.
- **Prior runs:** none, so there is no prior ledger. The newer `docs/` copy was also reviewed in the WODBrain run-1 audit (unit `docs/open.html#query w`), with the same result.

## 2. Security posture
These are static marketing and share-landing pages. They have no accounts, no server, no cookies, no secrets and no dependencies. The only untrusted input is the `?w` query parameter. Every path encodes it before use and it never selects a navigation scheme or host.

## 3. Confirmed findings
None.

## 4. Needs validation
None.

## 5. Hardening notes
- GitHub Pages cannot send CSP or `X-Frame-Options` headers. A restrictive `<meta http-equiv="Content-Security-Policy">` would add defence in depth: hash the inline scripts and allow fonts only from Google Fonts. Clickjacking is not a finding here, because no framed action changes any state.
- `open.html` and `ig.html` pass `?w` through without validating its format, although they do encode it. Limiting it to the workout-ID charset would shrink the attacker-controlled input that reaches the native app's deep-link handler. The WODBrain audit reviewed that handler and found it safe.
- `snapwod-logo.png` carries a C2PA content-credentials chunk. It is not sensitive.

**Positive patterns:**
- `encodeURIComponent` is used before building the `wodbrain://` URL.
- `URLSearchParams.set` is used on fixed store URLs.
- DOM writes use `textContent` only.
- Store URLs are hard-coded.
- External links use `rel=noreferrer`.

## 6. Coverage
- 2 units, both covered: injection/navigation, and obvious things.
- There are no candidate, blocked or deferred units.
- The final critic found no missing units.
- All server, cloud, LLM, mobile, data and supply-chain companions are excluded because none of those surfaces exists in these repositories.
